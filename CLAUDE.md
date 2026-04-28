# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**ExpressCare Intelligence Grid** — a real-time geographic demand-intelligence dashboard for ExpressCare Maryland. It fuses:

- Live MIEMSS **EDAS** ED-capacity data (5-min poll in prod, unauthenticated public API)
- **GeoHealth SDOH API** (`geohealth-api-production.up.railway.app`, X-API-Key)
- **HSCRC** Maryland hospital volume data + **CMS** provider data
- A **LightGBM** ED-wait forecast model + a spatial **gravity model** for expansion scoring

The repo root holds many planning/report `.md` files (PHASE*, *_PLAN, *_REPORT) that document the build history. The actual application lives in `expresscare-dashboard/`.

## Working directory

All commands below assume `cd expresscare-dashboard/` unless noted. This is a **single-package** project (no monorepo).

## First-time setup

```bash
cd expresscare-dashboard
npm install
cp .env.example .env     # fill in GeoHealth X-API-Key + EDAS base URL
# Python model (optional, only if running model:* scripts):
cd model && python -m venv venv && source venv/Scripts/activate && pip install -r requirements.txt
```

The frontend and collector run without the Python venv — it's only needed for `npm run model:pipeline`.

## Common commands

```bash
# Dev + build
npm run dev                     # Vite dev server on :5173
npm run build                   # tsc -b && vite build -> dist/
npm run lint                    # tsc --noEmit (no ESLint configured)
npm run preview                 # serve built dist/

# EDAS collector (Node + tsx)
npm run collect                 # long-running 60s poll loop
npm run collect:once            # single snapshot, then exit

# Data-prep pipeline (writes to scripts/data/, then copied to public/data/)
npm run prepare-data            # cms -> geocode -> hexgrid -> base-scores -> weather -> flu -> copy-data
# Individual steps: cms, geocode:expresscare, geocode:competitors, hexgrid,
#                   base-scores, weather, flu, copy-data

# Python LightGBM model (separate venv at model/venv/, activated via bash)
npm run model:pipeline          # extract -> hscrc -> features -> train -> export
# Individual: model:extract, model:hscrc, model:features, model:train, model:export
```

No test suite is wired up. `npm run lint` is type-check only.

## Architecture

### Three cooperating runtimes

1. **Frontend (Vite/React/TS)** — `src/`. Deployed to **Vercel** (`vercel.json`, framework `vite`).
2. **Collector (Node + tsx)** — `collector/collect.ts`. Deployed to **Railway** via `Dockerfile.collector` + `railway.toml`. Polls EDAS every 5 min (prod `POLL_INTERVAL_MS=300000`) and writes snapshots to Postgres (falls back to sql.js SQLite locally). Dual-schema logic in `collector/db.ts`.
3. **Python model pipeline** — `model/`. Runs offline (local venv). Outputs JSON artifacts into `public/data/` and uploads baselines to Postgres via `model/upload_initial_artifacts.py`. A `weekly_refresh.py` + `Dockerfile.refresh` + `railway-refresh.toml` handle the scheduled retrain.

### Data flow

```
EDAS public API ──► collector (Railway) ──► Postgres (hospital_snapshots)
                                               │
                                               ▼
                              Vercel serverless API (api/*.ts)
                                               │
                                               ▼
GeoHealth API + CMS + HSCRC + weather + flu ──► prepare-data scripts ──► public/data/*.json
                                                                              │
                                                                              ▼
                                                               React app (src/) ──► Leaflet + deck.gl hex grid
                                                                                     (h3-js resolution 8)
```

### Vercel serverless endpoints (`api/`)

- `api/edas/[...path].ts` — CORS-friendly proxy to `edas.miemss.org` (browser can't call it directly reliably).
- `api/hospitals/[code]/*`, `api/hospitals/stats.ts`, `api/hospitals/summary.ts` — read from Postgres via `api/_db.ts` (`DATABASE_URL` env, SSL forced off — Railway internal connection).
- `api/model/[key].ts` — serves the large model artifacts (hex-base-scores, expresscare-locations, competitor-locations) from DB in prod; in dev the app fetches `/data/*.json` statically (see `App.tsx:62`).

### Frontend state

- Zustand store: `src/store/dashboardStore.ts` (layer toggles, view mode, selected hospital).
- Data hooks: `src/hooks/useEDAS.ts` (60s polling via `src/services/edas.ts` → `/api/edas`), `useGravityModel.ts`, `useHospitalHistory.ts`.
- Map: `react-leaflet` base + `@deck.gl/react` for H3 hex overlay (`components/Map/DeckHexLayer.tsx`).
- Prediction UI reads from `services/predictor.ts`; a `predictor-placeholder.ts` exists for when the model hasn't been exported yet.

### Conventions specific to this repo

- **No data fabrication.** Every number must trace to a real source (EDAS, HSCRC, CMS, GeoHealth, Open-Meteo, CDC FluView, TIGER). If a source is missing, surface "unavailable" in the UI rather than estimating.
- **Generated data is gitignored.** `public/data/` and `scripts/data/` are build artifacts. Regenerate via `npm run prepare-data` rather than hand-editing.
- **Dev vs prod data loading is branched on `import.meta.env.DEV`** (see `App.tsx`). Keep both paths working when adding a new artifact — add a static file to `public/data/` *and* a key in `api/model/[key].ts`.
- **Collector targets two DBs.** When changing schema, update both `SQLITE_SCHEMA` and `PG_SCHEMA` in `collector/db.ts`, and bump migration in `collector/migrate-to-pg.ts`.
- **Python model uses a Windows bash-style venv activate** (`source venv/Scripts/activate`) — keep `model:*` scripts compatible with Git Bash on Windows.

## External dependencies / references

- Full phase-by-phase build plan: `ED_PREDICTOR_PLAN.md` + `ED_PREDICTOR_PHASE2.md` + `ED_PREDICTOR_PHASE3.md`
- Gravity model design: `GRAVITY_MODEL_PLAN.md` / `GRAVITY_MODEL_REPORT.md`
- Hex grid / deck.gl upgrade notes: `EDWAIT-HEXGRIDPLAN.md`, `HEXGRID_UPGRADE_REPORT.md`
- HSCRC volume data handling: `HSCRC-VOLUME-DATA-GUIDE.md`
- Railway deploy details: `expresscare-dashboard/RAILWAY_SETUP.md`, `RAILWAY_DEPLOY_STATUS.md`
- Vercel deploy details: `VERCEL_DEPLOY_PLAN.md` / `VERCEL_DEPLOY_REPORT.md`

Shared healthcare reference data (CMS, CDC, HRSA, NPPES) lives in `C:\dev\shared\data\` per the parent workspace convention — this project reads from there rather than re-downloading.
