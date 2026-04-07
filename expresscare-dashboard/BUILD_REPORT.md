# ExpressCare Intelligence Grid — Build Report

**Built**: 2026-04-07
**Status**: All phases (A–F) completed successfully. Dashboard boots and serves HTTP 200.

## File Tree (created/modified)

```
expresscare-dashboard/
├── collector/
│   ├── collect.ts                  # EDAS polling collector (--once mode)
│   ├── db.ts                       # SQLite via sql.js (pure JS, no native build)
│   └── data/
│       └── edas-history.db         # 126 snapshots, 2 collection logs
├── scripts/
│   ├── fetch-cms-hospital-data.ts  # CMS POS + OP-18B (API returned 400)
│   ├── fetch-flu-data.ts           # CDC FluView (stub — endpoint 500'd)
│   ├── fetch-weather-history.ts    # Open-Meteo archive hourly+daily
│   ├── generate-hex-grid.ts        # H3 res-6 hex grid over Maryland
│   ├── geocode-expresscare-locations.ts  # Census Bureau + Nominatim fallback
│   ├── geocode-competitor-locations.ts   # Same pattern
│   ├── precompute-base-scores.ts   # GeoHealth batch API → composite scores
│   └── data/                       # All generated JSON (gitignored)
│       ├── cms-hospitals.json          (861 entries)
│       ├── competitor-locations.json   (27 entries)
│       ├── expresscare-locations.json  (33 entries)
│       ├── flu-history.json            (stub — CDC unavailable)
│       ├── hex-base-scores.json        (2,099 entries)
│       ├── hex-grid.json               (2,099 cells)
│       └── weather-history.json        (~20MB hourly Baltimore weather)
├── public/data/                    # Copied from scripts/data for Vite serving
├── src/
│   ├── App.tsx                     # Full layout: sidebar + map + forecast
│   ├── vite-env.d.ts               # Vite env type declarations
│   ├── services/
│   │   ├── edas.ts                 # Typed EDAS fetch client with retry
│   │   ├── edas-normalize.ts       # Hospital normalization + system classification
│   │   └── predictor.ts            # Placeholder forecast (exponential decay)
│   ├── hooks/
│   │   └── useEDAS.ts              # 60s polling hook with trend tracking
│   ├── store/
│   │   └── dashboardStore.ts       # Zustand store (viewport, layers, selection)
│   └── components/
│       ├── Map/
│       │   ├── MapContainer.tsx     # Leaflet + CartoDB Dark Matter tiles
│       │   ├── HexGrid.tsx          # H3 hex polygons colored by baseScore
│       │   ├── HospitalMarkers.tsx  # EDAS hospitals, census-colored circles
│       │   ├── ExpressCareMarkers.tsx  # Blue EC location markers
│       │   ├── CompetitorMarkers.tsx   # Grey competitor markers
│       │   └── CoverageGapZones.tsx    # Amber pulsing gap zones
│       ├── Sidebar/
│       │   ├── LiveStatus.tsx       # Sorted hospital table with trends
│       │   ├── StatewideSummary.tsx  # Aggregate statistics
│       │   ├── ExpansionOpportunities.tsx  # Top 10 expansion candidates
│       │   └── LocationDetail.tsx   # Selected EC catchment analysis
│       ├── Controls/
│       │   └── LayerPanel.tsx       # Layer toggle switches
│       ├── TimeControls/
│       │   └── TimeBar.tsx          # LIVE indicator, time slider, play/pause
│       └── Timeline/
│           └── ForecastChart.tsx    # 24h Recharts forecast with P10–P90 band
└── BUILD_REPORT.md
```

## Data Counts

| Dataset | Count |
|---------|-------|
| EDAS hospital snapshots | 126 (2 collection runs × 63 hospitals) |
| Hex grid cells (H3 res-6) | 2,099 |
| Hex base scores | 2,099 |
| ExpressCare locations geocoded | 33 |
| Competitor locations geocoded | 27 |
| CMS hospitals (MD, from local POS) | 861 |
| Weather history | Hourly, 2024-01-01 → 2026-04-06 |
| Flu data | Stub (CDC FluView returned HTTP 500) |

## Decisions & Notes

- **better-sqlite3 → sql.js**: No Visual Studio C++ build tools on this machine; switched to pure-JS sql.js (zero native deps). Same SQLite functionality.
- **Hex grid count (2,099)**: Higher than the plan's 600-800 estimate because the 0.05° step over Maryland's bounding box generates more cells. The water filter (east of -76.0 AND south of 38.5) removed 164 cells. This is conservative — more cells = better resolution.
- **CMS OP-18B API**: Returned HTTP 400 on all 3 attempts (API schema may have changed). OP-18B data is null for all hospitals. Not blocking — only used for baseline enrichment.
- **CDC FluView**: Returned HTTP 500 on all attempts. Stub file written with fallback instructions.
- **Belcamp geocoding**: "vicinity James Run" is not a real address. City-level Nominatim geocoding used as fallback.
- **EDAS null alerts**: Some hospitals return null `alerts` object. Added defensive null checks in both collector and normalizer.

## Skipped/Failed Steps

- **OP-18B enrichment**: CMS Timely & Effective Care API returned 400. Hospital records have `op18bMinutes: null`. Non-blocking.
- **CDC flu data**: Stub file created. User can manually download from https://gis.cdc.gov/grasp/fluview/fluportaldashboard.html

## Next Step: Train the LightGBM Model

```bash
cd C:\dev\maryland-edwait-predictor\expresscare-dashboard\model
# Follow instructions in C:\dev\maryland-edwait-predictor\ED-PREDICTIVE-MODELING-RESEARCH.md
# Prerequisites:
#   1. Accumulate ≥1 week of EDAS data: npm run collect (runs continuously, 5-min polls)
#   2. pip install -r requirements.txt
#   3. python train.py --db ../collector/data/edas-history.db --weather ../scripts/data/weather-history.json
#   4. python export.py → model/output/prediction-model.json
#   5. Replace src/services/predictor.ts placeholder with real model evaluator
```
