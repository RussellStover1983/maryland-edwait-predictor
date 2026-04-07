# ExpressCare Intelligence Grid — Claude Code Build Prompt

## ⚠️ IMPORTANT: DO NOT START BUILDING YET

**Read this entire prompt first.** Then, before writing any code:

1. **Research the existing codebase.** This project builds on top of an existing repository (`geohealth-api`). Read the following files thoroughly:
   - `CLAUDE.md` — existing Claude Code project instructions
   - `ARCHITECTURE.md` — system architecture documentation
   - `pyproject.toml` — Python dependencies and project config
   - `geohealth/api/routes/` — all existing API route modules
   - `geohealth/services/` — geocoding, tract lookup, cache, narrator services
   - `geohealth/etl/` — existing ETL pipeline (TIGER/Line, ACS, SVI, PLACES)
   - `geohealth/db/` — SQLAlchemy models and schemas
   - `geohealth-ui/` — existing frontend (examine package.json, tsconfig, src/ structure)
   - `docker-compose.yml` and `Dockerfile` — current containerization setup
   - `railway.toml` — deployment config

2. **Understand the data layer.** Call the live GeoHealth API to inspect actual response shapes:
   - `GET /v1/dictionary` — understand every available field
   - `GET /v1/context?lat=39.29&lng=-76.61` — examine a real Baltimore response
   - Confirm Maryland (FIPS 24) data is loaded

3. **Test the EDAS endpoints.** Verify all three are still returning data:
   - `GET https://edas.miemss.org/edas-services/api/cachedfacilities`
   - `GET https://edas.miemss.org/edas-services/api/cachedhospitalstatus`
   - `GET https://edas.miemss.org/edas-services/api/cachedjurisdictions`

4. **Come back to me with a plan.** Before writing any code, present:
   - What you found in the codebase that we can reuse or extend
   - Any conflicts or issues with the existing architecture
   - How the existing `geohealth-ui/` is structured (tech stack, patterns) so the new dashboard follows consistent conventions where appropriate
   - The exact GeoHealth API response field names we'll use for scoring (from `/v1/dictionary` and `/v1/context`)
   - Confirmation that EDAS endpoints are live and returning the expected data structures
   - Your proposed build order and any modifications to the plan below based on what you found
   - Any questions or concerns before we start building

**Only after I review and approve the plan should you begin writing code.**

---

## Overview

Build a real-time geographic demand intelligence dashboard for ExpressCare, Maryland's second-largest urgent care company (~40 locations, strategic partner of LifeBridge Health). The dashboard combines:

1. **Real-time ED capacity data** from Maryland's EDAS system (live, unauthenticated API)
2. **SDOH and health burden data** from an existing production API called GeoHealth
3. **A pre-trained predictive model** that forecasts ED capacity 8-24 hours forward
4. **An H3 hex grid heatmap** of demand pressure across Maryland that animates over time

This project has three phases that should be built in order:
- **Phase 1**: EDAS data collector and historical dataset builder
- **Phase 2**: Predictive model training pipeline
- **Phase 3**: Frontend dashboard

Create everything in a new directory called `expresscare-dashboard/` at the root of the existing `geohealth-api` repository. Do NOT modify the existing `geohealth-ui/` directory.

---

## Existing Infrastructure

### GeoHealth API (Production, Deployed)

A census-tract-level geographic health intelligence API already running in production.

- **Production URL**: https://geohealth-api-production.up.railway.app
- **Swagger docs**: https://geohealth-api-production.up.railway.app/docs
- **Source repo**: https://github.com/RussellStover1983/geohealth-api
- **Stack**: FastAPI + PostGIS on Railway
- **Auth**: `X-API-Key` header required on all endpoints
- **Rate limit**: 60 requests/minute

**Endpoints we will use:**

| Method | Path | Returns |
|--------|------|---------|
| `GET` | `/v1/context?lat=...&lng=...` | Census tract demographics (population, income, poverty, insurance, unemployment, age), CDC/ATSDR SVI theme percentile rankings, CDC PLACES health measures (diabetes, asthma, uninsured, mental distress, etc.), composite SDOH index |
| `POST` | `/v1/batch` | Batch coordinate lookup (up to 50 per call). Body: `{"addresses": [...]}` or coordinates |
| `GET` | `/v1/nearby?lat=...&lng=...&radius=...&limit=...` | Census tracts within radius with full data |
| `GET` | `/v1/compare?geoid1=...&geoid2=...` | Tract comparison or tract vs. state average |
| `GET` | `/v1/dictionary` | Data dictionary with field definitions |

**Pre-requisite**: Maryland data (FIPS 24) must be loaded. If not already loaded:
```bash
cd geohealth-api
pip install -e ".[etl]"
DATABASE_URL_SYNC=<railway-public-connection-string> python -m geohealth.etl.load_all --state 24
```

### EDAS — Maryland Emergency Department Advisory System (Real-Time, Public)

