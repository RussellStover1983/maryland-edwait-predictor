# DATA_VIEWS_REPORT.md

## Summary

Two new views added to the ExpressCare Intelligence Grid dashboard:

1. **Data Definitions Panel** -- A 480px slide-out panel from the right side explaining all 38 model features, hex grid scoring formula, and data sources.
2. **Hospital History Table** -- A full-screen tabbed view with a sortable hospital table (live + 7d aggregate stats) and per-hospital detail view with time series charts.

## Files Created

| File | Purpose |
|------|---------|
| `server/api.ts` | Vite dev server middleware providing 3 Postgres API endpoints for historical hospital data |
| `src/components/DataDefinitions/DataDefinitionsPanel.tsx` | Slide-out panel with 9 collapsible sections covering model features, hex scoring, and data sources |
| `src/components/HospitalTable/HospitalTableView.tsx` | Full-screen hospital data explorer with sortable table and detail view with Recharts charts |
| `src/hooks/useHospitalHistory.ts` | React hooks for fetching hospital summary and time series data from the API middleware |

## Files Modified

| File | Changes |
|------|---------|
| `src/store/dashboardStore.ts` | Added `showDataDefinitions`, `view`, `selectedTableHospital` state + setters |
| `src/App.tsx` | Added sidebar links, conditional map/table rendering, DataDefinitionsPanel overlay |
| `vite.config.ts` | Added api-middleware plugin to wire up `server/api.ts` |
| `tsconfig.json` | Added `server` to `include` array |

## API Endpoints (dev server only)

| Endpoint | Description |
|----------|-------------|
| `GET /api/hospitals/stats` | Total snapshot count, hospital count, date range |
| `GET /api/hospitals/summary` | Per-hospital 7-day aggregates (avg census, max census, avg units, avg stay, alert count) |
| `GET /api/hospitals/:code/history?hours=N` | Hourly time series for one hospital (census, units, stay) |

## Verification

- `npx tsc --noEmit` -- passes cleanly (zero errors)
- `npx vite` -- dev server starts without errors
- No new dependencies added (uses existing `pg`, `recharts`, `zustand`, `dotenv`)

## Architecture Decisions

- **Vite middleware** for Postgres queries instead of a separate API server -- keeps the dev experience simple and avoids CORS. Only runs in dev mode; production would need a real backend.
- **Plain HTML `<table>` + Tailwind** for the hospital table -- no table library dependency.
- **Recharts** for time series charts -- already installed and used by ForecastChart.
- **Zustand store** for all view state -- consistent with existing patterns.
- **Collapsible sections** in Data Definitions -- keeps the panel scannable without overwhelming users.

## Success Criteria Checklist

- [x] Data Definitions panel opens/closes from sidebar link
- [x] All 38 features listed with descriptions, sources, and importance bars
- [x] Hex grid scoring formula explained with component weights
- [x] Data sources table with refresh frequencies
- [x] Hospital table shows all hospitals with live + 7d aggregate stats
- [x] Table columns are sortable (click header to sort, click again to reverse)
- [x] Clicking a hospital row opens detail view with time series charts
- [x] Back button returns to map view
- [x] TypeScript compiles cleanly
- [x] Dark theme consistency maintained throughout
