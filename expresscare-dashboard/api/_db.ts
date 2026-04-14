import pg from 'pg';

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
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
