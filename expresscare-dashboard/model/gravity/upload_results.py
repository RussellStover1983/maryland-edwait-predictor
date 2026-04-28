"""Upload gravity-results.json to Postgres model_artifacts table."""

import json
import os
import sys
from pathlib import Path

import psycopg2

ROOT = Path(__file__).resolve().parent.parent.parent
SCRIPTS_DATA = ROOT / "scripts" / "data"
RESULTS_FILE = SCRIPTS_DATA / "gravity-results.json"
PUBLIC_DATA = ROOT / "public" / "data"


def load_env():
    env_path = ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def main():
    load_env()
    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        print("ERROR: DATABASE_URL not set")
        sys.exit(1)

    if not RESULTS_FILE.exists():
        print(f"ERROR: {RESULTS_FILE} not found. Run build_gravity_model.py first.")
        sys.exit(1)

    with open(RESULTS_FILE) as f:
        data = json.load(f)

    raw = json.dumps(data)
    expansion_count = len(data.get("expansion_opportunities", []))

    conn_str = db_url.replace("?sslmode=require", "")
    conn = psycopg2.connect(conn_str)
    conn.autocommit = True
    cur = conn.cursor()

    cur.execute('''
        INSERT INTO model_artifacts (artifact_key, artifact_json, file_size_bytes, metadata)
        VALUES (%s, %s::jsonb, %s, %s::jsonb)
        ON CONFLICT (artifact_key) DO UPDATE SET
            artifact_json = EXCLUDED.artifact_json,
            file_size_bytes = EXCLUDED.file_size_bytes,
            created_at = NOW()
    ''', [
        'gravity_results',
        raw,
        len(raw),
        json.dumps({'expansion_count': expansion_count}),
    ])

    print(f"Uploaded gravity_results: {len(raw):,} bytes, {expansion_count} expansion opportunities")
    conn.close()

    # Copy to public/data
    public_dest = PUBLIC_DATA / "gravity-results.json"
    if PUBLIC_DATA.exists():
        with open(public_dest, "w") as f:
            json.dump(data, f, indent=2)
        print(f"Copied to {public_dest}")


if __name__ == "__main__":
    main()
