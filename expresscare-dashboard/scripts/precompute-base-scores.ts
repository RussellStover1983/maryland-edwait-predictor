import 'dotenv/config';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve(import.meta.dirname, 'data', 'hex-base-scores.json');
const PARTIAL = resolve(import.meta.dirname, 'data', 'hex-base-scores.partial.json');
const HEX_GRID = resolve(import.meta.dirname, 'data', 'hex-grid.json');
const EXPRESS_CARE = resolve(import.meta.dirname, 'data', 'expresscare-locations.json');

const API_KEY = process.env.VITE_GEOHEALTH_API_KEY || '';
const API_BASE = 'https://geohealth-api-production.up.railway.app';

interface HexCell {
  h3Index: string;
  centroid: { lat: number; lng: number };
}

interface ExpressCareLocation {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

interface HexBaseScore {
  h3Index: string;
  baseScore: number;
  centroid: { lat: number; lng: number };
  components: {
    healthBurden: number;
    socialVulnerability: number;
    coverageGap: number;
    populationDensity: number;
  };
  tractGeoid: string;
  population: number;
  nearestExpressCare: { id: string; name: string; distanceMiles: number };
}

interface BatchResult {
  address: string;
  status: string;
  tract?: {
    geoid?: string;
    total_population?: number;
    uninsured_rate?: number;
    poverty_rate?: number;
    sdoh_index?: number;
    svi_themes?: { rpl_themes?: number };
    places_measures?: {
      diabetes?: number;
      casthma?: number;
      mhlth?: number;
      checkup?: number;
    };
  };
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findNearestExpressCare(
  lat: number, lng: number, locations: ExpressCareLocation[],
): { id: string; name: string; distanceMiles: number } {
  let nearest = { id: '', name: '', distanceMiles: Infinity };
  for (const loc of locations) {
    const d = haversineMiles(lat, lng, loc.lat, loc.lng);
    if (d < nearest.distanceMiles) {
      nearest = { id: loc.id, name: loc.name, distanceMiles: Math.round(d * 100) / 100 };
    }
  }
  return nearest;
}

async function batchFetch(addresses: string[]): Promise<BatchResult[]> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const start = Date.now();
    try {
      const res = await fetch(`${API_BASE}/v1/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY,
        },
        body: JSON.stringify({ addresses }),
      });
      const latency = Date.now() - start;

      if (res.status === 429) {
        const resetAfter = parseInt(res.headers.get('X-RateLimit-Reset') || '60', 10);
        console.warn(`[base-scores] Rate limited, waiting ${resetAfter}s...`);
        await new Promise((r) => setTimeout(r, resetAfter * 1000));
        continue;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

      console.log(`[base-scores] batch OK (${latency}ms, attempt ${attempt})`);
      const data = await res.json() as { results: BatchResult[] };
      return data.results;
    } catch (err) {
      console.warn(`[base-scores] batch FAIL (attempt ${attempt}): ${err}`);
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw new Error('unreachable');
}

async function main(): Promise<void> {
  mkdirSync(resolve(import.meta.dirname, 'data'), { recursive: true });

  if (existsSync(OUT) && !process.argv.includes('--force')) {
    console.log(`[base-scores] Output exists, skipping (use --force to overwrite)`);
    return;
  }

  if (!API_KEY) {
    console.error('[base-scores] VITE_GEOHEALTH_API_KEY not set in .env');
    process.exit(1);
  }

  const hexCells: HexCell[] = JSON.parse(readFileSync(HEX_GRID, 'utf-8'));
  const ecLocations: ExpressCareLocation[] = JSON.parse(readFileSync(EXPRESS_CARE, 'utf-8'));

  console.log(`[base-scores] ${hexCells.length} hex cells, ${ecLocations.length} ExpressCare locations`);

  // Load checkpoint if it exists
  let rawResults: Map<string, { tract: BatchResult['tract']; nearest: HexBaseScore['nearestExpressCare'] }> = new Map();
  let startBatch = 0;

  if (existsSync(PARTIAL) && !process.argv.includes('--force')) {
    const partial = JSON.parse(readFileSync(PARTIAL, 'utf-8')) as {
      completedBatches: number;
      results: Array<{ h3Index: string; tract: BatchResult['tract']; nearest: HexBaseScore['nearestExpressCare'] }>;
    };
    startBatch = partial.completedBatches;
    for (const r of partial.results) {
      rawResults.set(r.h3Index, { tract: r.tract, nearest: r.nearest });
    }
    console.log(`[base-scores] Resuming from batch ${startBatch} (${rawResults.size} cells cached)`);
  }

  // Build batches of 50
  const BATCH_SIZE = 50;
  const batches: Array<{ cells: HexCell[]; addresses: string[] }> = [];
  for (let i = 0; i < hexCells.length; i += BATCH_SIZE) {
    const slice = hexCells.slice(i, i + BATCH_SIZE);
    batches.push({
      cells: slice,
      addresses: slice.map((c) => `${c.centroid.lng},${c.centroid.lat}`),
    });
  }

  console.log(`[base-scores] ${batches.length} batches total, starting at batch ${startBatch}`);

  for (let bIdx = startBatch; bIdx < batches.length; bIdx++) {
    const batch = batches[bIdx];
    const results = await batchFetch(batch.addresses);

    for (let j = 0; j < batch.cells.length; j++) {
      const cell = batch.cells[j];
      const result = results[j];
      const nearest = findNearestExpressCare(cell.centroid.lat, cell.centroid.lng, ecLocations);
      rawResults.set(cell.h3Index, {
        tract: (result?.status === 'success' || result?.status === 'ok') ? result.tract : undefined,
        nearest,
      });
    }

    if ((bIdx + 1) % 10 === 0 || bIdx === batches.length - 1) {
      console.log(`[base-scores] Progress: batch ${bIdx + 1}/${batches.length} (${rawResults.size} cells)`);
      // Save checkpoint
      const checkpointData = {
        completedBatches: bIdx + 1,
        results: Array.from(rawResults.entries()).map(([h3Index, data]) => ({
          h3Index,
          ...data,
        })),
      };
      writeFileSync(PARTIAL, JSON.stringify(checkpointData));
    }

    // Throttle: 1.1s between calls to stay under 60 req/min
    await new Promise((r) => setTimeout(r, 1100));
  }

  // First pass: collect raw values for normalization
  const rawValues = {
    diabetes: [] as number[],
    casthma: [] as number[],
    uninsuredRate: [] as number[],
    pctNoCheckup: [] as number[],
    mhlth: [] as number[],
    population: [] as number[],
  };

  for (const [, data] of rawResults) {
    const t = data.tract;
    if (!t) continue;
    const pm = t.places_measures;
    if (pm?.diabetes != null) rawValues.diabetes.push(pm.diabetes);
    if (pm?.casthma != null) rawValues.casthma.push(pm.casthma);
    if (t.uninsured_rate != null) rawValues.uninsuredRate.push(t.uninsured_rate);
    if (pm?.checkup != null) rawValues.pctNoCheckup.push(100 - pm.checkup);
    if (pm?.mhlth != null) rawValues.mhlth.push(pm.mhlth);
    if (t.total_population != null) rawValues.population.push(t.total_population);
  }

  const range = (arr: number[]) => {
    if (arr.length === 0) return { min: 0, max: 1 };
    const min = Math.min(...arr);
    const max = Math.max(...arr);
    return { min, max: max === min ? min + 1 : max };
  };

  const normalize = (val: number, r: { min: number; max: number }) =>
    Math.max(0, Math.min(1, (val - r.min) / (r.max - r.min)));

  const ranges = {
    diabetes: range(rawValues.diabetes),
    casthma: range(rawValues.casthma),
    uninsuredRate: range(rawValues.uninsuredRate),
    pctNoCheckup: range(rawValues.pctNoCheckup),
    mhlth: range(rawValues.mhlth),
  };
  const maxPop = Math.max(...rawValues.population, 1);

  // Second pass: compute scores
  const hexScores: HexBaseScore[] = [];
  for (const cell of hexCells) {
    const data = rawResults.get(cell.h3Index);
    if (!data) continue;

    const t = data.tract;
    const pm = t?.places_measures;
    const nearest = data.nearest;

    // Health burden: mean of normalized values
    const healthValues: number[] = [];
    if (pm?.diabetes != null) healthValues.push(normalize(pm.diabetes, ranges.diabetes));
    if (pm?.casthma != null) healthValues.push(normalize(pm.casthma, ranges.casthma));
    if (t?.uninsured_rate != null) healthValues.push(normalize(t.uninsured_rate, ranges.uninsuredRate));
    if (pm?.checkup != null) healthValues.push(normalize(100 - pm.checkup, ranges.pctNoCheckup));
    if (pm?.mhlth != null) healthValues.push(normalize(pm.mhlth, ranges.mhlth));

    const healthBurden = healthValues.length > 0
      ? healthValues.reduce((a, b) => a + b, 0) / healthValues.length
      : 0;

    // Social vulnerability: already 0-1
    const socialVulnerability = t?.svi_themes?.rpl_themes ?? 0;

    // Coverage gap: linear map of distance
    const distMiles = nearest.distanceMiles;
    const coverageGap = Math.max(0, Math.min(1, (distMiles - 2) / (15 - 2)));

    // Population density: sqrt(pop / maxPop)
    const pop = t?.total_population ?? 0;
    const populationDensity = Math.sqrt(pop / maxPop);

    // Composite
    const baseScore = Math.round(
      (0.35 * healthBurden +
        0.25 * socialVulnerability +
        0.25 * coverageGap +
        0.15 * populationDensity) * 100,
    );

    hexScores.push({
      h3Index: cell.h3Index,
      baseScore,
      centroid: cell.centroid,
      components: {
        healthBurden: Math.round(healthBurden * 1000) / 1000,
        socialVulnerability: Math.round(socialVulnerability * 1000) / 1000,
        coverageGap: Math.round(coverageGap * 1000) / 1000,
        populationDensity: Math.round(populationDensity * 1000) / 1000,
      },
      tractGeoid: t?.geoid ?? '',
      population: pop,
      nearestExpressCare: nearest,
    });
  }

  writeFileSync(OUT, JSON.stringify(hexScores));
  console.log(`\n[base-scores] Done: ${hexScores.length} hex scores written to ${OUT}`);

  // Clean up partial file
  if (existsSync(PARTIAL)) {
    const { unlinkSync } = await import('node:fs');
    unlinkSync(PARTIAL);
  }
}

main().catch((err) => {
  console.error('[base-scores] Fatal:', err);
  process.exit(1);
});
