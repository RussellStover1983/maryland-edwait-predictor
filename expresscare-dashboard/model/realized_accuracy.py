"""Realized-accuracy collector.

Each invocation does two passes:

1. **Predict pass** — load the production LightGBM models and the latest ~30h of
   `hospital_snapshots`, build features for every hospital, and write one row per
   (hospital, horizon) into `prediction_log` with `predicted_at = NOW()`.

2. **Resolve pass** — for every previously logged prediction whose
   `target_timestamp` is now safely in the past, look up the actual
   `ed_census_score` from `hospital_snapshots` (±10 min tolerance), compute the
   residual, and patch the row.

Designed to run on a Railway cron every hour. The script is idempotent: re-runs
will not duplicate predictions thanks to the UNIQUE(predicted_at, hospital_code,
horizon_hours) constraint, and resolution skips rows already filled in.
"""

from __future__ import annotations

import json
import os
import sys
import traceback
from datetime import datetime, timedelta, timezone
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
import psycopg2

try:
    from dotenv import load_dotenv
    ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
    if ENV_PATH.exists():
        load_dotenv(ENV_PATH)
except ImportError:
    pass

from feature_engineering import build_features

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL not set")
    sys.exit(1)
CONN_STR = DATABASE_URL.replace("?sslmode=require", "")

LOOKBACK_HOURS = 30          # enough history for the 24h lag feature
RESOLUTION_DELAY_MIN = 15    # only resolve predictions whose target is >15min old
ACTUAL_TOLERANCE_MIN = 10    # match an actual snapshot within ±10min of target
HORIZONS = [1, 4]


PREDICTION_LOG_DDL = """
CREATE TABLE IF NOT EXISTS prediction_log (
  id                          SERIAL PRIMARY KEY,
  predicted_at                TIMESTAMPTZ NOT NULL,
  target_timestamp            TIMESTAMPTZ NOT NULL,
  hospital_code               TEXT NOT NULL,
  horizon_hours               INTEGER NOT NULL,
  predicted_score             DOUBLE PRECISION NOT NULL,
  current_score_at_prediction DOUBLE PRECISION,
  model_trained_at            TIMESTAMPTZ NOT NULL,
  actual_score                DOUBLE PRECISION,
  residual                    DOUBLE PRECISION,
  resolved_at                 TIMESTAMPTZ,
  UNIQUE (predicted_at, hospital_code, horizon_hours)
);
CREATE INDEX IF NOT EXISTS idx_prediction_log_target_unresolved
  ON prediction_log(target_timestamp) WHERE actual_score IS NULL;
CREATE INDEX IF NOT EXISTS idx_prediction_log_hospital_horizon
  ON prediction_log(hospital_code, horizon_hours, predicted_at DESC);
"""


def get_connection():
    return psycopg2.connect(CONN_STR)


def ensure_table(conn):
    cur = conn.cursor()
    cur.execute(PREDICTION_LOG_DDL)
    conn.commit()
    cur.close()


def load_artifact(conn, key: str):
    cur = conn.cursor()
    cur.execute(
        "SELECT artifact_json, metadata, created_at FROM model_artifacts WHERE artifact_key = %s",
        [key],
    )
    row = cur.fetchone()
    cur.close()
    if not row:
        return None, None, None
    return row[0], row[1], row[2]


def load_models(conn):
    """Return ({horizon: booster}, inference_config, model_trained_at)."""
    cfg, cfg_meta, _ = load_artifact(conn, "inference_config")
    if cfg is None:
        raise RuntimeError("inference_config artifact missing — run weekly_refresh.py first")

    trained_at_str = (cfg_meta or {}).get("trained_at") if isinstance(cfg_meta, dict) else None
    if not trained_at_str:
        raise RuntimeError("inference_config metadata is missing trained_at")
    model_trained_at = datetime.fromisoformat(trained_at_str.replace("Z", "+00:00"))

    boosters = {}
    for horizon in HORIZONS:
        text, _, _ = load_artifact(conn, f"lgbm_{horizon}h_text")
        if text is None:
            print(
                f"  WARNING: lgbm_{horizon}h_text artifact missing. Skipping horizon={horizon}h. "
                "Run a fresh weekly_refresh.py to populate the text-format artifacts."
            )
            continue
        boosters[horizon] = lgb.Booster(model_str=text)

    return boosters, cfg, model_trained_at


def fetch_recent_snapshots(conn) -> pd.DataFrame:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=LOOKBACK_HOURS)
    cur = conn.cursor()
    cur.execute(
        "SELECT * FROM hospital_snapshots WHERE timestamp >= %s ORDER BY hospital_code, timestamp",
        [cutoff],
    )
    cols = [d[0] for d in cur.description]
    rows = cur.fetchall()
    cur.close()
    df = pd.DataFrame(rows, columns=cols)
    if not df.empty:
        df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    return df


def load_hscrc(conn) -> pd.DataFrame:
    data, _, _ = load_artifact(conn, "hscrc_baselines")
    if not data:
        return pd.DataFrame()
    return pd.DataFrame(data)


