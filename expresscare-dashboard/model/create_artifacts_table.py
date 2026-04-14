"""Create model_artifacts table in Railway Postgres for storing ML pipeline outputs."""

import os
import sys
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(ENV_PATH)

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL not found in", ENV_PATH)
    sys.exit(1)


def main():
    # Strip sslmode param that causes issues with local psycopg2
    conn_str = DATABASE_URL.replace("?sslmode=require", "")
    print("Connecting to Postgres...")
    conn = psycopg2.connect(conn_str)
    conn.autocommit = True
    cur = conn.cursor()

    print("Creating model_artifacts table...")
    cur.execute("""
        CREATE TABLE IF NOT EXISTS model_artifacts (
            id SERIAL PRIMARY KEY,
            artifact_key TEXT NOT NULL UNIQUE,
            artifact_json JSONB NOT NULL,
            file_size_bytes INTEGER,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            metadata JSONB DEFAULT '{}'
        );
    """)

    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_artifacts_key ON model_artifacts(artifact_key);
    """)

    # Verify table exists
    cur.execute("""
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'model_artifacts'
        ORDER BY ordinal_position;
    """)
    cols = cur.fetchall()
    print(f"\nmodel_artifacts table created with {len(cols)} columns:")
    for col_name, col_type in cols:
        print(f"  {col_name}: {col_type}")

    cur.close()
    conn.close()
    print("\nDone.")


if __name__ == "__main__":
    main()