EDAS is operated by MIEMSS (Maryland Institute for Emergency Medical Services Systems). Launched August 2025, it provides real-time ED capacity data for every hospital in Maryland. The following JSON API endpoints are **unauthenticated** and return live data:

**Endpoint 1: Facilities**
```
GET https://edas.miemss.org/edas-services/api/cachedfacilities
```
Returns 143 facilities with name, address, lat/lng, county. Example:
```json
{
  "facilityName": "Sinai Hospital (LifeBridge) - 210",
  "facilityCode": "210",
  "facilityAddress": "2401 W Belvedere Ave",
  "city": "Baltimore",
  "state": "MD",
  "postalCode": "21215",
  "county": "BALTIMORE CITY",
  "lat": 39.340185,
  "lon": -76.661526,
  "countyGroup": "BALTIMORE CITY"
}
```

**Endpoint 2: Hospital Status (the critical one)**
```
GET https://edas.miemss.org/edas-services/api/cachedhospitalstatus
```
Returns real-time status for 50+ hospitals. Example:
```json
{
  "destinationName": "Sinai Hospital (LifeBridge) - 210",
  "destinationCode": "210",
  "numOfUnits": 1,
  "numOfUnitsEnroute": 0,
  "minStay": 58,
  "maxStay": 58,
  "lat": 39.340185,
  "lon": -76.661526,
  "units": [
    {
      "agencyName": "BALTIMORE CITY FIRE DEPT",
      "unitCallSign": "MU12",
      "lengthOfStay": 58,
      "incidentNumber": "202625483",
      "timeEnroute": 107,
      "isEnroute": 0
    }
  ],
  "alerts": {
    "hospitalCode": "210",
    "red": null,
    "yellow": null,
    "reroute": null,
    "codeBlack": null,
    "traumaBypass": null,
    "capacity": null,
    "edCensusIndicatorScore": 2,
    "notes": null
  }
}
```

**Key fields:**
- `edCensusIndicatorScore`: 1 = 0-75% capacity, 2 = 76-100%, 3 = 101-130%, 4 = 131%+ (overcapacity)
- `numOfUnits`: EMS units currently at the ED (proxy for current patient volume)
- `numOfUnitsEnroute`: Ambulances inbound (leading indicator)
- `minStay` / `maxStay`: EMS unit dwell time range in minutes (proxy for ED throughput — higher = more congested)
- Alert flags: `yellow`, `red`, `reroute`, `codeBlack`, `traumaBypass` (non-null = active)

**Endpoint 3: Jurisdictions**
```
GET https://edas.miemss.org/edas-services/api/cachedjurisdictions
```
Returns county/jurisdiction reference data with codes and names.

---

## Phase 1: EDAS Data Collector

### Purpose

Build a lightweight service that polls the EDAS API at regular intervals and stores the results in a SQLite database. This historical dataset becomes the training data for the predictive model in Phase 2.

### Implementation

Create `expresscare-dashboard/collector/`:

```
collector/
├── collect.ts                # Main polling script
├── db.ts                     # SQLite schema and write operations
├── edas-client.ts            # Typed EDAS API client
├── types.ts                  # TypeScript interfaces for EDAS data
└── package.json
```

**`edas-client.ts`**: Fetch from all three EDAS endpoints. Type the responses fully based on the real data structures documented above. Handle network errors with retry (3 attempts, exponential backoff). Log every poll with timestamp and success/failure.

**`db.ts`**: Create a SQLite database at `collector/data/edas-history.db` with these tables:

```sql
CREATE TABLE IF NOT EXISTS hospital_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,                    -- ISO 8601 UTC
  hospital_code TEXT NOT NULL,                -- e.g., "210"
  hospital_name TEXT NOT NULL,                -- e.g., "Sinai Hospital (LifeBridge)"
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  ed_census_score INTEGER,                    -- 1-4
  num_units INTEGER NOT NULL,                 -- EMS units at ED
  num_units_enroute INTEGER NOT NULL,         -- Ambulances inbound
  min_stay_minutes INTEGER,                   -- Min EMS dwell time
  max_stay_minutes INTEGER,                   -- Max EMS dwell time
  alert_yellow INTEGER NOT NULL DEFAULT 0,    -- Boolean
  alert_red INTEGER NOT NULL DEFAULT 0,
  alert_reroute INTEGER NOT NULL DEFAULT 0,
  alert_code_black INTEGER NOT NULL DEFAULT 0,
  alert_trauma_bypass INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_snapshots_hospital_time 
  ON hospital_snapshots(hospital_code, timestamp);

CREATE TABLE IF NOT EXISTS collection_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  hospitals_collected INTEGER NOT NULL,
  success INTEGER NOT NULL DEFAULT 1,
  error_message TEXT
);
```

