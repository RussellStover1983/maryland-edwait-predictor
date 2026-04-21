import 'dotenv/config';
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'csv-parse/sync';

const OUT = resolve(import.meta.dirname, 'data', 'cms-hospitals.json');
const CMS_DIR = 'C:/dev/shared/data/cms';

interface CmsHospital {
  providerId: string;
  name: string;
  system: string;
  address: string;
  city: string;
  zip: string;
  county: string;
  lat: number | null;
  lon: number | null;
  op18bMinutes: number | null;
  isTraumaCenter: boolean;
  ownership: string;
  edasCode: string | null;
}

function classifySystem(name: string): string {
  if (/sinai|northwest|carroll|grace medical/i.test(name)) return 'LifeBridge';
  if (/hopkins|bayview|howard county general|suburban|sibley/i.test(name)) return 'Johns Hopkins';
  if (/university of maryland|umm|\bst\.?\s*joseph\b|upper chesapeake|harford|charles regional/i.test(name)) return 'UMMS';
  if (/medstar|harbor|franklin square|good samaritan|union memorial|\bst\.?\s*mary\b/i.test(name)) return 'MedStar';
  return 'Other';
}

async function fetchWithRetry<T>(url: string): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const start = Date.now();
    try {
      const res = await fetch(url);
      console.log(`[cms] ${res.status} ${url} (${Date.now() - start}ms, attempt ${attempt})`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt - 1) + Math.random() * 200));
    }
  }
  throw new Error('unreachable');
}

interface CmsApiResponse {
  results: Array<Record<string, string>>;
}

async function main(): Promise<void> {
  mkdirSync(resolve(import.meta.dirname, 'data'), { recursive: true });

  if (existsSync(OUT) && !process.argv.includes('--force')) {
    console.log(`[cms] Output exists, skipping (use --force to overwrite)`);
    return;
  }

  // Check local CMS files
  console.log(`[cms] Checking local CMS data at ${CMS_DIR}...`);
  const localFiles = existsSync(CMS_DIR) ? readdirSync(CMS_DIR) : [];
  console.log(`[cms] Found local files: ${localFiles.join(', ')}`);

  // Try to find hospital general info from local POS file
  let hospitalRows: Array<Record<string, string>> = [];
  let op18bRows: Array<Record<string, string>> = [];

  const posFile = localFiles.find(f => f.startsWith('pos_hospital'));
  if (posFile) {
    console.log(`[cms] Loading hospital data from local file: ${posFile}`);
    const raw = readFileSync(resolve(CMS_DIR, posFile), 'utf-8');
    const allRows = parse(raw, { columns: true, skip_empty_lines: true, relax_column_count: true }) as Array<Record<string, string>>;
    // POS file uses different column names — look for state column
    const stateCol = Object.keys(allRows[0] || {}).find(k =>
      /^state$/i.test(k.trim()) || /^prvdr_state_cd$/i.test(k.trim()) || /^state_cd$/i.test(k.trim())
    );
    if (stateCol) {
      hospitalRows = allRows.filter(r => r[stateCol]?.trim().toUpperCase() === 'MD');
      console.log(`[cms] Found ${hospitalRows.length} MD hospitals in local POS file (state col: "${stateCol}")`);
    }
  }

  // If local data insufficient, fall back to CMS API
  if (hospitalRows.length === 0) {
    console.warn(`[cms] shared/data/cms/ missing or empty — falling back to live CMS API. Data provenance: live fetch, not cached.`);
    console.log(`[cms] Local hospital data insufficient, fetching from CMS API...`);
    const data = await fetchWithRetry<CmsApiResponse>(
      'https://data.cms.gov/provider-data/api/1/datastore/query/xubh-q36u/0?conditions[0][property]=state&conditions[0][value]=MD&limit=500'
    );
    hospitalRows = data.results || [];
    console.log(`[cms] Got ${hospitalRows.length} hospitals from CMS API`);
  }

  // Fetch OP-18B data from CMS API (not available locally as structured data)
  console.log(`[cms] Fetching OP-18B measures from CMS API...`);
  try {
    const op18bData = await fetchWithRetry<CmsApiResponse>(
      'https://data.cms.gov/provider-data/api/1/datastore/query/yv7e-xc69/0?conditions[0][property]=state&conditions[0][value]=MD&limit=2000'
    );
    op18bRows = (op18bData.results || []).filter((r: Record<string, string>) =>
      r.measure_id === 'OP_18B' || r.measure_id === 'OP_18b'
    );
    console.log(`[cms] Got ${op18bRows.length} OP-18B measures`);
  } catch (err) {
    console.warn(`[cms] Could not fetch OP-18B data: ${err}`);
  }

  // Build OP-18B lookup by provider_id
  const op18bMap = new Map<string, number>();
  for (const row of op18bRows) {
    const id = row.facility_id || row.provider_id || '';
    const score = parseFloat(row.score || '');
    if (id && !isNaN(score)) {
      op18bMap.set(id, score);
    }
  }

  // Map hospital rows to our schema
  const hospitals: CmsHospital[] = [];

  for (const r of hospitalRows) {
    // Handle different column name conventions
    // CMS POS file uses uppercase abbreviated names like PRVDR_NUM, FAC_NAME, etc.
    const providerId = r.PRVDR_NUM || r.facility_id || r.provider_id || '';
    const name = r.FAC_NAME || r.facility_name || r.hospital_name || '';
    const address = r.ST_ADR || r.address || r.address_line_1 || '';
    const city = r.CITY_NAME || r.city || r.city_town || '';
    const zip = r.ZIP_CD || r.zip_code || r.zip || '';
    const county = r.SSA_CNTY_CD || r.county_name || r.county || '';
    const ownership = r.GNRL_CNTL_TYPE_CD || r.hospital_ownership || r.ownership || '';
    if (!providerId || !name) continue;

    hospitals.push({
      providerId,
      name,
      system: classifySystem(name),
      address,
      city,
      zip,
      county,
      lat: null,
      lon: null,
      op18bMinutes: op18bMap.get(providerId) ?? null,
      isTraumaCenter: false, // CMS doesn't flag this directly
      ownership,
      edasCode: null, // Backfilled below
    });
  }

  // Try to backfill edasCode by name matching against EDAS facilities
  try {
    const res = await fetch('https://edas.miemss.org/edas-services/api/cachedfacilities', {
      headers: { 'User-Agent': 'expresscare-dashboard/0.1' },
    });
    if (res.ok) {
      const facilities = await res.json() as Array<{ facilityName: string; facilityCode: string }>;
      for (const hosp of hospitals) {
        const match = facilities.find(f => {
          const fName = f.facilityName.toLowerCase();
          const hName = hosp.name.toLowerCase();
          // Match if one name contains the other or significant overlap
          return fName.includes(hName.split(' ')[0]) && hName.includes(fName.split(' ')[0]);
        });
        if (match) hosp.edasCode = match.facilityCode;
      }
    }
  } catch {
    console.warn(`[cms] Could not fetch EDAS facilities for code matching`);
  }

  writeFileSync(OUT, JSON.stringify(hospitals, null, 2));
  console.log(`\n[cms] Done: ${hospitals.length} hospitals written to ${OUT}`);
}

main().catch((err) => {
  console.error('[cms] Fatal:', err);
  process.exit(1);
});
