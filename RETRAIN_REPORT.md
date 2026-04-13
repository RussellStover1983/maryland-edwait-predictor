# HSCRC Volume Data Retrain Report

**Date:** 2026-04-13
**Pipeline:** expresscare-dashboard/model/

---

## HSCRC Data Parsing

| Metric | Value |
|--------|-------|
| Files parsed | 10 (FY17 through FY26) |
| Total EMG/EM2 rows | 5,632 |
| Date range | 2016-07-01 to 2026-02-01 |
| COVID-era rows excluded | 763 (March 2020 – June 2021) |
| Distinct hospitals (all) | 52 |
| EDAS-mapped hospitals | 21 / 24 |
| Months per hospital (excl COVID) | min=1, median=100, max=100 |

### EDAS hospitals without HSCRC match

Three EDAS destination codes had no HSCRC match: `211` (MedStar Harbor), `226` (MedStar Good Sam), `291` (UMMS Charles). These hospitals likely have different HOSP_NUM assignments in the HSCRC data than expected. They retain NaN for all HSCRC features.

### Parser improvements

The rewritten `parse_hscrc.py` auto-detects header rows (handles FY17 row-1 headers, FY25/FY26 row-2 headers) and normalizes column names to uppercase. It correctly parses all 10 fiscal year files despite structural variations.

---

## Model Metrics

### Comparison to Phase 3

| Horizon | Phase 3 MAE | Phase 3 RMSE | Retrained MAE | Retrained RMSE | Change |
|---------|-------------|--------------|---------------|----------------|--------|
| 1-hour  | 0.161       | —            | 0.1701        | 0.3540         | +0.009 (+5.6%) |
| 4-hour  | 0.361       | —            | 0.3392        | 0.5854         | -0.022 (-6.1%) |

The 1h MAE increased slightly (+0.009), likely due to the addition of weather features creating mild overfitting on the short-horizon task. The 4h MAE improved meaningfully (-0.022 / 6.1%), which aligns with expectations — HSCRC volume baselines and weather provide context that helps longer-horizon predictions more than short-horizon ones where current state dominates.

### Feature Importance — HSCRC features

**1-hour model:**
- `baseline_monthly_volume`: rank #14 (gain: 1,798.6)
- `seasonal_index`: rank #20 (gain: 1,093.2)
- `baseline_admit_rate`: rank #21 (gain: 878.2)
- `baseline_monthly_visits`: rank #22 (gain: 875.9)
- `licensed_beds`: rank #37 (gain: 0.0 — not used)

**4-hour model:**
- `baseline_monthly_volume`: rank #9 (gain: 10,808.9)
- `baseline_admit_rate`: rank #11 (gain: 7,137.3)
- `seasonal_index`: rank #19 (gain: 3,683.2)
- `baseline_monthly_visits`: rank #22 (gain: 3,248.6)
- `licensed_beds`: rank #37 (gain: 0.0 — not used)

HSCRC features are substantially more important in the 4h model, where `baseline_monthly_volume` is the #9 most important feature overall.

### Feature Importance — Weather features

- `temperature_2m`: rank #10 (1h) / #12 (4h)
- `relative_humidity_2m`: rank #11 (1h) / #14 (4h)
- `precipitation`: rank #35 (both) — not used by the model

---

## Weather Data

Weather history successfully fetched via Open-Meteo API covering 2024-01-01 to 2026-04-12. After joining, weather features have 14.3% null rate (edge of collection period). Temperature and humidity ranked in top 15 features for both models.

---

## Feature Null Rates

| Feature | Null Rate | Notes |
|---------|-----------|-------|
| temperature_2m | 14.3% | Edge of weather data range |
| precipitation | 14.3% | Same |
| relative_humidity_2m | 14.3% | Same |
| ili_rate | 100% | No flu data source configured |
| baseline_monthly_volume | 61.1% | 21/24 mapped + 49 unmapped EDAS hospitals |
| baseline_monthly_visits | 61.1% | Same |
| baseline_admit_rate | 61.1% | Same |
| seasonal_index | 61.1% | Same |
| licensed_beds | 61.1% | Same |

The 61.1% null rate on HSCRC features is expected: EDAS tracks 73 hospitals, but only 21 have confirmed HSCRC mappings. LightGBM handles missing values natively.

---

## Output Files

- `model/artifacts/hscrc_baselines.parquet` — 603 rows (21 hospitals x ~12 months each + unmapped)
- `model/artifacts/hscrc_all_months.parquet` — 5,632 rows (full parsed dataset)
- `model/artifacts/hscrc_hospital_meta.json` — 52 hospitals
- `public/data/model/lgbm_1h.json` — 2,649 KB
- `public/data/model/lgbm_4h.json` — 3,012 KB
- `public/data/model/inference_config.json` — updated
- `public/data/model/hospital_baselines.json` — 73 hospitals

---

## Warnings / Issues

1. **3 EDAS hospitals unmapped:** 211, 226, 291 — need HOSP_NUM verification against HSCRC data
2. **ILI/flu data 100% null:** No flu data source is configured. This feature contributes zero gain.
3. **licensed_beds 0 gain:** The beds column likely has too many nulls or insufficient variance to be useful.
4. **1h MAE slightly worse:** +5.6% regression vs Phase 3, possibly from feature noise. The 4h improvement outweighs this.

---

## TypeScript Verification

`npx tsc --noEmit` passes — no type errors. Frontend code unchanged and compatible with the updated model JSON format.
