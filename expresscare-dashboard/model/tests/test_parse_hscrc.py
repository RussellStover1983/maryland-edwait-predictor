"""Skeleton tests for parse_hscrc.

These do not exercise the full Excel-reading pipeline (no fixture .xlsx
files are checked in). They confirm the module imports cleanly and that the
HSCRC-to-EDAS mapping + expected output schema are well-formed.
"""
from __future__ import annotations

import importlib


def test_module_imports():
    """parse_hscrc should import without side effects."""
    module = importlib.import_module("parse_hscrc")
    assert hasattr(module, "main")
    assert hasattr(module, "parse_single_file")
    assert hasattr(module, "find_header_row")


def test_hscrc_to_edas_mapping_shape():
    module = importlib.import_module("parse_hscrc")
    mapping = module.HSCRC_TO_EDAS
    assert isinstance(mapping, dict)
    assert len(mapping) > 0
    # Keys are HSCRC hospital numbers (ints), values are EDAS codes (strings).
    assert all(isinstance(k, int) for k in mapping.keys())
    assert all(isinstance(v, str) for v in mapping.values())


def test_expected_baseline_columns():
    """The BASELINES_COLS contract is what downstream features.py relies on."""
    module = importlib.import_module("parse_hscrc")
    expected = {
        "hospital_code",
        "month",
        "avg_monthly_volume",
        "avg_monthly_visits",
        "avg_outpatient_volume",
        "avg_admit_rate",
        "seasonal_index",
        "licensed_beds",
    }
    assert set(module.BASELINES_COLS) == expected
