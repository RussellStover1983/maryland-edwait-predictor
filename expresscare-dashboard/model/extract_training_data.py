"""Extract EDAS hospital snapshots from Railway Postgres into a local Parquet file."""

import sys

import pandas as pd
import psycopg2

from config import settings

DATABASE_URL = settings.database_url
if not DATABASE_URL:
    print("ERROR: DATABASE_URL not set (checked ../.env and process env)")
    sys.exit(1)

OUTPUT_PATH = settings.model_artifacts_dir / "edas_snapshots.parquet"
OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)


def main():
    print(f"Connecting to Postgres...")
    conn = psycopg2.connect(DATABASE_URL)

    query = "SELECT * FROM hospital_snapshots ORDER BY hospital_code, timestamp"
    print("Executing query...")
    df = pd.read_sql_query(query, conn)
    conn.close()

    # Parse timestamp as UTC datetime
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)

    # Save to parquet
    df.to_parquet(OUTPUT_PATH, index=False)
    print(f"\nSaved {len(df):,} rows to {OUTPUT_PATH}")

    # Summary
    print(f"\n--- Summary ---")
    print(f"Rows:             {len(df):,}")
    print(f"Date range:       {df['timestamp'].min()} to {df['timestamp'].max()}")
    print(f"Distinct hospitals: {df['hospital_code'].nunique()}")
    print(f"\nNull rates per column:")
    null_rates = df.isnull().mean()
    for col in null_rates.index:
        if null_rates[col] > 0:
            print(f"  {col}: {null_rates[col]:.1%}")
    if null_rates.sum() == 0:
        print("  (no nulls)")


if __name__ == "__main__":
    main()
