# Gravity Model Volume Estimation — Build Report

**Date:** 2026-04-14
**Status:** Complete (haversine-estimated drive times; ORS API matrix available for refinement)

---

## What Was Built

A Huff gravity model pipeline that estimates patient capture volume for ExpressCare expansion opportunities, answering: **"If we opened an ExpressCare here, how many patients per day could we realistically capture?"**

### Pipeline Architecture

```
model/gravity/
  gravity_config.json           # Configurable parameters
  compute_drive_times.py        # ORS Matrix API -> drive-time matrix
  generate_haversine_matrix.py  # Fast haversine fallback (no API)
  build_gravity_model.py        # Huff model + volume estimation
  upload_results.py             # Push results to Postgres

scripts/data/
  drive-time-matrix.json        # 38,322 hexes x 132 facilities (204 MB)
  gravity-results.json          # Per-hex demand + expansion volumes

public/data/
  gravity-results.json          # Copy for frontend dev

src/hooks/useGravityModel.ts    # React hook for loading gravity data
src/components/Sidebar/ExpansionOpportunities.tsx  # Updated with volume UI
src/App.tsx                     # Wired gravity data into component tree
```

---

## Key Results

| Metric | Value |
|--------|-------|
| Total monthly outpatient ED volume (HSCRC) | 543,394 services |
| Divertible daily (20%) | 3,623 patients/day |
| Facilities modeled | 132 (72 hospitals, 33 ExpressCare, 27 competitors) |
| Maryland hex cells | 38,322 |
| Hexes with measurable demand | 14,733 |
| Expansion candidates evaluated | 20 |
| Calibration factor (haversine) | 1.350 |

### Top 5 Expansion Opportunities

| Rank | H3 Index | Score | Captured (pts/day) | Pop (5mi) |
|------|----------|-------|--------------------|-----------|
| 1 | 882aa858e5fffff | 74 | ~16.3 | 1,339,501 |
| 2 | 882aa859ddfffff | 72 | ~13.1 | 1,415,941 |
| 3 | 882aa87365fffff | 72 | ~4.6 | 1,201,291 |
| 4 | 882aa84705fffff | 73 | ~3.3 | 1,215,252 |
| 5 | 882aa87acdfffff | 72 | ~2.9 | 864,727 |

---

## Model Parameters (gravity_config.json)

| Parameter | Value | Range | Description |
|-----------|-------|-------|-------------|
| divertible_pct | 20% | 13-27% | Fraction of outpatient ED visits divertible to urgent care |
| distance_decay_beta | 2.0 | 1.5-3.0 | Huff model distance exponent |
| expresscare_attractiveness | 5.0 | — | Relative attractiveness of ExpressCare |
| competitor_attractiveness | 4.0 | — | Relative attractiveness of competitors |
| hospital_base_attractiveness | 1.0 | — | Base hospital attractiveness (modified by census) |
| max_drive_minutes | 30 | — | Cutoff for patient consideration |

---

## Frontend Features

1. **Volume estimates** prominently displayed for each expansion opportunity (~X pts/day)
2. **Divertible % slider** (13-27%) scales volumes in real-time
3. **Time-of-day toggle** (Morning/Afternoon/Evening/Overnight/Average) shows period-specific capture
4. **"Diverted From" breakdown** shows which hospitals would lose patients
5. **Score breakdown** retained from original hex-score system
6. **Graceful fallback** to hex-score ranking when gravity data unavailable

---

## Drive-Time Matrix

### Current: Haversine Estimation
- **Method:** Haversine distance x 1.35 calibration factor (assumes ~30 mph average)
- **Speed:** Computed in ~2 minutes locally (no API calls)
- **Accuracy:** Reasonable for relative ranking; overestimates in urban areas with highway access, underestimates in areas with poor road networks

### Available: OpenRouteService Matrix API
- **Script:** `model/gravity/compute_drive_times.py`
- **API key:** Configured in `.env` (ORS_API_KEY)
- **Requests needed:** 2,301 (767 hex batches x 3 facility batches)
- **Free tier:** 40 req/min, 2,500 req/day — fits in one run but rate limiting extends wall time
- **Estimated time:** ~77 minutes at 2s/request (longer with rate limit retries)
- **To run:** `cd expresscare-dashboard && source model/venv/Scripts/activate && python model/gravity/compute_drive_times.py`
- **Note:** The ORS free tier's burst rate limits triggered after ~10 requests during testing. Consider running during off-peak hours or upgrading to a paid tier for faster completion.

---

## Data Flow

```
HSCRC outpatient volume (49 mapped hospitals, 543K services/mo)
    |
    v
Population-weighted inverse-distance distribution -> hex_demand (14,733 hexes)
    |
    v
Apply divertible_pct (20%) -> hex_divertible_daily (3,623 pts/day total)
    |
    v
Huff model (attractiveness / drive_time^beta) -> facility_capture probabilities
    |
    v
Expansion simulation (20 candidates) -> captured_daily_avg per candidate
    |
    v
Time-of-day modulation (EDAS census -> hospital attractiveness by period)
    |
    v
gravity-results.json -> Postgres -> /api/model/gravity_results -> Frontend
```

---

## Verification Checklist

- [x] `npx tsc --noEmit` passes cleanly
- [x] Drive-time matrix computed (38,322 hexes x 132 facilities)
- [x] Gravity model produces volume estimates for 20 expansion candidates
- [x] Each candidate shows estimated patients/day with time-of-day breakdown
- [x] Divertible % configurable via slider (13-27%)
- [x] "Captured from" shows which hospitals lose volume
- [x] Results stored in Postgres (`/api/model/gravity_results` returns data)
- [x] Results served via static file (`/data/gravity-results.json`)
- [x] Frontend falls back gracefully when gravity data unavailable

---

## What's NOT Included

- Real-time gravity model updates (volumes are pre-computed)
- "Drop a pin" interactive what-if tool
- Insurance network filtering
- Competitor wait time data
- Drive-time isochrone visualization on the map

---

## How to Re-Run

```bash
cd C:/dev/maryland-edwait-predictor/expresscare-dashboard
source model/venv/Scripts/activate

# Option A: Fast haversine estimation (~2 min)
python model/gravity/generate_haversine_matrix.py

# Option B: Accurate ORS drive times (~77+ min, needs ORS_API_KEY)
python model/gravity/compute_drive_times.py

# Run gravity model
python model/gravity/build_gravity_model.py

# Upload to Postgres + copy to public/data
python model/gravity/upload_results.py
```
