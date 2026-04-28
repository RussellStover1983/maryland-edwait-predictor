"""Compute drive-time matrix from Maryland hex centroids to all facilities via ORS Matrix API."""

import json
import os
import sys
import time
import math
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent.parent


class QuotaExceededError(Exception):
    """ORS daily quota exhausted (HTTP 403). Non-retryable; re-run after 00:00 UTC."""
    pass


SCRIPTS_DATA = ROOT / "scripts" / "data"
ARTIFACTS = ROOT / "model" / "artifacts"

OUTPUT_FILE = SCRIPTS_DATA / "drive-time-matrix.json"
CHECKPOINT_FILE = SCRIPTS_DATA / "drive-time-matrix.partial.json"

ORS_BASE = "https://api.openrouteservice.org"
ORS_MATRIX_ENDPOINT = f"{ORS_BASE}/v2/matrix/driving-car"

MAX_SOURCES_PER_REQUEST = 50
MAX_DESTINATIONS_PER_REQUEST = 50
REQUEST_DELAY_S = 2.0
RATE_LIMIT_WAIT_S = 60
CHECKPOINT_INTERVAL = 10


def load_env():
    env_path = ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def get_api_key():
    load_env()
    key = os.environ.get("ORS_API_KEY", "").strip()
    if not key:
        print("ERROR: ORS_API_KEY not found in environment or .env file.")
        print("Sign up for a free key at: https://openrouteservice.org/dev/#/signup")
        print("Then add ORS_API_KEY=<your_key> to your .env file.")
        sys.exit(1)
    return key


def load_facilities():
    """Build unified facility list from ExpressCare, competitors, and EDAS hospitals."""
    facilities = []

    # ExpressCare locations
    ec_path = SCRIPTS_DATA / "expresscare-locations.json"
    with open(ec_path) as f:
        for loc in json.load(f):
            facilities.append({
                "id": f"ec_{loc['id']}",
                "type": "expresscare",
                "code": loc["id"],
                "name": loc["name"],
                "lat": loc["lat"],
                "lng": loc["lng"],
            })

    # Competitor locations
    comp_path = SCRIPTS_DATA / "competitor-locations.json"
    with open(comp_path) as f:
        for loc in json.load(f):
            facilities.append({
                "id": f"comp_{loc['id']}",
                "type": "competitor",
                "code": loc["id"],
                "name": loc["name"],
                "lat": loc["lat"],
                "lng": loc["lng"],
            })

    # EDAS hospitals from parquet
    try:
        import pandas as pd
        edas_df = pd.read_parquet(ARTIFACTS / "edas_snapshots.parquet")
        hosp_df = edas_df.groupby("hospital_code").agg(
            hospital_name=("hospital_name", "first"),
            lat=("lat", "median"),
            lon=("lon", "median"),
        ).reset_index()
        for _, row in hosp_df.iterrows():
            if pd.notna(row["lat"]) and pd.notna(row["lon"]) and row["lat"] != 0:
                facilities.append({
                    "id": f"hosp_{row['hospital_code']}",
                    "type": "hospital",
                    "code": str(row["hospital_code"]),
                    "name": row["hospital_name"],
                    "lat": float(row["lat"]),
                    "lng": float(row["lon"]),
                })
    except Exception as e:
        print(f"WARNING: Could not load EDAS hospitals from parquet: {e}")
        print("Continuing without hospital locations in the matrix.")

    print(f"Loaded {len(facilities)} facilities:")
    type_counts = {}
    for f in facilities:
        type_counts[f["type"]] = type_counts.get(f["type"], 0) + 1
    for t, c in sorted(type_counts.items()):
        print(f"  {t}: {c}")

    return facilities


def load_maryland_hexes():
    """Load hex centroids filtered to Maryland (FIPS starts with '24')."""
    hex_path = SCRIPTS_DATA / "hex-base-scores.json"
    with open(hex_path) as f:
        all_hexes = json.load(f)

    md_hexes = [h for h in all_hexes if h.get("tractGeoid", "").startswith("24")]
    print(f"Loaded {len(md_hexes)} Maryland hex cells (from {len(all_hexes)} total)")
    return md_hexes


def load_checkpoint():
    """Load checkpoint if it exists."""
    if CHECKPOINT_FILE.exists():
        with open(CHECKPOINT_FILE) as f:
            data = json.load(f)
        print(f"Resuming from checkpoint: {len(data.get('matrix', {}))} hexes computed")
        return data
    return None


def save_checkpoint(facilities, matrix, hex_count):
    """Save progress checkpoint."""
    data = {
        "computed_at": datetime.now(timezone.utc).isoformat(),
        "hex_count": hex_count,
        "facility_count": len(facilities),
        "facilities": facilities,
        "matrix": matrix,
        "is_checkpoint": True,
    }
    with open(CHECKPOINT_FILE, "w") as f:
        json.dump(data, f)
    print(f"  Checkpoint saved: {len(matrix)} hexes computed")


def ors_matrix_request(api_key, locations, source_indices, dest_indices, attempt=0):
    """Make a single ORS matrix API request with retry logic."""
    headers = {
        "Authorization": api_key,
        "Content-Type": "application/json",
    }
    body = {
        "locations": locations,
        "sources": source_indices,
        "destinations": dest_indices,
        "metrics": ["duration"],
        "units": "m",  # minutes
    }

    resp = requests.post(ORS_MATRIX_ENDPOINT, json=body, headers=headers, timeout=30)

    if resp.status_code == 429:
        if attempt < 3:
            print(f"  Rate limited (429). Waiting {RATE_LIMIT_WAIT_S}s before retry...")
            time.sleep(RATE_LIMIT_WAIT_S)
            return ors_matrix_request(api_key, locations, source_indices, dest_indices, attempt + 1)
        else:
            raise RuntimeError("Rate limited after 3 retries")

    if resp.status_code == 403:
        raise QuotaExceededError(f"ORS daily quota exceeded (403): {resp.text[:200]}")

    if resp.status_code != 200:
        raise RuntimeError(f"ORS API error {resp.status_code}: {resp.text[:200]}")

    data = resp.json()
    durations = data.get("durations", [])
    # Convert seconds to minutes
    result = []
    for row in durations:
        result.append([round(v / 60, 2) if v is not None else None for v in row])
    return result


