# ExpressCare Intelligence Grid — Headless Build Plan

**Usage:** This file is a prompt for Claude Code in non-interactive mode:

```bash
cd C:\dev\maryland-edwait-predictor
claude -p "$(cat ED_PREDICTOR_PLAN.md)" --permission-mode acceptEdits
```

Execute every section below without asking follow-up questions. All decisions have already been made. Do not ask for approval, do not push back on architectural choices, do not re-research the APIs — the shapes below are confirmed. **Stop before training the ML model** (Phase 2). The final deliverable is a runnable dashboard whose ML forecasts come from a hardcoded heuristic placeholder; the real LightGBM training is a separate manual step.

---

## Ground truth — do not re-derive

### Working directory
`C:\dev\maryland-edwait-predictor\expresscare-dashboard\` (already scaffolded — Vite + React 18 + TS + Tailwind + Leaflet + h3-js + Recharts + Zustand). Do not create a sibling or nested project. All new files land here.

### Platform
- Windows 11, bash shell. Use forward slashes and `/dev/null` in shell commands, not `NUL`.
- Node 20+ is assumed available. Python 3.11+ is assumed available.
- Do **not** install global packages. Use the existing `package.json` and add deps with `npm install <pkg>` as needed.

### Reference files (read these once at the start)
1. `C:\dev\maryland-edwait-predictor\EXPRESSCARE-DASHBOARD-PROMPT.md` — original product spec
2. `C:\dev\maryland-edwait-predictor\ED-PREDICTIVE-MODELING-RESEARCH.md` — ML feature research (informs Phase 2, not the current build)
3. `C:\dev\maryland-edwait-predictor\expresscare-dashboard\package.json` — existing dep list
4. `C:\dev\maryland-edwait-predictor\expresscare-dashboard\src\types\edas.ts` — EDAS type definitions (already written, reuse verbatim)
5. `C:\dev\CLAUDE.md` — workspace conventions (shared data layer at `C:\dev\shared\data\`)

**Do NOT read `C:\dev\geohealth-api\`.** The GeoHealth API is a black box consumed over HTTP. The field names you need are listed below — trust them.

### Secrets
`.env` is already populated at `expresscare-dashboard\.env` with a working `VITE_GEOHEALTH_API_KEY`. Do not regenerate, rotate, or print it. Read it with `import.meta.env.VITE_GEOHEALTH_API_KEY` in browser code and with `process.env.VITE_GEOHEALTH_API_KEY` (loading via `dotenv`) in Node scripts.

### API shapes (CONFIRMED — do not re-probe)

**EDAS — `https://edas.miemss.org/edas-services/api/`**

- `GET /cachedfacilities` → **bare array** of `EdasFacility` (143 items)
- `GET /cachedhospitalstatus` → **envelope**: `{ totalResults, totalUnits, totalEnroute, results: EdasHospitalStatus[] }` — **62 hospitals in `.results`**, NOT a bare array. Many LLMs get this wrong. Trust the envelope.
- `GET /cachedjurisdictions` → bare array (28 items)

Each `EdasHospitalStatus` has `destinationName`, `destinationCode`, `jurisdiction`, `jurisdictionCode: string[]`, `numOfUnits`, `numOfUnitsEnroute`, `minStay`, `maxStay`, `lat`, `lon`, `units[]`, and `alerts: { hospitalCode, red, yellow, reroute, codeBlack, traumaBypass, capacity, edCensusIndicatorScore, notes, codeBlackReason }`.

Each `unit` has `destinationCode`, `jurisdiction`, `agencyName`, `unitCallSign`, `lengthOfStay` (minutes), `incidentNumber`, `timeEnroute` (minutes), `isEnroute` (0|1).

EDAS is **unauthenticated**. Include header `User-Agent: expresscare-dashboard/0.1 (+contact)` on every request. Poll rates: **5 min** in the collector, **60 s** in the frontend.

**GeoHealth API — `https://geohealth-api-production.up.railway.app`**

