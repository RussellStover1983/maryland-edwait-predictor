"""Tests for the pandera-based input validators."""
from __future__ import annotations

import pandas as pd
import pandera as pa
import pytest

from validate_inputs import (
    validate_edas_snapshots,
    validate_hscrc_df,
    validate_weather_df,
)


# ── HSCRC ───────────────────────────────────────────────────────────


def test_validate_hscrc_happy_path(sample_hscrc_df):
    validated = validate_hscrc_df(sample_hscrc_df)
    assert len(validated) == len(sample_hscrc_df)
    assert set(
        ["HOSP_NUM", "REPORT_DATE", "VOL_IN", "VOL_OUT"]
    ).issubset(validated.columns)


def test_validate_hscrc_rejects_negative_volume(invalid_hscrc_df):
    with pytest.raises((pa.errors.SchemaError, pa.errors.SchemaErrors)):
        validate_hscrc_df(invalid_hscrc_df)


def test_validate_hscrc_rejects_missing_column(sample_hscrc_df):
    bad = sample_hscrc_df.drop(columns=["VOL_IN"])
    with pytest.raises((pa.errors.SchemaError, pa.errors.SchemaErrors)):
        validate_hscrc_df(bad)


# ── EDAS ────────────────────────────────────────────────────────────


def test_validate_edas_happy_path(sample_edas_snapshot_df):
    validated = validate_edas_snapshots(sample_edas_snapshot_df)
    assert len(validated) == len(sample_edas_snapshot_df)


def test_validate_edas_rejects_out_of_range_census(sample_edas_snapshot_df):
    bad = sample_edas_snapshot_df.copy()
    bad.loc[0, "ed_census_score"] = 7  # outside {1,2,3,4}
    with pytest.raises((pa.errors.SchemaError, pa.errors.SchemaErrors)):
        validate_edas_snapshots(bad)


def test_validate_edas_rejects_out_of_bounds_coord(sample_edas_snapshot_df):
    bad = sample_edas_snapshot_df.copy()
    bad.loc[0, "lat"] = 10.0  # far outside Maryland
    with pytest.raises((pa.errors.SchemaError, pa.errors.SchemaErrors)):
        validate_edas_snapshots(bad)


def test_validate_edas_rejects_missing_column(sample_edas_snapshot_df):
    bad = sample_edas_snapshot_df.drop(columns=["hospital_code"])
    with pytest.raises((pa.errors.SchemaError, pa.errors.SchemaErrors)):
        validate_edas_snapshots(bad)


# ── Weather ─────────────────────────────────────────────────────────


def test_validate_weather_happy_path(sample_weather_df):
    validated = validate_weather_df(sample_weather_df)
    assert len(validated) == len(sample_weather_df)


def test_validate_weather_rejects_out_of_range_temp(sample_weather_df):
    bad = sample_weather_df.copy()
    bad.loc[0, "temperature"] = 500.0  # way above 115 degF
    with pytest.raises((pa.errors.SchemaError, pa.errors.SchemaErrors)):
        validate_weather_df(bad)


def test_validate_weather_rejects_hourly_gap(sample_weather_df):
    bad = sample_weather_df.drop(index=5).reset_index(drop=True)
    with pytest.raises((pa.errors.SchemaError, pa.errors.SchemaErrors)):
        validate_weather_df(bad)


def test_validate_weather_rejects_missing_column(sample_weather_df):
    bad = sample_weather_df.drop(columns=["temperature"])
    with pytest.raises((pa.errors.SchemaError, pa.errors.SchemaErrors)):
        validate_weather_df(bad)
