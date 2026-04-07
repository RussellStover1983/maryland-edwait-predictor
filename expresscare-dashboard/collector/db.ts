import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
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

export interface DbHandle {
  db: SqlJsDatabase;
  path: string;
}

export async function openDb(dbPath: string): Promise<DbHandle> {
  mkdirSync(dirname(dbPath), { recursive: true });
  const SQL = await initSqlJs();
  let db: SqlJsDatabase;
  if (existsSync(dbPath)) {
    const buf = readFileSync(dbPath);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }
  db.run(SCHEMA);
  return { db, path: dbPath };
}

export function saveDb(handle: DbHandle): void {
  const data = handle.db.export();
  writeFileSync(handle.path, Buffer.from(data));
}

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

export function insertSnapshot(handle: DbHandle, row: SnapshotRow): void {
  handle.db.run(
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

export interface LogRow {
  timestamp: string;
  hospitals_collected: number;
  success: number;
  error_message: string | null;
}

export function insertLog(handle: DbHandle, entry: LogRow): void {
  handle.db.run(
    `INSERT INTO collection_log (timestamp, hospitals_collected, success, error_message)
     VALUES (?, ?, ?, ?)`,
    [entry.timestamp, entry.hospitals_collected, entry.success, entry.error_message],
  );
}

export function queryScalar(handle: DbHandle, sql: string): number {
  const result = handle.db.exec(sql);
  if (result.length === 0 || result[0].values.length === 0) return 0;
  return result[0].values[0][0] as number;
}
