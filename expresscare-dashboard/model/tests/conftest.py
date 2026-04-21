"""Pytest fixtures for the ED-wait model test suite.

These fixtures build small, valid (or intentionally invalid) DataFrames so
tests can exercise validation + feature logic without touching real HSCRC /
EDAS / weather files.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
import pytest

# Make the model package importable (tests live one directory below the module).
MODEL_DIR = Path(__file__).resolve().parent.parent
if str(MODEL_DIR) not in sys.path:
    sys.path.insert(0, str(MODEL_DIR))


@pytest.fixture
def sample_hscrc_df() -> pd.DataFrame:
    """Minimal valid HSCRC frame: 3 rows, schema-required columns populated."""
    return pd.DataFrame(
        {
            "HOSP_NUM": [12, 40, 2],
            "REPORT_DATE": pd.to_datetime(
                ["2024-01-01", "2024-02-01", "2024-03-01"]
            ),
            "CODE": ["EMG", "EMG", "EMG"],
            "VOL_IN": [100.0, 150.0, 200.0],
            "VOL_OUT": [800.0, 900.0, 1000.0],
            "CNTR_BED": [300, 400, 600],
        }
    )


@pytest.fixture
def sample_edas_snapshot_df() -> pd.DataFrame:
    """Minimal valid EDAS snapshot frame: 5 rows across hospitals/timestamps."""
    ts = pd.to_datetime(
        [
            "2026-01-01T00:00:00Z",
            "2026-01-01T00:05:00Z",
            "2026-01-01T00:10:00Z",
            "2026-01-01T00:15:00Z",
            "2026-01-01T00:20:00Z",
        ],
        utc=True,
    )
    return pd.DataFrame(
        {
            "hospital_code": ["210", "210", "204", "215", "212"],
            "ed_census_score": [1, 2, 3, 4, 2],
            "lat": [39.35, 39.35, 39.29, 39.29, 39.27],
            "lon": [-76.65, -76.65, -76.59, -76.62, -76.65],
            "timestamp": ts,
        }
    )


@pytest.fixture
def sample_weather_df() -> pd.DataFrame:
    """Minimal valid weather frame: 24 hourly rows, temperatures in range."""
    start = pd.Timestamp("2026-01-01 00:00:00")
    return pd.DataFrame(
        {
            "timestamp": [start + pd.Timedelta(hours=h) for h in range(24)],
            "temperature": [32.0 + h for h in range(24)],
        }
    )


@pytest.fixture
def invalid_hscrc_df() -> pd.DataFrame:
    """HSCRC frame with a negative volume row — must fail validation."""
    return pd.DataFrame(
        {
            "HOSP_NUM": [12, 40, 2],
            "REPORT_DATE": pd.to_datetime(
                ["2024-01-01", "2024-02-01", "2024-03-01"]
            ),
            "CODE": ["EMG", "EMG", "EMG"],
            "VOL_IN": [100.0, -5.0, 200.0],  # <-- negative — invalid
            "VOL_OUT": [800.0, 900.0, 1000.0],
            "CNTR_BED": [300, 400, 600],
        }
    )
