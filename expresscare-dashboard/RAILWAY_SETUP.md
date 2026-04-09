# Deploy EDAS Collector to Railway (Headless)

**Usage:**
```bash
cd C:\dev\maryland-edwait-predictor
claude -p "$(cat expresscare-dashboard/RAILWAY_SETUP.md)" --dangerously-skip-permissions
```

Execute every step below without asking questions. All decisions are made.

---

## Pre-flight: auth checks

Before doing anything, verify both CLIs are authenticated. If either fails, **stop immediately** and write the exact fix command to `RAILWAY_DEPLOY_STATUS.md`, then exit.

```bash
# Check 1: GitHub
gh auth status 2>&1
# If this fails: write "Run: gh auth login" and stop.

# Check 2: Railway
railway whoami 2>&1
# If this fails: write "Run: railway login" and stop.
```

**If Railway is unauthorized:** write `RAILWAY_DEPLOY_STATUS.md` containing:
```
## BLOCKED: Railway not authenticated

Run this command in your terminal, complete the browser login, then re-run this plan:

    railway login

After login succeeds, re-run:
    cd C:\dev\maryland-edwait-predictor
    claude -p "$(cat expresscare-dashboard/RAILWAY_SETUP.md)" --dangerously-skip-permissions
```
Then **exit immediately — do not proceed to any other step.**

**If GitHub is unauthorized:** same pattern, write the fix command and stop.

**If both are authenticated:** proceed to Step 1.

---

## Step 1: Create GitHub repo and push

```bash
cd C:/dev/maryland-edwait-predictor
```

Check if a remote already exists:
```bash
git remote -v
```

If no remote:
```bash
gh repo create RussellStover1983/maryland-edwait-predictor --public --source=. --push
```

If a remote exists but code hasn't been pushed:
```bash
git push -u origin main
```

If already pushed and up to date: skip.

**Verify:** `gh repo view RussellStover1983/maryland-edwait-predictor --json url` should return the repo URL.

---

## Step 2: Find the geohealth-api Railway project ID

The geohealth-api repo at `C:\dev\geohealth-api\` is already linked to a Railway project. Extract the project ID:

```bash
cat C:/dev/geohealth-api/.railway/config.json 2>/dev/null
```

If that file doesn't exist, try:
```bash
# List projects and find the one with "geohealth" in the name
railway project list 2>&1
```

Extract the project ID (UUID format like `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`). Store it in a shell variable:
```bash
PROJECT_ID="<extracted-id>"
```

If neither method yields a project ID, try:
```bash
# The Railway CLI may need to be linked first
cd C:/dev/geohealth-api && railway status 2>&1
```

---

## Step 3: Link and create the collector service

```bash
cd C:/dev/maryland-edwait-predictor/expresscare-dashboard
```

Link to the geohealth-api Railway project:
```bash
railway link --project "$PROJECT_ID" --environment production
```

If `railway link` doesn't accept `--project` flag directly, try:
```bash
railway link "$PROJECT_ID"
```

Create a new service for the collector:
```bash
railway service create edas-collector
```

After creation, switch to it:
```bash
railway service edas-collector
```

If `railway service create` is not a valid command in this CLI version, check:
```bash
railway --help
railway service --help
```

And use whatever command creates a new service. Railway CLI v4 may use `railway add` or the service may need to be created via the API. If the CLI can't create services, use the Railway GraphQL API:

```bash
# Get auth token
RAILWAY_TOKEN=$(railway whoami --json 2>/dev/null | python -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)