def compute_matrix(api_key, hexes, facilities):
    """Compute full drive-time matrix using batched ORS API calls."""
    # Check for checkpoint
    checkpoint = load_checkpoint()
    existing_matrix = {}
    if checkpoint:
        existing_matrix = checkpoint.get("matrix", {})

    # Filter out already-computed hexes
    remaining_hexes = [h for h in hexes if h["h3Index"] not in existing_matrix]
    print(f"Need to compute {len(remaining_hexes)} hexes ({len(existing_matrix)} already done)")

    if not remaining_hexes:
        print("All hexes already computed!")
        return existing_matrix

    # Batch facilities into groups of MAX_DESTINATIONS_PER_REQUEST
    fac_coords = [[f["lng"], f["lat"]] for f in facilities]
    fac_batches = []
    for i in range(0, len(fac_coords), MAX_DESTINATIONS_PER_REQUEST):
        fac_batches.append((i, fac_coords[i:i + MAX_DESTINATIONS_PER_REQUEST]))

    # Batch hex centroids into groups of MAX_SOURCES_PER_REQUEST
    hex_batches = []
    for i in range(0, len(remaining_hexes), MAX_SOURCES_PER_REQUEST):
        hex_batches.append(remaining_hexes[i:i + MAX_SOURCES_PER_REQUEST])

    total_requests = len(hex_batches) * len(fac_batches)
    print(f"Total API requests needed: {total_requests}")
    print(f"  {len(hex_batches)} hex batches × {len(fac_batches)} facility batches")
    print(f"  Estimated time: {total_requests * REQUEST_DELAY_S / 60:.1f} minutes")

    matrix = dict(existing_matrix)
    request_count = 0
    start_time = time.time()

    quota_exhausted = False

    for hb_idx, hex_batch in enumerate(hex_batches):
        hex_coords = [[h["centroid"]["lng"], h["centroid"]["lat"]] for h in hex_batch]
        hex_ids = [h["h3Index"] for h in hex_batch]

        batch_results = {hid: [None] * len(facilities) for hid in hex_ids}
        batch_had_failure = {hid: 0 for hid in hex_ids}

        for fac_start, fac_batch_coords in fac_batches:
            locations = hex_coords + fac_batch_coords
            source_indices = list(range(len(hex_coords)))
            dest_indices = list(range(len(hex_coords), len(hex_coords) + len(fac_batch_coords)))

            try:
                durations = ors_matrix_request(api_key, locations, source_indices, dest_indices)

                for row_idx, hid in enumerate(hex_ids):
                    for col_idx, dur in enumerate(durations[row_idx]):
                        fac_idx = fac_start + col_idx
                        batch_results[hid][fac_idx] = dur

            except QuotaExceededError as e:
                print(f"  QUOTA EXHAUSTED on batch {hb_idx}, fac_start {fac_start}: {e}")
                for hid in hex_ids:
                    batch_had_failure[hid] += 1
                save_checkpoint(facilities, matrix, len(hexes))
                print("Daily quota exhausted - checkpoint saved, re-run tomorrow after 00:00 UTC")
                return matrix, True

            except Exception as e:
                print(f"  ERROR on batch {hb_idx}, fac_start {fac_start}: {e}")
                for hid in hex_ids:
                    batch_had_failure[hid] += 1

            request_count += 1
            if request_count % 10 == 0:
                elapsed = time.time() - start_time
                rate = request_count / elapsed * 60
                remaining = (total_requests - request_count) / (request_count / elapsed)
                print(f"  Progress: {request_count}/{total_requests} requests "
                      f"({rate:.0f}/min, ~{remaining / 60:.1f} min remaining)")

            time.sleep(REQUEST_DELAY_S + (request_count % 5) * 0.1)

        # Only persist hex rows that have at least one numeric value
        for hid in hex_ids:
            if batch_had_failure[hid] < len(fac_batches) and any(
                v is not None for v in batch_results[hid]
            ):
                matrix[hid] = batch_results[hid]

        # Checkpoint
        if (hb_idx + 1) % CHECKPOINT_INTERVAL == 0:
            save_checkpoint(facilities, matrix, len(hexes))

    return matrix, False


def main():
    api_key = get_api_key()
    facilities = load_facilities()
    hexes = load_maryland_hexes()

    print(f"\nComputing drive-time matrix: {len(hexes)} hexes × {len(facilities)} facilities")
    print("=" * 60)

    matrix, quota_hit = compute_matrix(api_key, hexes, facilities)

    if quota_hit:
        print(f"\nExiting early due to quota exhaustion. {len(matrix)} hexes saved in checkpoint.")
        return

    # Save final output
    output = {
        "computed_at": datetime.now(timezone.utc).isoformat(),
        "hex_count": len(hexes),
        "facility_count": len(facilities),
        "facilities": facilities,
        "matrix": matrix,
    }

    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f)
    print(f"\nSaved drive-time matrix to {OUTPUT_FILE}")
    print(f"  {len(matrix)} hexes × {len(facilities)} facilities")

    # Clean up checkpoint
    if CHECKPOINT_FILE.exists():
        CHECKPOINT_FILE.unlink()
        print("Checkpoint file removed.")


if __name__ == "__main__":
    main()
