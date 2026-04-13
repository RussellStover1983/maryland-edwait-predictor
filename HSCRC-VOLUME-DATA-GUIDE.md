# HSCRC Monthly ED Volume Data — Integration Guide for Predictive Model

## Overview

The HSCRC (Health Services Cost Review Commission) publishes monthly hospital revenue and volume reports for every regulated hospital in Maryland. These Excel files contain per-hospital, per-month ED visit counts and revenue broken out by rate center. The Emergency Department data lives under rate center code `EMG`.

This data provides the **historical monthly baseline** for each hospital's ED volume — the anchor for the predictive model's mean reversion logic. When EDAS reports a hospital at Census Level 4 (131%+ capacity) at 2pm on a Tuesday, the model needs to know: "Is this hospital typically busy or is this abnormal?" The HSCRC monthly data answers that question.

## Data Source

**File location**: HSCRC Financial Data page — https://hscrc.maryland.gov/Pages/hsp_Data2.aspx

Files for FY2017 through FY2026 are available on the HSCRC Financial Data page. Maryland's fiscal year runs **July through June** (e.g., FY2020 = July 2019 – June 2020, FY2026 = July 2025 – February 2026 partial). Download all available fiscal year files to `scripts/data/hscrc/` for the full ~10-year history (July 2016 – February 2026).

**COVID exclusion:** Rows from March 2020 through June 2021 should be flagged as `covid_era` and excluded from baseline/seasonal computations. COVID volumes were wildly atypical and distort normal baselines.

**File format**: `.xlsx` with a data dictionary companion file.

**File structure**: 
- Row 1: Filename/metadata (skip)
- Row 2: Column headers
- Row 3+: Data rows
- Read with `pd.read_excel(filepath, skiprows=2)`

## Data Dictionary (EMG-relevant fields)

| Column | Type | Description |
|--------|------|-------------|
| `HOSP_NUM` | int | HSCRC hospital ID number (matches across all HSCRC data products) |
| `HNAME` | string | Hospital name (e.g., "Lifebridge- Sinai", "JHH- Johns Hopkins") |
| `REPORT_DATE` | date | First day of the reporting month (e.g., 2025-07-01 for July 2025) |
| `CODE` | string | Rate center code. **Filter to `CODE == 'EMG'` for Emergency Department data.** |
| `VOL_IN` | float | Total inpatient ED services for the month — patients who came through the ED and were admitted to the hospital. Proxy for high-acuity ED demand. |
| `VOL_OUT` | float | Total outpatient ED services for the month — patients who were treated in the ED and discharged home. **This is the low-acuity, potentially divertible population — the patients ExpressCare could capture.** |
| `REV_IN` | float | Gross inpatient ED revenue for the month (dollars) |
| `REV_OUT` | float | Gross outpatient ED revenue for the month (dollars) |
| `OVS_IN` | int | Number of ED visits resulting in inpatient admission |
| `OVS_OUT` | float | Number of outpatient ED visits (treat-and-release) |
| `TOTAL_IN_STATE_VOL_IN` | float | In-state inpatient ED volume |
| `TOTAL_OUT_STATE_VOL_IN` | float | Out-of-state inpatient ED volume |
| `TOTAL_IN_STATE_VOL_OUT` | float | In-state outpatient ED volume |
| `TOTAL_OUT_STATE_VOL_OUT` | float | Out-of-state outpatient ED volume |
| `MED_IN_VOL_IN` | float | Medicare in-state inpatient ED volume |
| `MED_IN_VOL_OUT` | float | Medicare in-state outpatient ED volume |
| `MED_IN_VOL_FFS_IN` | float | Medicare Fee-for-Service inpatient ED volume |
| `MED_IN_VOL_NONFFS_IN` | float | Medicare Advantage inpatient ED volume |
| `CNTR_ADM` | int | Admissions count (including births and transfers in) |
| `CNTR_BED` | int | Licensed beds for the month |
| `SER_TYPE` | string | Service type code |
| `MCID` | string | Medicare provider ID (links to CMS data) |

