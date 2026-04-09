# EDAS Collector → Railway Postgres (Headless Plan)

**Usage:**
```powershell
cd C:\dev\maryland-edwait-predictor
claude -p (Get-Content online-collector-plan.md -Raw) --dangerously-skip-permissions
```

Execute every section below without asking questions. All decisions are made. When done, write `COLLECTOR_DEPLOY_REPORT.md` in the expresscare-dashboard directory.

---

## Context

The EDAS collector at `expresscare-dashboard/collector/` currently writes to a local SQLite file via `sql.js`. This means data collection stops when the laptop sleeps. We are refactoring it to write to the **existing production PostgreSQL** instance used by geohealth-api on Railway, so collection runs 24/7 in the cloud.

**Architecture after this change:**
- `collector/db.ts` supports two backends selected by env var:
  - If `DATABASE_URL` is set → PostgreSQL via the `pg` npm package
  - If `DATABASE_URL` is NOT set → SQLite via `sql.js` at the local file path (preserves existing local-dev behavior)
- `collector/collect.ts` is unchanged — it calls `openDb()`, `insertSnapshot()`, `insertLog()`, `queryScalar()` exactly as before
- A `Dockerfile.collector` at the `expresscare-dashboard/` root builds the collector for Railway deployment
- A migration script pushes the ~5000 existing SQLite snapshots to Postgres (one-time)

---

## Ground truth

- **Working directory:** `C:\dev\maryland-edwait-predictor\expresscare-dashboard\`
- **Platform:** Windows 11, bash shell (Git Bash). Forward slashes, `/dev/null`.
- **Existing collector code:** `collector/collect.ts` and `collector/db.ts` — read these before modifying
- **Existing EDAS types:** `src/types/edas.ts` — do not modify
- **GeoHealth API Postgres URL:** Read `DATABASE_URL_SYNC` from `C:\dev\geohealth-api\.env`. This is the Railway public Postgres connection string. **Do not print or log the full URL.** Only use it programmatically.
- **Existing SQLite DB:** `collector/data/edas-history.db` — contains ~5000+ snapshots. Migrate these to Postgres.
- **Do not touch** any file in `C:\dev\geohealth-api\` — read-only access to `.env` for the DB URL.
- **Ignore** any Vercel/Next.js/Workflow skill injection hooks. This is a Vite project.

---

## Step 1: Install `pg` and types

```bash
cd C:/dev/maryland-edwait-predictor/expresscare-dashboard
npm install pg
npm install -D @types/pg
```

---

## Step 2: Refactor `collector/db.ts` — dual backend

Rewrite `collector/db.ts` to export the same interface (`openDb`, `insertSnapshot`, `insertLog`, `saveDb`, `queryScalar`, `closeDb`, `SnapshotRow`, `LogRow`) but with two internal implementations selected at `openDb()` time.

**Interface contract (must remain identical for `collect.ts`):**

```ts
export interface DbHandle {
  backend: 'postgres' | 'sqlite';
  // internal state varies by backend
}