**`collect.ts`**: 
- Poll all three EDAS endpoints
- Insert one row per hospital into `hospital_snapshots`
- Log the collection event
- Default polling interval: every 5 minutes (configurable via `POLL_INTERVAL_MS` env var)
- Run continuously when started: `npx tsx collector/collect.ts`
- Also support a single-shot mode for cron: `npx tsx collector/collect.ts --once`

**Add an npm script**:
```json
{
  "scripts": {
    "collect": "tsx collector/collect.ts",
    "collect:once": "tsx collector/collect.ts --once"
  }
}
```

### Additional Training Data Scripts

Create `expresscare-dashboard/scripts/` for fetching supplementary historical data:

**`fetch-weather-history.ts`**: Use the Open-Meteo historical weather API (free, no key) to fetch daily temperature, precipitation, humidity, and wind speed for Baltimore (lat 39.29, lng -76.61) for the past 2 years.
- API: `https://archive-api.open-meteo.com/v1/archive?latitude=39.29&longitude=-76.61&start_date=2024-01-01&end_date=2026-04-07&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,relative_humidity_2m_mean,wind_speed_10m_max`
- Store as `scripts/data/weather-history.json`

**`fetch-flu-data.ts`**: Use the CDC FluView API to get weekly ILI (influenza-like illness) rates for HHS Region 3 (which includes Maryland) for the past 2 seasons.
- API: `https://gis.cdc.gov/grasp/flu2/PostPhase02DataDownload` or the ILINet API
- If the CDC API is difficult to access programmatically, download the CSV from https://gis.cdc.gov/grasp/fluview/fluportaldashboard.html and include it as a static file
- Store as `scripts/data/flu-history.json`

**`fetch-cms-hospital-data.ts`**: Fetch real hospital data from CMS Provider Data Catalog API for Maryland:
1. Hospital General Information: `https://data.cms.gov/provider-data/api/1/datastore/query/xubh-q36u/0?conditions[0][property]=state&conditions[0][value]=MD&limit=500`
2. Timely & Effective Care (ED measures): `https://data.cms.gov/provider-data/api/1/datastore/query/yv7e-xc69/0?conditions[0][property]=state&conditions[0][value]=MD&limit=2000`
   - Filter for measure_id = `OP_18B` (median time ED arrival to departure, outpatient)
3. Join on provider_id. Tag hospital systems by name matching:
   - "Sinai", "Northwest Hospital", "Carroll Hospital", "Grace Medical" → "LifeBridge Health"
   - "Johns Hopkins", "Bayview", "Howard County General", "Suburban", "Sibley" → "Johns Hopkins"
   - "University of Maryland", "UMMC", "St. Joseph", "Upper Chesapeake", "Harford", "Charles Regional" → "UMMS"
   - "MedStar", "Harbor", "Franklin Square", "Good Samaritan", "Union Memorial", "St. Mary" → "MedStar"
4. Store as `scripts/data/cms-hospitals.json`

**`geocode-expresscare-locations.ts`**: Geocode all ExpressCare locations using the Census Bureau Geocoding API (free, no key): `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=...&benchmark=Public_AR_Current&format=json`

Fallback to Nominatim (1 req/sec) for failures.

Include these locations with addresses:

Baltimore City & County: Overlea (8039 Belair Rd, Baltimore 21236), Essex (700 Eastern Blvd, Essex 21221), Dundalk (1700 Merritt Blvd, Dundalk 21222), Middle River (1025 Eastern Blvd, Middle River 21220), Parkville (8640 Loch Raven Blvd, Towson 21286), Towson (1 W Pennsylvania Ave, Towson 21204), Arbutus (3815 Wilkens Ave, Baltimore 21229), Quarry Lake (4400 Quarry Lake Dr, Baltimore 21209), Rosedale (8920 Philadelphia Rd, Rosedale 21237), White Marsh (5212 Campbell Blvd, White Marsh 21236), Perry Hall (9609 Belair Rd, Perry Hall 21128), Catonsville (5424 Baltimore National Pike, Catonsville 21228), Pikesville (1440 Reisterstown Rd, Pikesville 21208), Owings Mills (9114 Reisterstown Rd, Owings Mills 21117), Reisterstown (11726 Reisterstown Rd, Reisterstown 21136), Cockeysville (555 Cranbrook Rd, Cockeysville 21030), Near Sinai Hospital (2600 W Belvedere Ave, Baltimore 21215).

Harford & Cecil: Bel Air (5 Bel Air S Pkwy, Bel Air 21015), Edgewood (1019 Pulaski Hwy, Edgewood 21040), Belcamp (vicinity James Run, Belcamp 21017), Havre de Grace (501 Franklin St, Havre de Grace 21078), North East (106 North East Plaza, North East 21901).

Carroll: Westminster (540 Jermor Ln, Westminster 21157), Mt. Airy (1400 S Main St, Mt Airy 21771), Eldersburg (1380 Progress Way, Eldersburg 21784).

