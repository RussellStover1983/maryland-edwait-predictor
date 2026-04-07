import { latLngToCell, cellToLatLng, cellToBoundary } from 'h3-js';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve(import.meta.dirname, 'data', 'hex-grid.json');

interface HexCell {
  h3Index: string;
  centroid: { lat: number; lng: number };
  boundary: Array<{ lat: number; lng: number }>;
}

function main(): void {
  mkdirSync(resolve(import.meta.dirname, 'data'), { recursive: true });

  if (existsSync(OUT) && !process.argv.includes('--force')) {
    console.log(`[hex-grid] Output exists, skipping (use --force to overwrite)`);
    return;
  }

  const RES = 6;
  const LAT_MIN = 37.91, LAT_MAX = 39.72;
  const LNG_MIN = -79.49, LNG_MAX = -75.05;
  const STEP = 0.05;

  // Generate seed points and collect unique H3 cells
  const cellSet = new Set<string>();
  for (let lat = LAT_MIN; lat <= LAT_MAX; lat += STEP) {
    for (let lng = LNG_MIN; lng <= LNG_MAX; lng += STEP) {
      cellSet.add(latLngToCell(lat, lng, RES));
    }
  }
  console.log(`[hex-grid] Unique H3 cells before water filter: ${cellSet.size}`);

  // Build cells and filter out water (rough Chesapeake Bay + Atlantic cut)
  // Reject cells whose centroid is east of -76.0 AND south of lat 38.5
  const cells: HexCell[] = [];
  for (const h3Index of cellSet) {
    const [lat, lng] = cellToLatLng(h3Index);

    // Deliberate approximation: filter Chesapeake Bay and Atlantic water cells
    if (lng > -76.0 && lat < 38.5) {
      continue;
    }

    const boundary = cellToBoundary(h3Index);
    // cellToBoundary returns [lat, lng][] — close the polygon
    const boundaryPoints = boundary.map(([bLat, bLng]) => ({ lat: bLat, lng: bLng }));
    // Close the polygon by repeating the first point
    if (boundaryPoints.length > 0) {
      boundaryPoints.push({ ...boundaryPoints[0] });
    }

    cells.push({
      h3Index,
      centroid: { lat, lng },
      boundary: boundaryPoints,
    });
  }

  writeFileSync(OUT, JSON.stringify(cells, null, 2));
  console.log(`[hex-grid] Done: ${cells.length} cells written to ${OUT}`);
}

main();
