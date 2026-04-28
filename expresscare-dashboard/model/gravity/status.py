"""ORS drive-time grind progress checker. Run: python model/gravity/status.py"""

import json
import os
import glob
from datetime import datetime
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent.parent
DATA = BASE / "scripts" / "data"

def main():
    full = DATA / "drive-time-matrix.json"
    partial = DATA / "drive-time-matrix.partial.json"

    if full.exists() and not partial.exists():
        path = full
    elif partial.exists():
        path = partial
    else:
        print("No drive-time matrix found.")
        return

    with open(path) as f:
        matrix = json.load(f)

    matrix_dict = matrix.get("matrix", matrix) if isinstance(matrix, dict) else {}
    total = 38322
    populated = len(matrix_dict)
    pct = populated / total * 100
    all_none_rows = sum(1 for row in matrix_dict.values() if all(v is None for v in row))
    complete = populated == total and all_none_rows == 0

    computed_at = None
    if partial.exists():
        computed_at = datetime.fromtimestamp(partial.stat().st_mtime).isoformat(timespec="seconds")
    elif full.exists():
        computed_at = datetime.fromtimestamp(full.stat().st_mtime).isoformat(timespec="seconds")

    remaining = total - populated
    rate_per_day = 5800
    days_left = remaining / rate_per_day if remaining > 0 else 0

    print(f"=== ORS Drive-Time Grind Status ===")
    print(f"Hexes:      {populated:,} / {total:,} ({pct:.2f}%)")
    print(f"All-None:   {all_none_rows} rows")
    print(f"Complete:   {'YES' if complete else 'NO'}")
    print(f"Checkpoint: {computed_at or 'unknown'}")
    if not complete:
        print(f"Est. days:  {days_left:.1f} at {rate_per_day:,}/day")
    print()

    status_file = DATA / "ors-status.txt"
    if status_file.exists():
        print(f"Last status: {status_file.read_text().strip()}")
    else:
        print("No ors-status.txt yet.")

    logs = sorted(glob.glob(str(DATA / "ors-logs" / "*.log")))
    if logs:
        latest = logs[-1]
        print(f"\nLog tail ({Path(latest).name}):")
        with open(latest) as f:
            lines = f.readlines()
        for line in lines[-10:]:
            print(f"  {line.rstrip()}")
    else:
        print("\nNo log files yet.")

if __name__ == "__main__":
    main()