There is also a secondary rate center code `EM2` with very few rows (8 total) — this appears to be a secondary ED or overflow. Include it in analysis but it's minor.

## Parsing Script

Create `scripts/parse-hscrc-volume.ts` (or `.py`):

```python
import pandas as pd

def parse_hscrc_volume(filepath: str) -> pd.DataFrame:
    """Parse HSCRC monthly revenue/volume Excel file and extract ED data."""
    
    # Skip the first 2 rows (metadata + blank), row 3 has column headers
    df = pd.read_excel(filepath, skiprows=2)
    
    # Filter to Emergency Department rate center
    ed = df[df['CODE'].isin(['EMG', 'EM2'])].copy()
    
    # Clean and compute derived fields
    ed['REPORT_DATE'] = pd.to_datetime(ed['REPORT_DATE'])
    ed['TOTAL_ED_VOLUME'] = ed['VOL_IN'].fillna(0) + ed['VOL_OUT'].fillna(0)
    ed['TOTAL_ED_VISITS'] = ed['OVS_IN'].fillna(0) + ed['OVS_OUT'].fillna(0)
    ed['TOTAL_ED_REVENUE'] = ed['REV_IN'].fillna(0) + ed['REV_OUT'].fillna(0)
    ed['ADMIT_RATE'] = ed['VOL_IN'].fillna(0) / ed['TOTAL_ED_VOLUME']  # % of ED volume admitted
    ed['AVG_REVENUE_PER_VISIT'] = ed['TOTAL_ED_REVENUE'] / ed['TOTAL_ED_VISITS']
    ed['MONTH'] = ed['REPORT_DATE'].dt.month
    ed['YEAR'] = ed['REPORT_DATE'].dt.year
    
    return ed
```

## What the Data Shows (Current File: FY2026 July-Feb)

- **50 hospitals** reporting EMG data
- **8 months** of data (July 2025 - February 2026)
- **~850,000 total ED volume statewide per month** (VOL_IN + VOL_OUT)
- **~190,000 total ED visits statewide per month** (OVS_IN + OVS_OUT)

### Hospital System Mapping

Map HSCRC hospital names to systems for the model's hospital identity features:

| HOSP_NUM | HNAME | System | EDAS Code |
|----------|-------|--------|-----------|
| 12 | Lifebridge- Sinai | LifeBridge Health | 210 |
| 40 | Lifebridge- Northwest | LifeBridge Health | 218 |
| 33 | Lifebridge- Carroll | LifeBridge Health | 219 |
| 13 | Lifebridge- Grace | LifeBridge Health | 208 |
| 9 | JHH- Johns Hopkins | Johns Hopkins | 204 |
| 43 | JHH- Bayview | Johns Hopkins | 201 |
| 22 | JHH- Suburban | Johns Hopkins | 249 |
| 35 | JHH- Howard County | Johns Hopkins | 223 |
| 2 | UMMS- UMMC | UMMS | 215 |
| 3 | UMMS- Capital Region | UMMS | 260 |
| 7 | UMMS- Charles | UMMS | 291 |
| 6 | UMMS-Aberdeen | UMMS | 388 |
| 15 | MedStar- Franklin Square | MedStar | 203 |
| 24 | MedStar- Union Mem | MedStar | 214 |
| 18 | MedStar- Montgomery | MedStar | 264 |
| 25 | MedStar- Harbor | MedStar | 211 |
| 26 | MedStar- Good Sam | MedStar | 226 |
| 30 | MedStar- Southern MD | MedStar | 343 |
| 31 | MedStar- St. Mary's | MedStar | 333 |
| 5 | Frederick | Independent | 239 |
| 1 | Meritus | Independent | 395 |
| 11 | Saint Agnes | Ascension | 212 |
| 4 | Trinity - Holy Cross | Trinity | 244 |
| 17 | Garrett | Independent | 322 |

