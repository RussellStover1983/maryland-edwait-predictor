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

FEATURE_COLS = [
    # Group 1: Current ED state
    "ed_census_score", "num_units", "num_units_enroute",
    "min_stay_minutes", "max_stay_minutes", "any_alert", "alert_count",
    # Group 2: Lag features
    "census_lag_1h", "census_lag_2h", "census_lag_4h", "census_lag_8h", "census_lag_24h",
    "census_rolling_3h", "census_rolling_6h", "census_rolling_12h",
    "census_rolling_std_3h", "census_change_2h",
    "units_rolling_3h", "max_stay_rolling_3h",
    # Group 3: Temporal
    "hour_sin", "hour_cos", "dow_sin", "dow_cos", "month_sin", "month_cos",
    "is_weekend", "hour_linear",
    # Group 4: Weather
    "temperature_2m", "precipitation", "relative_humidity_2m",
    # Group 5: Flu
    "ili_rate", "ili_weeks_stale",
    # Group 6: Hospital identity
    "hospital_code_encoded",
    # Group 7: HSCRC baselines
    "baseline_monthly_volume", "baseline_monthly_visits",
    "baseline_admit_rate", "seasonal_index", "licensed_beds",
]


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


def epiweek_from_date(dt):
    """Convert a datetime to CDC epiweek (YYYYWW). Simple ISO-week approximation."""
    iso = dt.isocalendar()
    return iso[0] * 100 + iso[1]


