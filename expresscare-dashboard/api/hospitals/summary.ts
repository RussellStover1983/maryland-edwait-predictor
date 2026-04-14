import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPool } from '../_db.js';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const db = getPool();
    const result = await db.query(`
      SELECT hospital_code, hospital_name,
        COUNT(*) as snapshot_count,
        AVG(ed_census_score) as avg_census,
        MAX(ed_census_score) as max_census,
        AVG(num_units) as avg_units,
        AVG(CASE WHEN max_stay_minutes > 0 THEN max_stay_minutes END) as avg_max_stay,
        SUM(
          COALESCE(alert_yellow::int,0) + COALESCE(alert_red::int,0) +
          COALESCE(alert_reroute::int,0) + COALESCE(alert_code_black::int,0) +
          COALESCE(alert_trauma_bypass::int,0)
        ) as total_alert_snapshots,
        MIN(timestamp) as earliest, MAX(timestamp) as latest
      FROM hospital_snapshots
      WHERE timestamp::timestamptz > NOW() - INTERVAL '7 days'
      GROUP BY hospital_code, hospital_name
      ORDER BY hospital_name
    `);
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    return res.status(200).json(result.rows);
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}
