// Weekly ILI rates for HHS Region 3 (DE + DC + MD + PA + VA + WV) from
// Carnegie Mellon's Delphi epidata API, which mirrors CDC FluView with a
// stable, key-less HTTP interface — replacing the flaky CDC endpoints
// that returned 500s during the previous run.
//
// API: https://api.delphi.cmu.edu/epidata/fluview/?regions=hhs3&epiweeks=...
// Docs: https://cmu-delphi.github.io/delphi-epidata/api/fluview.html
//
// Run: npx tsx scripts/fetch-flu-data.ts [--force]

import 'dotenv/config';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve(import.meta.dirname, 'data', 'flu-history.json');
const DELPHI_BASE = 'https://api.delphi.cmu.edu/epidata/fluview/';
const START_EPIWEEK = 202001; // Jan 2020 onward — covers COVID-era weirdness + pre-pandemic seasonality
const USER_AGENT = 'expresscare-dashboard/0.1 (+edas-predictor)';

interface DelphiRow {
  release_date: string;
  region: string;
  issue: number;
  epiweek: number;
  lag: number;
  num_ili: number | null;
  num_patients: number | null;
  num_providers: number | null;
  wili: number | null;
  ili: number | null;
  [key: string]: unknown;
}

interface DelphiResponse {
  result: number;
  message: string;
  epidata: DelphiRow[];
}

interface WeekRecord {
  epiweek: number;
  epiweek_start: string;
  epiweek_end: string;
  wili: number | null;
  ili: number | null;
  num_ili: number | null;
  num_patients: number | null;
  release_date: string;
}

// Convert a YYYYWW epiweek to the ISO Sunday start date of that week.
// CDC epiweeks: week 1 is the first week with ≥4 days in the new year.
// This matches ISO week with the Sunday offset.
function epiweekToDates(epiweek: number): { start: string; end: string } {
  const year = Math.floor(epiweek / 100);
  const week = epiweek % 100;
  // January 4th is always in week 1 (CDC convention matches ISO 8601 close enough for our purposes)
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Dow = jan4.getUTCDay(); // 0=Sun, 6=Sat
  // Sunday of week 1
  const week1Sunday = new Date(jan4);
  week1Sunday.setUTCDate(jan4.getUTCDate() - jan4Dow);
  const weekSunday = new Date(week1Sunday);
  weekSunday.setUTCDate(week1Sunday.getUTCDate() + (week - 1) * 7);
  const weekSaturday = new Date(weekSunday);
  weekSaturday.setUTCDate(weekSunday.getUTCDate() + 6);
  return {
    start: weekSunday.toISOString().slice(0, 10),
    end: weekSaturday.toISOString().slice(0, 10),
  };
}

// Compute the current CDC epiweek from today's date.
function currentEpiweek(): number {
  const now = new Date();
  const year = now.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Dow = jan4.getUTCDay();
  const week1Sunday = new Date(jan4);
  week1Sunday.setUTCDate(jan4.getUTCDate() - jan4Dow);
  const diffDays = Math.floor((now.getTime() - week1Sunday.getTime()) / (24 * 3600 * 1000));
  const week = Math.floor(diffDays / 7) + 1;
  if (week < 1) return (year - 1) * 100 + 52;
  if (week > 53) return (year + 1) * 100 + 1;
  return year * 100 + week;
}

async function fetchWithRetry(url: string, attempts = 3): Promise<DelphiResponse> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as DelphiResponse;
      if (data.result !== 1) {
        throw new Error(`Delphi returned result=${data.result} message=${data.message}`);
      }
      return data;
    } catch (err) {
      lastErr = err;
      console.warn(`[flu] attempt ${i}/${attempts} failed: ${(err as Error).message}`);
      if (i < attempts) await new Promise((r) => setTimeout(r, 500 * 2 ** (i - 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('unknown error');
}

async function main(): Promise<void> {
  mkdirSync(resolve(import.meta.dirname, 'data'), { recursive: true });

  if (existsSync(OUT) && !process.argv.includes('--force')) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const existing = JSON.parse(
        require('node:fs').readFileSync(OUT, 'utf8'),
      );
      if (existing.source === 'delphi-epidata-fluview' && Array.isArray(existing.weeks) && existing.weeks.length > 0) {
        console.log(`[flu] ${OUT} already populated with ${existing.weeks.length} weeks, skipping. Use --force to refresh.`);
        return;
      }
    } catch {
      /* fallthrough and refetch */
    }
  }

  const endEpiweek = currentEpiweek();
  const url = `${DELPHI_BASE}?regions=hhs3&epiweeks=${START_EPIWEEK}-${endEpiweek}`;
  console.log(`[flu] GET ${url}`);

  let data: DelphiResponse;
  try {
    data = await fetchWithRetry(url);
  } catch (err) {
    console.error(`[flu] Delphi epidata failed after retries: ${(err as Error).message}`);
    console.warn('[flu] Writing stub file.');
    writeFileSync(
      OUT,
      JSON.stringify(
        {
          source: 'unavailable',
          fallback_hint:
            'Delphi epidata API unreachable. Try https://api.delphi.cmu.edu/epidata/fluview/?regions=hhs3&epiweeks=202001-202615 directly, or download CSV from https://gis.cdc.gov/grasp/fluview/fluportaldashboard.html',
          weeks: [],
        },
        null,
        2,
      ),
    );
    return;
  }

  const weeks: WeekRecord[] = data.epidata.map((row) => {
    const { start, end } = epiweekToDates(row.epiweek);
    return {
      epiweek: row.epiweek,
      epiweek_start: start,
      epiweek_end: end,
      wili: row.wili,
      ili: row.ili,
      num_ili: row.num_ili,
      num_patients: row.num_patients,
      release_date: row.release_date,
    };
  });

  weeks.sort((a, b) => a.epiweek - b.epiweek);

  const latest = weeks[weeks.length - 1];
  const output = {
    source: 'delphi-epidata-fluview' as const,
    region: 'hhs3' as const,
    fetched_at: new Date().toISOString(),
    coverage: {
      first_epiweek: weeks[0]?.epiweek ?? null,
      last_epiweek: latest?.epiweek ?? null,
      week_count: weeks.length,
    },
    weeks,
  };

  writeFileSync(OUT, JSON.stringify(output, null, 2));
  console.log(
    `[flu] fetched ${weeks.length} weeks (${weeks[0]?.epiweek} → ${latest?.epiweek}), latest wILI=${latest?.wili?.toFixed(2) ?? 'null'}%`,
  );
  console.log(`[flu] wrote ${OUT}`);
}

main().catch((err) => {
  console.error('[flu] Fatal:', err);
  process.exit(1);
});
