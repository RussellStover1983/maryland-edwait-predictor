# Auto-Refresh Pipeline Report

**Date:** 2026-04-14
**Status:** All steps completed successfully

---

## What Was Built

An automated weekly data refresh + model retrain pipeline for the ExpressCare Intelligence Grid. The pipeline runs as a Railway cron job alongside the existing EDAS collector, sharing the same Postgres database.

### Architecture

```
Railway (elegant-success project)
├── edas-collector       (existing, 24/7, every 5 min)
│   └── EDAS snapshots → hospital_snapshots table
└── weekly-refresh       (NEW, cron: Mon 6am UTC)
    ├── Fetch flu/ILI data from Delphi API
    ├── Fetch weather data from Open-Meteo
    ├── Extract EDAS snapshots from Postgres
    ├── Build 38-feature matrix
    ├── Train LightGBM 1h + 4h models
    └── Store all artifacts → model_artifacts table
```

---

## Files Created

| File | Purpose |
|------|---------|
| `model/create_artifacts_table.py` | Migration: creates `model_artifacts` table in Postgres |
| `model/weekly_refresh.py` | Self-contained pipeline script (flu + weather + EDAS + features + train + store) |
| `model/upload_initial_artifacts.py` | One-time seed of existing local artifacts to Postgres |
| `Dockerfile.refresh` | Minimal Python container for Railway cron |
| `railway-refresh.toml` | Railway cron config (Monday 6am UTC) |

## Files Modified

| File | Change |
|------|--------|
| `server/api.ts` | Added `GET /api/model/:key` endpoint serving artifacts from Postgres |
| `model/requirements.txt` | Added `requests>=2.31` dependency |

---

## Database: model_artifacts Table

```sql
CREATE TABLE model_artifacts (
  id SERIAL PRIMARY KEY,
  artifact_key TEXT NOT NULL UNIQUE,
  artifact_json JSONB NOT NULL,
  file_size_bytes INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'
);
```

### Current Artifacts (8 total)

| Artifact Key | Size | Description |
|-------------|------|-------------|
| `lgbm_1h` | 2,467,965 bytes | 1-hour LightGBM model JSON |
| `lgbm_4h` | 3,662,348 bytes | 4-hour LightGBM model JSON |
| `inference_config` | 1,730 bytes | Feature names, metrics, hospital label map |
| `hospital_baselines` | 10,454 bytes | Per-hospital 24-hour census profiles (76 hospitals) |
| `training_meta` | 1,192 bytes | Training metrics and date ranges |
| `hscrc_baselines` | 141,353 bytes | HSCRC monthly volume baselines |
| `flu_history` | 60,798 bytes | CDC FluView ILI data (327 weeks) |
| `weather_history` | 6,741 bytes | Open-Meteo hourly weather for Baltimore |

---

## Model Training Results (Live Run)

| Metric | 1h Model | 4h Model |
|--------|----------|----------|
| **MAE** | **0.2030** | **0.4447** |
| RMSE | 0.4338 | 0.6916 |
| Best Iteration | 104 | 158 |
| Training Rows | 60,961 | 60,961 |
| Test Rows | 15,241 | 15,241 |

**Training data range:** 2026-04-07 to 2026-04-14 (7 days of EDAS collection)
**Flu data coverage:** 327 weeks (epiweek 202001 to 202613)
**Weather coverage:** 192 hourly records
**Pipeline duration:** 31.3 seconds

---

## API Endpoint

```
GET /api/model/:key
```

Returns the artifact JSON from Postgres. Includes `X-Artifact-Date` response header with the artifact's `created_at` timestamp.

**Verified endpoints:**
- `GET /api/model/inference_config` - 200 OK
- `GET /api/model/hospital_baselines` - 200 OK
- `GET /api/model/lgbm_1h` - 200 OK
- `GET /api/model/nonexistent` - 404 Not Found

---

## Verification Checklist

- [x] `model_artifacts` table created in Railway Postgres
- [x] `weekly_refresh.py` runs successfully and stores all 8 artifacts
- [x] `GET /api/model/:key` endpoint serves artifacts from Postgres
- [x] `Dockerfile.refresh` and `railway-refresh.toml` created
- [x] Initial artifacts uploaded to Postgres from local files
- [x] `npx tsc --noEmit` compiles cleanly
- [x] Dev server starts and API endpoint returns data

---

## Railway Deployment Instructions

To deploy the weekly refresh as a cron job on Railway:

1. **Open Railway dashboard** for the `elegant-success` project
2. **Create a new service** (+ New Service > GitHub Repo)
3. Point to the same repo: `RussellStover1983/maryland-edwait-predictor`
4. **Set the root directory** to `expresscare-dashboard/`
5. **Configure the build:**
   - Dockerfile path: `Dockerfile.refresh`
6. **Set environment variables:**
   - `DATABASE_URL` should be auto-linked from the existing Postgres instance
   - Or manually copy the same `DATABASE_URL` used by `edas-collector`
7. **Configure the cron schedule:**
   - In service settings > Deploy > Cron Schedule: `0 6 * * 1` (Monday 6am UTC)
   - Restart Policy: Never
8. **Deploy** and monitor the first run in Railway logs

Alternatively, use the Railway CLI:
```bash
railway service create --name weekly-refresh
railway link  # select elegant-success project
railway variables set DATABASE_URL=<your-url>
railway up --dockerfile Dockerfile.refresh
# Then set cron schedule via dashboard
```

---

## What This Does NOT Include

- **Frontend model hot-swap** — Dashboard still loads from static `public/data/model/` files. Future work: switch `predictor.ts` to fetch from `/api/model/:key`.
- **Alerting** — Failures appear in Railway logs only. Add Slack/email alerts if needed.
- **Model versioning** — Artifacts are overwritten each run. Add a `version` column if rollback is needed.
- **Automatic Railway service creation** — Must be done manually via dashboard/CLI.