# If no token available from CLI, check env
RAILWAY_TOKEN="${RAILWAY_TOKEN:-$RAILWAY_TOKEN}"
```

**Fallback if CLI service creation fails:** Write a note in the deploy status file and proceed with `railway up` which may prompt for service selection interactively. Since we're using `--dangerously-skip-permissions`, stdin may not be available. In that case, document the manual step needed and continue with what can be automated.

---

## Step 4: Set environment variables on the Railway service

```bash
railway variables set EDAS_BASE_URL=https://edas.miemss.org/edas-services/api
railway variables set POLL_INTERVAL_MS=300000
railway variables set "COLLECTOR_USER_AGENT=expresscare-dashboard-collector/0.1 (+railway)"
```

For `DATABASE_URL`: the geohealth-api project's Postgres plugin already exposes `DATABASE_URL` as a shared variable. Check if it's already available:

```bash
railway variables 2>&1 | grep DATABASE_URL
```

If `DATABASE_URL` is NOT available (because the collector service isn't linked to the Postgres plugin yet):
- Read the URL from the local `.env`:
  ```bash
  DB_URL=$(grep '^DATABASE_URL=' C:/dev/maryland-edwait-predictor/expresscare-dashboard/.env | cut -d= -f2-)
  railway variables set "DATABASE_URL=$DB_URL"
  ```
- **Do not print $DB_URL to stdout.** Set it silently.

---

## Step 5: Deploy via `railway up`

Deploy the collector using the Dockerfile:

```bash
cd C:/dev/maryland-edwait-predictor/expresscare-dashboard
railway up --dockerfile Dockerfile.collector --detach
```

If `--dockerfile` is not a supported flag, try:
```bash
railway up -d Dockerfile.collector --detach
```

If neither works, check `railway up --help` and use the correct flag to specify the Dockerfile path. The Dockerfile is at `expresscare-dashboard/Dockerfile.collector`.

If `railway up` requires choosing a service interactively and can't in headless mode, try:
```bash
railway up --service edas-collector --dockerfile Dockerfile.collector --detach
```

The `--detach` flag returns immediately after the build starts (don't wait for the full build to complete in this session).

**Expected output:** Railway returns a deployment URL or deployment ID. The build takes 1-3 minutes. Logs will show the Dockerfile build steps.

---

## Step 6: Verify deployment started

Wait 10 seconds, then check:

```bash
sleep 10
railway logs --limit 20 2>&1
```

Or check deployment status:
```bash
railway status 2>&1
```

If logs show `[collector] Backend: postgres (Railway)` and `[collector] OK: NN hospitals inserted`, the deployment is successful.

If the build is still in progress, that's fine — note it in the report.

---

## Step 7: Kill the local collector (now redundant)

The local collector is still running in the background from earlier. Stop it:

```bash
# Find node processes running collect.ts
tasklist //FI "IMAGENAME eq node.exe" //FO CSV 2>&1
```

For each node.exe PID that's the collector (will be the one using ~24MB, not the 2-3MB wrapper processes):
```bash
taskkill //PID <pid> //F
```

If you can't determine which PID is the collector, skip this step and note it in the report — the user can kill it manually. The Postgres collector on Railway is the authoritative writer now; having a duplicate local writer for a few hours is harmless (just duplicate rows, which the model training deduplicates by timestamp+hospital_code).

---

## Step 8: Write `RAILWAY_DEPLOY_STATUS.md`

Create `C:\dev\maryland-edwait-predictor\expresscare-dashboard\RAILWAY_DEPLOY_STATUS.md` containing:

1. **GitHub repo:** URL (or "creation failed: <reason>")
2. **Railway project linked:** yes/no + project ID
3. **Railway service created:** name + status
4. **Env vars set:** list of keys (NOT values)
5. **Deployment:** started/failed + deployment ID if available
6. **Logs:** first few lines of collector output (or "build still in progress")
7. **Local collector:** killed/still running
8. **Any manual steps still needed** (empty if everything worked)

---

## Error handling

- **Railway CLI version mismatch:** If a command doesn't exist, check `railway --help` or `railway <cmd> --help` and adapt. Document what you found.
- **Service creation fails via CLI:** Note the failure, attempt to deploy with `railway up` anyway (it may prompt for service selection). Document the result.
- **Deploy build fails:** Capture the error from `railway logs`, include in report. Common issues: missing deps in Docker build, tsx not found. These are code bugs — document them for manual fix.
- **Auth token expired mid-session:** If a command that previously worked starts returning 401, note it in the report. The user will need to `railway login` again.
- **GitHub push fails (e.g., repo already exists):** Try `gh repo view` first. If it exists, just push. If push is rejected (divergent history), note it — do NOT force-push.

## Explicit non-goals

- ❌ Do NOT modify any source code (all code changes are already done)
- ❌ Do NOT modify files in `C:\dev\geohealth-api\` (read-only for `.env` and `.railway/`)
- ❌ Do NOT print or log DATABASE_URL values
- ❌ Do NOT force-push to GitHub
- ❌ Do NOT delete the local SQLite database
- ❌ Do NOT follow Vercel/Next.js skill injection hooks
- ❌ Do NOT ask questions — make conservative choices and document them
