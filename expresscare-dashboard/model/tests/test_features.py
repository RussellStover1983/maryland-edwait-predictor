"""Skeleton tests for features.py.

Confirms the module imports cleanly and that the public surface (helpers +
main pipeline entry point) matches expectations. Full end-to-end feature
building is covered by running ``npm run model:features`` against real data
after this harness is wired up.
"""
from __future__ import annotations

import importlib
import inspect


def test_module_imports():
    module = importlib.import_module("features")
    assert hasattr(module, "build_features")
    assert hasattr(module, "load_weather")
    assert hasattr(module, "load_flu")
    assert hasattr(module, "load_hscrc_baselines")
    assert hasattr(module, "epiweek_from_date")


def test_build_features_signature():
    """build_features() is the pipeline entry and takes no arguments."""
    module = importlib.import_module("features")
    sig = inspect.signature(module.build_features)
    assert len(sig.parameters) == 0
