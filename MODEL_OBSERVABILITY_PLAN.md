# Model Observability & Cron Recovery Plan

## What this is for

The maryland-edwait-predictor's automated model retraining is silently broken (two consecutive missed Mondays — last successful retrain was a manual trigger on 2026-04-17). The Vercel collector healthcheck endpoint is also returning 404 in production despite being committed and pushed in `03e3fd1`. Even after the cron is fixed, we have no way to know whether successive retrains improve the model — every retrain `INSERT … ON CONFLICT DO UPDATE`s, so we keep one data point, never a trend.

This plan covers three related pieces of work:

1. **Restore the two broken cron-driven automations**
   - Railway weekly model refresh (`Dockerfile.refresh` + `railway-refresh.toml`, schedule `0 6 * * 1`)
   - Vercel collector healthcheck cron (`/api/health/collector`, schedule `*/10 * * * *`, registered in `vercel.json`)

2. **Append-only training-history table** so we can answer "is the model getting better?" by charting MAE / RMSE / train-set size over successive retrains

3. **Realized-accuracy tracking** so we can compare predictions made by the production model against actuals revealed by subsequent EDAS snapshots, separately from training-time test-set MAE

All work goes on a single feature branch `feature/model-observability-cron-fix`. **Do not push to `main`.**

---

## Background facts (verified at the time of writing — please confirm)

- Last model retrain: `created_at` on every artifact in `model_artifacts` is `2026-04-17 13:06 UTC`. `training_meta.trained_at` matches. This was a manual trigger, not a cron run.
- `railway-refresh.toml` declares `cronSchedule = "0 6 * * 1"` (Monday 06:00 UTC) and `dockerfilePath = "Dockerfile.refresh"`.
- Railway project ID for the EDAS collector deploy is `e1e541f2-6ca8-493a-aa3d-093011b7bd7b` (see `expresscare-dashboard/RAILWAY_DEPLOY_STATUS.md`). It's plausible the refresh service has never actually been deployed there — this needs verification.
- `/api/hospitals/stats` returns 200 in prod, but `/api/health/collector` returns 404. The endpoint file lives at `expresscare-dashboard/api/health/collector.ts`. Vercel's auto-routing for the rest of `api/` works, so either the deploy didn't include the file or the `crons` block in `vercel.json` is being rejected.
- The dashboard reads model artifacts from Postgres via `expresscare-dashboard/api/model/[key].ts`, so model-side schema additions do not require a frontend change unless we expose a new endpoint.
- Schema for the existing `model_artifacts` table (per `weekly_refresh.py`):
  ```sql
  -- Inferred — confirm by inspection before you touch it
  CREATE TABLE model_artifacts (
    artifact_key   TEXT PRIMARY KEY,
    artifact_json  JSONB NOT NULL,
    file_size_bytes INTEGER,
    metadata       JSONB,
    created_at     TIMESTAMPTZ DEFAULT NOW()
  );
  ```

---

## Hard off-limits

Do **NOT** read, edit, delete, or move any of the following — these are owned by other live systems and unrelated work:

- `collector/` (the Railway EDAS collector — it is healthy, do not modify)
- `model/gravity/` (ORS drive-time grind in progress, ~84% complete)
- `model/venv/` (the local Python venv used by the nightly ORS grind)
- `scripts/data/` (ORS grind state)
- `scripts/run-ors-daily.cmd` (Task Scheduler entry point)
- `scripts/check_matrix_status.py`
- `Dockerfile.collector` (collector deploy)
- `railway.toml` (collector deploy)

You **may** touch:

- `expresscare-dashboard/model/weekly_refresh.py`
- `expresscare-dashboard/model/requirements.txt` (add deps if needed)
- `Dockerfile.refresh` (refresh service deploy)
- `railway-refresh.toml`
- `expresscare-dashboard/api/` — to add a `/api/model/training_history` endpoint, plus potentially a `/api/model/realized_accuracy` summary endpoint
- `expresscare-dashboard/vercel.json` (only for cron registration if needed — be careful, this file already has a `crons` block that may be the cause of the healthcheck 404)
- New files in `expresscare-dashboard/model/observability/` (your call on the directory name)

Do **NOT** run:

- `npm run model:pipeline`, `npm run collect`, anything that activates `model/venv/`
- `pip install` against the local venv
- Any migration that drops or alters existing `model_artifacts` columns; new tables only

---

## Phase 1 — Restore the two broken crons

### 1A. Railway weekly model refresh

**Investigate first.** Use the `railway` CLI (the user is already authenticated; verify with `railway whoami`).