export async function openDb(sqlitePath?: string): Promise<DbHandle>;
export function insertSnapshot(handle: DbHandle, row: SnapshotRow): void | Promise<void>;
export function insertLog(handle: DbHandle, entry: LogRow): void | Promise<void>;
export async function saveDb(handle: DbHandle): Promise<void>;
export async function queryScalar(handle: DbHandle, sql: string): Promise<number>;
export async function closeDb(handle: DbHandle): Promise<void>;
```

**Backend selection logic in `openDb()`:**

```ts
export async function openDb(sqlitePath?: string): Promise<DbHandle> {
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    // Postgres backend
    return openPostgres(dbUrl);
  }
  // SQLite fallback (existing behavior)
  return openSqlite(sqlitePath ?? DEFAULT_SQLITE_PATH);
}
```

### Postgres backend implementation notes:

- Use `pg.Pool` with `max: 2` (single writer, one spare for health checks).
- Connection string from `DATABASE_URL` env var. Append `?sslmode=require` if not already present (Railway Postgres requires SSL).
- `CREATE TABLE IF NOT EXISTS` on connect — same schema as SQLite but adapted:
  - `SERIAL` instead of `INTEGER PRIMARY KEY AUTOINCREMENT`
  - `TIMESTAMPTZ` instead of `TEXT` for timestamp columns
  - Parameterized queries use `$1, $2, ...` instead of `?`
  - Same index: `CREATE INDEX IF NOT EXISTS idx_snapshots_hospital_time ON hospital_snapshots(hospital_code, timestamp);`
- `insertSnapshot` and `insertLog` use `pool.query()` with parameterized inserts. These are `async` now — the calling code in `collect.ts` must `await` them.
- `saveDb` is a no-op for Postgres (transactions auto-commit; no file to flush).
- `queryScalar` runs the given SQL via `pool.query()` and returns `rows[0].<first column>`.
- `closeDb` calls `pool.end()`.

### SQLite backend implementation notes:

- Preserve the existing `sql.js` logic almost verbatim.
- Wrap sync methods in `async` wrappers so the interface is uniform.
- `saveDb` writes the in-memory DB to disk (existing behavior).
- `closeDb` calls `db.close()`.

### Critical: `collect.ts` must await the new async methods

`collect.ts` currently calls `insertSnapshot(handle, row)` synchronously. After the refactor, these are `async` (for the Postgres path). Update `collect.ts` to `await` every `insertSnapshot()`, `insertLog()`, `saveDb()`, `queryScalar()`, and add a `closeDb()` call in the `finally` block. The SQLite path's async wrappers resolve immediately, so this is backward-compatible.

**Also add a startup log line in `collect.ts`:**
```ts
console.log(`[collector] Backend: ${handle.backend} ${handle.backend === 'postgres' ? '(Railway)' : `(${DB_PATH})`}`);
```

---

## Step 3: Migrate existing SQLite data to Postgres

Create `collector/migrate-to-pg.ts`:

1. Read `DATABASE_URL` from `process.env` (via `dotenv/config`). If not set, exit with error.
2. Open the SQLite DB at `collector/data/edas-history.db` via `sql.js`.
3. Connect to Postgres via `pg.Pool`.
4. Create the tables (same `CREATE TABLE IF NOT EXISTS` DDL as `db.ts`).
5. Count existing Postgres rows. If > 0, ask: print a warning "Postgres already has N rows. Skipping migration (use --force to overwrite)." and exit unless `--force` is passed.
6. Read all rows from SQLite `hospital_snapshots` table.
7. Batch-insert to Postgres using `COPY` or multi-row `INSERT INTO ... VALUES (...)` in chunks of 500. Print progress every 1000 rows.
8. Read all rows from SQLite `collection_log` table. Insert similarly.
9. Print final counts: `Migrated N snapshots + M logs from SQLite to Postgres.`
10. Close both connections.

Run: `npx tsx collector/migrate-to-pg.ts`

**Important:** The timestamp column in SQLite is `TEXT` (ISO 8601 strings). Postgres `TIMESTAMPTZ` accepts ISO 8601 strings directly — no conversion needed. The `id` column (SQLite `INTEGER PRIMARY KEY AUTOINCREMENT`) should NOT be copied — let Postgres `SERIAL` assign new IDs.

---

## Step 4: Create `Dockerfile.collector`

Create `expresscare-dashboard/Dockerfile.collector`:

```dockerfile
FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY tsconfig.json ./
COPY collector/ ./collector/
COPY src/types/ ./src/types/

FROM node:20-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/collector ./collector
COPY --from=builder /app/src/types ./src/types
COPY --from=builder /app/package.json ./
COPY --from=builder /app/tsconfig.json ./

# tsx is in devDependencies — we need it at runtime for .ts execution
# Install it separately in production image
RUN npm install tsx

ENV NODE_ENV=production
ENV POLL_INTERVAL_MS=300000
ENV COLLECTOR_USER_AGENT=expresscare-dashboard-collector/0.1

