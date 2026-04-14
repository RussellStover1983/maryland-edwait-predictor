import { latLngToCell, cellToLatLng } from 'h3-js';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve(import.meta.dirname, 'data', 'hex-grid.json');

interface HexCell {
  h3Index: string;
  centroid: { lat: number; lng: number };
}

function main(): void {
  mkdirSync(resolve(import.meta.dirname, 'data'), { recursive: true });

  if (existsSync(OUT) && !process.argv.includes('--force')) {
    console.log(`[hex-grid] Output exists, skipping (use --force to overwrite)`);
    return;
  }

  const RES = 8;
  const LAT_MIN = 37.91, LAT_MAX = 39.72;
  const LNG_MIN = -79.49, LNG_MAX = -75.05;
  const STEP = 0.005;

  // Generate seed points and collect unique H3 cells
  const cellSet = new Set<string>();
  for (let lat = LAT_MIN; lat <= LAT_MAX; lat += STEP) {
    for (let lng = LNG_MIN; lng <= LNG_MAX; lng += STEP) {
      cellSet.add(latLngToCell(lat, lng, RES));
    }
  }
  console.log(`[hex-grid] Unique H3 cells before water filter: ${cellSet.size}`);

  // Build cells and filter out water (Chesapeake Bay + Atlantic)
  // Reject cells whose centroid is east of -76.0 AND south of lat 38.5
  // BUT keep cells west of -76.3 (definitely land) or north of 39.0 (definitely land)
  const cells: HexCell[] = [];
  for (const h3Index of cellSet) {
    const [lat, lng] = cellToLatLng(h3Index);

    // Water filter: only apply to cells that are NOT definitely land
    const definitelyLand = lng < -76.3 || lat > 39.0;
    if (!definitelyLand && lng > -76.0 && lat < 38.5) {
      continue;
    }

    cells.push({
      h3Index,
      centroid: { lat, lng },
    });
  }

  writeFileSync(OUT, JSON.stringify(cells));
  console.log(`[hex-grid] Done: ${cells.length} cells written to ${OUT}`);
}

main();
