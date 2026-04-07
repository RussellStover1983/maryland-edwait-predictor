// One-shot row counter for verification
import fs from 'node:fs';
import initSqlJs from 'sql.js';

const DB = 'collector/data/edas-history.db';
const SQL = await initSqlJs();
const db = new SQL.Database(fs.readFileSync(DB));
const snap = db.exec('SELECT COUNT(*) FROM hospital_snapshots')[0].values[0][0];
const log = db.exec('SELECT COUNT(*) FROM collection_log')[0].values[0][0];
console.log(`snapshots=${snap} logs=${log}`);