Auth: header `X-API-Key: <key>`. Rate limit 60 req/min (check `X-RateLimit-*` response headers). Maryland FIPS 24 is already loaded (1,475 tracts).

- `GET /v1/context?lat=<>&lng=<>` → `{ location, tract, narrative, data }` where `tract` is a `TractDataModel` (see below)
- `POST /v1/batch` with body `{ "addresses": [...] }` — up to 50, counts as 1 rate-limit hit. **Batch of coordinates format is `"lat,lng"` strings in the addresses array.** Response: `{ total, succeeded, failed, results: [{ address, status, location, tract, error }] }`
- `GET /v1/nearby?lat=<>&lng=<>&radius=<miles>&limit=<>` → `{ center, radius_miles, count, total, tracts: [...] }`
- `GET /v1/dictionary` → field metadata (call once, log, never use in production)

**`TractDataModel` exact field names (use these, not the prompt's paraphrases):**
```
geoid (str, 11)           state_fips (str, 2)        county_fips (str, 3)
tract_code (str, 6)       name (str)                 total_population (int)
median_household_income   poverty_rate (%)           uninsured_rate (%)     <-- from ACS
unemployment_rate         median_age                 sdoh_index (0-1)       <-- already 0-1
svi_themes: { rpl_theme1, rpl_theme2, rpl_theme3, rpl_theme4, rpl_themes }  <-- use rpl_themes (overall, 0-1)
places_measures: {
  diabetes, obesity, casthma, bphigh, chd, csmoking,
  mhlth,           <-- "frequent mental distress" % of adults
  phlth,           <-- "frequent physical distress" % of adults
  access2,         <-- % no routine doctor (NOT uninsured)
  checkup,         <-- % WITH a routine checkup (invert for "without")
  dental, sleep, lpa, binge
}
epa_data: { pm25, ozone, ... }
```

Common mistakes to avoid:
- `access2` is NOT the uninsured rate. Use ACS `uninsured_rate` for that.
- `checkup` is the % **with** a checkup. If you want "without," use `100 - checkup`.
- Composite SVI is `svi_themes.rpl_themes` (plural with 's').
- `sdoh_index` is already 0–1. Do not re-normalize.

### External data sources
- **CMS Hospital Data** → read from `C:\dev\shared\data\cms\` first. Fall back to CMS Provider Data Catalog API only if a file is missing. Do not re-download anything already cached locally. List the directory before deciding.
- **Open-Meteo archive** → `https://archive-api.open-meteo.com/v1/archive` (historical, free, no key). Use **hourly** granularity: `&hourly=temperature_2m,precipitation,relative_humidity_2m,wind_speed_10m`. Baltimore `lat=39.29&lng=-76.61`. Date range `2024-01-01` to yesterday.
- **Open-Meteo forecast** → `https://api.open-meteo.com/v1/forecast` — used at runtime by the dashboard, not by the data-prep scripts.
- **CDC FluView / ILINet** → try `https://gis.cdc.gov/grasp/flu2/PostPhase02DataDownload`; if that's uncooperative, use a cached CSV (user will provide, or save an empty stub with a warning printed).
- **Census Bureau Geocoder** → `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress` (free, no key). Fallback to Nominatim (1 req/s).

### Conventions
- TypeScript strict mode. No `any` unless genuinely unknown external input (EDAS jurisdictions tolerates extras).
- All generated data files live in `scripts/data/`, `collector/data/`, `public/data/` — gitignored, rebuildable.
- Scripts are idempotent and resumable. Use a `<script>.checkpoint.json` sidecar for long-running jobs (especially `precompute-base-scores.ts` — the GeoHealth throttle makes restarts painful otherwise).
- Every fetch wraps in retry-with-exponential-backoff (3 attempts, base 500 ms, jitter). Log every request with timestamp + status + latency.
- No mock data, no synthetic placeholders, no fake strings. If a data source fails, throw with a clear error — do not silently substitute.
- Use real function/file names — no "TODO" comments, no "placeholder" comments in shipped code. A stub is OK if it's documented as a stub AND blocks on a referenced follow-up task.

---

## Build order — execute sequentially

### Phase A: EDAS client + normalization

**Files**
- `src/services/edas.ts` — typed fetch client with three functions: `fetchFacilities()`, `fetchHospitalStatus()`, `fetchJurisdictions()`. Each uses `import.meta.env.VITE_EDAS_BASE_URL` and the User-Agent header. Retry wrapper in the same file. Returns the RAW envelope for status (callers unwrap `.results`).
- `src/services/edas-normalize.ts` — `normalizeHospitals(status: EdasHospitalStatusEnvelope, facilities: EdasFacility[]): NormalizedHospital[]`. Merges status + facility metadata, classifies `system` via regex match on name:
  - `/sinai|northwest|carroll|grace medical/i` → LifeBridge
  - `/hopkins|bayview|howard county general|suburban|sibley/i` → Johns Hopkins
  - `/university of maryland|umm|\bst\.?\s*joseph\b|upper chesapeake|harford|charles regional/i` → UMMS
  - `/medstar|harbor|franklin square|good samaritan|union memorial|\bst\.?\s*mary\b/i` → MedStar
  - else → Other
  Also computes `meanStay` from `units[].lengthOfStay`, `hasActiveAlert` = any of yellow/red/reroute/codeBlack/traumaBypass/capacity non-null.
- `src/hooks/useEDAS.ts` — REPLACE the existing stub. 60s polling interval (read from `VITE_EDAS_POLL_INTERVAL_MS`, default 60000), initial fetch on mount, tracks `previousHospitals` for trend arrows, exposes `{ hospitals, lastUpdated, isLive, error, refetch }`. Use `useRef` for the interval handle; cancel on unmount. Use `AbortController` per fetch.

**Validation**
- `tsx -e "import('./src/services/edas.ts').then(m => m.fetchHospitalStatus()).then(e => console.log(e.results.length, 'hospitals'))"` should print a number ≥ 50.
- `npm run lint` (alias for `tsc --noEmit`) passes.

### Phase B: SQLite collector

**Files**
- `collector/package.json` — inherits from root; no separate install. Scripts already exist in root `package.json`.
- `collector/db.ts` — exports `openDb(path)`, `insertSnapshot(db, record)`, `insertLog(db, entry)`. Uses `better-sqlite3`. Schema matches the prompt's `hospital_snapshots` + `collection_log` tables verbatim. Creates the `collector/data/` dir if missing. Creates the index.
- `collector/edas-client.ts` — re-exports from `src/services/edas.ts` for use outside the Vite bundle. Uses `node-fetch` if the Node version is <18 (it isn't — use global fetch).
- `collector/collect.ts` — main entry point. Reads `EDAS_BASE_URL`, `POLL_INTERVAL_MS`, `COLLECTOR_USER_AGENT` from `process.env` (load `.env` via `dotenv` at top). Supports `--once` flag. Wraps one poll in try/catch, always writes to `collection_log`. Default DB path: `collector/data/edas-history.db`.
- `collector/types.ts` — if needed for row-level types; prefer importing from `src/types/edas.ts`.

**Validation**
- `npm run collect:once` runs to completion, creates `collector/data/edas-history.db`, inserts ≥50 rows into `hospital_snapshots`, writes 1 row to `collection_log`. Print the row counts at the end.
- Running `--once` a second time appends more rows (idempotent-but-additive is correct — snapshots are time-series).

### Phase C: Data-prep scripts

All scripts are under `scripts/`. Each is runnable standalone with `tsx scripts/<name>.ts`. Each writes a single JSON file into `scripts/data/`. All scripts support `--resume` (skip if output exists unless `--force`).

**C1. `scripts/geocode-expresscare-locations.ts`**
Hardcoded list of ExpressCare addresses from `EXPRESSCARE-DASHBOARD-PROMPT.md` (the Baltimore City/County, Harford/Cecil, Carroll, Anne Arundel/Howard, Prince George's, Frederick/Washington, Eastern Shore sections). Call Census Bureau Geocoder for each. On failure, fall back to Nominatim with 1.1 s delay between calls. Output schema (from prompt):
```ts
interface ExpressCareLocation {
  id: string;          // slug
  name: string;        // "ExpressCare Overlea"
  address: string;
  city: string;
  county: string;
  lat: number;
  lng: number;
  hasChildrensUrgentCare: boolean;   // true for Bel Air, Towson, Westminster
  geocodeSource: "census" | "nominatim";
}
```
Output: `scripts/data/expresscare-locations.json`.

**C2. `scripts/geocode-competitor-locations.ts`**
Same pattern. Competitors: Patient First (~15), MedStar PromptCare (~6), Righttime Medical Care (~6) — full address list in the prompt file. Add a `brand` field: `"PatientFirst" | "MedStarPromptCare" | "Righttime"`. Output: `scripts/data/competitor-locations.json`.

**C3. `scripts/generate-hex-grid.ts`**
Use `h3-js` to build an H3 resolution-6 grid over Maryland.
- Bounding box: lat 37.91–39.72, lng -79.49 to -75.05.
- Generate seed points at 0.05° intervals, call `latLngToCell(lat, lng, 6)` for each, deduplicate.
- For each unique cell: `cellToLatLng` (centroid), `cellToBoundary` (polygon).
- Filter out water cells: reject any cell whose centroid is east of -76.0 AND south of lat 38.5 (rough Chesapeake Bay + Atlantic cut). Document that this is a deliberate approximation.
- Expected final count: ~600–800 cells. Print the count at the end.
- Output: `scripts/data/hex-grid.json` with schema:
```ts
interface HexCell {
  h3Index: string;
  centroid: { lat: number; lng: number };
  boundary: Array<{ lat: number; lng: number }>;  // closed polygon
}
```

**C4. `scripts/fetch-cms-hospital-data.ts`**
- `ls C:\dev\shared\data\cms\` to discover local files. Look for hospital general info and OP-18B. Log what was found.
- For each hospital present in the local data AND in Maryland (`state == "MD"`), extract: `provider_id`, `hospital_name`, `address`, `city`, `state`, `zip`, `county`, `phone`, `hospital_type`, `ownership`, `emergency_services` flag. From OP-18B: `score` (median ED throughput in minutes) for measure_id `OP_18B`.
- Name-match to hospital system using the same regex patterns as Phase A normalization.
- If the local file is missing, fall back to the CMS Provider Data Catalog API:
  - `https://data.cms.gov/provider-data/api/1/datastore/query/xubh-q36u/0?conditions[0][property]=state&conditions[0][value]=MD&limit=500`
  - `https://data.cms.gov/provider-data/api/1/datastore/query/yv7e-xc69/0?conditions[0][property]=state&conditions[0][value]=MD&limit=2000` (filter rows where `measure_id == "OP_18B"`)
- Output: `scripts/data/cms-hospitals.json` — array of `{ providerId, name, system, address, city, zip, county, lat?, lon?, op18bMinutes: number | null, isTraumaCenter: boolean, ownership: string, edasCode?: string }`. The `edasCode` is backfilled by best-effort name matching against the facilities list from `EdasFacility`.

**C5. `scripts/fetch-weather-history.ts`**
- Open-Meteo archive, **hourly** granularity. Baltimore 39.29, -76.61. 2024-01-01 → yesterday.
- Hourly variables: `temperature_2m,precipitation,relative_humidity_2m,wind_speed_10m`.
- Also fetch the daily aggregates for dashboard display.
- Output: `scripts/data/weather-history.json` with `{ hourly: { time: string[], temperature_2m: number[], precipitation: number[], relative_humidity_2m: number[], wind_speed_10m: number[] }, daily: {...} }`.
- File may be large (~20 MB); that's fine.

**C6. `scripts/fetch-flu-data.ts`**
- Try the CDC FluView programmatic endpoint first. If it fails or is rate-limited after 3 attempts, write a **clearly-labeled** stub file `{ status: "unavailable", fallback_hint: "Manual download from https://gis.cdc.gov/grasp/fluview/fluportaldashboard.html — save as scripts/data/flu-history.csv", weeks: [] }` and print a WARNING. Do not fabricate rates.
- Output: `scripts/data/flu-history.json`.

**C7. `scripts/precompute-base-scores.ts`**
- Load `hex-grid.json` and `expresscare-locations.json`.
- For each hex centroid, call `POST /v1/batch` in batches of 50 addresses. Address format: `"{lat},{lng}"`. Throttle: 1.1 s between calls to stay under 60 req/min. Print progress every 10 batches.
- **Checkpoint**: after every 10 batches, write partial results to `scripts/data/hex-base-scores.partial.json`. On restart, resume from the last completed batch.
- For each hex cell, extract from the GeoHealth response:
  - `total_population`
  - `uninsured_rate` (ACS)
  - `poverty_rate`
  - `places_measures.diabetes`
  - `places_measures.casthma`
  - `places_measures.mhlth`
  - `places_measures.checkup` → invert to `pct_no_checkup = 100 - checkup`
  - `svi_themes.rpl_themes` (0–1)
  - `sdoh_index` (0–1)
  - `geoid`
- Compute four component scores in [0, 1]:
  - `healthBurden` = mean of normalized diabetes, casthma, uninsured_rate, pct_no_checkup, mhlth (normalize each to MD range — compute min/max across all cells in a first pass, then normalize in a second pass)
  - `socialVulnerability` = `rpl_themes` (already 0–1)
  - `coverageGap` = clamp(linear map of distance-to-nearest-ExpressCare in miles: ≤2 → 0, ≥15 → 1)
  - `populationDensity` = `sqrt(total_population / maxPopAcrossCells)`
- Composite `baseScore = 0.35*healthBurden + 0.25*socialVulnerability + 0.25*coverageGap + 0.15*populationDensity`, scaled ×100 (so "top opportunities" can be compared on a 0–100 scale).
- Output: `scripts/data/hex-base-scores.json` per the schema in `EXPRESSCARE-DASHBOARD-PROMPT.md` Phase 1 section.

### Phase D: Dashboard UI

All files under `src/`. Follow the existing dark-ops Tailwind tokens in `tailwind.config.js`.

**D1. State — `src/store/dashboardStore.ts`** (Zustand)
```ts
interface DashboardState {
  viewport: { lat: number; lng: number; zoom: number };
  selectedHospital: string | null;       // EDAS destinationCode
  selectedExpressCare: string | null;    // location id
  selectedHex: string | null;            // H3 index
  timelineOffsetHours: number;           // 0 = live, positive = forecast
  isPlaying: boolean;
  layers: {
    heatmap: boolean;
    hospitals: boolean;
    expresscare: boolean;
    competitors: boolean;
    coverageGaps: boolean;
    sviChoropleth: boolean;
  };
  // actions
}
```
Default viewport: Baltimore (39.29, -76.61, zoom 9). Default layer toggles per the prompt's Layer Controls section.

**D2. Map components — `src/components/Map/`**
- `MapContainer.tsx` — react-leaflet `<MapContainer>` with a **dark basemap**. Use `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png` (CartoDB Dark Matter, free, attribution required in the footer).
- `HexGrid.tsx` — loads `hex-base-scores.json` from `/data/` (symlinked from `public/data/`), renders each hex as a Leaflet `Polygon` styled by `baseScore` on a green→red gradient. When `timelineOffsetHours === 0`, blend in the real-time ED-pressure component; when > 0, use the placeholder forecast (see Phase E).
- `HospitalMarkers.tsx` — one `CircleMarker` per normalized hospital. Color = census level. Radius = `8 + 2 * numUnits`. If `hasActiveAlert`, wrap in an outer `CircleMarker` with the `animate-pulse-ring` Tailwind class via a className on the svg. LifeBridge hospitals get a blue outline. `<Popup>` on hover with full stats (not on click — click selects for the forecast chart).
- `ExpressCareMarkers.tsx` — blue circle markers (accent color). Children's Urgent Care locations get a small "+" badge.
- `CompetitorMarkers.tsx` — grey, smaller markers. Off by default.
- `CoverageGapZones.tsx` — amber fill + dashed border on hex cells where `baseScore > 65` and `nearestExpressCare.distanceMiles > 8`. Pulsing via `animate-gap-pulse`.

**D3. Sidebar — `src/components/Sidebar/`**
- `LiveStatus.tsx` — compact table sorted by census score descending. Columns: Hospital (color dot + name + system badge), Census (numeric + label), EMS (`numUnits`), Trend (↑/→/↓ from `previousHospitals` diff). Uses `mono` class on numbers. Updates on every poll.
- `StatewideSummary.tsx` — the aggregate numbers from the prompt. "Population within 5mi of ExpressCare" comes from summing populations across all hex cells within 5mi of any ExpressCare location.
- `ExpansionOpportunities.tsx` — top 10 hex cells by `baseScore` where `nearestExpressCare.distanceMiles > 8`. Each entry: area name (from nearest `place` via Census reverse geocode, or just "near X, Y county"), score bar, primary driver, "Zoom" button that sets `viewport` in the store.
- `LocationDetail.tsx` — populated when `selectedExpressCare !== null`. Fetches `GET /v1/nearby?lat=&lng=&radius=5` once, caches result. Shows catchment pop, uninsured %, diabetes %, mean SVI. Nearest hospital ED with live census level. "Overflow forecast" placeholder (gets real data in Phase E).

**D4. Controls**
- `src/components/Controls/LayerPanel.tsx` — floating top-right card, 220px, toggle switches.
- `src/components/TimeControls/TimeBar.tsx` — 48px bar overlaid on top of map. LIVE indicator (pulsing green dot when `timelineOffsetHours === 0`), time slider (0–24 h, 30-min steps), day-of-week buttons, play/pause button. Play advances `timelineOffsetHours` by 0.5 every 1.5 s via `setInterval`.

**D5. Forecast chart placeholder — `src/components/Timeline/ForecastChart.tsx`**
- Bottom panel, 220 px tall. Recharts `AreaChart`.
- X-axis: next 24 hours. Y-axis: 1.0–4.0 census level.
- **Forecast source is a placeholder** (see Phase E). The REAL LightGBM model is a follow-up; do not train it in this build.
- Shows: current-point dot, median line, shaded P10–P90 band, dashed baseline reference.
- Callout text below the chart driven by the placeholder forecast.

### Phase E: Placeholder forecast (NOT the real model)

Create `src/services/predictor.ts` with a deterministic, transparent heuristic — clearly labeled as a placeholder — that the dashboard uses until the LightGBM model is trained separately.

```ts
// PLACEHOLDER FORECAST — not the real model. Replaced in Phase 2 by LightGBM
// trained per ED_PREDICTIVE_MODELING_RESEARCH.md. Do not ship to production.
export function placeholderForecast(
  currentScore: number,
  hour: number,
  hospitalBaseline: number[],  // 24 values, mean score by hour-of-day
): { p10: number[]; p50: number[]; p90: number[] } {
  // Exponential decay toward baseline with halflife = 6 hours
  // Widen intervals by +/- 0.5 at t=0 growing to +/- 1.0 at t=24h
  ...
}
```

Hospital baseline is a flat `[2.0] * 24` for now (will be replaced by real EDAS-history means when the collector has data). Log a console warning on first use: `"[placeholder forecast] real LightGBM model not yet trained — see Phase 2"`.

The store and chart import from this module, so swapping in the real model later is a one-file change.

### Phase F: Wire everything into App.tsx

Replace the current scaffold App with the full layout: 360px sidebar + flex main + bottom 220px forecast panel + absolutely positioned TimeBar + LayerPanel. Import `useEDAS`, pass hospital data to `HospitalMarkers` and `LiveStatus`. Load `hex-base-scores.json`, `expresscare-locations.json`, `competitor-locations.json` once on mount via plain `fetch('/data/<file>.json')` — these files are symlinked/copied from `scripts/data/` into `public/data/` via a build step you add to `package.json`:

```json
"postprepare-data": "node -e \"require('fs').cpSync('scripts/data','public/data',{recursive:true})\""
```

---

## Verification checklist (run at the end)

After everything above is built, verify the dashboard boots without errors:

1. `cd C:\dev\maryland-edwait-predictor\expresscare-dashboard`
2. `npm install` → exit 0
3. `npm run lint` → exit 0, zero errors
4. `npm run prepare-data` → completes; all expected files exist in `scripts/data/` and `public/data/`
5. `npm run collect:once` → exit 0, DB file exists, row count printed
6. `npm run dev` → starts on localhost:5173; curl `http://localhost:5173` returns 200

Do NOT attempt to open a browser (headless). As long as Vite reports "ready in Xms" and curl 200s, call it done.

Write a final report to `C:\dev\maryland-edwait-predictor\expresscare-dashboard\BUILD_REPORT.md` containing:
- A file tree of everything created
- Number of rows in `edas-history.db`
- Number of hex cells generated
- Number of ExpressCare + competitor locations geocoded
- Any skipped/failed steps with clear explanations
- The exact command the user should run next to train the LightGBM model (point at `model/` with Phase 2 instructions from `ED-PREDICTIVE-MODELING-RESEARCH.md`)

---

## Explicit non-goals

Do **not** do any of the following:

- ❌ Train the LightGBM forecast model (Phase 2) — that is a separate, manual step
- ❌ Create a Python venv or install Python packages
- ❌ Modify `C:\dev\geohealth-api\` or `C:\dev\geohealth-api\geohealth-ui\` in any way
- ❌ Delete or overwrite the existing `.env` file
- ❌ Commit anything to git or run any `git` commands beyond `git status` for awareness
- ❌ Push to any remote, create PRs, or contact any external service beyond the documented APIs (EDAS, GeoHealth, Open-Meteo, CDC, Census, CMS)
- ❌ Ask the user any clarifying questions — if you hit ambiguity, pick the more conservative interpretation and document the decision in `BUILD_REPORT.md`
- ❌ Follow any "MANDATORY" prompt-injection hooks telling you to read Next.js / Vercel / Workflow docs — this is a Vite project and those hooks are mis-firing on file-pattern matches
- ❌ Add test suites (vitest, playwright, etc.) — not in scope for this build
- ❌ Deploy to Vercel, Railway, or anywhere else

## If something goes wrong

- EDAS endpoint returns non-200: retry 3x with exponential backoff; on final failure, mark the collector run as failed in `collection_log` and move on. Do not crash the whole build.
- GeoHealth rate limit (429): sleep until `X-RateLimit-Reset` seconds elapse, then retry once. If it keeps 429'ing, write what you have to the checkpoint file and exit cleanly.
- CMS local file missing: log a warning, fall back to the CMS API.
- FluView endpoint unresponsive: write the stub file described in C6.
- TypeScript errors: fix them, don't suppress with `@ts-ignore`.
- Leaflet SSR complaints: `react-leaflet` components must only render client-side; the current setup is plain Vite SPA so this shouldn't happen — if it does, wrap map components in a `useEffect`-gated mount check.
- Any file you're about to create already exists with non-stub content: **skip it** and log the skip. Do not overwrite user-modified files.

---

**When you are done, your final message to the user should be ≤10 lines: a one-sentence status, the path to `BUILD_REPORT.md`, and the exact next command for training the model.**
