import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import pg from 'pg';

// ── Schema ──────────────────────────────────────────────────────────

const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS hospital_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  hospital_code TEXT NOT NULL,
  hospital_name TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  hospitals_collected INTEGER NOT NULL,
  success INTEGER NOT NULL DEFAULT 1,
  error_message TEXT
);
`;

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

// ── Shared types ────────────────────────────────────────────────────

export interface SnapshotRow {
  timestamp: string;
  hospital_code: string;
  hospital_name: string;
  lat: number;
  lon: number;
  ed_census_score: number | null;
  num_units: number;
  num_units_enroute: number;
  min_stay_minutes: number | null;
  max_stay_minutes: number | null;
  alert_yellow: number;
  alert_red: number;
  alert_reroute: number;
  alert_code_black: number;
  alert_trauma_bypass: number;
}

export interface LogRow {
  timestamp: string;
  hospitals_collected: number;
  success: number;
  error_message: string | null;
}

export interface DbHandle {
  backend: 'postgres' | 'sqlite';
  _pg?: pg.Pool;
  _sqlite?: SqlJsDatabase;
  _sqlitePath?: string;
}

const DEFAULT_SQLITE_PATH = 'collector/data/edas-history.db';

// ── Postgres backend ────────────────────────────────────────────────

async function openPostgres(dbUrl: string): Promise<DbHandle> {
  const pool = new pg.Pool({ connectionString: dbUrl, max: 2 });
  await pool.query(PG_SCHEMA);
  return { backend: 'postgres', _pg: pool };
}

// ── SQLite backend ──────────────────────────────────────────────────

async function openSqlite(dbPath: string): Promise<DbHandle> {
  mkdirSync(dirname(dbPath), { recursive: true });
  const SQL = await initSqlJs();
  let db: SqlJsDatabase;
  if (existsSync(dbPath)) {
    const buf = readFileSync(dbPath);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }
  db.run(SQLITE_SCHEMA);
  return { backend: 'sqlite', _sqlite: db, _sqlitePath: dbPath };
}

// ── Public API ──────────────────────────────────────────────────────

export async function openDb(sqlitePath?: string): Promise<DbHandle> {
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    return openPostgres(dbUrl);
  }
  return openSqlite(sqlitePath ?? DEFAULT_SQLITE_PATH);
}

export async function insertSnapshot(handle: DbHandle, row: SnapshotRow): Promise<void> {
  if (handle.backend === 'postgres') {
    await handle._pg!.query(
      `INSERT INTO hospital_snapshots (
        timestamp, hospital_code, hospital_name, lat, lon,
        ed_census_score, num_units, num_units_enroute,
        min_stay_minutes, max_stay_minutes,
        alert_yellow, alert_red, alert_reroute, alert_code_black, alert_trauma_bypass
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        row.timestamp, row.hospital_code, row.hospital_name, row.lat, row.lon,
        row.ed_census_score, row.num_units, row.num_units_enroute,
        row.min_stay_minutes, row.max_stay_minutes,
        row.alert_yellow, row.alert_red, row.alert_reroute, row.alert_code_black, row.alert_trauma_bypass,
      ],
    );
  } else {
    handle._sqlite!.run(
      `INSERT INTO hospital_snapshots (
        timestamp, hospital_code, hospital_name, lat, lon,
        ed_census_score, num_units, num_units_enroute,
        min_stay_minutes, max_stay_minutes,
        alert_yellow, alert_red, alert_reroute, alert_code_black, alert_trauma_bypass
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.timestamp, row.hospital_code, row.hospital_name, row.lat, row.lon,
        row.ed_census_score, row.num_units, row.num_units_enroute,
        row.min_stay_minutes, row.max_stay_minutes,
        row.alert_yellow, row.alert_red, row.alert_reroute, row.alert_code_black, row.alert_trauma_bypass,
      ],
    );
  }
}

export async function insertLog(handle: DbHandle, entry: LogRow): Promise<void> {
  if (handle.backend === 'postgres') {
    await handle._pg!.query(
      `INSERT INTO collection_log (timestamp, hospitals_collected, success, error_message)
       VALUES ($1, $2, $3, $4)`,
      [entry.timestamp, entry.hospitals_collected, entry.success, entry.error_message],
    );
  } else {
    handle._sqlite!.run(
      `INSERT INTO collection_log (timestamp, hospitals_collected, success, error_message)
       VALUES (?, ?, ?, ?)`,
      [entry.timestamp, entry.hospitals_collected, entry.success, entry.error_message],
    );
  }
}

export async function saveDb(handle: DbHandle): Promise<void> {
  if (handle.backend === 'postgres') {
    // No-op: Postgres auto-commits
    return;
  }
  const data = handle._sqlite!.export();
  writeFileSync(handle._sqlitePath!, Buffer.from(data));
}

export async function queryScalar(handle: DbHandle, sql: string): Promise<number> {
  if (handle.backend === 'postgres') {
    const res = await handle._pg!.query(sql);
    if (res.rows.length === 0) return 0;
    const firstCol = Object.keys(res.rows[0])[0];
    return Number(res.rows[0][firstCol]) || 0;
  }
  const result = handle._sqlite!.exec(sql);
  if (result.length === 0 || result[0].values.length === 0) return 0;
  return result[0].values[0][0] as number;
}

export async function closeDb(handle: DbHandle): Promise<void> {
  if (handle.backend === 'postgres') {
    await handle._pg!.end();
  } else {
    handle._sqlite!.close();
  }
}
