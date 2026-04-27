"""Weekly data refresh + model retrain pipeline.

Designed to run as a Railway cron job. Requires:
- DATABASE_URL env var (Railway Postgres)
- Internet access (Delphi API, Open-Meteo API)
- No file system persistence needed — all artifacts stored in Postgres.
"""

import json
import math
import os
import sys
import traceback
from datetime import datetime, timedelta, timezone
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
import psycopg2
from sklearn.metrics import mean_absolute_error, mean_squared_error

from feature_engineering import (
    FEATURE_COLS as SHARED_FEATURE_COLS,
    build_features as shared_build_features,
    epiweek_from_date as shared_epiweek_from_date,
)

# Try loading .env for local runs; on Railway DATABASE_URL is set directly
try:
    from dotenv import load_dotenv
    ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
    if ENV_PATH.exists():
        load_dotenv(ENV_PATH)
except ImportError:
    pass

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL not set")
    sys.exit(1)

# Strip sslmode param that causes issues with psycopg2
CONN_STR = DATABASE_URL.replace("?sslmode=require", "")

# ── LightGBM hyperparameters (same as train.py) ─────────────────────
PARAMS = {
    "objective": "regression",
    "metric": "mae",
    "learning_rate": 0.05,
    "num_leaves": 63,
    "max_depth": 8,
    "min_child_samples": 50,
    "feature_fraction": 0.8,
    "bagging_fraction": 0.8,
    "bagging_freq": 5,
    "verbose": -1,
    "n_jobs": -1,
}
NUM_ROUNDS = 1000
EARLY_STOPPING = 50

FEATURE_COLS = SHARED_FEATURE_COLS


# ═══════════════════════════════════════════════════════════════════════
# Utility functions
# ═══════════════════════════════════════════════════════════════════════