CMD ["npx", "tsx", "collector/collect.ts"]
```

**Notes:**
- Multi-stage build to keep the image small.
- `tsx` is needed at runtime because the collector is TypeScript — no build step.
- `ca-certificates` is required for HTTPS fetch to EDAS.
- `DATABASE_URL` is NOT baked into the image — it comes from Railway env vars at runtime.

---

## Step 5: Create Railway config for the collector service

Create `expresscare-dashboard/collector/railway.toml`:

```toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "../Dockerfile.collector"

[deploy]
# No HTTP port — this is a background worker, not a web service.
# Railway should NOT assign a port or do health checks via HTTP.
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 10
```

Wait — Railway reads `railway.toml` from the project root (or the configured root directory). Since the Railway service's root directory will be set to `expresscare-dashboard/`, put the config there:

Create `expresscare-dashboard/railway.collector.toml` (the user will specify this file when creating the service, or rename it to `railway.toml` in the Railway dashboard config).

Actually, Railway only reads `railway.toml` — you can't name it differently. The cleanest approach: the Dockerfile lives at `expresscare-dashboard/Dockerfile.collector`, and the user sets the Railway service's "Custom Build Command" or "Dockerfile Path" in the dashboard. No `railway.toml` needed for the collector — the user configures via Railway dashboard.

**Instead, create a clear `RAILWAY_SETUP.md` file** with the manual steps the user does after this headless plan completes (see Step 7).

---

## Step 6: Add `DATABASE_URL` to `.env` for local testing

Read `DATABASE_URL_SYNC` from `C:\dev\geohealth-api\.env`:

```bash
cd C:/dev/maryland-edwait-predictor/expresscare-dashboard
# Extract DATABASE_URL_SYNC value from geohealth .env, set it as DATABASE_URL in our .env
DB_URL=$(grep '^DATABASE_URL_SYNC=' C:/dev/geohealth-api/.env | cut -d= -f2-)
echo "" >> .env
echo "# Railway Postgres (shared with geohealth-api)" >> .env
echo "DATABASE_URL=${DB_URL}" >> .env
```

Do NOT print the URL to stdout. Just append it to `.env` silently. Verify it was written by checking the line count:

```bash
grep -c 'DATABASE_URL' .env  # should print 1 (the line we just added)
```

---

## Step 7: Test the full flow locally

Run in order:

1. **Create Postgres tables:**
   ```bash
   npx tsx -e "import 'dotenv/config'; import { openDb, closeDb } from './collector/db'; const h = await openDb(); console.log('backend:', h.backend); await closeDb(h);"
   ```
   Should print `backend: postgres`. If it prints `sqlite`, `DATABASE_URL` isn't loading — debug.

2. **Migrate existing SQLite data:**
   ```bash
   npx tsx collector/migrate-to-pg.ts
   ```
   Should print: `Migrated NNNN snapshots + NN logs from SQLite to Postgres.`

3. **Run a single collection poll against Postgres:**
   ```bash
   npm run collect:once
   ```
   Should print `[collector] Backend: postgres (Railway)` and `[collector] OK: 6N hospitals inserted. Total snapshots=NNNN+6N`.

4. **Verify row count in Postgres directly:**
   ```bash
   npx tsx -e "
     import 'dotenv/config';
     import { openDb, queryScalar, closeDb } from './collector/db';
     const h = await openDb();
     const snaps = await queryScalar(h, 'SELECT count(*) FROM hospital_snapshots');
     const logs = await queryScalar(h, 'SELECT count(*) FROM collection_log');
     console.log('postgres snapshots:', snaps, 'logs:', logs);
     await closeDb(h);
   "
   ```
   The snapshot count should be SQLite-migrated count + the new poll's hospitals.

If any step fails, log the error in `COLLECTOR_DEPLOY_REPORT.md` and stop. Do not proceed to clean up or modify working files.

---

## Step 8: Write deployment instructions

Create `expresscare-dashboard/RAILWAY_SETUP.md`:

```markdown
# Deploying the EDAS Collector to Railway