Anne Arundel / Howard: Glen Burnie (7485 Baltimore Annapolis Blvd, Glen Burnie 21061), Hanover (7306 Parkway Dr S, Hanover 21076), Ellicott City (9150 Baltimore National Pike, Ellicott City 21042).

Prince George's: Laurel (312 Main St, Laurel 20707).

Frederick / Washington: Frederick (1305 W 7th St, Frederick 21702), Urbana (3520 Urbana Pike, Frederick 21704), Hagerstown (1700 Dual Hwy, Hagerstown 21740).

Eastern Shore: Salisbury (2625 N Salisbury Blvd, Salisbury 21801).

Flag Children's Urgent Care at: Bel Air, Towson, Westminster.

Store as `scripts/data/expresscare-locations.json` with schema:
```typescript
interface ExpressCareLocation {
  id: string;          // slug, e.g. "overlea"
  name: string;        // "ExpressCare Overlea"
  address: string;
  city: string;
  county: string;
  lat: number;
  lng: number;
  hasChildrensUrgentCare: boolean;
  geocodeSource: "census" | "nominatim";
}
```

**`geocode-competitor-locations.ts`**: Same approach for competitors. Include a representative sample:

Patient First (~15 locations): Nottingham, Rosedale, White Marsh, Timonium, Owings Mills, Catonsville, Glen Burnie, Columbia, Laurel, College Park, Germantown, Frederick, Annapolis, Bel Air, Dundalk.

MedStar PromptCare (~6): Bel Air, Brandywine, Chevy Chase, Lutherville, Pasadena, Largo.

Righttime Medical Care (~6): Annapolis, Columbia, Ellicott City, Frederick, Laurel, Waldorf.

Store as `scripts/data/competitor-locations.json`.

**`generate-hex-grid.ts`**: Using `h3-js`, generate an H3 hex grid covering Maryland at resolution 6 (~36km² hexagons).
- Maryland bounding box: lat 37.91-39.72, lng -79.49 to -75.05
- Generate points at ~0.05° intervals, get H3 index for each, deduplicate
- For each unique H3 cell: compute centroid, boundary polygon
- Filter out hexes over the Chesapeake Bay and Atlantic (centroid east of -76.0 below lat 38.5 is likely water — apply a rough filter)
- Store as `scripts/data/hex-grid.json`

**`precompute-base-scores.ts`**: Call the GeoHealth API to compute a base SDOH score per hex cell.

1. Load hex-grid.json, expresscare-locations.json, cms-hospitals.json
2. For each hex centroid, call GeoHealth `POST /v1/batch` in batches of 50. Respect 60 req/min rate limit (1.1s delay between calls). Log progress.
3. Extract from each response: population, uninsured rate, poverty rate, diabetes prevalence, asthma prevalence, frequent mental distress, % without routine checkup, SVI percentile ranking, tract GEOID.
4. Compute per hex cell:

   **Health Burden (0-1)**: Average of normalized PLACES measures (diabetes, asthma, uninsured, no checkup, mental distress). Normalize each to Maryland ranges, clamp to [0,1].

   **Social Vulnerability (0-1)**: SVI percentile from GeoHealth. Already 0-1.

   **Coverage Gap (0-1)**: Distance to nearest ExpressCare. ≤2mi = 0.0, ≥15mi = 1.0, linear between.

   **Population Density (0-1)**: sqrt(tract_population / max_population) across all cells.

   Store as `scripts/data/hex-base-scores.json` with schema:
   ```typescript
   interface HexBaseScore {
     h3Index: string;
     baseScore: number;  // Weighted composite: health 0.35, SVI 0.25, coverage 0.25, population 0.15
     components: { healthBurden: number; socialVulnerability: number; coverageGap: number; populationDensity: number; };
     tractGeoid: string;
     population: number;
     nearestExpressCare: { id: string; name: string; distanceMiles: number; };
   }
   ```

**Data pipeline runner**:
```json
{
  "scripts": {
    "prepare-data": "tsx scripts/fetch-cms-hospital-data.ts && tsx scripts/geocode-expresscare-locations.ts && tsx scripts/geocode-competitor-locations.ts && tsx scripts/generate-hex-grid.ts && tsx scripts/precompute-base-scores.ts && tsx scripts/fetch-weather-history.ts && tsx scripts/fetch-flu-data.ts"
  }
}
```

---

## Phase 2: Predictive Model

### Purpose

Train a model that takes a hospital's **current EDAS state** plus contextual features and outputs a predicted ED census trajectory for the next 8-24 hours.

### Architecture

The model is trained offline in Python and exported as a set of JSON coefficient files that the TypeScript dashboard can evaluate at runtime. No Python runtime needed in the frontend.

Create `expresscare-dashboard/model/`:

