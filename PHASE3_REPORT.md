# Phase 3 Report: Predictive Model (Headless)

**Date:** April 13, 2026
**Status:** Complete - All success criteria met

---

## Summary

Built and deployed a LightGBM-based predictive model for ED census scores, trained on 7 days of EDAS collector data (73,649 snapshots across 72 hospitals). The model runs client-side in the browser via a custom tree evaluator that loads the exported JSON model. The placeholder forecast has been replaced with real model predictions in the dashboard.

---

## Model Metrics

### 1-Hour Horizon Model (`lgbm_1h`)

| Metric | Value |
|--------|-------|
| MAE | **0.161** |
| RMSE | 0.348 |
| Trees | 110 |
| Features | 37 |
| Train rows | 49,291 |
| Test rows | 12,323 |

**Confusion matrix (rounded predictions vs actual, 1-4 scale):**

| | Pred 1 | Pred 2 | Pred 3 | Pred 4 |
|---|---|---|---|---|
| **Actual 1** | 5,152 | 221 | 69 | 14 |
| **Actual 2** | 120 | 2,392 | 209 | 12 |
| **Actual 3** | 0 | 309 | 2,135 | 37 |
| **Actual 4** | 12 | 3 | 179 | 1,459 |

Overall accuracy (exact integer match): 90.2%

### 4-Hour Horizon Model (`lgbm_4h`)

| Metric | Value |
|--------|-------|
| MAE | **0.361** |
| RMSE | 0.602 |
| Trees | 112 |

### Per-Hour-of-Day MAE (1h model)

Peak error hours are 11:00 (0.259) and 17:00 (0.277) -- transition periods when census scores are most volatile. Overnight hours (0:00-7:00) have MAE < 0.14 since census scores are more stable.

### Top 10 Features by Gain (1h model)

1. `ed_census_score` -- 400,155 (dominant, as expected from literature)
2. `census_lag_1h` -- 44,035
3. `census_rolling_3h` -- 12,661
4. `hospital_code_encoded` -- 5,526
5. `census_rolling_12h` -- 4,964
6. `census_lag_24h` -- 4,728
7. `hour_cos` -- 4,183
8. `hour_sin` -- 4,140
9. `census_rolling_6h` -- 2,723
10. `max_stay_rolling_3h` -- 2,157

This aligns with the research literature: current ED state is the strongest predictor, followed by recent history (lag/rolling features), hospital identity, and temporal features.

---

## Decisions Made

1. **Separate 1h and 4h models** (not a single model with horizon as a feature). The 4h model has fundamentally different error characteristics and training two models is simpler and more interpretable.

2. **Weather and flu features are NaN for this training run.** Weather history ends April 6 while EDAS collection began April 7. Flu data ends at epiweek 202612 (late March 2026). LightGBM handles NaN natively and simply ignores these features. They will activate once the data pipelines are re-synced or more EDAS history accumulates into a range covered by weather data.

3. **HSCRC baselines are empty.** The HSCRC Excel files have not been downloaded yet. The model trains without these features (all NaN). See "Re-training with HSCRC data" below.

4. **Autoregressive rollout for 24h forecast curve.** The browser-side predictor chains 1h predictions forward, using each prediction as the "current score" for the next step. Temporal features (hour_sin, hour_cos, etc.) are recomputed for each future step. Lag features use predicted values as synthetic lags. This produces a smooth trajectory that captures time-of-day patterns.

5. **Uncertainty bands via parametric approximation.** Since LightGBM regression gives point estimates, p10/p90 bands are computed as `prediction +/- 1.28 * MAE * sqrt(hours_ahead)`. The sqrt scaling reflects increasing uncertainty with horizon.

6. **13.2% null rate on `ed_census_score`.** Some hospitals don't report census scores. These rows are retained in training (with NaN census handled by LightGBM) and contribute to other feature learning.

---

## Pipeline Architecture

