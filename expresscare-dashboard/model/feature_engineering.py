"""Shared feature-engineering primitives used by both training (`weekly_refresh.py`)
and live prediction (`realized_accuracy.py`).

This module owns the *computational* feature pipeline. It does NOT own data fetching
(EDAS/weather/flu/HSCRC come from the caller), and it does NOT own model fitting.

The single public entry point is `build_features`. Pass `compute_targets=False`
when scoring (rather than training) so target columns are not required and rows
without a future observation are not dropped.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Optional

import numpy as np
import pandas as pd


# ── Canonical feature list (must stay in sync with whatever the model expects) ──
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


def epiweek_from_date(dt: datetime) -> int:
    """Convert a datetime to CDC epiweek (YYYYWW). Simple ISO-week approximation."""
    iso = dt.isocalendar()
    return iso[0] * 100 + iso[1]


def _print(msg: str, verbose: bool):
    if verbose:
        print(msg)


def build_features(
    edas_df: pd.DataFrame,
    flu_data: Optional[dict],
    weather_data: Optional[dict],
    hscrc_df: Optional[pd.DataFrame],
    *,
    compute_targets: bool = True,
    label_map: Optional[dict] = None,
    verbose: bool = True,
) -> tuple[pd.DataFrame, list, dict]:
    """Run the feature engineering pipeline.

    Args:
        edas_df: hospital snapshots, already pulled from Postgres.
        flu_data: dict in `flu_history` artifact format, or None.
        weather_data: dict in `weather_history` artifact format, or None.
        hscrc_df: optional HSCRC baselines DataFrame.
        compute_targets: if True, add target_census_score_{1h,4h} columns and
            drop rows without a 1h target. Set False at inference time.
        label_map: optional pre-built {hospital_code: int} mapping. When provided
            (e.g. loaded from inference_config) it is used as-is; missing
            hospitals receive -1 so the caller can decide how to handle them.
        verbose: print progress.

    Returns:
        (feature_df, feature_names, label_map)
    """
    df = edas_df.copy()
    df = df.sort_values(["hospital_code", "timestamp"]).reset_index(drop=True)

    # ── Group 1: Current ED state ───────────────────────────────────────
    df["min_stay_minutes"] = df["min_stay_minutes"].fillna(0)
    df["max_stay_minutes"] = df["max_stay_minutes"].fillna(0)

    alert_cols = ["alert_yellow", "alert_red", "alert_reroute",
                  "alert_code_black", "alert_trauma_bypass"]
    existing_alert_cols = [c for c in alert_cols if c in df.columns]
    if existing_alert_cols:
        df["any_alert"] = df[existing_alert_cols].max(axis=1)
        df["alert_count"] = df[existing_alert_cols].sum(axis=1)
    else:
        df["any_alert"] = 0
        df["alert_count"] = 0

    # ── Group 2: Lag and rolling features ───────────────────────────────
    _print("  Computing lag and rolling features...", verbose)
    df["ts_round"] = df["timestamp"].dt.round("5min")

    lag_offsets = {
        "census_lag_1h": pd.Timedelta(hours=1),
        "census_lag_2h": pd.Timedelta(hours=2),
        "census_lag_4h": pd.Timedelta(hours=4),
        "census_lag_8h": pd.Timedelta(hours=8),
        "census_lag_24h": pd.Timedelta(hours=24),
    }

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

    _print("  Rolling features (3h, 6h, 12h)...", verbose)
    rolling_results = []
    for _, group in df.groupby("hospital_code"):
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

    # ── Group 3: Temporal / calendar ────────────────────────────────────
    _print("  Computing temporal features...", verbose)
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

    # ── Group 4: Weather (join by nearest hour) ─────────────────────────
    _print("  Joining weather data...", verbose)
    if weather_data and "hourly" in weather_data and len(weather_data["hourly"].get("time", [])) > 0:
        hourly = weather_data["hourly"]
        wdf = pd.DataFrame({
            "weather_hour": pd.to_datetime(hourly["time"]).tz_localize(
                "America/New_York", ambiguous="NaT", nonexistent="shift_forward"
            ).tz_convert("UTC"),
            "temperature_2m": hourly["temperature_2m"],
            "precipitation": hourly["precipitation"],
            "relative_humidity_2m": hourly["relative_humidity_2m"],
        })
        wdf = wdf.dropna(subset=["weather_hour"])
        df["weather_hour"] = df["timestamp"].dt.floor("h")
        df = df.merge(wdf, on="weather_hour", how="left")
        df.drop(columns=["weather_hour"], inplace=True)
        _print(f"    Matched {df['temperature_2m'].notna().sum():,} / {len(df):,} rows with weather", verbose)
    else:
        df["temperature_2m"] = np.nan
        df["precipitation"] = np.nan
        df["relative_humidity_2m"] = np.nan
        _print("    No weather data available", verbose)

    # ── Group 5: Flu/ILI (join by epiweek) ──────────────────────────────
    _print("  Joining flu data...", verbose)
    if flu_data and "weeks" in flu_data and len(flu_data["weeks"]) > 0:
        fdf = pd.DataFrame(flu_data["weeks"])
        fdf = fdf[["epiweek", "ili"]].rename(columns={"ili": "ili_rate"})
        df["epiweek"] = df["timestamp"].apply(epiweek_from_date)
        max_flu_ew = int(fdf["epiweek"].max())
        df = df.merge(fdf, on="epiweek", how="left")
        df["ili_weeks_stale"] = (df["epiweek"] - max_flu_ew).clip(lower=0).astype(float)
        df.drop(columns=["epiweek"], inplace=True)
    else:
        df["ili_rate"] = np.nan
        df["ili_weeks_stale"] = np.nan
        _print("    No flu data available", verbose)

    # ── Group 6: Hospital identity ──────────────────────────────────────
    _print("  Encoding hospital codes...", verbose)
    if label_map is None:
        unique_codes = sorted(df["hospital_code"].unique())
        label_map = {code: i for i, code in enumerate(unique_codes)}
    df["hospital_code_encoded"] = df["hospital_code"].map(label_map).fillna(-1).astype(int)

    # ── Group 7: HSCRC baselines (optional) ─────────────────────────────
    _print("  Joining HSCRC baselines...", verbose)
    if hscrc_df is not None and len(hscrc_df) > 0:
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

    # ── Targets (only when training) ────────────────────────────────────
    if compute_targets:
        _print("  Computing target variables...", verbose)
        targets_1h = []
        targets_4h = []
        deltas = [pd.Timedelta(0), pd.Timedelta(minutes=5), pd.Timedelta(minutes=-5),
                  pd.Timedelta(minutes=10), pd.Timedelta(minutes=-10)]

        for _, row in df.iterrows():
            hcode = row["hospital_code"]
            ts = row["ts_round"]

            target_ts_1h = ts + pd.Timedelta(hours=1)
            val_1h = np.nan
            for delta in deltas:
                key = (hcode, target_ts_1h + delta)
                if key in lookup:
                    val_1h = lookup[key]["census"]
                    break
            targets_1h.append(val_1h)

            target_ts_4h = ts + pd.Timedelta(hours=4)
            val_4h = np.nan
            for delta in deltas:
                key = (hcode, target_ts_4h + delta)
                if key in lookup:
                    val_4h = lookup[key]["census"]
                    break
            targets_4h.append(val_4h)

        df["target_census_score_1h"] = targets_1h
        df["target_census_score_4h"] = targets_4h

        before = len(df)
        df = df.dropna(subset=["target_census_score_1h"]).reset_index(drop=True)
        _print(f"  Dropped {before - len(df):,} rows without 1h target", verbose)

    df.drop(columns=["ts_round"], inplace=True, errors="ignore")

    actual_features = [c for c in FEATURE_COLS if c in df.columns]
    _print(f"\n  Feature matrix: {len(df):,} rows x {len(actual_features)} features", verbose)
    if len(df) > 0:
        _print(f"  Date range: {df['timestamp'].min()} to {df['timestamp'].max()}", verbose)

    return df, actual_features, label_map