```
model/
├── train.py                 # Training pipeline
├── export.py                # Export model to JSON for frontend consumption
├── features.py              # Feature engineering
├── evaluate.py              # Model evaluation and metrics
├── requirements.txt         # Python deps: scikit-learn, pandas, numpy, xgboost, lightgbm
└── data/                    # Training data assembled here
    └── .gitkeep
```

### Training Data Assembly

The model needs historical time series of ED capacity. Since EDAS only launched August 2025 and we may have limited collection history, the training pipeline uses a **hybrid approach**:

**Real data (from EDAS collector):**
- If `collector/data/edas-history.db` exists and has >1 week of data, use it as the primary training source.
- Features: ed_census_score, num_units, num_units_enroute, min_stay, max_stay, alert flags per hospital per timestamp.

**Supplementary historical data (always used):**
- CMS Hospital Compare OP-18B scores per hospital (quarterly baseline)
- Weather history (daily temp, precip, humidity)
- CDC flu/ILI weekly rates
- Calendar features (hour, day of week, month, holiday flag, school session flag)

**Synthetic augmentation (used when EDAS history is thin):**
- Use HSCRC monthly ED volume data (from CMS or HSCRC financial reports) to establish per-hospital monthly volume baselines
- Distribute monthly volumes across hours using published ED utilization curves from academic literature:
  - Weekday: bimodal peaks at 10-11am and 5-7pm
  - Weekend: single broad peak 10am-2pm
  - Monday is highest volume day; Friday/Saturday are lowest
- Add realistic noise calibrated to the variance observed in whatever real EDAS data exists
- Label synthetic data as synthetic so the model can weight real observations higher

### Feature Engineering (`features.py`)

For each prediction point (hospital × timestamp), compute:

**Current state features:**
- `ed_census_score` (1-4, from most recent EDAS poll)
- `num_units` (EMS units at ED)
- `num_units_enroute` (ambulances inbound — leading indicator)
- `max_stay_minutes` (worst EMS dwell time — proxy for congestion)
- `any_alert_active` (binary: any yellow/red/reroute/codeBlack active)
- `deviation_from_baseline` — current census score minus expected score for this hospital at this hour/day (the mean reversion signal)

**Temporal features:**
- `hour_of_day` (0-23, cyclical encode as sin/cos)
- `day_of_week` (0-6, cyclical encode as sin/cos)
- `month` (1-12, cyclical encode as sin/cos)
- `is_weekend` (binary)
- `is_holiday` (binary, use US federal holiday list)
- `hours_until_shift_change` (common shift changes at 7am, 3pm, 11pm — congestion often spikes around these)

**Environmental features:**
- `temperature_f` (current or forecast)
- `precipitation_inches` (current or forecast)
- `flu_ili_rate` (most recent weekly ILI rate for HHS Region 3)

**Hospital identity:**
- `hospital_code` (categorical, label encoded)
- `baseline_monthly_volume` (historical average for this hospital and month — the anchor for mean reversion)
- `hospital_system` (categorical: LifeBridge, Hopkins, UMMS, MedStar, Other)

### Model Training (`train.py`)

**Target variable**: `ed_census_score` at time T+h, where h ∈ {1, 2, 4, 8, 12, 24} hours ahead. Train a separate model per forecast horizon, or a single model with `forecast_horizon_hours` as a feature.

**Algorithm**: LightGBM (gradient boosted trees). It handles mixed feature types, is fast to train, and the tree structure can be exported as a set of decision rules or lookup tables.

**Training approach:**
1. Assemble the feature matrix from EDAS history + supplementary data
2. Split: 80% train, 20% test (time-based split, not random)
3. Train with LightGBM using `objective='multiclass'` (4 classes for census scores 1-4) or `objective='regression'` treating the score as continuous (1.0-4.0)
4. Evaluate: accuracy, MAE, and importantly **calibration** — does the model correctly predict the rate of mean reversion?
5. Feature importance analysis — output which features drive predictions

**Key model behavior**: When the current census score is elevated (3 or 4) at a time when the historical baseline expects lower volume, the model should predict a decline toward baseline over the next 8-24 hours — with the rate of decline shaped by time-of-day (approaching evening = faster decline), day-of-week (Monday = slower decline), and flu season (high ILI = slower decline because sustained demand).

### Model Export (`export.py`)

Export the trained model as JSON files the TypeScript frontend can consume:

**Option A (preferred if feasible)**: Export the LightGBM model as a set of decision tree rules in JSON format. LightGBM has `model.dump_model()` which outputs JSON. Write a lightweight TypeScript evaluator that walks the tree.

**Option B (simpler)**: Precompute prediction lookup tables. For each hospital × hour × day_of_week × census_score combination, store the predicted trajectory as a JSON array. This is a larger file but trivial to consume in TypeScript.

**Option C (fallback)**: Export model-derived coefficients for a simplified linear prediction:
```
predicted_score[t+h] = baseline[hospital][hour+h][day] + 
  decay_rate * (current_score - baseline[hospital][hour][day]) * 
  exp(-h / mean_reversion_halflife[hospital])
```
Where `baseline`, `decay_rate`, and `mean_reversion_halflife` are learned from the data. Export these as JSON lookup tables.

