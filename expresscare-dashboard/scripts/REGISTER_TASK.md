# ORS Drive-Time Matrix — Automated Grind Runbook

Background on why this exists: the gravity expansion model needs a 38,322 hex × 132 facility drive-time matrix. The free-tier OpenRouteService Matrix API allows ~500 requests/day, and the full matrix takes ~1,641 requests. We grind through it over ~4 evenings via Windows Task Scheduler.

The runner `scripts/run-ors-daily.cmd` is idempotent: safe to re-run; skips work if already complete.

---

## 1. Register the scheduled task (one-time)

Open **elevated PowerShell** (right-click PowerShell → *Run as Administrator*) and run:

```powershell
schtasks.exe /create /tn "ExpressCareORSGrind" /tr "C:\dev\maryland-edwait-predictor\expresscare-dashboard\scripts\run-ors-daily.cmd" /sc daily /st 20:05 /f
```

You should see `SUCCESS: The scheduled task "ExpressCareORSGrind" has successfully been created.`

You can close the PowerShell window — the task is owned by Windows and runs independently. Fires at **8:05 PM local** every night. Laptop must be powered on and awake at that time; if it's off, that night is skipped and it resumes the next evening.

---

## 2. Check progress (anytime, non-elevated PowerShell)

```powershell
cd C:\dev\maryland-edwait-predictor\expresscare-dashboard

# Full status with tail of today's log
.\model\venv\Scripts\python.exe .\model\gravity\status.py

# One-line status snapshot
Get-Content .\scripts\data\ors-status.txt

# Live-tail today's log during a run
Get-Content ".\scripts\data\ors-logs\$(Get-Date -Format yyyy-MM-dd).log" -Wait -Tail 20
```

Expected daily progression: **~5,800 hexes/night** (validated against night 1: 5,795 hexes from 500 requests × ~11.6 hexes/request). Each hex batch requires 3 facility-batch calls, so the 500/day quota delivers ~167 complete hex batches × ~35 hexes/batch.

- After night 1: ~15% ✅
- After night 2: ~30%
- After night 3: ~45%
- After night 4: ~60%
- After night 5: ~75%
- After night 6: ~90%
- After night 7: 100% + automatic rebuild + upload + self-disable

---

## 3. Manually trigger a run (for testing)

```powershell
schtasks /run /tn "ExpressCareORSGrind"
```

This burns the day's 500-request quota but validates the pipeline end-to-end. Useful right after registering.

---

## 4. Task management

```powershell
# View task config and last run
schtasks /query /tn "ExpressCareORSGrind" /v /fo LIST

# Temporarily disable without deleting
schtasks /change /tn "ExpressCareORSGrind" /disable

# Re-enable
schtasks /change /tn "ExpressCareORSGrind" /enable

# Permanently delete
schtasks /delete /tn "ExpressCareORSGrind" /f
```

Or use the GUI: `taskschd.msc` → Task Scheduler Library → locate `ExpressCareORSGrind`.

---

## 5. What happens on the final night

When `compute_drive_times.py` writes the 38,322nd valid hex, `run-ors-daily.cmd` detects completion and automatically:

1. Runs `model\gravity\build_gravity_model.py` (rebuilds `gravity-results.json` with real ORS drive times).
2. Runs `model\gravity\upload_results.py` (pushes to Railway Postgres).
3. Creates marker file `scripts\data\ors-grind-complete.txt`.
4. Disables the scheduled task (`schtasks /change /tn ExpressCareORSGrind /disable`).

The Vercel dashboard's Expansion Opportunities panel will automatically start reading the new ORS-based scores — no deploy needed, since the data lives in Postgres and is served via `/api/model/gravity_results`.

---

## 6. Troubleshooting

- **"SUCCESS" but no log file appears overnight**: confirm laptop was awake at 8:05 PM. Check `schtasks /query /tn "ExpressCareORSGrind" /v /fo LIST` — "Last Run Time" tells you if it fired. If Last Result ≠ 0, look at the dated log under `scripts\data\ors-logs\`.
- **403 errors flooding the log**: daily quota exhausted for the day — expected. Script should exit cleanly and resume tomorrow. If you see 403s without a `"Daily quota exhausted"` message, the patched exception handling in `compute_drive_times.py` may have regressed; check `model\gravity\compute_drive_times.py` for the `QuotaExceededError` class.
- **Checkpoint corruption** (matrix keys exist but rows are all-None): the bug this runbook was built to prevent. Shouldn't recur, but if it does: inspect `scripts\data\drive-time-matrix.partial.json` with `status.py` and selectively delete all-None keys before the next run.
- **Need to start over**: delete `scripts\data\drive-time-matrix.json`, replace `scripts\data\drive-time-matrix.partial.json` with `{"matrix": {}, "is_checkpoint": true, ...}`, re-enable the task.

---

## 7. Related files

| File | Purpose |
|---|---|
| `scripts/run-ors-daily.cmd` | Windows batch runner invoked by Task Scheduler |
| `model/gravity/compute_drive_times.py` | Core ORS grinder; patched for quota-aware resume |
| `model/gravity/status.py` | CLI progress checker |
| `model/gravity/build_gravity_model.py` | Rebuilds `gravity-results.json` from the matrix |
| `model/gravity/upload_results.py` | Pushes results to Postgres |
| `scripts/data/drive-time-matrix.partial.json` | In-progress checkpoint (resumed from) |
| `scripts/data/drive-time-matrix.json` | Final matrix (written at 100%) |
| `scripts/data/ors-logs/YYYY-MM-DD.log` | Per-day run logs |
| `scripts/data/ors-status.txt` | Latest one-line status snapshot |
| `scripts/data/ors-grind-complete.txt` | Marker file; presence means done |
