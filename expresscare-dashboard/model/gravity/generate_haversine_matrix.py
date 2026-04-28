"""Generate a haversine-based drive-time matrix as a fast fallback (no API calls).

Uses haversine distance × calibration factor to estimate drive times.
This gives reasonable results for initial testing; the ORS-based matrix
provides more accurate road-network drive times.
"""

import json
import math
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
SCRIPTS_DATA = ROOT / "scripts" / "data"
OUTPUT_FILE = SCRIPTS_DATA / "drive-time-matrix.json"

CALIBRATION_FACTOR = 1.35  # typical ratio of drive time to haversine time


def haversine_miles(lat1, lng1, lat2, lng2):
    R = 3959
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


def main():
    import pandas as pd

    # Load facilities
    facilities = []

    with open(SCRIPTS_DATA / "expresscare-locations.json") as f:
        for loc in json.load(f):
            facilities.append({
                "id": f"ec_{loc['id']}",
                "type": "expresscare",
                "code": loc["id"],
                "name": loc["name"],
                "lat": loc["lat"],
                "lng": loc["lng"],
            })

    with open(SCRIPTS_DATA / "competitor-locations.json") as f:
        for loc in json.load(f):
            facilities.append({
                "id": f"comp_{loc['id']}",
                "type": "competitor",
                "code": loc["id"],
                "name": loc["name"],
                "lat": loc["lat"],
                "lng": loc["lng"],
            })

    edas_df = pd.read_parquet(ROOT / "model" / "artifacts" / "edas_snapshots.parquet")
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

    print(f"Facilities: {len(facilities)}")

    # Load Maryland hexes
    with open(SCRIPTS_DATA / "hex-base-scores.json") as f:
        all_hexes = json.load(f)
    md_hexes = [h for h in all_hexes if h.get("tractGeoid", "").startswith("24")]
    print(f"Maryland hexes: {len(md_hexes)}")

    # Compute haversine-based drive times
    matrix = {}
    avg_speed_mph = 30
    for i, hex_cell in enumerate(md_hexes):
        h3idx = hex_cell["h3Index"]
        hlat, hlng = hex_cell["centroid"]["lat"], hex_cell["centroid"]["lng"]
        times = []
        for fac in facilities:
            dist = haversine_miles(hlat, hlng, fac["lat"], fac["lng"])
            drive_min = (dist / avg_speed_mph) * 60 * CALIBRATION_FACTOR
            times.append(round(drive_min, 2))
        matrix[h3idx] = times

        if (i + 1) % 5000 == 0:
            print(f"  {i + 1}/{len(md_hexes)} hexes computed")

    output = {
        "computed_at": datetime.now(timezone.utc).isoformat(),
        "hex_count": len(md_hexes),
        "facility_count": len(facilities),
        "facilities": facilities,
        "matrix": matrix,
        "method": "haversine_estimated",
        "calibration_factor": CALIBRATION_FACTOR,
    }

    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f)
    print(f"Saved haversine matrix to {OUTPUT_FILE} ({len(matrix)} hexes × {len(facilities)} facilities)")


if __name__ == "__main__":
    main()