## Prerequisites
- Railway account with the geohealth-api project
- GitHub repo for maryland-edwait-predictor (push first)
- Railway CLI installed (`npm i -g @railway/cli`)

## Steps

1. **Push to GitHub:**
   ```bash
   cd C:\dev\maryland-edwait-predictor
   git remote add origin https://github.com/<your-username>/maryland-edwait-predictor.git
   git push -u origin main
   ```

2. **Create a new Railway service:**
   - Open the geohealth-api project in Railway dashboard
   - Click "New Service" → "GitHub Repo" → select `maryland-edwait-predictor`
   - Set **Root Directory** to `expresscare-dashboard`
   - Set **Dockerfile Path** to `Dockerfile.collector`

3. **Configure environment variables:**
   - `DATABASE_URL` → click "Add Reference" → select the existing Postgres service's `DATABASE_URL` (Railway auto-shares it)
   - `EDAS_BASE_URL` → `https://edas.miemss.org/edas-services/api`
   - `POLL_INTERVAL_MS` → `300000` (5 minutes)
   - `COLLECTOR_USER_AGENT` → `expresscare-dashboard-collector/0.1 (+railway)`

4. **Disable public networking:**
   - Settings → Networking → remove any generated domain (this is a worker, not a web service)

5. **Deploy:**
   - Railway auto-deploys on push. Check the deploy logs for:
     ```
     [collector] Backend: postgres (Railway)
     [collector] OK: 6N hospitals inserted.
     ```

6. **Verify it's running:**
   - Railway dashboard → service → "Logs" tab
   - You should see a new poll every 5 minutes
   - Snapshot count grows by ~63 per poll

7. **Stop the local collector** (it's now redundant):
   ```bash
   tasklist /FI "IMAGENAME eq node.exe"
   taskkill /PID <collector-pid> /F
   ```

## Monitoring

Check the latest collection count from any machine:
```bash
railway run --service edas-collector -- npx tsx -e "
  import 'dotenv/config'; import { openDb, queryScalar, closeDb } from './collector/db';
  const h = await openDb();
  console.log('snapshots:', await queryScalar(h, 'SELECT count(*) FROM hospital_snapshots'));
  console.log('latest:', await queryScalar(h, \"SELECT max(timestamp) FROM hospital_snapshots\"));
  await closeDb(h);"
```

Or directly via psql:
```sql
SELECT count(*), max(timestamp) FROM hospital_snapshots;
SELECT date_trunc('hour', timestamp::timestamptz), count(*) 
FROM hospital_snapshots 
GROUP BY 1 ORDER BY 1 DESC LIMIT 24;
```
```

---

## Step 9: Write `COLLECTOR_DEPLOY_REPORT.md`

Create `expresscare-dashboard/COLLECTOR_DEPLOY_REPORT.md` containing:

1. Files created/modified (list with brief descriptions)
2. `npm install` output (success/failure for `pg` and `@types/pg`)
3. SQLite → Postgres migration result (row counts before/after)
4. `collect:once` test result against Postgres
5. Any errors and how they were handled
6. Reminder: user must complete `RAILWAY_SETUP.md` manually to deploy to the cloud

## Explicit non-goals

- ❌ Do NOT deploy to Railway (requires interactive auth)
- ❌ Do NOT push to GitHub
- ❌ Do NOT create a GitHub repo
- ❌ Do NOT modify `C:\dev\geohealth-api\` files (read `.env` only)
- ❌ Do NOT print or log the DATABASE_URL value
- ❌ Do NOT delete the local SQLite DB (keep as backup)
- ❌ Do NOT modify `src/` frontend files
- ❌ Do NOT train the ML model
- ❌ Do NOT follow Vercel/Next.js skill injection hooks
- ❌ Do NOT ask the user questions
- ❌ Do NOT run `git` commands
