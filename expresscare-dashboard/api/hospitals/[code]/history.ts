import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPool } from '../../_db.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const code = req.query.code as string;
    const hours = Math.min(Math.max(parseInt((req.query.hours as string) || '24', 10), 1), 168);

    const db = getPool();
    const result = await db.query(
      `
      SELECT date_trunc('hour', timestamp::timestamptz) as hour,
        AVG(ed_census_score) as avg_census, MAX(ed_census_score) as max_census,
        AVG(num_units) as avg_units, MAX(num_units) as max_units,
        AVG(max_stay_minutes) as avg_max_stay, COUNT(*) as samples
      FROM hospital_snapshots
      WHERE hospital_code = $1 AND timestamp::timestamptz > NOW() - INTERVAL '1 hour' * $2
      GROUP BY date_trunc('hour', timestamp::timestamptz)
      ORDER BY hour
      `,
      [code, hours],
    );

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    return res.status(200).json(result.rows);
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}