def sanitize_nans(obj):
    """Replace NaN/Inf floats with null for valid JSON output."""
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    if isinstance(obj, dict):
        return {k: sanitize_nans(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize_nans(v) for v in obj]
    return obj


epiweek_from_date = shared_epiweek_from_date


def get_connection():
    return psycopg2.connect(CONN_STR)


TRAINING_HISTORY_DDL = """
CREATE TABLE IF NOT EXISTS training_history (
  id              SERIAL PRIMARY KEY,
  trained_at      TIMESTAMPTZ NOT NULL,
  trigger         TEXT NOT NULL,
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
"""


def ensure_training_history_table(conn):
    """Idempotently create the training_history table."""
    cur = conn.cursor()
    cur.execute(TRAINING_HISTORY_DDL)
    conn.commit()
    cur.close()


def detect_trigger_source() -> str:
    """Identify whether this run was driven by cron or a manual trigger."""
    explicit = os.getenv("TRIGGER_SOURCE")
    if explicit:
        return explicit
    # Railway sets various RAILWAY_* env vars; the cron-specific flag isn't reliably
    # documented, so we fall back to the deployment ID being present plus an
    # interactive TTY check. A scheduled cron run has no TTY.
    if os.getenv("RAILWAY_DEPLOYMENT_ID") and not sys.stdin.isatty():
        return "cron"
    if not sys.stdin.isatty():
        return "cron"
    return "manual"


def record_training_history(conn, training_meta: dict, trigger: str,
                            duration_seconds: float, hospital_count: int,
                            notes: str = None) -> None:
    """Insert one row into training_history; failures are logged, not fatal."""
    try:
        ensure_training_history_table(conn)

        models = training_meta.get("models", {})
        m1 = models.get("1h", {}) or {}
        m4 = models.get("4h", {}) or {}

        train_range = training_meta.get("train_date_range") or [None, None]
        test_range = training_meta.get("test_date_range") or [None, None]

        cur = conn.cursor()
        cur.execute("""
            INSERT INTO training_history (
                trained_at, trigger, train_rows, test_rows, feature_count,
                mae_1h, rmse_1h, best_iter_1h,
                mae_4h, rmse_4h, best_iter_4h,
                train_date_min, train_date_max, test_date_min, test_date_max,
                hospital_count, duration_seconds, notes
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, [
            training_meta.get("trained_at"),
            trigger,
            int(training_meta.get("train_rows", 0)),
            int(training_meta.get("test_rows", 0)),
            int(training_meta.get("feature_count", 0)),
            m1.get("mae"), m1.get("rmse"), m1.get("best_iteration"),
            m4.get("mae"), m4.get("rmse"), m4.get("best_iteration"),
            train_range[0], train_range[1],
            test_range[0], test_range[1],
            hospital_count,
            duration_seconds,
            notes,
        ])
        conn.commit()
        cur.close()
        print(f"  Logged training_history row (trigger={trigger}, duration={duration_seconds:.1f}s)")
    except Exception as exc:
        print(f"  WARNING: failed to record training_history: {exc}")
        traceback.print_exc()
        try:
            conn.rollback()
        except Exception:
            pass


def store_artifact(conn, key: str, data, metadata: dict = None):
    """Upsert a model artifact into the model_artifacts table."""
    json_str = json.dumps(data)
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO model_artifacts (artifact_key, artifact_json, file_size_bytes, metadata)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (artifact_key) DO UPDATE SET
            artifact_json = EXCLUDED.artifact_json,
            file_size_bytes = EXCLUDED.file_size_bytes,
            metadata = EXCLUDED.metadata,
            created_at = NOW()
    """, [key, json_str, len(json_str), json.dumps(metadata or {})])
    conn.commit()
    cur.close()
    print(f"  Stored artifact '{key}' ({len(json_str):,} bytes)")


def load_artifact(conn, key: str):
    """Load an artifact from Postgres. Returns None if not found."""
    cur = conn.cursor()
    cur.execute("SELECT artifact_json FROM model_artifacts WHERE artifact_key = %s", [key])
    row = cur.fetchone()
    cur.close()
    if row:
        return row[0]
    return None


# ═══════════════════════════════════════════════════════════════════════
# Step A: Fetch flu/ILI data from Delphi API
# ═══════════════════════════════════════════════════════════════════════

def fetch_flu_data() -> dict:
    """Fetch ILI data for HHS Region 3 from Delphi epidata API."""
    import requests

    print("\n" + "=" * 60)
    print("  STEP A: Fetching flu/ILI data from Delphi API")
    print("=" * 60)

    # Compute current epiweek
    now = datetime.now(timezone.utc)
    current_ew = epiweek_from_date(now)

    # Build epiweek range string: 202001-current
    epiweek_range = f"202001-{current_ew}"

    url = "https://api.delphi.cmu.edu/epidata/fluview/"
    params = {
        "regions": "hhs3",
        "epiweeks": epiweek_range,
    }

    print(f"  Requesting epiweeks {epiweek_range} for HHS Region 3...")
    resp = requests.get(url, params=params, timeout=60)
    resp.raise_for_status()
    data = resp.json()

    if data.get("result") != 1:
        print(f"  WARNING: Delphi API returned result={data.get('result')}: {data.get('message', 'unknown')}")
        return None

    epidata = data.get("epidata", [])
    print(f"  Received {len(epidata)} weeks of flu data")

    # Build output matching flu-history.json format
    weeks = []
    for row in epidata:
        ew = row["epiweek"]
        # Approximate epiweek start date (ISO week)
        year = ew // 100
        week = ew % 100
        try:
            ew_start = datetime.strptime(f"{year}-W{week:02d}-1", "%Y-W%W-%w").strftime("%Y-%m-%d")
        except ValueError:
            ew_start = f"{year}-01-01"
        try:
            ew_end_dt = datetime.strptime(f"{year}-W{week:02d}-1", "%Y-W%W-%w") + timedelta(days=6)
            ew_end = ew_end_dt.strftime("%Y-%m-%d")
        except ValueError:
            ew_end = ew_start

        weeks.append({
            "epiweek": ew,
            "epiweek_start": ew_start,
            "epiweek_end": ew_end,
            "wili": row.get("wili"),
            "ili": row.get("ili"),
            "num_ili": row.get("num_ili"),
            "num_patients": row.get("num_patients"),
            "release_date": row.get("release_date"),
        })

    result = {
        "source": "delphi-epidata-fluview",
        "region": "hhs3",
        "fetched_at": now.isoformat(),
        "coverage": {
            "first_epiweek": weeks[0]["epiweek"] if weeks else None,
            "last_epiweek": weeks[-1]["epiweek"] if weeks else None,
            "week_count": len(weeks),
        },
        "weeks": weeks,
    }

    print(f"  Coverage: epiweek {result['coverage']['first_epiweek']} to {result['coverage']['last_epiweek']}")
    return result


# ═══════════════════════════════════════════════════════════════════════
# Step B: Fetch weather data from Open-Meteo
# ═══════════════════════════════════════════════════════════════════════

def fetch_weather_data(start_date: str, end_date: str) -> dict:
    """Fetch hourly weather for Baltimore from Open-Meteo archive API."""
    import requests

    print("\n" + "=" * 60)
    print("  STEP B: Fetching weather data from Open-Meteo")
    print("=" * 60)

    # Use archive API for historical data, forecast API for recent
    # Open-Meteo archive covers up to ~5 days ago; forecast API covers recent + future
    # We'll try archive first, then supplement with forecast for the last few days
    all_times = []
    all_temp = []
    all_precip = []
    all_humidity = []

    # Archive API: up to 5 days ago
    archive_end = (datetime.now(timezone.utc) - timedelta(days=5)).strftime("%Y-%m-%d")
    if start_date < archive_end:
        archive_url = (
            f"https://archive-api.open-meteo.com/v1/archive?"
            f"latitude=39.29&longitude=-76.61"
            f"&hourly=temperature_2m,precipitation,relative_humidity_2m"
            f"&start_date={start_date}&end_date={archive_end}"
            f"&timezone=America/New_York"
        )
        print(f"  Archive API: {start_date} to {archive_end}...")
        resp = requests.get(archive_url, timeout=120)
        resp.raise_for_status()
        archive_data = resp.json()
        hourly = archive_data.get("hourly", {})
        all_times.extend(hourly.get("time", []))
        all_temp.extend(hourly.get("temperature_2m", []))
        all_precip.extend(hourly.get("precipitation", []))
        all_humidity.extend(hourly.get("relative_humidity_2m", []))
        print(f"    Got {len(hourly.get('time', []))} hourly records from archive")

    # Forecast API: last 5 days + today
    forecast_start = archive_end if start_date < archive_end else start_date
    forecast_url = (
        f"https://api.open-meteo.com/v1/forecast?"
        f"latitude=39.29&longitude=-76.61"
        f"&hourly=temperature_2m,precipitation,relative_humidity_2m"
        f"&start_date={forecast_start}&end_date={end_date}"
        f"&timezone=America/New_York"
        f"&past_days=0"
    )
    print(f"  Forecast API: {forecast_start} to {end_date}...")
    resp = requests.get(forecast_url, timeout=60)
    resp.raise_for_status()
    forecast_data = resp.json()
    hourly = forecast_data.get("hourly", {})

    # Deduplicate by only adding times after the archive end
    for i, t in enumerate(hourly.get("time", [])):
        if t not in all_times:
            all_times.append(t)
            all_temp.append(hourly["temperature_2m"][i] if i < len(hourly.get("temperature_2m", [])) else None)
            all_precip.append(hourly["precipitation"][i] if i < len(hourly.get("precipitation", [])) else None)
            all_humidity.append(hourly["relative_humidity_2m"][i] if i < len(hourly.get("relative_humidity_2m", [])) else None)

    print(f"    Total: {len(all_times)} hourly weather records")

    result = {
        "hourly": {
            "time": all_times,
            "temperature_2m": all_temp,
            "precipitation": all_precip,
            "relative_humidity_2m": all_humidity,
        }
    }
    return result


# ═══════════════════════════════════════════════════════════════════════
# Step C: Extract EDAS data from Postgres
# ═══════════════════════════════════════════════════════════════════════

def extract_edas_data(conn) -> pd.DataFrame:
    """Pull all EDAS snapshots from Postgres."""
    print("\n" + "=" * 60)
    print("  STEP C: Extracting EDAS data from Postgres")
    print("=" * 60)

    query = "SELECT * FROM hospital_snapshots ORDER BY hospital_code, timestamp"
    df = pd.read_sql_query(query, conn)
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)

    print(f"  {len(df):,} rows, {df['hospital_code'].nunique()} hospitals")
    print(f"  Date range: {df['timestamp'].min()} to {df['timestamp'].max()}")
    return df


