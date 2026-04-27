import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPool } from '../_db.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const rawLimit = Number(req.query.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
    : DEFAULT_LIMIT;

  try {
    const db = getPool();
    const result = await db.query(
      `SELECT id, trained_at, trigger, train_rows, test_rows, feature_count,
              mae_1h, rmse_1h, best_iter_1h,
              mae_4h, rmse_4h, best_iter_4h,
              train_date_min, train_date_max, test_date_min, test_date_max,
              hospital_count, duration_seconds, notes
       FROM training_history
       ORDER BY trained_at DESC
       LIMIT $1`,
      [limit],
    );

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({
      count: result.rows.length,
      limit,
      rows: result.rows,
    });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}
