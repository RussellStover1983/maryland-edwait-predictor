# Vercel Deploy Report — ExpressCare Intelligence Grid

**Deploy date:** 2026-04-14
**Status:** ✅ LIVE

## Production URLs

- Primary alias: **https://expresscare-dashboard.vercel.app**
- Team alias: https://expresscare-dashboard-russellstover1983s-projects.vercel.app
- Latest deployment: https://expresscare-dashboard-eahc4j7jt-russellstover1983s-projects.vercel.app
- Inspector: https://vercel.com/russellstover1983s-projects/expresscare-dashboard

**Vercel project:** `prj_x5meYD4swCWJxiUzxJIUmBf1t6dX`
**Team:** `russellstover1983s-projects` (`team_jQEL0CnNqGsSzuPfptipjxDt`)

## Verified endpoints

| Endpoint | Status | Notes |
|----------|--------|-------|
| `/` | 200 | SPA loads (1.7MB JS, 30KB CSS, gzipped) |
| `/api/edas/cachedhospitalstatus` | 200 | Proxy to `edas.miemss.org` returning 30 hospitals |
| `/api/hospitals/stats` | 200 | 92,379 snapshots across 76 hospitals |
| `/api/hospitals/summary` | 200 | ~25KB, per-hospital 7d aggregates |
| `/api/hospitals/:code/history` | 200 | Hourly rollups, 1h–168h window |
| `/api/model/inference_config` | 200 | LightGBM feature config |
| `/api/model/hex_base_scores` | 200 | 35 MB payload, ~2.9s cold |
| `/api/model/lgbm_1h` | 200 | Model tree JSON |
| `/api/model/expresscare_locations` | 200 | |
| `/api/model/competitor_locations` | 200 | |

## What was built

### Serverless functions (`expresscare-dashboard/api/`)

- `api/_db.ts` — shared `pg.Pool` helper (strips `?sslmode=require`, `ssl: false` for Railway).
- `api/edas/[...path].ts` — CORS proxy to EDAS with browser-like `User-Agent`. Includes URL-regex fallback when `req.query.path` is empty.
- `api/hospitals/stats.ts` — snapshot counts / date range.
- `api/hospitals/summary.ts` — 7-day per-hospital aggregates. Alert summation uses `COALESCE(col::int,0)` since EDAS `alert_*` columns are integers, not booleans.
- `api/hospitals/[code]/history.ts` — hourly rollup for a hospital (hours clamped 1–168).
- `api/model/[key].ts` — serves rows from Postgres `model_artifacts` table by `artifact_key`.

### Frontend changes

- `src/services/edas.ts` — always uses `/api/edas` unless `VITE_EDAS_BASE_URL` is set (dev: Vite proxy; prod: Vercel function).
- `src/App.tsx` — in production, fetches `hex-base-scores`, `expresscare-locations`, `competitor-locations` from `/api/model/<key>`; dev still uses static `/data/*.json`.
- `src/services/predictor.ts` — LightGBM model + config + baselines loaded from `/api/model/*` in production.

### Postgres (Railway) — `model_artifacts` table

Newly uploaded (via one-off Python script):

| artifact_key | bytes |
|---|---|
| `hex_base_scores` | 38,144,817 |
| `expresscare_locations` | 8,117 |
| `competitor_locations` | 5,774 |

Already present from prior model pipeline: `lgbm_1h`, `lgbm_4h`, `inference_config`, `hospital_baselines`, `training_meta`, `hscrc_baselines`, `flu_history`, `weather_history`.

### Vercel project config

- `vercel.json`: `framework: vite`, `outputDirectory: dist`, 1-hour browser / 24-hour edge cache on `/data/*`.
- Env vars: `DATABASE_URL` set on **Production** and **Development** (Railway Postgres URL, shared with EDAS collector + weekly refresh).
- `@vercel/node@^5.7.5` installed as dev dependency.

## Issues encountered and resolved

1. **API routes returning `index.html`.** Initial `vercel link` auto-injected `experimentalServices.web` into `vercel.json`, which claimed the `/` route prefix and prevented `api/` function detection. **Fix:** removed that block, kept only `framework`, `outputDirectory`, and `headers`.
2. **`ERR_MODULE_NOT_FOUND` on all Postgres functions.** Project has `"type": "module"` in `package.json`, so relative imports in the compiled ESM output must include `.js` extensions. **Fix:** `import { getPool } from '../_db.js'` (TS allows `.js` suffix referring to the `.ts` source).
3. **EDAS proxy returning 404 with empty path.** `req.query.path` was empty for the `[...path]` catch-all in one deploy. **Fix:** added a URL-regex fallback that extracts the segment from `req.url` when the dynamic param is missing. Also switched to a browser-like `User-Agent` + `Accept: application/json` to avoid edge cases.
4. **`argument of CASE/WHEN must be type boolean, not type integer`** on summary endpoint. The `alert_*` columns in `hospital_snapshots` are stored as integers. **Fix:** replaced the `CASE WHEN col THEN 1 ELSE 0 END` pattern with `COALESCE(col::int, 0)` summation.

## Known limitations / future work

- **hex_base_scores response size.** The largest artifact is 35 MB uncompressed. Current cold response is ~2.9s on Vercel Node runtime; this works but is fragile if Vercel reduces response size limits. Migrate to Vercel Blob (or keep it as a static asset in `public/data/`) if users report load issues.
- **Git-based auto-deploy not wired up.** Step 12 was optional. The Vercel project is **not yet** linked to `RussellStover1983/maryland-edwait-predictor`; deploys are CLI-driven from `expresscare-dashboard/`. Link via `vercel git connect` (or the dashboard) when ready.
- **Custom domain not configured.** Using the `.vercel.app` alias.
- **No auth / access control.** Public endpoint. If this is meant to be internal, add Vercel Password Protection or auth middleware.
- **Build warning.** Main JS bundle is 1.68 MB (gzip 472 KB). Consider `build.rollupOptions.output.manualChunks` for code-splitting deck.gl separately.
- **Preview env var.** `DATABASE_URL` was added to Production + Development only. If you enable PR preview deploys, add it to Preview as well.