```
model/
  extract_training_data.py  -- Pulls EDAS snapshots from Railway Postgres to Parquet
  parse_hscrc.py            -- Parses HSCRC Excel files (produces empty output if no files)
  features.py               -- Feature engineering: 37 features across 7 groups
  train.py                  -- LightGBM training + SHAP analysis
  export_model.py           -- Exports model JSON for browser inference
  generate_baselines.py     -- Per-hospital hourly baseline profiles from EDAS history
  artifacts/                -- All intermediate and final artifacts

public/data/model/
  lgbm_1h.json              -- 2.5 MB model JSON (110 trees)
  lgbm_4h.json              -- 2.6 MB model JSON (112 trees)
  inference_config.json     -- Feature names, hospital label map, metrics
  hospital_baselines.json   -- 72 hospitals x 24 hourly mean census scores

src/services/predictor.ts           -- Browser-side LightGBM inference (replaced placeholder)
src/services/predictor-placeholder.ts -- Original placeholder (kept as fallback)
src/components/Timeline/ForecastChart.tsx -- Updated for async model loading
```

### Feature Groups (37 total)

| Group | Count | Description |
|-------|-------|-------------|
| Current ED state | 7 | Census score, EMS units, stay times, alerts |
| Lag features | 12 | 1h/2h/4h/8h/24h lags, 3h/6h/12h rolling means, volatility, trend |
| Temporal | 8 | Sin/cos encoded hour/dow/month, weekend flag, linear hour |
| Weather | 3 | Temperature, precipitation, humidity (NaN for this run) |
| Flu/ILI | 1 | Weekly ILI rate (NaN for this run) |
| Hospital identity | 1 | Label-encoded hospital code |
| HSCRC baselines | 5 | Monthly volume, visits, admit rate, seasonal index, beds (NaN for this run) |

---

## Frontend Integration

- `ForecastChart.tsx` now loads the model asynchronously via `useEffect` and displays real predictions
- Model metadata badge shows "LightGBM 110T | MAE: 0.16" instead of "PLACEHOLDER MODEL"
- If model files fail to load (404 or parse error), graceful fallback to placeholder forecast with console warning
- Hospital baselines computed from real EDAS history (72 hospitals x 24 hours) replace the hardcoded `Array(24).fill(2.0)`

---

## Known Limitations

1. **Only 7 days of training data.** Model accuracy will improve significantly with 30+ days of data, which will provide better coverage of weekly cycles, weekend patterns, and more diverse conditions.

2. **Weather and flu features inactive.** The weather history file ends before the EDAS collection period. Re-running `npm run weather` to fetch updated weather data and then re-training will activate these features.

3. **No HSCRC baselines.** Monthly volume baselines from HSCRC provide important context (is this hospital normally busy?). Download the Excel files from https://hscrc.maryland.gov/Pages/hsp_Data2.aspx and place them in `scripts/data/hscrc/`, then re-run the pipeline.

4. **Model JSON size (2.5 MB per model).** Acceptable for initial load but should be compressed or lazy-loaded if it becomes a bottleneck. Consider gzip transfer encoding.

5. **Autoregressive drift.** The 24h forecast chains predictions forward, so errors compound. The 1h model is accurate, but predictions beyond ~4h should be interpreted as trends, not precise forecasts.

6. **Hospital 212 (Saint Agnes) has highest MAE (0.44).** Some hospitals have more volatile census patterns that are harder to predict with only 7 days of history.

---

## Re-training Instructions

### Full pipeline re-run (after more data accumulates):

```bash
cd expresscare-dashboard/model
source venv/Scripts/activate
python extract_training_data.py
python parse_hscrc.py
python features.py
python train.py
python export_model.py
python generate_baselines.py
```

Or via npm: `npm run model:pipeline`

### Adding HSCRC data:

1. Download FY2017-FY2026 Excel files from https://hscrc.maryland.gov/Pages/hsp_Data2.aspx
2. Place all `.xlsx` files in `expresscare-dashboard/scripts/data/hscrc/`
3. Re-run the pipeline (HSCRC features will be populated instead of NaN)

### Updating weather data:

1. Run `npm run weather` to fetch latest weather history from Open-Meteo
2. Re-run `python features.py` and subsequent steps

---

## Success Criteria Checklist

- [x] Two trained LightGBM models (1h MAE=0.161, 4h MAE=0.361)
- [x] Models exported to JSON and loadable in the browser (public/data/model/)
- [x] ForecastChart.tsx renders real model predictions
- [x] Hospital baselines computed from EDAS history (72 hospitals)
- [x] Graceful fallback to placeholder if model files fail to load
- [x] PHASE3_REPORT.md documents all metrics, decisions, and limitations