# ═══════════════════════════════════════════════════════════════════════
# Step D: Load HSCRC baselines from Postgres
# ═══════════════════════════════════════════════════════════════════════

def load_hscrc_baselines(conn) -> pd.DataFrame:
    """Load HSCRC baselines from Postgres artifact store."""
    print("\n" + "=" * 60)
    print("  STEP D: Loading HSCRC baselines")
    print("=" * 60)

    data = load_artifact(conn, "hscrc_baselines")
    if data is None:
        print("  WARNING: No hscrc_baselines artifact in Postgres. HSCRC features will be NaN.")
        return pd.DataFrame()

    df = pd.DataFrame(data)
    print(f"  Loaded {len(df)} HSCRC baseline rows")
    return df


# ═══════════════════════════════════════════════════════════════════════
# Step E: Build features (same logic as features.py)
# ═══════════════════════════════════════════════════════════════════════

def build_features(edas_df: pd.DataFrame, flu_data: dict, weather_data: dict,
                   hscrc_df: pd.DataFrame) -> tuple:
    """Training-mode wrapper around the shared feature pipeline."""
    print("\n" + "=" * 60)
    print("  STEP E: Building features")
    print("=" * 60)
    return shared_build_features(
        edas_df, flu_data, weather_data, hscrc_df,
        compute_targets=True, label_map=None, verbose=True,
    )