def get_connection():
    return psycopg2.connect(CONN_STR)


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
                   hscrc_df: pd.DataFrame) -> pd.DataFrame:
    """Feature engineering pipeline — same as features.py but from in-memory data."""
    print("\n" + "=" * 60)
    print("  STEP E: Building features")
    print("=" * 60)

    df = edas_df.copy()
    df = df.sort_values(["hospital_code", "timestamp"]).reset_index(drop=True)

    # ── Group 1: Current ED state ───────────────────────────────────
    df["min_stay_minutes"] = df["min_stay_minutes"].fillna(0)
    df["max_stay_minutes"] = df["max_stay_minutes"].fillna(0)

    alert_cols = ["alert_yellow", "alert_red", "alert_reroute", "alert_code_black", "alert_trauma_bypass"]
    existing_alert_cols = [c for c in alert_cols if c in df.columns]
    if existing_alert_cols:
        df["any_alert"] = df[existing_alert_cols].max(axis=1)
        df["alert_count"] = df[existing_alert_cols].sum(axis=1)
    else:
        df["any_alert"] = 0
        df["alert_count"] = 0

    # ── Group 2: Lag and rolling features ───────────────────────────
    print("  Computing lag and rolling features...")
    df["ts_round"] = df["timestamp"].dt.round("5min")

    lag_offsets = {
        "census_lag_1h": pd.Timedelta(hours=1),
        "census_lag_2h": pd.Timedelta(hours=2),
        "census_lag_4h": pd.Timedelta(hours=4),
        "census_lag_8h": pd.Timedelta(hours=8),
        "census_lag_24h": pd.Timedelta(hours=24),
    }

    # Build lookup: (hospital_code, rounded_ts) -> values
    lookup = df.groupby(["hospital_code", "ts_round"]).agg(
        census=("ed_census_score", "last"),
        units=("num_units", "last"),
        max_stay=("max_stay_minutes", "last"),
    ).to_dict("index")

    def get_lookup(hcode, ts, field="census"):
        key = (hcode, ts)
        if key in lookup:
            return lookup[key][field]
        for delta in [pd.Timedelta(minutes=5), pd.Timedelta(minutes=-5)]:
            key2 = (hcode, ts + delta)
            if key2 in lookup:
                return lookup[key2][field]
        return np.nan

    for lag_name, offset in lag_offsets.items():
        df[lag_name] = df.apply(
            lambda row, _ln=lag_name, _off=offset: get_lookup(
                row["hospital_code"], row["ts_round"] - _off
            ), axis=1
        )

    # Rolling features
    print("  Rolling features (3h, 6h, 12h)...")
    rolling_results = []
    for hcode, group in df.groupby("hospital_code"):
        g = group.set_index("timestamp").sort_index()
        census = g["ed_census_score"]
        units = g["num_units"]
        max_stay = g["max_stay_minutes"]

        result = pd.DataFrame(index=g.index)
        result["census_rolling_3h"] = census.rolling("3h", min_periods=1).mean()
        result["census_rolling_6h"] = census.rolling("6h", min_periods=1).mean()
        result["census_rolling_12h"] = census.rolling("12h", min_periods=1).mean()
        result["census_rolling_std_3h"] = census.rolling("3h", min_periods=2).std()
        result["units_rolling_3h"] = units.rolling("3h", min_periods=1).mean()
        result["max_stay_rolling_3h"] = max_stay.rolling("3h", min_periods=1).mean()
        rolling_results.append(result)

    rolling_df = pd.concat(rolling_results)
    df = df.set_index("timestamp")
    for col in rolling_df.columns:
        df[col] = rolling_df[col]
    df = df.reset_index()

    df["census_change_2h"] = df["ed_census_score"] - df["census_lag_2h"]

    # Impute missing lag/rolling features
    lag_rolling_cols = list(lag_offsets.keys()) + [
        "census_rolling_3h", "census_rolling_6h", "census_rolling_12h",
        "census_rolling_std_3h", "census_change_2h",
        "units_rolling_3h", "max_stay_rolling_3h",
    ]
    hospital_means = df.groupby("hospital_code")[lag_rolling_cols].transform("mean")
    for col in lag_rolling_cols:
        df[col] = df[col].fillna(hospital_means[col])
    for col in lag_rolling_cols:
        df[col] = df[col].fillna(df[col].mean())

    # ── Group 3: Temporal / calendar ────────────────────────────────
    print("  Computing temporal features...")
    hour = df["timestamp"].dt.hour + df["timestamp"].dt.minute / 60.0
    dow = df["timestamp"].dt.dayofweek
    month = df["timestamp"].dt.month

    df["hour_sin"] = np.sin(2 * math.pi * hour / 24)
    df["hour_cos"] = np.cos(2 * math.pi * hour / 24)
    df["dow_sin"] = np.sin(2 * math.pi * dow / 7)
    df["dow_cos"] = np.cos(2 * math.pi * dow / 7)
    df["month_sin"] = np.sin(2 * math.pi * month / 12)
    df["month_cos"] = np.cos(2 * math.pi * month / 12)
    df["is_weekend"] = (dow >= 5).astype(int)
    df["hour_linear"] = df["timestamp"].dt.hour

    # ── Group 4: Weather (join by nearest hour) ─────────────────────
    print("  Joining weather data...")
    if weather_data and "hourly" in weather_data and len(weather_data["hourly"].get("time", [])) > 0:
        hourly = weather_data["hourly"]
        wdf = pd.DataFrame({
            "weather_hour": pd.to_datetime(hourly["time"]).tz_localize("America/New_York", ambiguous="NaT", nonexistent="shift_forward").tz_convert("UTC"),
            "temperature_2m": hourly["temperature_2m"],
            "precipitation": hourly["precipitation"],
            "relative_humidity_2m": hourly["relative_humidity_2m"],
        })
        # Drop any rows with NaT from ambiguous DST
        wdf = wdf.dropna(subset=["weather_hour"])
        df["weather_hour"] = df["timestamp"].dt.floor("h")
        df = df.merge(wdf, on="weather_hour", how="left")
        df.drop(columns=["weather_hour"], inplace=True)
        print(f"    Matched {df['temperature_2m'].notna().sum():,} / {len(df):,} rows with weather")
    else:
        df["temperature_2m"] = np.nan
        df["precipitation"] = np.nan
        df["relative_humidity_2m"] = np.nan
        print("    No weather data available")

    # ── Group 5: Flu/ILI (join by epiweek) ──────────────────────────
    print("  Joining flu data...")
    if flu_data and "weeks" in flu_data and len(flu_data["weeks"]) > 0:
        fdf = pd.DataFrame(flu_data["weeks"])
        fdf = fdf[["epiweek", "ili"]].rename(columns={"ili": "ili_rate"})
        df["epiweek"] = df["timestamp"].apply(epiweek_from_date)
        max_flu_ew = int(fdf["epiweek"].max())
        df = df.merge(fdf, on="epiweek", how="left")
        df["ili_weeks_stale"] = (df["epiweek"] - max_flu_ew).clip(lower=0).astype(float)
        stale_count = int((df["ili_weeks_stale"] > 0).sum())
        if stale_count > 0:
            print(f"    {stale_count} rows beyond flu data coverage")
        df.drop(columns=["epiweek"], inplace=True)
    else:
        df["ili_rate"] = np.nan
        df["ili_weeks_stale"] = np.nan
        print("    No flu data available")

    # ── Group 6: Hospital identity ──────────────────────────────────
    print("  Encoding hospital codes...")
    unique_codes = sorted(df["hospital_code"].unique())
    label_map = {code: i for i, code in enumerate(unique_codes)}
    df["hospital_code_encoded"] = df["hospital_code"].map(label_map)

    # ── Group 7: HSCRC baselines (optional) ─────────────────────────
    print("  Joining HSCRC baselines...")
    if len(hscrc_df) > 0:
        df["_month"] = df["timestamp"].dt.month
        merge_cols = ["hospital_code", "month", "avg_monthly_volume", "avg_monthly_visits",
                      "avg_admit_rate", "seasonal_index", "licensed_beds"]
        available_cols = [c for c in merge_cols if c in hscrc_df.columns]
        if "month" in available_cols:
            hscrc_merge = hscrc_df[available_cols].rename(
                columns={
                    "month": "_month",
                    "avg_monthly_volume": "baseline_monthly_volume",
                    "avg_monthly_visits": "baseline_monthly_visits",
                    "avg_admit_rate": "baseline_admit_rate",
                }
            )
            df = df.merge(hscrc_merge, on=["hospital_code", "_month"], how="left")
        df.drop(columns=["_month"], inplace=True, errors="ignore")

    for col in ["baseline_monthly_volume", "baseline_monthly_visits",
                "baseline_admit_rate", "seasonal_index", "licensed_beds"]:
        if col not in df.columns:
            df[col] = np.nan

    # ── Target variables ────────────────────────────────────────────
    print("  Computing target variables...")
    targets_1h = []
    targets_4h = []

    for _, row in df.iterrows():
        hcode = row["hospital_code"]
        ts = row["ts_round"]

        # 1h target
        target_ts_1h = ts + pd.Timedelta(hours=1)
        val_1h = np.nan
        for delta in [pd.Timedelta(0), pd.Timedelta(minutes=5), pd.Timedelta(minutes=-5),
                      pd.Timedelta(minutes=10), pd.Timedelta(minutes=-10)]:
            key = (hcode, target_ts_1h + delta)
            if key in lookup:
                val_1h = lookup[key]["census"]
                break
        targets_1h.append(val_1h)

        # 4h target
        target_ts_4h = ts + pd.Timedelta(hours=4)
        val_4h = np.nan
        for delta in [pd.Timedelta(0), pd.Timedelta(minutes=5), pd.Timedelta(minutes=-5),
                      pd.Timedelta(minutes=10), pd.Timedelta(minutes=-10)]:
            key = (hcode, target_ts_4h + delta)
            if key in lookup:
                val_4h = lookup[key]["census"]
                break
        targets_4h.append(val_4h)

    df["target_census_score_1h"] = targets_1h
    df["target_census_score_4h"] = targets_4h

    before = len(df)
    df = df.dropna(subset=["target_census_score_1h"]).reset_index(drop=True)
    dropped = before - len(df)
    print(f"  Dropped {dropped:,} rows without 1h target")

    # Clean up temp columns
    df.drop(columns=["ts_round"], inplace=True, errors="ignore")

    # Only keep features that exist
    actual_features = [c for c in FEATURE_COLS if c in df.columns]

    print(f"\n  Feature matrix: {len(df):,} rows x {len(actual_features)} features")
    print(f"  Date range: {df['timestamp'].min()} to {df['timestamp'].max()}")

    return df, actual_features, label_map


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

    # 1h model JSON
    model_json_1h = sanitize_nans(booster_1h.dump_model())
    store_artifact(conn, "lgbm_1h", model_json_1h, {"horizon": "1h"})

    # 4h model JSON
    if booster_4h is not None:
        model_json_4h = sanitize_nans(booster_4h.dump_model())
        store_artifact(conn, "lgbm_4h", model_json_4h, {"horizon": "4h"})

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

    conn.close()

    # ── Summary ─────────────────────────────────────────────────────
    elapsed = (datetime.now(timezone.utc) - start_time).total_seconds()
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
