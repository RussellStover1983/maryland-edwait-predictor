# EDAS Collector → Railway Postgres: Deploy Report

**Date:** 2026-04-09

## Files Created / Modified

| File | Action | Description |
|------|--------|-------------|
| `collector/db.ts` | **Modified** | Dual-backend (Postgres via `pg` / SQLite via `sql.js`) selected by `DATABASE_URL` env var |
| `collector/collect.ts` | **Modified** | All DB calls now `await`-ed; `closeDb()` in `finally` block; backend startup log line |
| `collector/migrate-to-pg.ts` | **Created** | One-time migration script: SQLite → Postgres, chunked batch inserts |
| `Dockerfile.collector` | **Created** | Multi-stage Docker build for Railway deployment (node:20-slim + tsx) |
| `RAILWAY_SETUP.md` | **Created** | Manual Railway deployment instructions |
| `.env` | **Modified** | Added `DATABASE_URL` (Railway Postgres connection string) |
| `package.json` / `package-lock.json` | **Modified** | Added `pg` (runtime) and `@types/pg` (dev) dependencies |

## npm install

- `pg` — installed successfully (14 packages added)
- `@types/pg` — installed successfully (1 package added)

## SQLite → Postgres Migration

- **Source:** `collector/data/edas-history.db`
- **Snapshots migrated:** 10,453
- **Logs migrated:** 173
- **Method:** Batched multi-row INSERT in chunks of 500
- **Duration:** ~10 seconds
- **Errors:** None

## Live Collection Test (`collect:once`)

- **Backend detected:** `postgres (Railway)`
- **EDAS API:** All 3 endpoints returned HTTP 200
- **Hospitals inserted:** 62
- **Post-collection totals:** 10,515 snapshots, 174 logs
- **Math check:** 10,453 (migrated) + 62 (new poll) = 10,515 ✓

## Errors Encountered

1. **SSL connection rejected** — Railway's proxy Postgres does not require SSL. Fixed by removing the automatic `?sslmode=require` append from both `db.ts` and `migrate-to-pg.ts`. Connection works with the plain connection string.

## Next Steps (Manual)

Complete the steps in `RAILWAY_SETUP.md` to deploy the collector to Railway for 24/7 cloud collection. The local SQLite database at `collector/data/edas-history.db` is preserved as a backup.
