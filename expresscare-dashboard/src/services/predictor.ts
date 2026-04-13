/**
 * Browser-side LightGBM inference for ED census score prediction.
 *
 * Loads the exported JSON model and runs tree evaluation in the browser.
 * Falls back to the placeholder forecast if model files fail to load.
 */

import { placeholderForecast, getHospitalBaseline as getPlaceholderBaseline } from './predictor-placeholder';

// ── Types ──────────────────────────────────────────────────────────

interface TreeNode {
  split_feature?: number;
  threshold?: number;
  decision_type?: string;
  default_left?: boolean;
  left_child?: TreeNode;
  right_child?: TreeNode;
  leaf_value?: number;
}

interface LGBMModel {
  tree_info: Array<{ tree_structure: TreeNode }>;
  feature_names?: string[];
}

interface InferenceConfig {
  feature_names: string[];
  hospital_label_map: Record<string, number>;
  horizons: number[];
  target_clamp: [number, number];
  trained_date: string;
  train_samples: number;
  test_mae_1h: number | null;
  test_mae_4h: number | null;
}

// ── Module state ───────────────────────────────────────────────────

let model1h: LGBMModel | null = null;
let config: InferenceConfig | null = null;
let baselines: Record<string, number[]> | null = null;
let loadAttempted = false;
let loadFailed = false;

// ── Tree evaluation ────────────────────────────────────────────────

function evaluateTree(node: TreeNode, features: number[]): number {
  if (node.leaf_value !== undefined) return node.leaf_value;

  const featureIdx = node.split_feature!;
  const val = features[featureIdx];

  // LightGBM: NaN/null → default direction (usually left)
  if (val === null || val === undefined || isNaN(val)) {
    const goLeft = node.default_left !== false; // default is left
    return goLeft
      ? evaluateTree(node.left_child!, features)
      : evaluateTree(node.right_child!, features);
  }

  if (val <= node.threshold!) {
    return evaluateTree(node.left_child!, features);
  }
  return evaluateTree(node.right_child!, features);
}

function predict(model: LGBMModel, features: number[]): number {
  let sum = 0;
  for (const tree of model.tree_info) {
    sum += evaluateTree(tree.tree_structure, features);
  }
  return sum;
}

// ── Model loading ──────────────────────────────────────────────────

async function loadModel(): Promise<boolean> {
  if (loadAttempted) return !loadFailed;
  loadAttempted = true;

  try {
    const [modelRes, configRes, baselinesRes] = await Promise.all([
      fetch('/data/model/lgbm_1h.json'),
      fetch('/data/model/inference_config.json'),
      fetch('/data/model/hospital_baselines.json'),
    ]);

    if (!modelRes.ok || !configRes.ok) {
      throw new Error(`Model load failed: model=${modelRes.status}, config=${configRes.status}`);
    }

    model1h = await modelRes.json();
    config = await configRes.json();
    baselines = baselinesRes.ok ? await baselinesRes.json() : null;

    console.log(`[predictor] LightGBM model loaded: ${model1h!.tree_info.length} trees, MAE=${config!.test_mae_1h}`);
    return true;
  } catch (err) {
    console.warn('[predictor] Failed to load LightGBM model, using placeholder:', err);
    loadFailed = true;
    return false;
  }
}

// ── Feature construction ───────────────────────────────────────────

function buildFeatureVector(
  currentScore: number,
  hour: number,
  minute: number,
  hospitalCode: string,
  state: {
    numUnits: number;
    numUnitsEnroute: number;
    minStay: number;
    maxStay: number;
    alertYellow: boolean;
    alertRed: boolean;
    alertReroute: boolean;
  },
  overrides?: Partial<Record<string, number>>,
): number[] {
  if (!config) return [];

  const hourFrac = hour + minute / 60;
  const now = new Date();
  const dow = now.getDay() === 0 ? 6 : now.getDay() - 1; // Monday=0
  const month = now.getMonth() + 1;

  const alertYellow = state.alertYellow ? 1 : 0;
  const alertRed = state.alertRed ? 1 : 0;
  const alertReroute = state.alertReroute ? 1 : 0;
  const anyAlert = Math.max(alertYellow, alertRed, alertReroute);
  const alertCount = alertYellow + alertRed + alertReroute;

  const hospitalEnc = config.hospital_label_map[hospitalCode] ?? 0;

  // Default feature values
  const featureMap: Record<string, number> = {
    ed_census_score: currentScore,
    num_units: state.numUnits,
    num_units_enroute: state.numUnitsEnroute,
    min_stay_minutes: state.minStay,
    max_stay_minutes: state.maxStay,
    any_alert: anyAlert,
    alert_count: alertCount,

    // Lag features: use current as best proxy
    census_lag_1h: currentScore,
    census_lag_2h: currentScore,
    census_lag_4h: currentScore,
    census_lag_8h: currentScore,
    census_lag_24h: currentScore,
    census_rolling_3h: currentScore,
    census_rolling_6h: currentScore,
    census_rolling_12h: currentScore,
    census_rolling_std_3h: 0.3, // typical volatility
    census_change_2h: 0,
    units_rolling_3h: state.numUnits,
    max_stay_rolling_3h: state.maxStay,

    // Temporal
    hour_sin: Math.sin(2 * Math.PI * hourFrac / 24),
    hour_cos: Math.cos(2 * Math.PI * hourFrac / 24),
    dow_sin: Math.sin(2 * Math.PI * dow / 7),
    dow_cos: Math.cos(2 * Math.PI * dow / 7),
    month_sin: Math.sin(2 * Math.PI * month / 12),
    month_cos: Math.cos(2 * Math.PI * month / 12),
    is_weekend: (dow >= 5) ? 1 : 0,
    hour_linear: hour,

    // Weather (NaN → LightGBM handles)
    temperature_2m: NaN,
    precipitation: NaN,
    relative_humidity_2m: NaN,

    // Flu
    ili_rate: NaN,

    // Hospital identity
    hospital_code_encoded: hospitalEnc,

    // HSCRC baselines (NaN if unavailable)
    baseline_monthly_volume: NaN,
    baseline_monthly_visits: NaN,
    baseline_admit_rate: NaN,
    seasonal_index: NaN,
    licensed_beds: NaN,
  };

  // Apply overrides
  if (overrides) {
    for (const [key, val] of Object.entries(overrides)) {
      if (val !== undefined) featureMap[key] = val;
    }
  }

  // Build ordered feature vector matching model's expected order
  return config.feature_names.map((name) => featureMap[name] ?? NaN);
}

