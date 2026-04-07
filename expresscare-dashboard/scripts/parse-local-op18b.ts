// Enrich scripts/data/cms-hospitals.json with OP_18b median ED throughput
// minutes, parsed directly from the local CMS care_compare mirror.
//
// Strategy A per ED_PREDICTOR_PHASE2.md — no network calls, uses the CSV
// at C:\dev\shared\data\cms\care_compare\timely_and_effective_care.csv.
//
// Run: npx tsx scripts/parse-local-op18b.ts

import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';

const CSV_PATH =
  'C:/dev/shared/data/cms/care_compare/timely_and_effective_care.csv';
const HOSPITALS_JSON = path.resolve('scripts/data/cms-hospitals.json');

interface CmsHospital {
  providerId: string;
  name: string;
  system: string;
  op18bMinutes: number | null;
  op18bSource?: 'local-cms' | 'cms-csv' | 'edas-proxy' | null;
  [key: string]: unknown;
}

interface CsvRow {
  'Facility ID': string;
  'Facility Name': string;
  State: string;
  'Measure ID': string;
  Score: string;
  'Start Date': string;
  'End Date': string;
}

function main(): void {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`[op18b] ERROR: CMS CSV not found at ${CSV_PATH}`);
    process.exit(1);
  }
  if (!fs.existsSync(HOSPITALS_JSON)) {
    console.error(`[op18b] ERROR: ${HOSPITALS_JSON} not found — run fetch-cms-hospital-data.ts first`);
    process.exit(1);
  }

  console.log(`[op18b] reading ${CSV_PATH}`);
  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  const rows: CsvRow[] = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  });
  console.log(`[op18b] parsed ${rows.length.toLocaleString()} total rows`);

  // Build provider_id -> score map, MD + OP_18b only
  const scoreByProvider = new Map<string, number>();
  let mdOp18bRows = 0;
  let unscoredRows = 0;

  for (const row of rows) {
    if (row.State !== 'MD') continue;
    if (row['Measure ID'] !== 'OP_18b') continue;
    mdOp18bRows++;
    const score = Number(row.Score);
    if (!Number.isFinite(score)) {
      unscoredRows++;
      continue;
    }
    // providerId column is a zero-padded CMS CCN (e.g., "210001")
    scoreByProvider.set(row['Facility ID'], score);
  }

  console.log(
    `[op18b] MD OP_18b rows: ${mdOp18bRows} (${unscoredRows} had no numeric score, ${scoreByProvider.size} usable)`,
  );

  // Enrich cms-hospitals.json
  const hospitals: CmsHospital[] = JSON.parse(fs.readFileSync(HOSPITALS_JSON, 'utf8'));
  let enriched = 0;
  for (const h of hospitals) {
    const score = scoreByProvider.get(h.providerId);
    if (score !== undefined) {
      h.op18bMinutes = score;
      h.op18bSource = 'local-cms';
      enriched++;
    }
  }

  // Sort by op18bMinutes desc for a quick sanity check in the log
  const enrichedRecords = hospitals
    .filter((h) => h.op18bMinutes != null)
    .sort((a, b) => (b.op18bMinutes ?? 0) - (a.op18bMinutes ?? 0));
  console.log(`[op18b] enriched ${enriched}/${hospitals.length} hospitals`);
  console.log('[op18b] slowest 5 MD EDs by OP-18b:');
  for (const h of enrichedRecords.slice(0, 5)) {
    console.log(`  ${h.op18bMinutes!.toString().padStart(4)} min — ${h.name} (${h.providerId})`);
  }
  console.log('[op18b] fastest 5 MD EDs by OP-18b:');
  for (const h of enrichedRecords.slice(-5).reverse()) {
    console.log(`  ${h.op18bMinutes!.toString().padStart(4)} min — ${h.name} (${h.providerId})`);
  }

  fs.writeFileSync(HOSPITALS_JSON, JSON.stringify(hospitals, null, 2));
  console.log(`[op18b] wrote ${HOSPITALS_JSON}`);
}

main();