def predict_pass(conn, boosters, cfg, model_trained_at, snapshots, flu, weather, hscrc):
    """Generate predictions for the most recent row per hospital and store them."""
    if snapshots.empty:
        print("  No recent snapshots — skipping predict pass")
        return 0

    feature_names = cfg["feature_names"]
    label_map = {str(k): int(v) for k, v in cfg["hospital_label_map"].items()}
    clamp_lo, clamp_hi = cfg.get("target_clamp", [1.0, 4.0])

    snapshots = snapshots.copy()
    snapshots["hospital_code"] = snapshots["hospital_code"].astype(str)

    feature_df, _, _ = build_features(
        snapshots, flu, weather, hscrc,
        compute_targets=False, label_map=label_map, verbose=False,
    )
    if feature_df.empty:
        print("  Feature pipeline produced 0 rows — skipping predict pass")
        return 0

    latest_idx = feature_df.groupby("hospital_code")["timestamp"].idxmax()
    latest = feature_df.loc[latest_idx].reset_index(drop=True)

    missing = [c for c in feature_names if c not in latest.columns]
    if missing:
        print(f"  ERROR: feature columns missing from inference frame: {missing}")
        return 0

    X = latest[feature_names]
    predicted_at = datetime.now(timezone.utc)

    inserted = 0
    cur = conn.cursor()
    for horizon, booster in boosters.items():
        try:
            preds = np.clip(booster.predict(X), clamp_lo, clamp_hi)
        except Exception as exc:
            print(f"  ERROR predicting horizon={horizon}h: {exc}")
            traceback.print_exc()
            continue

        target_offset = timedelta(hours=horizon)
        for (_, row), pred in zip(latest.iterrows(), preds):
            try:
                cur.execute(
                    """
                    INSERT INTO prediction_log (
                        predicted_at, target_timestamp, hospital_code, horizon_hours,
                        predicted_score, current_score_at_prediction, model_trained_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (predicted_at, hospital_code, horizon_hours) DO NOTHING
                    """,
                    [
                        predicted_at,
                        predicted_at + target_offset,
                        str(row["hospital_code"]),
                        horizon,
                        float(pred),
                        float(row["ed_census_score"]) if pd.notna(row["ed_census_score"]) else None,
                        model_trained_at,
                    ],
                )
                inserted += cur.rowcount
            except Exception as exc:
                print(f"  WARNING: insert failed for {row['hospital_code']} h={horizon}: {exc}")
                conn.rollback()
                cur = conn.cursor()
    conn.commit()
    cur.close()
    print(f"  Inserted {inserted} prediction rows (horizons={list(boosters.keys())})")
    return inserted


def resolve_pass(conn) -> int:
    """Fill `actual_score` and `residual` for predictions whose target is past."""
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=RESOLUTION_DELAY_MIN)
    cur = conn.cursor()
    cur.execute(
        """
        SELECT id, target_timestamp, hospital_code, predicted_score
        FROM prediction_log
        WHERE actual_score IS NULL AND target_timestamp < %s
        ORDER BY target_timestamp
        LIMIT 5000
        """,
        [cutoff],
    )
    rows = cur.fetchall()
    if not rows:
        cur.close()
        print("  No unresolved predictions to score")
        return 0

    tolerance = timedelta(minutes=ACTUAL_TOLERANCE_MIN)
    resolved = 0
    skipped = 0
    cur_inner = conn.cursor()
    for pred_id, target_ts, hospital_code, pred_score in rows:
        cur_inner.execute(
            """
            SELECT ed_census_score, timestamp
            FROM hospital_snapshots
            WHERE hospital_code = %s
              AND timestamp BETWEEN %s AND %s
              AND ed_census_score IS NOT NULL
            ORDER BY ABS(EXTRACT(EPOCH FROM (timestamp - %s)))
            LIMIT 1
            """,
            [str(hospital_code), target_ts - tolerance, target_ts + tolerance, target_ts],
        )
        match = cur_inner.fetchone()
        if not match:
            skipped += 1
            continue
        actual = float(match[0])
        residual = float(pred_score) - actual
        cur_inner.execute(
            """
            UPDATE prediction_log
            SET actual_score = %s, residual = %s, resolved_at = NOW()
            WHERE id = %s
            """,
            [actual, residual, pred_id],
        )
        resolved += 1
    conn.commit()
    cur_inner.close()
    cur.close()
    print(f"  Resolved {resolved} predictions ({skipped} had no matching snapshot)")
    return resolved


def main():
    print("=" * 60)
    print(f"  REALIZED ACCURACY — {datetime.now(timezone.utc).isoformat()}")
    print("=" * 60)

    conn = get_connection()
    ensure_table(conn)

    print("\n[predict pass]")
    try:
        boosters, cfg, model_trained_at = load_models(conn)
        if not boosters:
            print("  No usable models found — skipping predict pass")
        else:
            snapshots = fetch_recent_snapshots(conn)
            flu, _, _ = load_artifact(conn, "flu_history")
            weather, _, _ = load_artifact(conn, "weather_history")
            hscrc = load_hscrc(conn)
            predict_pass(conn, boosters, cfg, model_trained_at, snapshots, flu, weather, hscrc)
    except Exception as exc:
        print(f"  ERROR in predict pass: {exc}")
        traceback.print_exc()

    print("\n[resolve pass]")
    try:
        resolve_pass(conn)
    except Exception as exc:
        print(f"  ERROR in resolve pass: {exc}")
        traceback.print_exc()

    conn.close()
    print("\nDone.")


if __name__ == "__main__":
    main()
