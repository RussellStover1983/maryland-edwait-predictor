# Hex Grid Upgrade Report: Resolution 6 → Resolution 8

**Date:** 2026-04-13
**Status:** Complete.

---

## Summary

Upgraded the ExpressCare Intelligence Grid from H3 resolution 6 (~2,263 cells, ~36 km²/hex) to resolution 8 (~101K cells, ~0.74 km²/hex). Replaced react-leaflet `<Polygon>` rendering with deck.gl's `H3HexagonLayer` for WebGL-accelerated rendering of 100K+ hexes.

---

## Cell Count

| Metric | Value |
|--------|-------|
| Unique H3 cells (pre-filter) | 108,811 |
| After water filter | **100,995** |
| Expected range | 90K–110K |

The water filter removes Chesapeake Bay and Atlantic Ocean cells using a two-pass approach:
1. Reject cells east of -76.0° AND south of 38.5° (bay/ocean)
2. Exempt cells west of -76.3° or north of 39.0° (definitely land on Eastern Shore)

---

## File Sizes

| File | Old (res 6) | New (res 8) | Notes |
|------|-------------|-------------|-------|
| `hex-grid.json` | ~1.5 MB (with boundaries) | 8.9 MB (index + centroid only) | No boundary coords needed — deck.gl computes on GPU |
| `hex-base-scores.json` | 759 KB (~2,263 entries) | 31.2 MB / 2.7 MB gzipped (~101K entries) | Complete |

---

## Dependencies Added

```
@deck.gl/core
@deck.gl/layers
@deck.gl/geo-layers
@deck.gl/react
@deck.gl/mesh-layers    (peer dep of geo-layers)
@deck.gl/extensions     (peer dep of geo-layers)
```

All installed with `--legacy-peer-deps` due to React 18 peer dependency resolution.

**Build note:** The production bundle increased from ~400 KB to ~1,655 KB (465 KB gzipped) due to deck.gl's WebGL runtime. This is expected and acceptable — deck.gl is the rendering engine for 100K+ hexes.

---

## Files Changed

### New
- `src/components/Map/DeckHexLayer.tsx` — deck.gl H3HexagonLayer overlay on Leaflet map

### Modified
- `scripts/generate-hex-grid.ts` — Resolution 8, finer seed grid (STEP=0.005), compact output (no boundaries)
- `scripts/precompute-base-scores.ts` — Added `centroid` field to output, removed boundary dependency from HexCell interface
- `src/App.tsx` — Removed hexGrid state/fetch, replaced HexGridWithBoundaries + CoverageGapZones with single DeckHexLayer
- `src/components/Sidebar/ExpansionOpportunities.tsx` — Removed `hexGrid` prop, reads centroids from `hexScores` directly
- `package.json` — Added deck.gl dependencies

### Deleted
- `src/components/Map/HexGrid.tsx` — Replaced by DeckHexLayer
- `src/components/Map/CoverageGapZones.tsx` — Merged into DeckHexLayer (mode='coverageGaps')

---

## Architecture

### Before
```
hex-grid.json (h3Index, centroid, boundary[]) → 2,263 react-leaflet <Polygon> components
```

### After
```
hex-base-scores.json (h3Index, centroid, baseScore, components, ...) → 1 deck.gl H3HexagonLayer (WebGL)
```

deck.gl's `H3HexagonLayer` computes hex boundaries from H3 indices on the GPU. No boundary coordinates stored or transferred.

### deck.gl Integration
- **Overlay approach:** A `<canvas>` element positioned absolutely over the Leaflet map container
- **View sync:** Leaflet `move`/`zoom`/`resize` events → `deck.setProps({ viewState })` with zoom offset of -1
- **Interactivity:** `pickable: true` for hover tooltips; click-through to Leaflet markers when no hex picked
- **z-index:** Canvas at z-index 450 (above tiles, below Leaflet markers at 600+)

### Modes
- **heatmap:** All hexes colored by composite score (green → amber → red gradient), opacity 0.35
- **coverageGaps:** Only hexes where baseScore > 65 AND nearest ExpressCare > 8mi, amber color, opacity 0.45

---

## Data Regeneration Status

### Hex Grid (COMPLETE)
```
npx tsx scripts/generate-hex-grid.ts --force
→ 100,995 cells in 8.9 MB
```

### Base Scores (COMPLETE)
```
npx tsx scripts/precompute-base-scores.ts
→ 2,020 batches, 100,995 cells scored
→ 31.2 MB raw / 2.7 MB gzipped
→ Completed in ~37 minutes (GeoHealth API rate limited at 60 req/min)
```

Copied to `public/data/hex-base-scores.json`.

---

## Verification Checklist

- [x] TypeScript compiles cleanly (`npx tsc --noEmit`)
- [x] Production build succeeds (`npx vite build`)
- [x] Hex grid at resolution 8: 100,995 cells
- [x] Old HexGrid.tsx and CoverageGapZones.tsx deleted
- [x] No remaining imports of deleted components
- [x] ExpansionOpportunities uses centroid from hexScores (no hexGrid prop)
- [x] DeckHexLayer supports heatmap and coverageGaps modes
- [x] Tooltips on hover with score, population, nearest ExpressCare, component breakdown
- [x] Base scores regeneration complete (100,995 cells, 31.2 MB / 2.7 MB gzipped)
- [ ] Visual verification in browser (run `npm run dev` and check)

---

## What's NOT Included

- Gravity model / patient flow — deferred to Phase 4
- Resolution hierarchy (res 7 at low zoom) — unnecessary, deck.gl handles 100K+ hexes at any zoom
- Click-to-select-hex detail panel — hover tooltips sufficient for now
- Bundle splitting for deck.gl — can be added later with dynamic `import()`