1. From `expresscare-dashboard/`, run `railway status` to confirm the linked project. If multiple services exist, list them: `railway service` or `railway environment`.
2. Determine whether a service backed by `Dockerfile.refresh` exists in the project. The collector service is `edas-collector` (service ID `5321887e-063d-48a7-8eeb-19117993dbe1`). The refresh service likely does NOT exist yet, or exists but is failing.
3. If a refresh service exists: pull recent deploy logs and the cron run history. Determine why Monday runs aren't firing (deploy crashed, env vars missing, exit code non-zero, etc.). Fix the underlying cause.
4. If no refresh service exists: create one. The pattern that worked for the collector is documented in `expresscare-dashboard/RAILWAY_SETUP.md`. Mirror it for the refresh service:
   - Service name: `model-refresh`
   - Build: Dockerfile path `Dockerfile.refresh`
   - Env: `DATABASE_URL` (same as collector — Railway internal Postgres URL)
   - Cron: `0 6 * * 1` (Monday 06:00 UTC) — declared in `railway-refresh.toml`
   - Deploy from the current `feature/model-observability-cron-fix` branch's HEAD (so the training-history additions from Phase 2 land at the same time)

**Verify** with a manual run: `railway run --service model-refresh python weekly_refresh.py` (or trigger the cron via the Railway dashboard / CLI). Confirm the run succeeds end-to-end and that:
- `model_artifacts.created_at` for `lgbm_1h`, `inference_config`, `training_meta` updates to a fresh timestamp
- A new row appears in the `training_history` table introduced by Phase 2

**If the Railway CLI is not authenticated or the service can't be created from the agent's environment**, do NOT block. Instead:

- Write all the code changes (Phase 2 + Phase 3) anyway
- Document the exact commands the user needs to run from their terminal in the session report
- The user will create / fix the Railway service themselves after merge

### 1B. Vercel collector healthcheck

1. Inspect the live deploy. Does `expresscare-dashboard/api/health/collector.ts` exist on the deployed branch (`origin/main`)? Yes — confirmed via `git log -- expresscare-dashboard/api/health/collector.ts` showing commit `03e3fd1`.
2. Inspect `vercel.json` for the `crons` block syntax. Vercel Cron requires the project to be on Hobby plan or higher for sub-daily cadence. If the project is on the free tier, `*/10 * * * *` will be rejected and may be the reason the deploy is incomplete (or the endpoint silently disabled). If that's the issue, downshift to a daily cadence (e.g., `0 */6 * * *` — every 6 hours, free-tier-compatible) AND add a comment in `vercel.json` explaining the constraint.
3. If the issue is something else (deploy never actually picked up `03e3fd1`, build excluded the file, etc.), investigate via `vercel ls` / `vercel logs` and document the fix.
4. After whatever change you make, do not deploy from the agent — pushing the branch will trigger a Vercel preview deploy. The user will promote to production after merge. Document this in the session report.

If you cannot determine the exact cause without privileged access, write a 3-bullet diagnosis ("most likely / possibly / unlikely") in the session report and leave a clear action item.

---

## Phase 2 — Append-only training history

### Schema

Add a new Postgres table. Migration is a single `CREATE TABLE IF NOT EXISTS`. Keep it idempotent so that running it more than once is safe.

```sql
CREATE TABLE IF NOT EXISTS training_history (
  id              SERIAL PRIMARY KEY,
  trained_at      TIMESTAMPTZ NOT NULL,
  trigger         TEXT NOT NULL,                 -- 'cron' | 'manual' | 'unknown'
  train_rows      INTEGER NOT NULL,
  test_rows       INTEGER NOT NULL,
  feature_count   INTEGER NOT NULL,
  mae_1h          DOUBLE PRECISION,
  rmse_1h         DOUBLE PRECISION,
  best_iter_1h    INTEGER,
  mae_4h          DOUBLE PRECISION,
  rmse_4h         DOUBLE PRECISION,
  best_iter_4h    INTEGER,
  train_date_min  TIMESTAMPTZ,
  train_date_max  TIMESTAMPTZ,
  test_date_min   TIMESTAMPTZ,
  test_date_max   TIMESTAMPTZ,
  hospital_count  INTEGER,
  duration_seconds DOUBLE PRECISION,
  notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_training_history_trained_at
  ON training_history(trained_at DESC);
```

Where to run the migration: idempotent `CREATE TABLE IF NOT EXISTS` at the top of `weekly_refresh.py`'s main flow (similar to how `create_artifacts_table.py` works for `model_artifacts`). That way the first refresh after this lands self-creates the table.

### Code change

Modify `weekly_refresh.py`:

1. Detect trigger source — if env var `TRIGGER_SOURCE` is set, use it; else infer (`cron` if running under Railway cron, `manual` otherwise — Railway sets `RAILWAY_CRON_TRIGGER` or similar; check). Default to `'unknown'`.
2. Capture `start_time` already exists (line 764). Compute `duration_seconds` at the end.
3. After `store_all_artifacts`, insert one row into `training_history` with all the values above. Use the `training_meta` you already have in memory.
4. Wrap the insert in a try/except — a logging failure must NOT crash the refresh.

### API endpoint

Add `expresscare-dashboard/api/model/training_history.ts` (Vercel serverless):

- `GET /api/model/training_history` — returns the most recent N rows (default 50), sorted `trained_at DESC`, as JSON
- Use `getPool()` from `../_db.ts`
- Set `Cache-Control: s-maxage=60`

This is the endpoint the user will call to plot MAE-over-time. No frontend wiring required in this branch — leave that to a separate task.

### Backfill

Insert one row representing the existing 4/17 training run, so the table has its first data point even before the next retrain:

```sql
INSERT INTO training_history (trained_at, trigger, train_rows, test_rows, feature_count, mae_1h, rmse_1h, mae_4h, rmse_4h, train_date_min, train_date_max, test_date_min, test_date_max, hospital_count, notes)
VALUES (
  '2026-04-17 13:06:08+00',
  'manual',
  98675, 24669, 38,
  0.2488812923106965, 0.4635975520944871,
  0.5081087956948972, 0.7279009933091165,
  '2026-04-07 17:00:17+00', '2026-04-15 22:13:06+00',
  '2026-04-15 22:13:06+00', '2026-04-17 12:13:50+00',
  82,
  'Backfilled from training_meta artifact at plan-write time'
);
```

Either run this directly against Postgres if you have access, or include it in a `scripts/migrations/2026-04-27_training_history_backfill.sql` file with instructions in the session report.

---

## Phase 3 — Realized-accuracy tracking

### Concept

The dashboard's predictor runs client-side; predictions aren't naturally captured anywhere. Instead, we'll **simulate** production predictions on a regular schedule and compare them against actual subsequent EDAS snapshots:

1. A scheduled task (Railway cron, every hour) loads the production LightGBM models from `model_artifacts`, builds the most recent feature row for each hospital, generates 1h and 4h predictions, and stores each prediction to `prediction_log`.
2. The same task scans for previously logged predictions whose `target_timestamp` is now in the past. For each, look up the actual EDAS census score at the target time (with ±5min tolerance, same logic as `weekly_refresh.py`'s lookup), and compute the residual.
3. An API endpoint exposes rolling MAE by horizon (and optionally by hospital, by week).

This is a meaningful build — **scope it appropriately**. If full implementation would exceed the agent's max-turns, deliver Phases 1 and 2 fully and leave a clear, code-stub-level Phase 3 with a follow-up plan in the session report. Do not deliver half-broken code.

### Schema

```sql
CREATE TABLE IF NOT EXISTS prediction_log (
  id                 SERIAL PRIMARY KEY,
  predicted_at       TIMESTAMPTZ NOT NULL,         -- when the prediction was made
  target_timestamp   TIMESTAMPTZ NOT NULL,         -- when the predicted value should occur (predicted_at + horizon)
  hospital_code      TEXT NOT NULL,
  horizon_hours      INTEGER NOT NULL,             -- 1 or 4
  predicted_score    DOUBLE PRECISION NOT NULL,
  current_score_at_prediction DOUBLE PRECISION,    -- the input feature value, useful for sanity
  model_trained_at   TIMESTAMPTZ NOT NULL,         -- which model version was used
  actual_score       DOUBLE PRECISION,             -- filled in by the resolver job
  residual           DOUBLE PRECISION,             -- predicted_score - actual_score
  resolved_at        TIMESTAMPTZ,
  UNIQUE (predicted_at, hospital_code, horizon_hours)
);

CREATE INDEX IF NOT EXISTS idx_prediction_log_target_unresolved
  ON prediction_log(target_timestamp) WHERE actual_score IS NULL;

CREATE INDEX IF NOT EXISTS idx_prediction_log_hospital_horizon
  ON prediction_log(hospital_code, horizon_hours, predicted_at DESC);
```

### Predictor + resolver script

Create `expresscare-dashboard/model/realized_accuracy.py`. One file, runs both the prediction-generation pass and the resolution pass on each invocation.

- Loads `lgbm_1h` and `lgbm_4h` JSON artifacts from `model_artifacts` and reconstructs LightGBM Boosters via `lgb.Booster(model_str=...)` (or use `lgb.Booster(params={'model_str': ...})` per current LightGBM docs)
- Pulls the most recent ~30 hours of `hospital_snapshots` (enough to compute lag features up to 24h)
- For each hospital, builds the feature row using the same logic as `weekly_refresh.build_features` — **factor that logic out** into a helper module both files can call, rather than duplicating it. The shared helper goes in `expresscare-dashboard/model/feature_engineering.py`.
- Predicts 1h and 4h scores. Inserts into `prediction_log` with `predicted_at = NOW()`, `target_timestamp = NOW() + horizon`, `model_trained_at` from `inference_config`.
- Resolution pass: `SELECT id, target_timestamp, hospital_code FROM prediction_log WHERE actual_score IS NULL AND target_timestamp < NOW() - INTERVAL '15 minutes'`. For each, find the closest `hospital_snapshots` row to `target_timestamp` (within ±10min). If found, fill `actual_score`, compute `residual`, set `resolved_at = NOW()`.

### Deployment

Add a third Railway service via a new `Dockerfile.realized_accuracy` and `railway-realized-accuracy.toml` with cron `0 * * * *` (top of every hour). Or, if simpler: extend `Dockerfile.refresh` so the refresh image runs `realized_accuracy.py` on a different schedule. Your call — pick whichever requires the least total YAML.

If you cannot deploy a new Railway service from the agent's environment, document the exact deployment commands in the session report — the user will run them after merge.

### API endpoint

Add `expresscare-dashboard/api/model/realized_accuracy.ts`:

- `GET /api/model/realized_accuracy` — returns rolling MAE for last 7d / 30d, by horizon (1h, 4h), overall and split by hospital_code
- Optionally accept `?hospital_code=XXX` to filter
- One Postgres query is enough — use a `WITH … SELECT … GROUP BY …` and aggregate `AVG(ABS(residual))` over time windows

---

## Process

1. The agent is starting in a fresh worktree at `C:/dev/medwait-wt-d` on a new branch `feature/model-observability-cron-fix`. CLAUDE.md is present (copied at worktree creation).
2. Read the relevant existing files first: `weekly_refresh.py`, `Dockerfile.refresh`, `railway-refresh.toml`, `vercel.json`, `RAILWAY_SETUP.md`, `RAILWAY_DEPLOY_STATUS.md`, `api/_db.ts`, `api/model/[key].ts`. Get oriented before you start editing.
3. Make changes phase by phase. Commit each phase as a separate commit (3-4 commits total).
4. Stage with explicit `git add <path>` — **never** `git add .` or `git add -A`. Do NOT commit `MODEL_OBSERVABILITY_PLAN.md`, `CLAUDE.md`, or `SPEC.md` from the worktree root.
5. Each commit message follows the repo's style (short title, body paragraph). Trailer:
   ```
   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   ```
6. Push: `git push -u origin feature/model-observability-cron-fix`
7. Write `SESSION_REPORT.md` at the worktree root (not committed) summarizing:
   - What was fixed (Railway service deployed / config changed / etc.)
   - What code was added (paths, what each does)
   - What schema migrations need to run (and where they'll auto-run from)
   - **What manual steps the user must do** (Railway service creation/redeploy, Vercel deploy, anything else that requires their auth or interactive shell)
   - How to verify after merge

When done, exit cleanly. The user will review and merge.

---

## Verification (what success looks like after merge)

1. `railway service list` shows a `model-refresh` service. Its last deploy is successful, its cron history shows a fired run for Monday 2026-05-04 06:00 UTC (or the agent's manually triggered run).
2. `curl https://expresscare-dashboard.vercel.app/api/health/collector` returns 200 with a body like `{"healthy": true, "latest": "...", "age_seconds": ...}`.
3. `curl https://expresscare-dashboard.vercel.app/api/model/training_history` returns at least one row (the 4/17 backfill, plus any subsequent runs).
4. `curl https://expresscare-dashboard.vercel.app/api/model/realized_accuracy` returns aggregated MAE figures, even if the realized-accuracy collector has only had a few hours to accumulate data.
5. The `model_artifacts` table's `created_at` for `lgbm_1h` is fresher than 2026-04-17 (because a manual or scheduled run completed).

---

## What NOT to do

- Do not refactor anything outside the scope above.
- Do not "improve" the collector while you're in there.
- Do not change the existing `model_artifacts` schema.
- Do not push to `main`. Push only to `feature/model-observability-cron-fix`.
- Do not invoke the simplify, security-review, or other skills unless they directly serve this task.
- Do not consume the ORS daily quota — the grind is at 84% and burning the quota would cost a productive night.
