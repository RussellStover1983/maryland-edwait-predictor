"""Feature engineering pipeline for ED census score prediction.

Reads EDAS snapshots, weather, flu, and optional HSCRC baselines.
Produces a feature matrix ready for LightGBM training.
"""

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

ARTIFACTS = Path(__file__).resolve().parent / "artifacts"
SCRIPTS_DATA = Path(__file__).resolve().parent.parent / "scripts" / "data"

# ── Helpers ─────────────────────────────────────────────────────────


def epiweek_from_date(dt):
    """Convert a datetime to CDC epiweek (YYYYWW). Simple ISO-week approximation."""
    iso = dt.isocalendar()
    return iso[0] * 100 + iso[1]


def load_weather() -> pd.DataFrame:
    """Load weather history and return a DataFrame indexed by hourly timestamp."""
    path = SCRIPTS_DATA / "weather-history.json"
    if not path.exists():
        print("WARNING: weather-history.json not found")
        return pd.DataFrame()

    with open(path) as f:
        data = json.load(f)

    hourly = data["hourly"]
    wdf = pd.DataFrame({
        "weather_time": pd.to_datetime(hourly["time"]),
        "temperature_2m": hourly["temperature_2m"],
        "precipitation": hourly["precipitation"],
        "relative_humidity_2m": hourly["relative_humidity_2m"],
    })
    return wdf


def load_flu() -> pd.DataFrame:
    """Load flu/ILI data and return DataFrame with epiweek and ili_rate."""
    path = SCRIPTS_DATA / "flu-history.json"
    if not path.exists():
        print("WARNING: flu-history.json not found")
        return pd.DataFrame()

    with open(path) as f:
        data = json.load(f)

    weeks = data["weeks"]
    fdf = pd.DataFrame(weeks)
    fdf = fdf[["epiweek", "ili"]].rename(columns={"ili": "ili_rate"})
    return fdf


def load_hscrc_baselines() -> pd.DataFrame:
    """Load HSCRC monthly baselines (may be empty)."""
    path = ARTIFACTS / "hscrc_baselines.parquet"
    if not path.exists():
        return pd.DataFrame()
    df = pd.read_parquet(path)
    if len(df) == 0:
        return pd.DataFrame()
    return df


# ── Main pipeline ───────────────────────────────────────────────────