# ═══════════════════════════════════════════════════════════════════════
# Step F: Train models (same logic as train.py)
# ═══════════════════════════════════════════════════════════════════════

def train_models(df: pd.DataFrame, feature_names: list) -> tuple:
    """Train 1h and 4h LightGBM models. Returns (booster_1h, booster_4h, training_meta)."""
    print("\n" + "=" * 60)
    print("  STEP F: Training LightGBM models")
    print("=" * 60)

    # Time-based split: first 80% train, last 20% test
    df = df.sort_values("timestamp").reset_index(drop=True)
    split_idx = int(len(df) * 0.8)
    train_df = df.iloc[:split_idx]
    test_df = df.iloc[split_idx:]

    print(f"  Train: {len(train_df):,} rows ({train_df['timestamp'].min()} to {train_df['timestamp'].max()})")
    print(f"  Test:  {len(test_df):,} rows ({test_df['timestamp'].min()} to {test_df['timestamp'].max()})")

    X_train = train_df[feature_names]
    X_test = test_df[feature_names]

    training_meta = {
        "train_rows": len(train_df),
        "test_rows": len(test_df),
        "train_date_range": [str(train_df["timestamp"].min()), str(train_df["timestamp"].max())],
        "test_date_range": [str(test_df["timestamp"].min()), str(test_df["timestamp"].max())],
        "feature_names": feature_names,
        "feature_count": len(feature_names),
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "models": {},
    }

    # ── Train 1h model ──────────────────────────────────────────────
    target_1h = "target_census_score_1h"
    mask_1h_train = train_df[target_1h].notna()
    mask_1h_test = test_df[target_1h].notna()

    dtrain_1h = lgb.Dataset(X_train[mask_1h_train], label=train_df.loc[mask_1h_train, target_1h],
                            feature_name=feature_names)
    dtest_1h = lgb.Dataset(X_test[mask_1h_test], label=test_df.loc[mask_1h_test, target_1h],
                           feature_name=feature_names, reference=dtrain_1h)

    print("\n  Training 1h model...")
    booster_1h = lgb.train(
        PARAMS, dtrain_1h,
        num_boost_round=NUM_ROUNDS,
        valid_sets=[dtest_1h],
        valid_names=["test"],
        callbacks=[lgb.early_stopping(EARLY_STOPPING), lgb.log_evaluation(100)],
    )

    preds_1h = np.clip(booster_1h.predict(X_test[mask_1h_test]), 1.0, 4.0)
    mae_1h = mean_absolute_error(test_df.loc[mask_1h_test, target_1h], preds_1h)
    rmse_1h = float(np.sqrt(mean_squared_error(test_df.loc[mask_1h_test, target_1h], preds_1h)))

    fi_1h = dict(zip(feature_names, booster_1h.feature_importance(importance_type="gain").tolist()))

    training_meta["models"]["1h"] = {
        "mae": mae_1h,
        "rmse": rmse_1h,
        "best_iteration": booster_1h.best_iteration,
    }
    print(f"  1h MAE: {mae_1h:.4f}, RMSE: {rmse_1h:.4f}, best_iter: {booster_1h.best_iteration}")

    # ── Train 4h model ──────────────────────────────────────────────
    booster_4h = None
    target_4h = "target_census_score_4h"
    mask_4h_train = train_df[target_4h].notna()
    mask_4h_test = test_df[target_4h].notna()

    if mask_4h_train.sum() > 100 and mask_4h_test.sum() > 100:
        dtrain_4h = lgb.Dataset(X_train[mask_4h_train], label=train_df.loc[mask_4h_train, target_4h],
                                feature_name=feature_names)
        dtest_4h = lgb.Dataset(X_test[mask_4h_test], label=test_df.loc[mask_4h_test, target_4h],
                               feature_name=feature_names, reference=dtrain_4h)

        print("\n  Training 4h model...")
        booster_4h = lgb.train(
            PARAMS, dtrain_4h,
            num_boost_round=NUM_ROUNDS,
            valid_sets=[dtest_4h],
            valid_names=["test"],
            callbacks=[lgb.early_stopping(EARLY_STOPPING), lgb.log_evaluation(100)],
        )

        preds_4h = np.clip(booster_4h.predict(X_test[mask_4h_test]), 1.0, 4.0)
        mae_4h = mean_absolute_error(test_df.loc[mask_4h_test, target_4h], preds_4h)
        rmse_4h = float(np.sqrt(mean_squared_error(test_df.loc[mask_4h_test, target_4h], preds_4h)))

        training_meta["models"]["4h"] = {
            "mae": mae_4h,
            "rmse": rmse_4h,
            "best_iteration": booster_4h.best_iteration,
        }
        print(f"  4h MAE: {mae_4h:.4f}, RMSE: {rmse_4h:.4f}, best_iter: {booster_4h.best_iteration}")
    else:
        print(f"  WARNING: Not enough 4h target data, skipping 4h model")

    return booster_1h, booster_4h, training_meta, fi_1h


