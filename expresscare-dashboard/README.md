# ExpressCare Intelligence Grid

Real-time geographic demand intelligence for ExpressCare Maryland, fusing live MIEMSS EDAS ED-capacity data with the GeoHealth SDOH API and a LightGBM forecast model.

## Status

- [x] Scaffold (Vite + React 18 + TS + Tailwind + Leaflet + h3-js + Recharts + Zustand)
- [ ] EDAS client + types
- [ ] SQLite EDAS collector (Phase 1)
- [ ] Data-prep scripts (geocode / hex grid / CMS / weather / flu / base scores)
- [ ] Dashboard UI (Phase 3)
- [ ] LightGBM forecast model (Phase 2)
- [ ] Forecast chart + time slider animation

See `ED_PREDICTOR_PLAN.md` in the parent directory for the full build plan (designed to be executable via `claude -p`).

## Quick start

```bash
npm install
cp .env.example .env   # real .env already populated for local dev
npm run dev            # http://localhost:5173
```

## Structure

```
expresscare-dashboard/
├── src/                # Vite + React frontend
├── collector/          # Node/TSX EDAS SQLite collector
├── scripts/            # Data-prep scripts (TSX)
├── model/              # Python LightGBM training pipeline (separate venv)
├── public/data/        # Generated JSON artifacts (gitignored)
└── .env                # GeoHealth API key + EDAS base URL
```

## Data sources (all real, no fabrication)

- **EDAS** — `https://edas.miemss.org/edas-services/api/cached{facilities,hospitalstatus,jurisdictions}` (unauthenticated, 60s polling)
- **GeoHealth API** — `https://geohealth-api-production.up.railway.app` (X-API-Key, 60 req/min)
- **CMS Provider Data** — local mirror in `C:\dev\shared\data\cms\`, web fallback
- **Open-Meteo** — hourly weather archive + forecast (free, no key)
- **CDC FluView** — ILINet HHS Region 3 weekly rates
- **TIGER/Census** — geocoding via Census Bureau Geocoder