The `EDAS Code` column links HSCRC data to the EDAS real-time feed. The `destinationCode` field in EDAS hospital status responses uses these same codes. Build a mapping table that joins HSCRC `HOSP_NUM` → EDAS `destinationCode` so the model can look up the monthly baseline for any hospital that appears in the EDAS feed.

## How This Data Feeds Into the Predictive Model

### Feature 1: Monthly Baseline Volume (`baseline_monthly_volume`)

For each hospital, compute the average monthly ED volume for each calendar month across available history:

```python
# Per hospital, per calendar month average
baselines = ed.groupby(['HOSP_NUM', 'MONTH']).agg({
    'TOTAL_ED_VOLUME': 'mean',
    'VOL_OUT': 'mean',  # Outpatient/treat-and-release specifically
    'ADMIT_RATE': 'mean',
    'TOTAL_ED_REVENUE': 'mean'
}).reset_index()
```

This gives the model an expected volume for "Sinai in January" vs. "Sinai in July." With only 8 months of data, some months will have only one observation — augment with prior year files when available.

### Feature 2: Deviation from Baseline (`deviation_from_baseline`)

At prediction time, the model compares current EDAS state to what the HSCRC baseline says this hospital should look like this month:

```
baseline_daily = baseline_monthly_volume / days_in_month
baseline_hourly = baseline_daily / 18  # ~18 operating hours per day

# Convert EDAS census score to estimated current hourly volume
# Census 1 = 0-75% capacity, Census 2 = 76-100%, Census 3 = 101-130%, Census 4 = 131%+
estimated_current_rate = edas_census_score / 4  # Normalized 0-1

# Deviation: positive = busier than expected, negative = quieter
deviation = estimated_current_rate - (expected_rate_for_this_hour / max_observed_rate)
```

This deviation feature is the **mean reversion signal**. When deviation is strongly positive (hospital much busier than its baseline), the model should predict a gradual return toward baseline over the next 8-24 hours — unless external factors (flu season, weather, time of day approaching peak) sustain the elevation.

### Feature 3: Seasonal Pattern Features

Extract from the monthly data:

```python
# Month-over-month volume change per hospital
ed_sorted = ed.sort_values(['HOSP_NUM', 'REPORT_DATE'])
ed_sorted['VOL_CHANGE_PCT'] = ed_sorted.groupby('HOSP_NUM')['TOTAL_ED_VOLUME'].pct_change()

# Seasonal index: hospital's volume this month relative to its annual average
annual_avg = ed.groupby('HOSP_NUM')['TOTAL_ED_VOLUME'].transform('mean')
ed['SEASONAL_INDEX'] = ed['TOTAL_ED_VOLUME'] / annual_avg
```

Observable patterns from the current data:
- **November**: Consistent dip across all hospitals (Thanksgiving week suppresses volume)
- **December**: Spike (flu season onset + holiday injuries)
- **February**: Low (short month + winter)
- **July**: High (summer trauma, full staffing)

### Feature 4: Admit Rate as Acuity Proxy (`admit_rate`)

`ADMIT_RATE = VOL_IN / TOTAL_ED_VOLUME` tells you what percentage of ED patients get admitted. This is a proxy for ED acuity mix:

- High admit rate (>30%) = sicker patients, longer ED stays, more boarding → slower throughput
- Low admit rate (<20%) = more treat-and-release patients → faster throughput, more divertible to urgent care

Use this as a hospital-level feature. Hospitals with chronically high admit rates will have structurally longer wait times regardless of volume.

### Feature 5: Outpatient Volume as Diversion Target (`vol_out_monthly`)

`VOL_OUT` is the key metric for the ExpressCare value proposition. These are patients who came to the ED and went home — many of whom could have been served at an urgent care center. 

For the dashboard's "Expansion Opportunities" panel, compute:

```python
# Monthly outpatient ED volume per hospital = the divertible pool
# Estimate % that could be urgent-care-appropriate (literature suggests 13-27%)
DIVERTIBLE_PCT = 0.20  # Conservative estimate
ed['DIVERTIBLE_MONTHLY'] = ed['VOL_OUT'] * DIVERTIBLE_PCT
ed['DIVERTIBLE_DAILY'] = ed['DIVERTIBLE_MONTHLY'] / 30
```

For Sinai: ~21,000 outpatient ED services/month × 20% = ~4,200 potentially divertible visits/month = ~140/day. That's a substantial volume of patients who could be served by ExpressCare locations near Sinai.

### Feature 6: Revenue Per Visit (`avg_revenue_per_visit`)

While not directly used in the demand prediction model, this is powerful for the business case:

```python
# Average outpatient ED revenue per visit
ed['REV_PER_OP_VISIT'] = ed['REV_OUT'] / ed['OVS_OUT']
```

This shows the cost of treating low-acuity patients in the ED vs. what they'd cost at urgent care. Under Maryland's GBR model, every ED visit costs the hospital money from a fixed budget. Diverting those visits to ExpressCare saves LifeBridge real dollars.

## Integration with EDAS Collector Data

The HSCRC data is monthly granularity. The EDAS collector produces 5-minute snapshots. They connect through the hospital ID mapping.

**Training pipeline**:

1. Load HSCRC monthly data → compute per-hospital monthly baselines and seasonal patterns
2. Load EDAS collector history → 5-minute snapshots of census scores, EMS units, dwell times
3. For each EDAS snapshot, join the HSCRC baseline for that hospital and month:
   ```python
   # Join EDAS snapshots with HSCRC monthly baselines
   edas_data['month'] = edas_data['timestamp'].dt.month
   training = edas_data.merge(
       hscrc_baselines,
       left_on=['hospital_code_mapped', 'month'],
       right_on=['HOSP_NUM', 'MONTH'],
       how='left'
   )
   # Now each EDAS snapshot has the monthly baseline volume for context
   training['deviation'] = (training['ed_census_score'] / 4) - (training['expected_normalized_rate'])
   ```

4. The model trains on EDAS features (real-time) + HSCRC features (baseline context) + weather + calendar features → predicts census score at T+h

**Inference pipeline**:

1. Current EDAS reading comes in (e.g., Sinai at Census Level 3, 2 EMS units, 58 min max stay)
2. Look up Sinai's HSCRC baseline for the current month (e.g., January average: 28,846 total volume)
3. Compute deviation from baseline
4. Feed all features to model → get predicted trajectory for next 8-24 hours
5. The baseline acts as the attractor: the model predicts convergence back toward it, modulated by time-of-day, weather, and flu activity

## Data Quality Notes

- Some hospitals report `VOL_IN = 0` for EMG (e.g., Grace Medical, UMMS-Aberdeen). This means they don't have inpatient admissions through their ED — they're freestanding EDs or transfer all admissions. Their `VOL_OUT` is still valid.
- The `.` values in Medicaid and Kaiser columns indicate the data wasn't reported (not zero). Treat as null, not zero.
- `CNTR_BED` (licensed beds) is reported monthly and can vary. Use it as a capacity denominator for the hospital.
- Volume numbers (`VOL_IN`, `VOL_OUT`) are service counts, not unique patient counts. A single ED visit may generate multiple services (triage + labs + imaging). `OVS_OUT` (outpatient visits) is the actual visit count.
- **Use `OVS_OUT` as the visit count and `VOL_OUT` as the service volume.** For demand modeling, visit counts (`OVS_OUT`) are the better measure. For revenue modeling, service volumes (`VOL_OUT`) tied to `REV_OUT` are more appropriate.

## File Naming Convention

HSCRC names these files with the fiscal year and date range:
- `hscrc_revenue_vol_FY26Julythroughfeb2026_040726.xlsx` = FY2026, July 2025 through February 2026, published April 7, 2026

When requesting prior years, expect similar naming. Store all downloaded files in `scripts/data/hscrc/` and the parsing script should handle multiple files to build multi-year history.