# ═══════════════════════════════════════════════════════════════════════
# Step G: Generate hospital baselines
# ═══════════════════════════════════════════════════════════════════════

def generate_baselines(edas_df: pd.DataFrame) -> dict:
    """Generate per-hospital hourly baseline profiles from EDAS data."""
    print("\n" + "=" * 60)
    print("  STEP G: Generating hospital baselines")
    print("=" * 60)

    df = edas_df.copy()
    df["hour"] = df["timestamp"].dt.hour
    baselines_agg = df.groupby(["hospital_code", "hour"])["ed_census_score"].mean().reset_index()

    result = {}
    for hcode in baselines_agg["hospital_code"].unique():
        hosp = baselines_agg[baselines_agg["hospital_code"] == hcode].sort_values("hour")
        profile = [None] * 24
        for _, row in hosp.iterrows():
            profile[int(row["hour"])] = round(row["ed_census_score"], 2)
        mean_val = round(hosp["ed_census_score"].mean(), 2)
        if math.isnan(mean_val):
            mean_val = 2.0
        profile = [v if (v is not None and not math.isnan(v)) else mean_val for v in profile]
        result[str(hcode)] = profile

    print(f"  Generated baselines for {len(result)} hospitals")
    return result


# ═══════════════════════════════════════════════════════════════════════
# Step H: Store all artifacts in Postgres
# ═══════════════════════════════════════════════════════════════════════

