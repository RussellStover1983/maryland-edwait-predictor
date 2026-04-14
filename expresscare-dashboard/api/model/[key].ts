import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPool } from '../_db.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const key = req.query.key as string;
  try {
    const db = getPool();
    const result = await db.query(
      'SELECT artifact_json, created_at FROM model_artifacts WHERE artifact_key = $1',
      [key],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Artifact not found' });
    }
    res.setHeader('X-Artifact-Date', String(result.rows[0].created_at));
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
    return res.status(200).json(result.rows[0].artifact_json);
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}