Export to `model/output/prediction-model.json` and copy to `scripts/data/` for the frontend.

---

## Phase 3: Frontend Dashboard

### Tech Stack
- React 18 + TypeScript + Vite
- Leaflet via `react-leaflet` for mapping
- `h3-js` for hex grid
- Recharts for timeline charts
- Tailwind CSS for layout

### Project Structure

```
expresscare-dashboard/
├── src/
│   ├── components/
│   │   ├── Map/
│   │   │   ├── MapContainer.tsx
│   │   │   ├── HexGrid.tsx              # H3 hex grid colored by demand score
│   │   │   ├── HospitalMarkers.tsx       # EDAS real-time hospital status
│   │   │   ├── ExpressCareMarkers.tsx    # ExpressCare locations
│   │   │   ├── CompetitorMarkers.tsx     # Patient First, MedStar, etc.
│   │   │   └── CoverageGapZones.tsx      # Pulsing expansion opportunity zones
│   │   ├── Sidebar/
│   │   │   ├── LiveStatus.tsx            # Real-time EDAS hospital table
│   │   │   ├── StatewideSummary.tsx
│   │   │   ├── ExpansionOpportunities.tsx
│   │   │   └── LocationDetail.tsx
│   │   ├── Timeline/
│   │   │   └── ForecastChart.tsx         # 24hr forecast with actual vs predicted
│   │   ├── TimeControls/
│   │   │   └── TimeBar.tsx              # Time slider, day picker, play/pause
│   │   └── Controls/
│   │       └── LayerPanel.tsx            # Map layer toggles
│   ├── hooks/
│   │   ├── useEDAS.ts                   # Polls EDAS API, manages live state
│   │   ├── useGeoHealth.ts              # GeoHealth API calls
│   │   ├── useHexScores.ts              # Hex grid scoring + temporal adjustment
│   │   └── usePrediction.ts            # Runs prediction model in browser
│   ├── services/
│   │   ├── edas.ts                      # EDAS API client
│   │   ├── geohealth.ts                # GeoHealth API client
│   │   └── predictor.ts                # Loads and evaluates the prediction model
│   ├── utils/
│   │   ├── scoring.ts                   # Wait Burden Score composite calculation
│   │   ├── geo.ts                       # Distance calculations
│   │   └── time.ts                      # Time formatting, holiday detection
│   ├── types/
│   │   └── index.ts
│   ├── App.tsx
│   └── main.tsx
├── public/
│   └── data/                            # Symlink or copy from scripts/data/
├── collector/                           # Phase 1
├── model/                               # Phase 2
├── scripts/                             # Data pipeline
├── .env.example
├── package.json
├── vite.config.ts
├── tailwind.config.js
└── tsconfig.json
```

### Real-Time EDAS Integration

**`useEDAS.ts`** hook:
- On mount, immediately fetch all three EDAS endpoints
- Re-poll `cachedhospitalstatus` every **60 seconds**
- Store current state in React context
- Track the previous poll result to compute deltas (census score trending up or down)
- Expose: `hospitals` (array with current status), `lastUpdated` (timestamp), `isLive` (boolean)

**`HospitalMarkers.tsx`**:
- Render each hospital as a marker on the map
- Marker **color** based on live `edCensusIndicatorScore`:
  - 1 (0-75%): Green `#22c55e`
  - 2 (76-100%): Yellow `#eab308`
  - 3 (101-130%): Orange `#f97316`
  - 4 (131%+): Red `#ef4444`
- Marker **size** proportional to `numOfUnits` (more EMS units = larger marker)
- If any alert is active (yellow, red, reroute, codeBlack), add a pulsing ring animation
- Popup on hover shows: hospital name, system, census level description, EMS units present, units enroute, max dwell time, active alerts
- LifeBridge hospitals (Sinai, Northwest, Carroll, Grace Medical) should have a distinct blue ring to visually connect them to ExpressCare

**`LiveStatus.tsx`** (sidebar panel):
A compact real-time table showing all Maryland hospital EDs, sorted by census score descending:

| Hospital | Census | EMS | Trend |
|----------|--------|-----|-------|
| 🔴 Hopkins Bayview | 4 (131%+) | 3 units | ↑ |
| 🔴 UMMC | 4 (131%+) | 0 units | → |
| 🟡 Sinai (LifeBridge) | 2 (76-100%) | 1 unit | ↓ |
| 🟢 Northwest (LifeBridge) | 1 (0-75%) | 2 units | → |

The trend arrow compares current census score to previous poll. This table updates every 60 seconds. Show a "Last updated: 12s ago" counter.

### Hex Grid with Real-Time ED Pressure

The hex grid Wait Burden Score now incorporates **live EDAS data** instead of static CMS data:

