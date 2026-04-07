// PLACEHOLDER FORECAST — not the real model. Replaced in Phase 2 by LightGBM
// trained per ED_PREDICTIVE_MODELING_RESEARCH.md. Do not ship to production.

let warned = false;

export function placeholderForecast(
  currentScore: number,
  hour: number,
  hospitalBaseline: number[],
): { p10: number[]; p50: number[]; p90: number[] } {
  if (!warned) {
    console.warn('[placeholder forecast] real LightGBM model not yet trained — see Phase 2');
    warned = true;
  }

  const HALFLIFE = 6;
  const steps = 48; // 30-min steps over 24 hours
  const p10: number[] = [];
  const p50: number[] = [];
  const p90: number[] = [];

  for (let i = 0; i <= steps; i++) {
    const hoursAhead = i * 0.5;
    const futureHour = (hour + hoursAhead) % 24;
    const baseline = hospitalBaseline[Math.floor(futureHour)] ?? 2.0;

    // Exponential decay toward baseline
    const decay = Math.exp(-hoursAhead / HALFLIFE);
    const predicted = baseline + (currentScore - baseline) * decay;

    // Widen intervals: +/- 0.5 at t=0, growing to +/- 1.0 at t=24h
    const spread = 0.5 + 0.5 * (hoursAhead / 24);

    const clamp = (v: number) => Math.max(1.0, Math.min(4.0, v));
    p50.push(clamp(Math.round(predicted * 100) / 100));
    p10.push(clamp(Math.round((predicted - spread) * 100) / 100));
    p90.push(clamp(Math.round((predicted + spread) * 100) / 100));
  }

  return { p10, p50, p90 };
}

// Hospital baseline: flat 2.0 for now — replaced by real EDAS-history means when available
export function getHospitalBaseline(_hospitalCode: string): number[] {
  return new Array(24).fill(2.0);
}
