"""Matrix status check + ors-status.txt writer. Called from run-ors-daily.cmd.

Exit codes:
  0  -> in progress (not complete)
  42 -> complete (runner should chain build + upload + disable task)
  1  -> error (matrix missing/unreadable)
"""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
DATA = BASE / "scripts" / "data"
TOTAL_HEXES = 38322


def main():
    partial = DATA / "drive-time-matrix.partial.json"
    full = DATA / "drive-time-matrix.json"

    path = partial if partial.exists() else full if full.exists() else None
    if path is None:
        print("ERROR: no matrix file found")
        return 1

    with open(path) as f:
        data = json.load(f)

    matrix = data.get("matrix", {})
    populated = len(matrix)
    pct = populated / TOTAL_HEXES * 100
    all_none_rows = sum(1 for row in matrix.values() if all(v is None for v in row))
    complete = populated == TOTAL_HEXES and all_none_rows == 0

    iso = datetime.now(timezone.utc).isoformat(timespec="seconds")
    status_line = (
        f"{iso} | hexes={populated}/{TOTAL_HEXES} ({pct:.2f}%) "
        f"| all_none={all_none_rows} | complete={'true' if complete else 'false'}"
    )
    (DATA / "ors-status.txt").write_text(status_line + "\n", encoding="utf-8")
    print(status_line)

    return 42 if complete else 0


if __name__ == "__main__":
    sys.exit(main())