def store_all_artifacts(conn, booster_1h, booster_4h, training_meta, label_map,
                        baselines, flu_data, weather_data, fi_1h):
    """Store all model artifacts in Postgres."""
    print("\n" + "=" * 60)
    print("  STEP H: Storing artifacts in Postgres")
    print("=" * 60)

    # 1h model JSON (browser-side inference) + TEXT (Python reload for realized_accuracy)
    model_json_1h = sanitize_nans(booster_1h.dump_model())
    store_artifact(conn, "lgbm_1h", model_json_1h, {"horizon": "1h"})
    store_artifact(conn, "lgbm_1h_text", booster_1h.model_to_string(),
                   {"horizon": "1h", "format": "lightgbm-text"})

    # 4h model JSON + TEXT
    if booster_4h is not None:
        model_json_4h = sanitize_nans(booster_4h.dump_model())
        store_artifact(conn, "lgbm_4h", model_json_4h, {"horizon": "4h"})
        store_artifact(conn, "lgbm_4h_text", booster_4h.model_to_string(),
                       {"horizon": "4h", "format": "lightgbm-text"})

    # Inference config
    inference_config = {
        "feature_names": training_meta.get("feature_names", []),
        "hospital_label_map": label_map,
        "horizons": [1, 4],
        "target_clamp": [1.0, 4.0],
        "trained_date": training_meta.get("train_date_range", ["unknown"])[0][:10],
        "train_samples": training_meta.get("train_rows", 0),
        "test_mae_1h": training_meta.get("models", {}).get("1h", {}).get("mae"),
        "test_mae_4h": training_meta.get("models", {}).get("4h", {}).get("mae"),
    }
    store_artifact(conn, "inference_config", inference_config,
                   {"trained_at": training_meta.get("trained_at")})

    # Hospital baselines
    store_artifact(conn, "hospital_baselines", baselines,
                   {"hospital_count": len(baselines)})

    # Training metadata
    store_artifact(conn, "training_meta", training_meta)

    # Flu data
    if flu_data:
        store_artifact(conn, "flu_history", flu_data,
                       {"week_count": flu_data.get("coverage", {}).get("week_count", 0)})

    # Weather data
    if weather_data:
        hour_count = len(weather_data.get("hourly", {}).get("time", []))
        store_artifact(conn, "weather_history", weather_data,
                       {"hour_count": hour_count})

    print("\n  All artifacts stored successfully.")


# ═══════════════════════════════════════════════════════════════════════
# Main pipeline
# ═══════════════════════════════════════════════════════════════════════

