import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPool } from '../_db.js';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const db = getPool();
    const result = await db.query(`
      SELECT COUNT(*) as total_snapshots, COUNT(DISTINCT hospital_code) as hospital_count,
             MIN(timestamp) as earliest, MAX(timestamp) as latest
      FROM hospital_snapshots
    `);
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    return res.status(200).json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}
