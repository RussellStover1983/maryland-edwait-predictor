import pg from 'pg';
import type { ViteDevServer } from 'vite';
import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '..', '.env') });

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!pool) {
    const connStr = (process.env.DATABASE_URL || '').replace(/\?sslmode=require$/, '');
    pool = new pg.Pool({
      connectionString: connStr,
      max: 3,
      idleTimeoutMillis: 30000,
      ssl: false,
    });
  }
  return pool;
}

function json(res: import('http').ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function error(res: import('http').ServerResponse, msg: string, status = 500) {
  json(res, { error: msg }, status);
}

export function setupApiMiddleware(server: ViteDevServer) {
  server.middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith('/api/hospitals') && !req.url?.startsWith('/api/model')) return next();

    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    try {
      const db = getPool();

      // GET /api/hospitals/stats
      if (pathname === '/api/hospitals/stats') {
        const result = await db.query(`
          SELECT
            COUNT(*) as total_snapshots,
            COUNT(DISTINCT hospital_code) as hospital_count,
            MIN(timestamp) as earliest,
            MAX(timestamp) as latest
          FROM hospital_snapshots
        `);
        return json(res, result.rows[0]);
      }

      // GET /api/hospitals/summary
      if (pathname === '/api/hospitals/summary') {
        const result = await db.query(`
          SELECT
            hospital_code,
            hospital_name,
            COUNT(*) as snapshot_count,
            AVG(ed_census_score) as avg_census,
            MAX(ed_census_score) as max_census,
            AVG(num_units) as avg_units,
            AVG(CASE WHEN max_stay_minutes > 0 THEN max_stay_minutes END) as avg_max_stay,
            SUM(
              CASE WHEN alert_yellow THEN 1 ELSE 0 END +
              CASE WHEN alert_red THEN 1 ELSE 0 END +
              CASE WHEN alert_reroute THEN 1 ELSE 0 END +
              CASE WHEN alert_code_black THEN 1 ELSE 0 END +
              CASE WHEN alert_trauma_bypass THEN 1 ELSE 0 END
            ) as total_alert_snapshots,
            MIN(timestamp) as earliest,
            MAX(timestamp) as latest
          FROM hospital_snapshots
          WHERE timestamp::timestamptz > NOW() - INTERVAL '7 days'
          GROUP BY hospital_code, hospital_name
          ORDER BY hospital_name
        `);
        return json(res, result.rows);
      }

      // GET /api/hospitals/:code/history?hours=24
      const historyMatch = pathname.match(/^\/api\/hospitals\/([^/]+)\/history$/);
      if (historyMatch) {
        const code = decodeURIComponent(historyMatch[1]);
        const hours = parseInt(url.searchParams.get('hours') || '24', 10);
        const clampedHours = Math.min(Math.max(hours, 1), 168); // 1h to 7d

        const result = await db.query(
          `
          SELECT
            date_trunc('hour', timestamp::timestamptz) as hour,
            AVG(ed_census_score) as avg_census,
            MAX(ed_census_score) as max_census,
            AVG(num_units) as avg_units,
            MAX(num_units) as max_units,
            AVG(max_stay_minutes) as avg_max_stay,
            COUNT(*) as samples
          FROM hospital_snapshots
          WHERE hospital_code = $1
            AND timestamp::timestamptz > NOW() - INTERVAL '1 hour' * $2
          GROUP BY date_trunc('hour', timestamp::timestamptz)
          ORDER BY hour
          `,
          [code, clampedHours],
        );
        return json(res, result.rows);
      }

      // GET /api/model/:key — serve model artifact from Postgres
      const modelMatch = pathname.match(/^\/api\/model\/([^/]+)$/);
      if (modelMatch) {
        const key = decodeURIComponent(modelMatch[1]);
        const db = getPool();
        const result = await db.query(
          'SELECT artifact_json, created_at FROM model_artifacts WHERE artifact_key = $1',
          [key],
        );
        if (result.rows.length === 0) return error(res, 'Artifact not found', 404);
        res.setHeader('X-Artifact-Date', result.rows[0].created_at);
        return json(res, result.rows[0].artifact_json);
      }

      return next();
    } catch (err) {
      console.error('[api] Error:', err);
      return error(res, (err as Error).message);
    }
  });
}