**ED Pressure Score (real-time component):**
For each hex cell, compute distance to every hospital within 20 miles. For each nearby hospital:
```
contribution = (edCensusScore / 4) * (1 / (distance_miles + 1)) * (1 + numOfUnitsEnroute * 0.1)
```
Sum contributions across all nearby hospitals, normalize across all hex cells.

This means the hex grid **shifts color in real-time** as EDAS data updates. When Hopkins Bayview hits Level 4, all hex cells near Bayview get an ED pressure boost, and the model predicts that demand will spill over to nearby ExpressCare locations.

The base SDOH score (from precompute) provides the structural foundation. The EDAS real-time data provides the dynamic layer on top.

### Prediction Visualization

**`ForecastChart.tsx`** (bottom panel, 220px tall):

When a hospital or hex cell is selected, show a Recharts `AreaChart`:

- **X-axis**: Next 24 hours from now, labeled every 2 hours
- **Y-axis**: Predicted ED Census Level (1-4 scale)
- **Filled area**: Predicted trajectory from the ML model, colored by score threshold (green → yellow → orange → red gradient)
- **Current point**: Bold dot at the current time showing the actual EDAS reading
- **Confidence band**: If the model provides uncertainty estimates, show as a lighter fill ±1 level
- **Baseline reference**: Dashed gray line showing the historical average for this hospital on this day type
- **Key callout text below chart**:
  - "Current: Level 3 (101-130%)" 
  - "Predicted peak: Level 4 at 5:30 PM"
  - "Expected to return to Level 2 by 9:00 PM"
  - "Mean reversion from monthly baseline: -1.2 levels over next 8 hours"

If an ExpressCare location is selected instead, show the **aggregate demand forecast** — average predicted census across all hospitals within 10 miles of that location. This tells the ExpressCare manager: "hospitals near your location are going to be slammed at 5pm, expect overflow."

### Time Controls

Horizontal bar at top of map, 48px height:

- **"LIVE" indicator**: Green pulsing dot with "LIVE" text when viewing current real-time data. Clicking it snaps back to current time.
- **Time slider**: Can scrub forward up to 24 hours to see the predicted future state of the hex grid and hospital markers. When scrubbed forward, the "LIVE" indicator turns gray and shows "FORECAST +4h" (or whatever offset).
- **Day-of-week buttons**: Mon-Sun, affects the prediction model's calendar features when forecasting.
- **Play button**: Animates forward through time at 1 step (30 min) per 1.5 seconds, showing the predicted heatmap evolve. The hex grid and hospital markers update with each step using the model's predictions.

When viewing live data (time slider at "now"), hospital markers show actual EDAS colors. When viewing forecast (time slider in the future), hospital markers show predicted colors with a subtle dashed border to indicate "predicted."

### Sidebar

**360px wide, left side, three sections:**

**Top: Statewide Summary**
- Total ExpressCare locations
- Hospitals currently at Level 3+: [count] / [total]
- Active reroutes: [count]
- Statewide average census score: [value, colored]
- Population within 5mi of ExpressCare: [value]
- Coverage rate: [percentage]

**Middle: Top 10 Expansion Opportunities**
Same as before — hex cells ranked by base SDOH score where nearest ExpressCare > 8 miles. Each entry: approximate area name, score with bar chart, primary driver label, nearest ExpressCare + distance, "Zoom" button.

**Bottom: Selected Location Detail**
When an ExpressCare marker is clicked:
- Location name & address
- Catchment population (GeoHealth `/v1/nearby`)
- Catchment health profile: uninsured %, diabetes %, avg SVI
- Nearest competitor + distance
- Nearest hospital ED: name, **live census level**, distance
- **"Overflow forecast"**: predicted peak demand time for nearby hospitals in next 24h

### Layer Controls (floating, top-right of map, 220px wide)

Toggle switches:
- ☑ Demand Heatmap (hex grid)
- ☑ Hospital EDs (live EDAS)
- ☑ ExpressCare Locations
- ☐ Competitor Urgent Care
- ☑ Coverage Gap Zones
- ☐ SVI Choropleth

### Coverage Gap Zones

