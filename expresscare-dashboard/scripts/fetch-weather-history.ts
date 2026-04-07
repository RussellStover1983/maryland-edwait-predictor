import 'dotenv/config';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve(import.meta.dirname, 'data', 'weather-history.json');

async function fetchWithRetry<T>(url: string): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const start = Date.now();
    try {
      const res = await fetch(url);
      console.log(`[weather] ${res.status} (${Date.now() - start}ms, attempt ${attempt})`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt - 1) + Math.random() * 200));
    }
  }
  throw new Error('unreachable');
}

async function main(): Promise<void> {
  mkdirSync(resolve(import.meta.dirname, 'data'), { recursive: true });

  if (existsSync(OUT) && !process.argv.includes('--force')) {
    console.log(`[weather] Output exists, skipping (use --force to overwrite)`);
    return;
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const endDate = yesterday.toISOString().slice(0, 10);
  const startDate = '2024-01-01';

  console.log(`[weather] Fetching hourly weather data from ${startDate} to ${endDate}...`);

  // Open-Meteo archive API — hourly granularity
  const hourlyUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=39.29&longitude=-76.61&start_date=${startDate}&end_date=${endDate}&hourly=temperature_2m,precipitation,relative_humidity_2m,wind_speed_10m&timezone=America/New_York`;

  console.log(`[weather] Fetching daily aggregates...`);
  const dailyUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=39.29&longitude=-76.61&start_date=${startDate}&end_date=${endDate}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,relative_humidity_2m_mean,wind_speed_10m_max&timezone=America/New_York`;

  const [hourlyData, dailyData] = await Promise.all([
    fetchWithRetry<Record<string, unknown>>(hourlyUrl),
    fetchWithRetry<Record<string, unknown>>(dailyUrl),
  ]);

  const result = {
    hourly: (hourlyData as { hourly: unknown }).hourly,
    daily: (dailyData as { daily: unknown }).daily,
  };

  writeFileSync(OUT, JSON.stringify(result));
  console.log(`[weather] Done: written to ${OUT}`);
}

main().catch((err) => {
  console.error('[weather] Fatal:', err);
  process.exit(1);
});
