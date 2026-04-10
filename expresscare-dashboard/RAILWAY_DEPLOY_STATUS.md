## EDAS Collector Railway Deployment Status

**Date:** 2026-04-09

### 1. GitHub Repo
- **URL:** https://github.com/RussellStover1983/maryland-edwait-predictor
- **Status:** Created and pushed (master + main branches)

### 2. Railway Project Linked
- **Yes** — Project: `elegant-success`
- **Project ID:** `e1e541f2-6ca8-493a-aa3d-093011b7bd7b`
- **Environment:** production

### 3. Railway Service Created
- **Name:** `edas-collector`
- **Service ID:** `5321887e-063d-48a7-8eeb-19117993dbe1`
- **Status:** Running

### 4. Environment Variables Set
- `EDAS_BASE_URL`
- `POLL_INTERVAL_MS`
- `COLLECTOR_USER_AGENT`
- `DATABASE_URL`

### 5. Deployment
- **Status:** Started and running
- **Deployment ID:** `c8cca2c8-905b-49bd-8afa-4dc3aa544c45`
- **Build logs:** https://railway.com/project/e1e541f2-6ca8-493a-aa3d-093011b7bd7b/service/5321887e-063d-48a7-8eeb-19117993dbe1?id=c8cca2c8-905b-49bd-8afa-4dc3aa544c45&

### 6. Logs (first collector output)
```
Starting Container
[collector] 200 https://edas.miemss.org/edas-services/api/cachedhospitalstatus (77ms, attempt 1)
[collector] 200 https://edas.miemss.org/edas-services/api/cachedfacilities (43ms, attempt 1)
[collector] OK: 63 hospitals inserted. Total snapshots=10578, logs=175
[collector] DB: /app/collector/data/edas-history.db
[collector] Mode: continuous (300000ms interval)
[collector] Backend: postgres (Railway)
[collector] 200 https://edas.miemss.org/edas-services/api/cachedjurisdictions (37ms, attempt 1)
```

### 7. Local Collector
- **Killed** — PIDs 32012, 34680 terminated. Railway collector is now the authoritative writer.

### 8. Manual Steps Needed
- None. Deployment is fully operational.

### Notes
- Created `railway.toml` in `expresscare-dashboard/` to specify `Dockerfile.collector` as the build Dockerfile (Railway CLI `up` command doesn't accept a `--dockerfile` flag).
- The collector is writing to the shared Railway Postgres instance (same DB as geohealth-api's dpc-market-fit service).
- Polling interval: 5 minutes (300000ms).