def main():
    start_time = datetime.now(timezone.utc)
    print("=" * 60)
    print(f"  WEEKLY REFRESH PIPELINE — {start_time.strftime('%Y-%m-%d %H:%M:%S UTC')}")
    print("=" * 60)

    conn = get_connection()

    # Step A: Fetch flu data
    flu_data = None
    try:
        flu_data = fetch_flu_data()
    except Exception as e:
        print(f"  ERROR fetching flu data: {e}")
        traceback.print_exc()
        # Try loading stale data from Postgres
        flu_data = load_artifact(conn, "flu_history")
        if flu_data:
            print("  Using cached flu data from Postgres")

    # Step B: Fetch weather data
    weather_data = None
    try:
        # Get earliest EDAS snapshot date
        cur = conn.cursor()
        cur.execute("SELECT MIN(timestamp) FROM hospital_snapshots")
        earliest = cur.fetchone()[0]
        cur.close()

        if earliest:
            start_date = earliest.strftime("%Y-%m-%d")
            end_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            weather_data = fetch_weather_data(start_date, end_date)
        else:
            print("  WARNING: No EDAS snapshots found, skipping weather fetch")
    except Exception as e:
        print(f"  ERROR fetching weather data: {e}")
        traceback.print_exc()
        weather_data = load_artifact(conn, "weather_history")
        if weather_data:
            print("  Using cached weather data from Postgres")

    # Step C: Extract EDAS data
    try:
        edas_df = extract_edas_data(conn)
    except Exception as e:
        print(f"  FATAL: Cannot extract EDAS data: {e}")
        traceback.print_exc()
        conn.close()
        sys.exit(1)

    if len(edas_df) < 100:
        print(f"  FATAL: Only {len(edas_df)} EDAS rows — not enough to train")
        conn.close()
        sys.exit(1)

    # Step D: Load HSCRC baselines
    hscrc_df = load_hscrc_baselines(conn)

    # Step E: Build features
    try:
        feature_df, feature_names, label_map = build_features(edas_df, flu_data, weather_data, hscrc_df)
    except Exception as e:
        print(f"  FATAL: Feature engineering failed: {e}")
        traceback.print_exc()
        conn.close()
        sys.exit(1)

    # Step F: Train models
    try:
        booster_1h, booster_4h, training_meta, fi_1h = train_models(feature_df, feature_names)
    except Exception as e:
        print(f"  FATAL: Model training failed: {e}")
        traceback.print_exc()
        conn.close()
        sys.exit(1)

    # Step G: Generate baselines
    baselines = generate_baselines(edas_df)

    # Step H: Store all artifacts
    try:
        store_all_artifacts(conn, booster_1h, booster_4h, training_meta,
                            label_map, baselines, flu_data, weather_data, fi_1h)
    except Exception as e:
        print(f"  ERROR storing artifacts: {e}")
        traceback.print_exc()

    elapsed = (datetime.now(timezone.utc) - start_time).total_seconds()

    # Step I: Record run in training_history (append-only, never blocks the pipeline)
    record_training_history(
        conn,
        training_meta=training_meta,
        trigger=detect_trigger_source(),
        duration_seconds=elapsed,
        hospital_count=len(baselines),
    )

    conn.close()

    # ── Summary ─────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("  PIPELINE COMPLETE")
    print("=" * 60)
    print(f"  Duration: {elapsed:.1f}s")
    print(f"  Training rows: {training_meta.get('train_rows', 0):,}")
    print(f"  Test rows: {training_meta.get('test_rows', 0):,}")
    if "1h" in training_meta.get("models", {}):
        print(f"  1h MAE: {training_meta['models']['1h']['mae']:.4f}")
    if "4h" in training_meta.get("models", {}):
        print(f"  4h MAE: {training_meta['models']['4h']['mae']:.4f}")
    if flu_data:
        print(f"  Flu coverage: {flu_data.get('coverage', {}).get('week_count', 0)} weeks")
    if weather_data:
        print(f"  Weather hours: {len(weather_data.get('hourly', {}).get('time', []))}")
    print(f"  Hospitals: {len(baselines)}")


if __name__ == "__main__":
    main()
