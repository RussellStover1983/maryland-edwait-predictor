import 'dotenv/config';
import initSqlJs from 'sql.js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

const SQLITE_PATH = resolve(import.meta.dirname, 'data', 'edas-history.db');

const PG_SCHEMA = `
CREATE TABLE IF NOT EXISTS hospital_snapshots (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL,
  hospital_code TEXT NOT NULL,
  hospital_name TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  ed_census_score INTEGER,
  num_units INTEGER NOT NULL,
  num_units_enroute INTEGER NOT NULL,
  min_stay_minutes INTEGER,
  max_stay_minutes INTEGER,
  alert_yellow INTEGER NOT NULL DEFAULT 0,
  alert_red INTEGER NOT NULL DEFAULT 0,
  alert_reroute INTEGER NOT NULL DEFAULT 0,
  alert_code_black INTEGER NOT NULL DEFAULT 0,
  alert_trauma_bypass INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_snapshots_hospital_time
  ON hospital_snapshots(hospital_code, timestamp);

CREATE TABLE IF NOT EXISTS collection_log (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL,
  hospitals_collected INTEGER NOT NULL,
  success INTEGER NOT NULL DEFAULT 1,
  error_message TEXT
);
`;

const CHUNK_SIZE = 500;

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('ERROR: DATABASE_URL is not set. Cannot migrate.');
    process.exit(1);
  }

  if (!existsSync(SQLITE_PATH)) {
    console.error(`ERROR: SQLite DB not found at ${SQLITE_PATH}`);
    process.exit(1);
  }

  // Open SQLite
  const SQL = await initSqlJs();
  const buf = readFileSync(SQLITE_PATH);
  const sqliteDb = new SQL.Database(buf);

  // Connect to Postgres
  const pool = new pg.Pool({ connectionString: dbUrl, max: 2 });

  // Create tables
  await pool.query(PG_SCHEMA);
  console.log('[migrate] Postgres tables created/verified.');

  // Check existing rows
  const forceFlag = process.argv.includes('--force');
  const existingRes = await pool.query('SELECT count(*) AS cnt FROM hospital_snapshots');
  const existingCount = Number(existingRes.rows[0].cnt);
  if (existingCount > 0 && !forceFlag) {
    console.log(`[migrate] Postgres already has ${existingCount} rows. Skipping migration (use --force to overwrite).`);
    sqliteDb.close();
    await pool.end();
    return;
  }

  // Migrate hospital_snapshots
  const snapResult = sqliteDb.exec('SELECT timestamp, hospital_code, hospital_name, lat, lon, ed_census_score, num_units, num_units_enroute, min_stay_minutes, max_stay_minutes, alert_yellow, alert_red, alert_reroute, alert_code_black, alert_trauma_bypass FROM hospital_snapshots');

  let snapCount = 0;
  if (snapResult.length > 0) {
    const rows = snapResult[0].values;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      const placeholders: string[] = [];
      const values: unknown[] = [];
      let paramIdx = 1;

      for (const row of chunk) {
        const ph = [];
        for (let c = 0; c < 15; c++) {
          ph.push(`$${paramIdx++}`);
          values.push(row[c]);
        }
        placeholders.push(`(${ph.join(',')})`);
      }

      await pool.query(
        `INSERT INTO hospital_snapshots (
          timestamp, hospital_code, hospital_name, lat, lon,
          ed_census_score, num_units, num_units_enroute,
          min_stay_minutes, max_stay_minutes,
          alert_yellow, alert_red, alert_reroute, alert_code_black, alert_trauma_bypass
        ) VALUES ${placeholders.join(',')}`,
        values,
      );

      snapCount += chunk.length;
      if (snapCount % 1000 === 0 || i + CHUNK_SIZE >= rows.length) {
        console.log(`[migrate] Snapshots: ${snapCount} / ${rows.length}`);
      }
    }
  }

  // Migrate collection_log
  const logResult = sqliteDb.exec('SELECT timestamp, hospitals_collected, success, error_message FROM collection_log');
  let logCount = 0;
  if (logResult.length > 0) {
    const rows = logResult[0].values;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      const placeholders: string[] = [];
      const values: unknown[] = [];
      let paramIdx = 1;

      for (const row of chunk) {
        const ph = [];
        for (let c = 0; c < 4; c++) {
          ph.push(`$${paramIdx++}`);
          values.push(row[c]);
        }
        placeholders.push(`(${ph.join(',')})`);
      }

      await pool.query(
        `INSERT INTO collection_log (timestamp, hospitals_collected, success, error_message)
         VALUES ${placeholders.join(',')}`,
        values,
      );

      logCount += chunk.length;
    }
  }

  console.log(`[migrate] Migrated ${snapCount} snapshots + ${logCount} logs from SQLite to Postgres.`);

  sqliteDb.close();
  await pool.end();
}

main().catch((err) => {
  console.error('[migrate] Fatal:', err);
  process.exit(1);
});
