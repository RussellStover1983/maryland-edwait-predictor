import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPool } from '../_db.js';

/**
 * GET /api/model/realized_accuracy
 *
 * Returns rolling MAE for resolved predictions in the last 7 and 30 days,
 * grouped by horizon. Optionally filterable by ?hospital_code=XXX.
 */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const hospitalCode = typeof req.query.hospital_code === 'string'
    ? req.query.hospital_code
    : null;

  try {
    const db = getPool();

    const params: (string | null)[] = [hospitalCode];
    const hospitalFilter = hospitalCode ? 'AND hospital_code = $1' : '';

    const overall = await db.query(
      `WITH resolved AS (
         SELECT horizon_hours, predicted_at, ABS(residual) AS abs_residual
         FROM prediction_log
         WHERE actual_score IS NOT NULL ${hospitalFilter}
       )
       SELECT
         horizon_hours,
         COUNT(*) FILTER (WHERE predicted_at >= NOW() - INTERVAL '7 days')  AS n_7d,
         AVG(abs_residual) FILTER (WHERE predicted_at >= NOW() - INTERVAL '7 days')  AS mae_7d,
         COUNT(*) FILTER (WHERE predicted_at >= NOW() - INTERVAL '30 days') AS n_30d,
         AVG(abs_residual) FILTER (WHERE predicted_at >= NOW() - INTERVAL '30 days') AS mae_30d
       FROM resolved
       GROUP BY horizon_hours
       ORDER BY horizon_hours`,
      params,
    );

    const byHospital = hospitalCode
      ? null
      : await db.query(
          `SELECT
             hospital_code,
             horizon_hours,
             COUNT(*) FILTER (WHERE predicted_at >= NOW() - INTERVAL '7 days')  AS n_7d,
             AVG(ABS(residual)) FILTER (WHERE predicted_at >= NOW() - INTERVAL '7 days')  AS mae_7d,
             COUNT(*) FILTER (WHERE predicted_at >= NOW() - INTERVAL '30 days') AS n_30d,
             AVG(ABS(residual)) FILTER (WHERE predicted_at >= NOW() - INTERVAL '30 days') AS mae_30d
           FROM prediction_log
           WHERE actual_score IS NOT NULL
           GROUP BY hospital_code, horizon_hours
           HAVING COUNT(*) FILTER (WHERE predicted_at >= NOW() - INTERVAL '30 days') > 0
           ORDER BY hospital_code, horizon_hours`,
        );

    const counts = await db.query(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE actual_score IS NULL) AS unresolved,
         MIN(predicted_at) AS first_predicted_at,
         MAX(predicted_at) AS last_predicted_at,
         MAX(model_trained_at) AS latest_model_trained_at
       FROM prediction_log
       ${hospitalCode ? 'WHERE hospital_code = $1' : ''}`,
      hospitalCode ? [hospitalCode] : [],
    );

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({
      filter: { hospital_code: hospitalCode },
      summary: counts.rows[0],
      overall: overall.rows,
      by_hospital: byHospital ? byHospital.rows : undefined,
    });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}
