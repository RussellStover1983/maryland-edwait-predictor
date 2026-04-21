import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPool } from '../_db.js';

const STALE_THRESHOLD_SECONDS = Number(process.env.COLLECTOR_STALE_THRESHOLD_SECONDS || 900);

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const db = getPool();
    const result = await db.query('SELECT MAX(timestamp) as latest FROM hospital_snapshots');
    const latest = result.rows[0]?.latest as string | Date | null;

    if (!latest) {
      return res.status(500).json({ healthy: false, reason: 'no snapshots found' });
    }

    const latestMs = new Date(latest).getTime();
    const ageSeconds = Math.round((Date.now() - latestMs) / 1000);
    const healthy = ageSeconds < STALE_THRESHOLD_SECONDS;

    res.setHeader('Cache-Control', 'no-store');
    return res.status(healthy ? 200 : 500).json({
      healthy,
      latest,
      age_seconds: ageSeconds,
      threshold_seconds: STALE_THRESHOLD_SECONDS,
      reason: healthy ? null : `last snapshot ${ageSeconds}s ago, threshold ${STALE_THRESHOLD_SECONDS}s`,
    });
  } catch (err) {
    return res.status(500).json({ healthy: false, reason: (err as Error).message });
  }
}