def build_features():
    print("Loading EDAS snapshots...")
    df = pd.read_parquet(ARTIFACTS / "edas_snapshots.parquet")
    print(f"  {len(df):,} rows loaded")

    # Ensure timestamp is datetime UTC, sorted
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    df = df.sort_values(["hospital_code", "timestamp"]).reset_index(drop=True)

    # ── Group 1: Current ED state ───────────────────────────────────
    df["min_stay_minutes"] = df["min_stay_minutes"].fillna(0)
    df["max_stay_minutes"] = df["max_stay_minutes"].fillna(0)
    df["any_alert"] = df[
        ["alert_yellow", "alert_red", "alert_reroute", "alert_code_black", "alert_trauma_bypass"]
    ].max(axis=1)
    df["alert_count"] = df[
        ["alert_yellow", "alert_red", "alert_reroute", "alert_code_black", "alert_trauma_bypass"]
    ].sum(axis=1)

    # ── Group 2: Lag and rolling features ───────────────────────────
    print("Computing lag and rolling features...")

    # Round timestamps to nearest 5 minutes for alignment
    df["ts_round"] = df["timestamp"].dt.round("5min")

    lag_offsets = {
        "census_lag_1h": pd.Timedelta(hours=1),
        "census_lag_2h": pd.Timedelta(hours=2),
        "census_lag_4h": pd.Timedelta(hours=4),
        "census_lag_8h": pd.Timedelta(hours=8),
        "census_lag_24h": pd.Timedelta(hours=24),
    }

    # Build lookup: (hospital_code, rounded_ts) -> ed_census_score
    # Use the most recent value within a group
    lookup = df.groupby(["hospital_code", "ts_round"]).agg(
        census=("ed_census_score", "last"),
        units=("num_units", "last"),
        max_stay=("max_stay_minutes", "last"),
    ).to_dict("index")

    def get_lookup(hcode, ts, field="census"):
        key = (hcode, ts)
        if key in lookup:
            return lookup[key][field]
        # Try +/- 5 min
        for delta in [pd.Timedelta(minutes=5), pd.Timedelta(minutes=-5)]:
            key2 = (hcode, ts + delta)
            if key2 in lookup:
                return lookup[key2][field]
        return np.nan

    # Compute lag features
    for lag_name, offset in lag_offsets.items():
        print(f"  {lag_name}...")
        df[lag_name] = df.apply(
            lambda row: get_lookup(row["hospital_code"], row["ts_round"] - offset), axis=1
        )

    # Rolling features — use a time-based approach
    # For each hospital, set timestamp as index and use rolling windows
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
    # Merge back by index position — align on timestamp
    df = df.set_index("timestamp")
    for col in rolling_df.columns:
        df[col] = rolling_df[col]
    df = df.reset_index()

    # census_change_2h
    df["census_change_2h"] = df["ed_census_score"] - df["census_lag_2h"]

    # Impute missing lag/rolling features with hospital mean
    lag_rolling_cols = list(lag_offsets.keys()) + [
        "census_rolling_3h", "census_rolling_6h", "census_rolling_12h",
        "census_rolling_std_3h", "census_change_2h",
        "units_rolling_3h", "max_stay_rolling_3h",
    ]
    hospital_means = df.groupby("hospital_code")[lag_rolling_cols].transform("mean")
    for col in lag_rolling_cols:
        df[col] = df[col].fillna(hospital_means[col])
    # If still NaN (entire hospital has no data), fill with global mean
    for col in lag_rolling_cols:
        df[col] = df[col].fillna(df[col].mean())

    # ── Group 3: Temporal / calendar ────────────────────────────────
    print("Computing temporal features...")
    hour = df["timestamp"].dt.hour + df["timestamp"].dt.minute / 60.0
    dow = df["timestamp"].dt.dayofweek  # 0=Monday
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
    print("Joining weather data...")
    wdf = load_weather()
    if len(wdf) > 0:
        # Create hourly timestamps in UTC for matching
        wdf["weather_time"] = pd.to_datetime(wdf["weather_time"]).dt.tz_localize("UTC")
        df["weather_hour"] = df["timestamp"].dt.floor("h")
        df = df.merge(
            wdf.rename(columns={"weather_time": "weather_hour"}),
            on="weather_hour", how="left",
        )
        df.drop(columns=["weather_hour"], inplace=True)
    else:
        df["temperature_2m"] = np.nan
        df["precipitation"] = np.nan
        df["relative_humidity_2m"] = np.nan

    # ── Group 5: Flu/ILI (join by epiweek) ──────────────────────────
    print("Joining flu data...")
    fdf = load_flu()
    if len(fdf) > 0:
        df["epiweek"] = df["timestamp"].apply(epiweek_from_date)
        max_flu_ew = int(fdf["epiweek"].max())
        df = df.merge(fdf, on="epiweek", how="left")
        # Staleness indicator: how many weeks beyond the last reported ILI value
        df["ili_weeks_stale"] = (df["epiweek"] - max_flu_ew).clip(lower=0).astype(float)
        # Leave ili_rate as NaN for weeks beyond coverage — LightGBM handles NaN natively
        stale_count = int((df["ili_weeks_stale"] > 0).sum())
        if stale_count > 0:
            print(f"  {stale_count} rows beyond flu data coverage (ili_rate=NaN, ili_weeks_stale>0)")
        df.drop(columns=["epiweek"], inplace=True)
    else:
        df["ili_rate"] = np.nan
        df["ili_weeks_stale"] = np.nan

    # ── Group 6: Hospital identity ──────────────────────────────────
    print("Encoding hospital codes...")
    unique_codes = sorted(df["hospital_code"].unique())
    label_map = {code: i for i, code in enumerate(unique_codes)}
    df["hospital_code_encoded"] = df["hospital_code"].map(label_map)

    # Save label map
    with open(ARTIFACTS / "hospital_label_map.json", "w") as f:
        json.dump(label_map, f, indent=2)

    # ── Group 7: HSCRC baselines (optional) ─────────────────────────
    print("Joining HSCRC baselines...")
    hscrc = load_hscrc_baselines()
    if len(hscrc) > 0:
        df["_month"] = df["timestamp"].dt.month
        df = df.merge(
            hscrc[["hospital_code", "month", "avg_monthly_volume", "avg_monthly_visits",
                    "avg_admit_rate", "seasonal_index", "licensed_beds"]].rename(
                columns={"month": "_month", "avg_monthly_volume": "baseline_monthly_volume",
                         "avg_monthly_visits": "baseline_monthly_visits",
                         "avg_admit_rate": "baseline_admit_rate"}
            ),
            on=["hospital_code", "_month"], how="left",
        )
        df.drop(columns=["_month"], inplace=True)
    else:
        df["baseline_monthly_volume"] = np.nan
        df["baseline_monthly_visits"] = np.nan
        df["baseline_admit_rate"] = np.nan
        df["seasonal_index"] = np.nan
        df["licensed_beds"] = np.nan

    # ── Target variables ────────────────────────────────────────────
    print("Computing target variables...")

    # Build forward-lookup: for each (hospital, rounded_ts), find census score
    # at +1h and +4h (nearest within 10 min)
    targets_1h = []
    targets_4h = []
    tolerance = pd.Timedelta(minutes=10)

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

    # Drop rows without at least one target
    before = len(df)
    df = df.dropna(subset=["target_census_score_1h"]).reset_index(drop=True)
    dropped = before - len(df)
    print(f"  Dropped {dropped:,} rows without 1h target (insufficient future data)")

    # ── Define feature list ─────────────────────────────────────────
    feature_cols = [
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

    # Keep only columns we need
    meta_cols = ["timestamp", "hospital_code", "hospital_name"]
    target_cols = ["target_census_score_1h", "target_census_score_4h"]
    keep_cols = meta_cols + feature_cols + target_cols
    # Only keep columns that exist
    keep_cols = [c for c in keep_cols if c in df.columns]
    df_out = df[keep_cols].copy()

    # Drop temp columns
    for col in ["ts_round"]:
        if col in df_out.columns:
            df_out.drop(columns=[col], inplace=True)

    # Save
    output_path = ARTIFACTS / "feature_matrix.parquet"
    df_out.to_parquet(output_path, index=False)
    print(f"\nSaved feature matrix: {output_path}")

    # Save feature names
    actual_features = [c for c in feature_cols if c in df_out.columns]
    with open(ARTIFACTS / "feature_names.json", "w") as f:
        json.dump(actual_features, f, indent=2)

    # Summary
    print(f"\n--- Summary ---")
    print(f"Total rows:       {len(df_out):,}")
    print(f"Rows dropped:     {dropped:,} (no future target)")
    print(f"Feature count:    {len(actual_features)}")
    print(f"Date range:       {df_out['timestamp'].min()} to {df_out['timestamp'].max()}")
    print(f"\nNull rates in features:")
    for col in actual_features:
        null_pct = df_out[col].isnull().mean()
        if null_pct > 0:
            print(f"  {col}: {null_pct:.1%}")


if __name__ == "__main__":
    build_features()