Hex cells where `baseScore > 65` AND `nearestExpressCare.distanceMiles > 8`. Render with amber fill (#f59e0b) at 30% opacity, dashed border (2px, dash 8-4), pulsing CSS animation on border opacity (0.4 to 1.0 over 2 seconds).

---

## Design Specifications

**Aesthetic direction**: Dark ops dashboard. Think military command center meets Bloomberg terminal. Dense information, dark backgrounds, precise typography, live data feel.

**Colors:**
- Background: `#0a0b10` (near-black with slight blue)
- Panels: `#12141f` (dark navy)
- Elevated cards: `#1a1d2e`
- Borders: `#252840`
- Primary text: `#e2e8f0`
- Secondary text: `#8892a8`
- Accent (ExpressCare): `#3b82f6`
- Live indicator: `#22c55e` pulsing
- Census 1: `#22c55e` (green)
- Census 2: `#eab308` (yellow)
- Census 3: `#f97316` (orange)
- Census 4: `#ef4444` (red)
- Heatmap gradient: green → lime → yellow → orange → red
- Coverage gaps: `#f59e0b` (amber, pulsing)
- Competitors: `#4b5563` (dark gray)

**Typography:**
- Headers/UI: `Space Grotesk` from Google Fonts (or `DM Sans` as fallback)
- Data values, scores, times: `JetBrains Mono` from Google Fonts (or `Fira Code`)
- App title: 22px bold
- Section headers: 12px bold uppercase tracking-widest
- Body: 13px regular
- Data values: 13px monospace

**Layout:**
- Full viewport, no scroll on main layout
- Left sidebar: 360px fixed
- Bottom panel: 220px fixed
- Map fills remaining space
- Time controls: 48px overlaid on top of map
- Layer controls: floating card, top-right
- Optimized for 1440px+ desktop. NOT mobile responsive.

**Title (top-left of sidebar):**
- "EXPRESSCARE" in `#3b82f6`, 12px bold tracking-widest
- "Intelligence Grid" in `#e2e8f0`, 20px bold
- Below: thin blue accent line
- Below that: "Powered by GeoHealth API" in `#8892a8`, 10px
- Below that: small live indicator: 🟢 "EDAS LIVE · Updated 12s ago"

**Footer (bottom-right corner, overlaid on map):**
"EDAS · CMS · CDC PLACES · CDC SVI · U.S. Census Bureau" in 9px `#4b5563`

---

## Environment Configuration

`.env.example`:
```
VITE_GEOHEALTH_API_URL=https://geohealth-api-production.up.railway.app
VITE_GEOHEALTH_API_KEY=your-api-key-here
VITE_EDAS_BASE_URL=https://edas.miemss.org/edas-services/api
VITE_EDAS_POLL_INTERVAL_MS=60000
```

---

## Startup

```bash
cd expresscare-dashboard

# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env with real GeoHealth API key

# 3. Fetch and process all data (one-time)
npm run prepare-data

# 4. Start the EDAS collector in background (for building training data)
npm run collect &

# 5. Train the prediction model (requires Python, one-time)
cd model && pip install -r requirements.txt && python train.py && python export.py && cd ..

# 6. Launch the dashboard
npm run dev
```

The dashboard opens at `http://localhost:5173` showing live EDAS data immediately, with the hex grid and predictions powered by GeoHealth + the trained model.

---

## Implementation Priority

If time is limited, build in this order:

1. **EDAS client + live hospital markers on a Leaflet map** — this alone is impressive
2. **Hex grid with precomputed SDOH scores** — the visual wow factor
3. **EDAS polling + real-time hex grid updates** — bringing it to life
4. **Sidebar with live status table and expansion opportunities** — making it actionable
5. **Prediction model + forecast chart** — the ML layer
6. **Time slider animation** — the demo centerpiece
7. **Polish: coverage gap zones, competitor markers, detail panels**

---

## Important Notes

1. **All data is real.** No synthetic fallbacks, no "simulated" labels. Every number on the dashboard comes from a real public data source. If a data source is unavailable, the app should show a clear error, not fake data.

2. **EDAS endpoints are unauthenticated** as of April 2026. The three endpoints documented above return JSON without any API key or login. If this changes, the app should display "EDAS connection lost" rather than silently failing.

3. **EDAS polling should be respectful.** 60-second intervals for the dashboard, 5-minute intervals for the collector. Do not poll more aggressively. Include a User-Agent header identifying the application.

4. **The GeoHealth API rate limit is 60 req/min.** The precompute script must throttle batch calls with 1.1s delays. The live dashboard should cache all GeoHealth data and only re-fetch when a user clicks a new location.

5. **The prediction model may have limited training data initially.** If EDAS collection history is less than 1 week, the model will lean heavily on the synthetic-augmented data and calendar/weather features. This is fine — the model improves as more real EDAS data accumulates. Log the ratio of real vs. synthetic training data.

6. **The hex grid animation on the time slider is the demo moment.** When the user hits play and watches the heatmap shift from current state into the predicted future — with hospitals changing color as the model forecasts overcapacity — that's the money shot. Ensure smooth 60fps color transitions. Use `requestAnimationFrame` for layer style updates.

7. **Git hygiene**: Add to `.gitignore`: `scripts/data/`, `collector/data/`, `model/data/`, `model/output/`, `node_modules/`, `.env`. The generated data files and trained model are not committed. The scripts and training pipeline are the source of truth.

8. **Inspect actual GeoHealth API responses** before coding the frontend. Call `/v1/dictionary` and `/v1/context` to confirm exact field names. Adapt scoring normalization if actual Maryland data ranges differ from estimates.
