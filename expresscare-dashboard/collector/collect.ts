import 'dotenv/config';
import { resolve } from 'node:path';
import { openDb, insertSnapshot, insertLog, saveDb, queryScalar } from './db';
import type { EdasHospitalStatusEnvelope, EdasFacility } from '../src/types/edas';

const BASE_URL = process.env.EDAS_BASE_URL || 'https://edas.miemss.org/edas-services/api';
const POLL_MS = Number(process.env.POLL_INTERVAL_MS || 300_000);
const USER_AGENT = process.env.COLLECTOR_USER_AGENT || 'expresscare-dashboard-collector/0.1 (+contact)';
const DB_PATH = resolve(import.meta.dirname, 'data', 'edas-history.db');
const ONCE = process.argv.includes('--once');

async function fetchWithRetry<T>(url: string): Promise<T> {
  const maxAttempts = 3;
  const baseDelay = 500;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const start = Date.now();
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      const latency = Date.now() - start;
      console.log(`[collector] ${res.status} ${url} (${latency}ms, attempt ${attempt})`);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      return (await res.json()) as T;
    } catch (err) {
      const latency = Date.now() - start;
      console.warn(`[collector] FAIL ${url} (${latency}ms, attempt ${attempt}): ${err}`);
      if (attempt === maxAttempts) throw err;
      const jitter = Math.random() * 200;
      await new Promise((r) => setTimeout(r, baseDelay * Math.pow(2, attempt - 1) + jitter));
    }
  }
  throw new Error('unreachable');
}

async function pollOnce(): Promise<void> {
  const handle = await openDb(DB_PATH);
  const now = new Date().toISOString();

  try {
    const [statusEnvelope] = await Promise.all([
      fetchWithRetry<EdasHospitalStatusEnvelope>(`${BASE_URL}/cachedhospitalstatus`),
      fetchWithRetry<EdasFacility[]>(`${BASE_URL}/cachedfacilities`),
      fetchWithRetry<unknown>(`${BASE_URL}/cachedjurisdictions`),
    ]);

    const hospitals = statusEnvelope.results;
    for (const h of hospitals) {
      const alerts = h.alerts;
      insertSnapshot(handle, {
        timestamp: now,
        hospital_code: h.destinationCode,
        hospital_name: h.destinationName,
        lat: h.lat,
        lon: h.lon,
        ed_census_score: alerts?.edCensusIndicatorScore ?? null,
        num_units: h.numOfUnits,
        num_units_enroute: h.numOfUnitsEnroute,
        min_stay_minutes: h.minStay,
        max_stay_minutes: h.maxStay,
        alert_yellow: alerts?.yellow ? 1 : 0,
        alert_red: alerts?.red ? 1 : 0,
        alert_reroute: alerts?.reroute ? 1 : 0,
        alert_code_black: alerts?.codeBlack ? 1 : 0,
        alert_trauma_bypass: alerts?.traumaBypass ? 1 : 0,
      });
    }

    insertLog(handle, {
      timestamp: now,
      hospitals_collected: hospitals.length,
      success: 1,
      error_message: null,
    });

    saveDb(handle);

    const snapCount = queryScalar(handle, 'SELECT count(*) FROM hospital_snapshots');
    const logCount = queryScalar(handle, 'SELECT count(*) FROM collection_log');
    console.log(`[collector] OK: ${hospitals.length} hospitals inserted. Total snapshots=${snapCount}, logs=${logCount}`);
  } catch (err) {
    insertLog(handle, {
      timestamp: now,
      hospitals_collected: 0,
      success: 0,
      error_message: (err as Error).message,
    });
    saveDb(handle);
    console.error(`[collector] Collection failed: ${(err as Error).message}`);
  } finally {
    handle.db.close();
  }
}

async function main(): Promise<void> {
  console.log(`[collector] DB: ${DB_PATH}`);
  console.log(`[collector] Mode: ${ONCE ? 'single-shot' : `continuous (${POLL_MS}ms interval)`}`);

  await pollOnce();

  if (!ONCE) {
    setInterval(() => {
      pollOnce().catch((err) => console.error('[collector] Unhandled:', err));
    }, POLL_MS);
  }
}

main().catch((err) => {
  console.error('[collector] Fatal:', err);
  process.exit(1);
});