// ── Public API ─────────────────────────────────────────────────────

export async function forecast(
  currentScore: number,
  hour: number,
  hospitalCode: string,
  currentState: {
    numUnits: number;
    numUnitsEnroute: number;
    minStay: number;
    maxStay: number;
    alertYellow: boolean;
    alertRed: boolean;
    alertReroute: boolean;
  },
): Promise<{ p10: number[]; p50: number[]; p90: number[] }> {
  const loaded = await loadModel();

  if (!loaded || !model1h || !config) {
    // Fallback to placeholder
    const baseline = getPlaceholderBaseline(hospitalCode);
    return placeholderForecast(currentScore, hour, baseline);
  }

  const mae = config.test_mae_1h ?? 0.5;
  const steps = 48; // 30-min steps over 24 hours
  const p10: number[] = [];
  const p50: number[] = [];
  const p90: number[] = [];

  const now = new Date();
  let prevScore = currentScore;

  for (let i = 0; i <= steps; i++) {
    const hoursAhead = i * 0.5;
    const futureDate = new Date(now.getTime() + hoursAhead * 3600000);
    const futureHour = futureDate.getHours();
    const futureMinute = futureDate.getMinutes();
    const futureDow = futureDate.getDay() === 0 ? 6 : futureDate.getDay() - 1;
    const futureMonth = futureDate.getMonth() + 1;

    let predicted: number;

    if (i === 0) {
      predicted = currentScore;
    } else {
      // Build features for this future time step
      const overrides: Record<string, number> = {
        ed_census_score: prevScore,
        hour_sin: Math.sin(2 * Math.PI * (futureHour + futureMinute / 60) / 24),
        hour_cos: Math.cos(2 * Math.PI * (futureHour + futureMinute / 60) / 24),
        dow_sin: Math.sin(2 * Math.PI * futureDow / 7),
        dow_cos: Math.cos(2 * Math.PI * futureDow / 7),
        month_sin: Math.sin(2 * Math.PI * futureMonth / 12),
        month_cos: Math.cos(2 * Math.PI * futureMonth / 12),
        is_weekend: futureDow >= 5 ? 1 : 0,
        hour_linear: futureHour,
        // Use predicted values as synthetic lags
        census_lag_1h: i >= 2 ? p50[Math.max(0, i - 2)] : currentScore,
        census_lag_2h: i >= 4 ? p50[Math.max(0, i - 4)] : currentScore,
        census_rolling_3h: prevScore,
        census_rolling_6h: i > 1 ? (currentScore + prevScore) / 2 : currentScore,
        census_change_2h: prevScore - currentScore,
      };

      const features = buildFeatureVector(
        prevScore, futureHour, futureMinute, hospitalCode,
        currentState, overrides,
      );

      const raw = predict(model1h, features);
      predicted = Math.max(1.0, Math.min(4.0, raw));
    }

    // Uncertainty grows with horizon
    const spread = 1.28 * mae * Math.sqrt(Math.max(hoursAhead, 0.1));
    const clamp = (v: number) => Math.max(1.0, Math.min(4.0, v));

    p50.push(clamp(Math.round(predicted * 100) / 100));
    p10.push(clamp(Math.round((predicted - spread) * 100) / 100));
    p90.push(clamp(Math.round((predicted + spread) * 100) / 100));

    prevScore = predicted;
  }

  return { p10, p50, p90 };
}

export function getHospitalBaseline(hospitalCode: string): number[] {
  if (baselines && baselines[hospitalCode]) {
    return baselines[hospitalCode];
  }
  return new Array(24).fill(2.0);
}

/** Return model metadata for display (e.g., in chart badges). */
export async function getModelMeta(): Promise<{
  loaded: boolean;
  mae1h: number | null;
  mae4h: number | null;
  trainedDate: string;
  treeCount: number;
}> {
  await loadModel();
  if (!config || !model1h) {
    return { loaded: false, mae1h: null, mae4h: null, trainedDate: '', treeCount: 0 };
  }
  return {
    loaded: true,
    mae1h: config.test_mae_1h,
    mae4h: config.test_mae_4h,
    trainedDate: config.trained_date,
    treeCount: model1h.tree_info.length,
  };
}
