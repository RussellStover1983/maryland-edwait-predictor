import type {
  EdasFacility,
  EdasHospitalStatusEnvelope,
  EdasJurisdiction,
} from '../types/edas';

const BASE_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_EDAS_BASE_URL) ||
  'https://edas.miemss.org/edas-services/api';

const USER_AGENT = 'expresscare-dashboard/0.1 (+contact)';

async function fetchWithRetry<T>(url: string, signal?: AbortSignal): Promise<T> {
  const maxAttempts = 3;
  const baseDelay = 500;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const start = Date.now();
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal,
      });
      const latency = Date.now() - start;
      console.log(`[edas] ${res.status} ${url} (${latency}ms, attempt ${attempt})`);

      if (!res.ok) {
        throw new Error(`EDAS ${res.status}: ${res.statusText}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      const latency = Date.now() - start;
      console.warn(`[edas] FAIL ${url} (${latency}ms, attempt ${attempt}): ${err}`);
      if (attempt === maxAttempts) throw err;
      const jitter = Math.random() * 200;
      const delay = baseDelay * Math.pow(2, attempt - 1) + jitter;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('unreachable');
}

export async function fetchFacilities(signal?: AbortSignal): Promise<EdasFacility[]> {
  return fetchWithRetry<EdasFacility[]>(`${BASE_URL}/cachedfacilities`, signal);
}

export async function fetchHospitalStatus(
  signal?: AbortSignal,
): Promise<EdasHospitalStatusEnvelope> {
  return fetchWithRetry<EdasHospitalStatusEnvelope>(
    `${BASE_URL}/cachedhospitalstatus`,
    signal,
  );
}

export async function fetchJurisdictions(signal?: AbortSignal): Promise<EdasJurisdiction[]> {
  return fetchWithRetry<EdasJurisdiction[]>(`${BASE_URL}/cachedjurisdictions`, signal);
}
