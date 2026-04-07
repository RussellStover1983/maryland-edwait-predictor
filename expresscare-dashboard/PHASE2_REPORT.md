# Phase 2 Prep — Completion Report

**Date:** 2026-04-07
**Status:** All three workstreams completed successfully.
**Executed by:** Interactive Claude session (Option B) after the headless `--permission-mode acceptEdits` attempt was blocked on Bash approval walls.

---

## W1 — EDAS Collector (background, long-running)

**Status:** ✅ Running detached

- Launched via `collector/run-detached.bat` which wraps `start /b npm run collect`.
- Mode: continuous, 300,000 ms (5 min) interval.
- Confirmed polling: 3 HTTP 200s per poll (facilities / jurisdictions / hospitalstatus), all first-attempt success.
- **Snapshot count grew from 190 (before this session) to 570+ during the session** — 6+ successful polls observed.
- Log: `collector/data/collector.log`
- Stderr: `collector/data/collector.err` (empty)

**To check status:**
```bash
cd C:/dev/maryland-edwait-predictor/expresscare-dashboard
tail -10 collector/data/collector.log
npx tsx collector/count-rows.ts   # prints current row count
```

**To stop the collector** when the training data accumulates:
```bash
tasklist //FI "IMAGENAME eq node.exe"
# Look for the node.exe child with the collect.ts command in its parent chain
taskkill //PID <pid> //F
```

Or kill by port if nothing else on the machine is running node collectors:
```bash
powershell "Get-Process node | Where-Object {$_.Path -like '*expresscare*'} | Stop-Process -Force"
```

---

## W2 — CMS OP-18B Enrichment

**Status:** ✅ Strategy A succeeded (local CMS mirror)

**Source:** `C:\dev\shared\data\cms\care_compare\timely_and_effective_care.csv`
(138,129 total rows nationwide — standard CMS Care Compare flat file)

**Results:**
- **46** Maryland OP_18b rows in the source file
- **6** had non-numeric scores (footnoted as "not available" / "fewer than 25 cases")
- **40** usable scores → enriched into `scripts/data/cms-hospitals.json`
- All enriched records tagged `op18bSource: "local-cms"`

**Sanity check** — the distribution exactly matches expectations for an urban/rural split:

| Rank | Hospital | OP-18b (min) |
|---|---|---|
| Slowest | MEDSTAR FRANKLIN SQUARE MEDICAL CENTER (210015) | **399** |
| #2 | MEDSTAR SOUTHERN MARYLAND HOSPITAL CENTER (210062) | 386 |
| #3 | ADVENTIST HEALTHCARE WHITE OAK MEDICAL CENTER (210016) | 343 |
| #4 | JOHNS HOPKINS BAYVIEW MEDICAL CENTER (210029) | 332 |
| #5 | UNIVERSITY OF MARYLAND MEDICAL CENTER (210002) | 325 |
| ... | ... | ... |
| Fastest 5 | Rural Eastern Shore + Garrett Regional | 134 – 182 |

Urban academic/trauma centers dominate the slow end (expected); rural small hospitals are ~2–3× faster (expected). This feature is ready for LightGBM training as a structural per-hospital baseline.

**Script:** `scripts/parse-local-op18b.ts` (new, 90 lines). Idempotent — running again just re-enriches.

**Untouched:** Strategies B (CMS flat-file URL) and C (EDAS proxy) were NOT needed. Strategy C may still be worth adding later as a second feature that updates as collector history grows.

---

## W3 — Flu / ILI data via Delphi epidata

**Status:** ✅ Delphi API returned full history

**Source:** `https://api.delphi.cmu.edu/epidata/fluview/?regions=hhs3&epiweeks=202001-202614`
(Carnegie Mellon's Delphi Group mirror of CDC FluView — stable, key-less, maintained specifically to replace the flaky CDC endpoints)

**Results:**
- **326 epiweeks** fetched (202001 → 202612)
- Covers **Jan 2020 → early April 2026** — 6+ years of pre/post/current-pandemic ILI for HHS Region 3 (DE + DC + MD + PA + VA + WV)
- **Latest `wILI` = 2.26%** (epiweek 202612, release_date 2026-04-03, lag 1 week)
- Output includes derived `epiweek_start` / `epiweek_end` ISO dates for convenient joins to hourly weather/EDAS data

**Output shape** (`scripts/data/flu-history.json`):
```json
{
  "source": "delphi-epidata-fluview",
  "region": "hhs3",
  "fetched_at": "2026-04-07T...",
  "coverage": { "first_epiweek": 202001, "last_epiweek": 202612, "week_count": 326 },
  "weeks": [
    { "epiweek": 202001, "epiweek_start": "2019-12-29", "epiweek_end": "2020-01-04",
      "wili": 3.45, "ili": 3.32, "num_ili": ..., "num_patients": ..., "release_date": "..." },
    ...
  ]
}
```

**Script rewritten:** `scripts/fetch-flu-data.ts` — dropped the CDC POST endpoints, hits Delphi with retry/backoff, computes current epiweek from today's date, derives epiweek boundary dates, writes schema above.

**RESP-NET (optional bonus):** NOT fetched. Deferred — the 326-week Delphi series is already plenty for training. Can be added later as a second feature if feature importance shows ILI alone is insufficient.

---

## Summary

| Workstream | Status | Outcome |
|---|---|---|
| W1 — Collector detached | ✅ | 570+ snapshots, still running every 5 min |
| W2 — OP-18B | ✅ Strategy A | 40/40 MD EDs enriched from local CMS mirror |
| W3 — FluView | ✅ Delphi | 326 weeks, wILI 2.26% current |

**The ML model's training feature set is now complete** except for the collector's temporal depth, which will grow automatically. Recommendation: let the collector run for ~5–7 days, then train LightGBM with real (not synthetic) EDAS lag features.

## Files changed/created this session

- `collector/count-rows.ts` (from Phase 2 headless run)
- `collector/run-detached.bat` (from Phase 2 headless run)
- `scripts/parse-local-op18b.ts` **(new)**
- `scripts/fetch-flu-data.ts` **(rewritten — replaced CDC with Delphi)**
- `scripts/data/cms-hospitals.json` (40 records enriched with `op18bMinutes` + `op18bSource`)
- `scripts/data/flu-history.json` (326 weeks of real ILI data)
- `collector/data/edas-history.db` (growing; 570+ snapshots at report time)
- `collector/data/collector.log`, `collector/data/collector.err`

## Next step: train LightGBM

Wait ~5–7 days for the collector to accumulate a week of history, then:

```bash
cd C:/dev/maryland-edwait-predictor/expresscare-dashboard/model
# Per ED-PREDICTIVE-MODELING-RESEARCH.md spec:
python -m venv .venv
.venv/Scripts/activate      # Windows
pip install lightgbm pandas numpy scikit-learn shap holidays python-dateutil
# write features.py / train.py / evaluate.py / export.py (see research doc for architecture)
python train.py --db ../collector/data/edas-history.db \
                --weather ../scripts/data/weather-history.json \
                --flu ../scripts/data/flu-history.json \
                --cms ../scripts/data/cms-hospitals.json
python evaluate.py
python export.py    # → model/output/prediction-model.json
# Then replace src/services/predictor.ts placeholder with the JSON evaluator.
```
