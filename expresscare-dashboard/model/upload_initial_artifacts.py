"""Upload current local model artifacts to Postgres model_artifacts table.

Run once after create_artifacts_table.py to seed the database with existing
model files so there's a baseline before the weekly cron runs.
"""

import json
import math
import sys

import pandas as pd
import psycopg2

from config import settings


def sanitize_nans(obj):
    """Replace NaN/Inf floats with None for valid JSON."""
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    if isinstance(obj, dict):
        return {k: sanitize_nans(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize_nans(v) for v in obj]
    return obj

DATABASE_URL = settings.database_url
if not DATABASE_URL:
    print("ERROR: DATABASE_URL not set (checked ../.env and process env)")
    sys.exit(1)

CONN_STR = DATABASE_URL.replace("?sslmode=require", "")

ARTIFACTS = settings.model_artifacts_dir


def store_artifact(cur, conn, key: str, data, metadata: dict = None):
    """Upsert a model artifact."""
    json_str = json.dumps(sanitize_nans(data))
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
    print(f"  {key:25s} {len(json_str):>12,} bytes")


def main():
    print("Connecting to Postgres...")
    conn = psycopg2.connect(CONN_STR)
    cur = conn.cursor()

    print("\nUploading artifacts:\n")

    # JSON artifacts from model/artifacts/
    json_artifacts = {
        "lgbm_1h": ARTIFACTS / "lgbm_1h.json",
        "lgbm_4h": ARTIFACTS / "lgbm_4h.json",
        "inference_config": ARTIFACTS / "inference_config.json",
        "hospital_baselines": ARTIFACTS / "hospital_baselines.json",
        "training_meta": ARTIFACTS / "training_meta.json",
    }

    for key, path in json_artifacts.items():
        if path.exists():
            with open(path) as f:
                data = json.load(f)
            store_artifact(cur, conn, key, data)
        else:
            print(f"  WARNING: {path} not found, skipping {key}")

    # HSCRC baselines from parquet
    hscrc_path = ARTIFACTS / "hscrc_baselines.parquet"
    if hscrc_path.exists():
        df = pd.read_parquet(hscrc_path)
        # Convert numpy types to native Python, then sanitize NaN
        records = json.loads(df.to_json(orient="records"))
        clean_records = sanitize_nans(records)
        store_artifact(cur, conn, "hscrc_baselines", clean_records,
                       {"row_count": len(records)})
    else:
        print(f"  WARNING: {hscrc_path} not found, skipping hscrc_baselines")

    # Flu history from scripts/data/
    flu_path = settings.flu_data_path
    if flu_path.exists():
        with open(flu_path) as f:
            data = json.load(f)
        store_artifact(cur, conn, "flu_history", data,
                       {"week_count": data.get("coverage", {}).get("week_count", 0)})
    else:
        print(f"  WARNING: {flu_path} not found, skipping flu_history")

    # Weather history from scripts/data/
    weather_path = settings.weather_data_path
    if weather_path.exists():
        with open(weather_path) as f:
            data = json.load(f)
        hour_count = len(data.get("hourly", {}).get("time", []))
        store_artifact(cur, conn, "weather_history", data,
                       {"hour_count": hour_count})
    else:
        print(f"  WARNING: {weather_path} not found, skipping weather_history")

    # Verify
    print("\n\nVerifying artifacts in Postgres:")
    cur.execute("""
        SELECT artifact_key, file_size_bytes, created_at
        FROM model_artifacts
        ORDER BY artifact_key
    """)
    for row in cur.fetchall():
        print(f"  {row[0]:25s} {row[1]:>12,} bytes  {row[2]}")

    cur.close()
    conn.close()
    print(f"\nDone. All artifacts uploaded.")


if __name__ == "__main__":
    main()
