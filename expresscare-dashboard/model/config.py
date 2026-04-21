"""Centralized pydantic-settings configuration for the ED-wait model pipeline.

Every Python script in ``model/`` (excluding ``model/gravity/``) should read
its paths and secrets from the ``settings`` singleton defined at the bottom
of this module instead of calling ``os.getenv`` or hardcoding paths.

Defaults reproduce the pre-refactor behavior: all relative paths resolve
against the ``expresscare-dashboard/model/`` working directory because every
``model:*`` npm script does ``cd model && ...`` before invoking Python.
"""
from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Typed configuration loaded from ``../.env`` or the process env."""

    model_config = SettingsConfigDict(env_file="../.env", extra="ignore")

    database_url: str | None = None
    """Postgres DSN for Railway DB. Optional so offline scripts (parse_hscrc,
    features, train, export) can import this module without a DB available."""

    hscrc_data_dir: Path = Path("C:/dev/shared/data/hscrc")
    """Primary location for HSCRC Excel files (shared across projects)."""

    hscrc_fallback_dir: Path = Path("../scripts/data/hscrc")
    """Fallback HSCRC directory — the per-project copy under scripts/data/."""

    weather_data_path: Path = Path("../scripts/data/weather-history.json")
    """Open-Meteo weather history JSON produced by ``npm run weather``."""

    flu_data_path: Path = Path("../scripts/data/flu-history.json")
    """CDC / Delphi ILI history JSON produced by ``npm run flu``."""

    model_artifacts_dir: Path = Path("./artifacts")
    """Local output directory for parquet / JSON model artifacts."""


settings = Settings()
