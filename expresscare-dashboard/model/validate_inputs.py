"""Pandera-based schema validation for ED-wait model pipeline inputs.

Each validator raises ``pandera.errors.SchemaError`` / ``SchemaErrors`` on
failure so that bad data surfaces immediately rather than being silently
filtered. Returns the validated DataFrame (with coercion applied where the
schema allows it) on success.
"""
from __future__ import annotations

import pandas as pd
import pandera as pa
from pandera import Check, Column, DataFrameSchema


# ── HSCRC ───────────────────────────────────────────────────────────

HSCRC_SCHEMA = DataFrameSchema(
    {
        "HOSP_NUM": Column(
            pa.Int,
            nullable=False,
            coerce=True,
            description="HSCRC hospital number",
        ),
        "REPORT_DATE": Column(
            "datetime64[ns]",
            nullable=False,
            coerce=True,
            description="Reporting period — parseable as date",
        ),
        "VOL_IN": Column(
            pa.Float,
            checks=Check.ge(0, error="VOL_IN must be non-negative"),
            nullable=True,
            coerce=True,
            description="Inpatient ED volume (non-negative)",
        ),
        "VOL_OUT": Column(
            pa.Float,
            checks=Check.ge(0, error="VOL_OUT must be non-negative"),
            nullable=True,
            coerce=True,
            description="Outpatient ED volume (non-negative)",
        ),
    },
    strict=False,
    coerce=True,
)


def validate_hscrc_df(df: pd.DataFrame) -> pd.DataFrame:
    """Validate a parsed HSCRC DataFrame before persistence.

    Required columns: ``HOSP_NUM``, ``REPORT_DATE``, ``VOL_IN``, ``VOL_OUT``.
    ``VOL_IN`` and ``VOL_OUT`` must be non-negative; ``REPORT_DATE`` must be
    parseable as a datetime.

    Raises
    ------
    pandera.errors.SchemaError
        If any required column is missing or any row violates the checks.
    """
    required = {"HOSP_NUM", "REPORT_DATE", "VOL_IN", "VOL_OUT"}
    missing = required - set(df.columns)
    if missing:
        raise pa.errors.SchemaError(
            schema=HSCRC_SCHEMA,
            data=df,
            message=f"HSCRC DataFrame is missing required columns: {sorted(missing)}",
        )
    return HSCRC_SCHEMA.validate(df, lazy=True)


# ── EDAS snapshots ──────────────────────────────────────────────────

# Maryland-ish bounding box, inclusive of border hospitals.
_MD_LAT_MIN, _MD_LAT_MAX = 37.8, 39.8
_MD_LON_MIN, _MD_LON_MAX = -79.6, -74.9

_VALID_CENSUS_SCORES = {1, 2, 3, 4}


def _census_score_in_allowed_set(series: pd.Series) -> pd.Series:
    """Allow NaN or an integer in {1,2,3,4}."""
    # Treat NaNs as passing; non-NaN values must be in the allowed set.
    numeric = pd.to_numeric(series, errors="coerce")
    is_nan = numeric.isna()
    in_set = numeric.isin(_VALID_CENSUS_SCORES)
    return is_nan | in_set


EDAS_SNAPSHOT_SCHEMA = DataFrameSchema(
    {
        "hospital_code": Column(
            pa.String,
            nullable=False,
            coerce=True,
            description="EDAS destination code (non-null string)",
        ),
        "ed_census_score": Column(
            pa.Float,
            checks=Check(
                _census_score_in_allowed_set,
                element_wise=False,
                error="ed_census_score must be in {1,2,3,4} or NaN",
            ),
            nullable=True,
            coerce=True,
        ),
        "lat": Column(
            pa.Float,
            checks=Check.in_range(
                _MD_LAT_MIN,
                _MD_LAT_MAX,
                include_min=True,
                include_max=True,
                error=f"lat must be in [{_MD_LAT_MIN}, {_MD_LAT_MAX}]",
            ),
            nullable=True,
            coerce=True,
        ),
        "lon": Column(
            pa.Float,
            checks=Check.in_range(
                _MD_LON_MIN,
                _MD_LON_MAX,
                include_min=True,
                include_max=True,
                error=f"lon must be in [{_MD_LON_MIN}, {_MD_LON_MAX}]",
            ),
            nullable=True,
            coerce=True,
        ),
        "timestamp": Column(
            "datetime64[ns, UTC]",
            nullable=False,
            coerce=True,
            description="Snapshot timestamp (parseable as datetime, UTC)",
        ),
    },
    strict=False,
    coerce=True,
)


def validate_edas_snapshots(df: pd.DataFrame) -> pd.DataFrame:
    """Validate a DataFrame of EDAS hospital snapshots.

    Required columns: ``hospital_code``, ``ed_census_score``, ``lat``, ``lon``,
    ``timestamp``. See ``EDAS_SNAPSHOT_SCHEMA`` for the rules.

    Raises
    ------
    pandera.errors.SchemaError / SchemaErrors
        On any schema violation.
    """
    required = {"hospital_code", "ed_census_score", "lat", "lon", "timestamp"}
    missing = required - set(df.columns)
    if missing:
        raise pa.errors.SchemaError(
            schema=EDAS_SNAPSHOT_SCHEMA,
            data=df,
            message=f"EDAS snapshot DataFrame is missing required columns: {sorted(missing)}",
        )
    return EDAS_SNAPSHOT_SCHEMA.validate(df, lazy=True)


# ── Weather ─────────────────────────────────────────────────────────

WEATHER_SCHEMA = DataFrameSchema(
    {
        "timestamp": Column(
            "datetime64[ns]",
            nullable=False,
            coerce=True,
            description="Hourly observation timestamp",
        ),
        "temperature": Column(
            pa.Float,
            checks=Check.in_range(
                -30,
                115,
                include_min=True,
                include_max=True,
                error="temperature must be in [-30, 115] degF",
            ),
            nullable=True,
            coerce=True,
        ),
    },
    strict=False,
    coerce=True,
)


def validate_weather_df(df: pd.DataFrame) -> pd.DataFrame:
    """Validate a weather history DataFrame.

    Required columns: ``timestamp``, ``temperature`` (degF, in [-30, 115]).
    Enforces hourly continuity — consecutive timestamps must be exactly one
    hour apart after sorting.

    Raises
    ------
    pandera.errors.SchemaError
        If required columns are missing, a row violates the temperature
        bounds, or the series is not continuous at hourly cadence.
    """
    required = {"timestamp", "temperature"}
    missing = required - set(df.columns)
    if missing:
        raise pa.errors.SchemaError(
            schema=WEATHER_SCHEMA,
            data=df,
            message=f"Weather DataFrame is missing required columns: {sorted(missing)}",
        )

    validated = WEATHER_SCHEMA.validate(df, lazy=True)

    # Hourly continuity check: sorted timestamps must step by exactly 1 hour.
    if len(validated) > 1:
        ordered = validated.sort_values("timestamp").reset_index(drop=True)
        deltas = ordered["timestamp"].diff().dropna()
        bad = deltas[deltas != pd.Timedelta(hours=1)]
        if len(bad) > 0:
            raise pa.errors.SchemaError(
                schema=WEATHER_SCHEMA,
                data=validated,
                message=(
                    "Weather DataFrame is not hourly-continuous: "
                    f"{len(bad)} gap(s) found (sample delta: {bad.iloc[0]})"
                ),
            )

    return validated
