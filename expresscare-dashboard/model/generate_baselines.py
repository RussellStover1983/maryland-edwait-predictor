"""Generate per-hospital hourly baseline profiles from EDAS history.

Produces a JSON mapping hospital_code -> [24 hourly mean census scores].
"""

import json
import shutil
from pathlib import Path

import pandas as pd

ARTIFACTS = Path(__file__).resolve().parent / "artifacts"
PUBLIC_MODEL = Path(__file__).resolve().parent.parent / "public" / "data" / "model"


def main():
    PUBLIC_MODEL.mkdir(parents=True, exist_ok=True)

    print("Loading EDAS snapshots...")
    df = pd.read_parquet(ARTIFACTS / "edas_snapshots.parquet")
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    print(f"  {len(df):,} rows, {df['hospital_code'].nunique()} hospitals")

    # Compute mean census score per hospital per hour of day
    df["hour"] = df["timestamp"].dt.hour
    baselines = (
        df.groupby(["hospital_code", "hour"])["ed_census_score"]
        .mean()
        .reset_index()
    )

    # Pivot to {hospital_code: [24 values]}
    result = {}
    for hcode in baselines["hospital_code"].unique():
        hosp = baselines[baselines["hospital_code"] == hcode].sort_values("hour")
        profile = [None] * 24
        for _, row in hosp.iterrows():
            profile[int(row["hour"])] = round(row["ed_census_score"], 2)
        # Fill any missing hours with overall hospital mean
        mean_val = round(hosp["ed_census_score"].mean(), 2)
        profile = [v if v is not None else mean_val for v in profile]
        result[str(hcode)] = profile

    output_path = ARTIFACTS / "hospital_baselines.json"
    with open(output_path, "w") as f:
        json.dump(result, f, indent=2)

    # Copy to public
    public_path = PUBLIC_MODEL / "hospital_baselines.json"
    shutil.copy(output_path, public_path)

    print(f"\nGenerated baselines for {len(result)} hospitals")
    print(f"  to {output_path}")
    print(f"  to {public_path}")

    # Show a sample
    sample_code = list(result.keys())[0]
    print(f"\n  Sample ({sample_code}): {result[sample_code]}")


if __name__ == "__main__":
    main()
