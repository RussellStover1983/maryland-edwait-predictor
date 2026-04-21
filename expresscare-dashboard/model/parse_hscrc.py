"""Parse HSCRC monthly revenue/volume Excel files and produce per-hospital baselines.

Expects .xlsx files in ../scripts/data/hscrc/. If none found, writes empty-schema
Parquet files so downstream pipeline handles gracefully.

Handles structural variations across HSCRC fiscal year files (FY17-FY26):
- Different header row positions (row 0, 1, or 2)
- Mixed column name casing (HOSP_NUM vs hosp_num)
- Varying column order (HNAME first vs last)
"""

import json
import warnings
from pathlib import Path

import numpy as np
import openpyxl
import pandas as pd

warnings.filterwarnings("ignore", category=UserWarning, module="openpyxl")

# TODO: move path to config.settings
_SHARED_HSCRC = Path("C:/dev/shared/data/hscrc")
_LOCAL_HSCRC = Path(__file__).resolve().parent.parent / "scripts" / "data" / "hscrc"
HSCRC_DIR = _SHARED_HSCRC if _SHARED_HSCRC.exists() else _LOCAL_HSCRC
ARTIFACTS = Path(__file__).resolve().parent / "artifacts"
ARTIFACTS.mkdir(parents=True, exist_ok=True)

# HSCRC HOSP_NUM to EDAS destinationCode mapping
# Verified against FY2026 HSCRC data and EDAS hospital status feed
HSCRC_TO_EDAS = {
    12: "210",    # Lifebridge- Sinai
    40: "218",    # Lifebridge- Northwest
    33: "219",    # Lifebridge- Carroll
    13: "208",    # Lifebridge- Grace
    9:  "204",    # JHH- Johns Hopkins
    29: "201",    # JHH- Bayview (was incorrectly 43, which is UMMS-BWMC)
    22: "249",    # JHH- Suburban
    48: "223",    # JHH- Howard County (was incorrectly 35, which is UMMS-Charles)
    2:  "215",    # UMMS- UMMC
    3:  "260",    # UMMS- Capital Region
    35: "291",    # UMMS- Charles (was incorrectly 7, which doesn't exist in HSCRC)
    6:  "388",    # UMMS-Aberdeen/Harford
    15: "203",    # MedStar- Franklin Square
    24: "214",    # MedStar- Union Mem
    18: "264",    # MedStar- Montgomery
    34: "211",    # MedStar- Harbor (was incorrectly 25, which doesn't exist in HSCRC)
    2004: "226",  # MedStar- Good Sam (was incorrectly 26, which doesn't exist in HSCRC)
    62: "343",    # MedStar- Southern MD (was incorrectly 30, which is UMMS-Chestertown)
    28: "333",    # MedStar- St. Mary's (was incorrectly 31, which doesn't exist in HSCRC)
    5:  "239",    # Frederick
    1:  "395",    # Meritus
    11: "212",    # Saint Agnes
    4:  "244",    # Trinity - Holy Cross
    17: "322",    # Garrett
}

HOSPITAL_SYSTEMS = {
    12: "LifeBridge", 40: "LifeBridge", 33: "LifeBridge", 13: "LifeBridge",
    9: "Johns Hopkins", 29: "Johns Hopkins", 22: "Johns Hopkins", 48: "Johns Hopkins",
    2: "UMMS", 3: "UMMS", 35: "UMMS", 6: "UMMS",
    15: "MedStar", 24: "MedStar", 18: "MedStar", 34: "MedStar",
    2004: "MedStar", 62: "MedStar", 28: "MedStar",
    5: "Independent", 1: "Independent", 17: "Independent",
    11: "Ascension", 4: "Trinity",
}

# COVID exclusion period
COVID_START = pd.Timestamp("2020-03-01")
COVID_END = pd.Timestamp("2021-06-30")

# Expected baselines schema (empty DataFrame if no files)
BASELINES_COLS = [
    "hospital_code", "month", "avg_monthly_volume", "avg_monthly_visits",
    "avg_outpatient_volume", "avg_admit_rate", "seasonal_index", "licensed_beds",
]

# Key column names to detect header row
HEADER_MARKERS = {"HOSP_NUM", "CODE", "VOL_IN", "REPORT_DATE"}


def find_header_row(filepath: str) -> int:
    """Scan first 5 rows for the one containing column code names."""
    wb = openpyxl.load_workbook(filepath, read_only=True)
    ws = wb.active
    for i, row in enumerate(ws.iter_rows(max_row=5, max_col=15, values_only=True)):
        vals = {str(v).upper().strip().replace("\xa0", " ") for v in row if v is not None}
        if len(vals & HEADER_MARKERS) >= 2:
            wb.close()
            return i
    wb.close()
    raise ValueError(f"Could not find header row in {filepath}")


def parse_single_file(filepath: Path) -> pd.DataFrame:
    """Parse one HSCRC Excel file, return ED rows with normalized columns.

    CNTR_BED (licensed beds) is zero on EMG rows because beds are reported
    per inpatient rate center.  We sum CNTR_BED across ALL rate centers for
    each (HOSP_NUM, REPORT_DATE) to get total hospital beds, then join that
    back onto the EMG rows.
    """
    header_row = find_header_row(str(filepath))
    df = pd.read_excel(filepath, header=header_row)

    # Normalize column names: uppercase, strip whitespace and non-breaking spaces
    df.columns = [str(c).upper().strip().replace("\xa0", " ") for c in df.columns]

    # Verify required columns exist
    required = {"HOSP_NUM", "CODE", "REPORT_DATE"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"Missing required columns {missing} in {filepath.name}. Found: {list(df.columns)}")

    df["CODE"] = df["CODE"].astype(str).str.strip().str.upper()

    # Ensure HOSP_NUM and REPORT_DATE are usable before grouping
    df["HOSP_NUM"] = pd.to_numeric(df["HOSP_NUM"], errors="coerce")
    df["REPORT_DATE"] = pd.to_datetime(df["REPORT_DATE"], errors="coerce")
    df = df.dropna(subset=["HOSP_NUM", "REPORT_DATE"])

    # Compute total licensed beds per hospital per month from ALL rate centers
    if "CNTR_BED" in df.columns:
        df["CNTR_BED"] = pd.to_numeric(df["CNTR_BED"], errors="coerce").fillna(0)
        total_beds = (
            df.groupby(["HOSP_NUM", "REPORT_DATE"])["CNTR_BED"]
            .sum()
            .reset_index()
            .rename(columns={"CNTR_BED": "TOTAL_LICENSED_BEDS"})
        )
    else:
        total_beds = pd.DataFrame(columns=["HOSP_NUM", "REPORT_DATE", "TOTAL_LICENSED_BEDS"])

    # Filter to ED rate centers (EMG and EM2)
    ed = df[df["CODE"].isin(["EMG", "EM2"])].copy()

    if len(ed) == 0:
        print(f"  WARNING: No EMG/EM2 rows found in {filepath.name}")
        return pd.DataFrame()

    # Ensure numeric columns
    for col in ["VOL_IN", "VOL_OUT", "REV_IN", "REV_OUT"]:
        if col in ed.columns:
            ed[col] = pd.to_numeric(ed[col], errors="coerce")

    for col in ["OVS_IN", "OVS_OUT", "CNTR_ADM", "MCID"]:
        if col in ed.columns:
            ed[col] = pd.to_numeric(ed[col], errors="coerce")

    # Join total beds back onto ED rows
    ed = ed.merge(total_beds, on=["HOSP_NUM", "REPORT_DATE"], how="left")
    # Replace the per-rate-center CNTR_BED (always 0 for EMG) with the hospital total
    ed["CNTR_BED"] = ed["TOTAL_LICENSED_BEDS"].fillna(0)
    ed = ed.drop(columns=["TOTAL_LICENSED_BEDS"], errors="ignore")

    ed["source_file"] = filepath.name
    return ed


def main():
    xlsx_files = sorted(HSCRC_DIR.glob("*.xlsx")) if HSCRC_DIR.exists() else []
    # Exclude data dictionary files
    xlsx_files = [f for f in xlsx_files if "datadictionary" not in f.name.lower()]

    if not xlsx_files:
        print(f"WARNING: No HSCRC Excel files found in {HSCRC_DIR}")
        print("Writing empty baselines file with correct schema.")
        empty_baselines = pd.DataFrame(columns=BASELINES_COLS)
        empty_baselines.to_parquet(ARTIFACTS / "hscrc_baselines.parquet", index=False)
        empty_all = pd.DataFrame()
        empty_all.to_parquet(ARTIFACTS / "hscrc_all_months.parquet", index=False)
        with open(ARTIFACTS / "hscrc_hospital_meta.json", "w") as f:
            json.dump({}, f)
        print("Done (empty output).")
        return

    # Parse all files
    frames = []
    parse_errors = []
    for fp in xlsx_files:
        print(f"Parsing {fp.name}...")
        try:
            result = parse_single_file(fp)
            if len(result) > 0:
                frames.append(result)
                print(f"  -> {len(result):,} EMG/EM2 rows")
            else:
                parse_errors.append((fp.name, "No EMG/EM2 rows"))
        except Exception as e:
            print(f"  ERROR parsing {fp.name}: {e}")
            parse_errors.append((fp.name, str(e)))

    if not frames:
        print("ERROR: No files parsed successfully.")
        return

    files_parsed = len(frames)
    ed = pd.concat(frames, ignore_index=True)
    total_rows = len(ed)
    print(f"\nTotal rows loaded across all files: {total_rows:,}")

    # Ensure HOSP_NUM is integer
    ed["HOSP_NUM"] = ed["HOSP_NUM"].astype(int)

    # Deduplicate on (HOSP_NUM, REPORT_DATE, CODE)
    before = len(ed)
    ed = ed.drop_duplicates(subset=["HOSP_NUM", "REPORT_DATE", "CODE"], keep="first")
    if before != len(ed):
        print(f"Deduplicated: {before:,} -> {len(ed):,} rows")

    # Derived fields
    ed["TOTAL_ED_VOLUME"] = ed["VOL_IN"].fillna(0) + ed["VOL_OUT"].fillna(0)

    if "OVS_IN" in ed.columns and "OVS_OUT" in ed.columns:
        ed["TOTAL_ED_VISITS"] = ed["OVS_IN"].fillna(0) + ed["OVS_OUT"].fillna(0)
    else:
        ed["TOTAL_ED_VISITS"] = np.nan

    ed["ADMIT_RATE"] = ed["VOL_IN"].fillna(0) / ed["TOTAL_ED_VOLUME"].replace(0, np.nan)
    ed["MONTH"] = ed["REPORT_DATE"].dt.month
    ed["YEAR"] = ed["REPORT_DATE"].dt.year

    # COVID flag
    ed["covid_era"] = (ed["REPORT_DATE"] >= COVID_START) & (ed["REPORT_DATE"] <= COVID_END)
    covid_count = int(ed["covid_era"].sum())
    print(f"COVID-era rows flagged: {covid_count}")

    # Map HOSP_NUM to EDAS code
    ed["hospital_code"] = ed["HOSP_NUM"].map(HSCRC_TO_EDAS)
    unmapped = ed[ed["hospital_code"].isna()]["HOSP_NUM"].unique()
    if len(unmapped) > 0:
        print(f"WARNING: {len(unmapped)} HOSP_NUMs not in EDAS mapping: {sorted(unmapped)}")
        ed.loc[ed["hospital_code"].isna(), "hospital_code"] = (
            ed.loc[ed["hospital_code"].isna(), "HOSP_NUM"].astype(str)
        )

    # Map hospital system
    ed["system"] = ed["HOSP_NUM"].map(HOSPITAL_SYSTEMS).fillna("Unknown")

    # Fix mixed-type object columns before parquet serialization
    for col in ed.columns:
        if ed[col].dtype == object and col not in ("hospital_code", "source_file", "system", "CODE"):
            # Try to convert to numeric; if that fails, convert to string
            try:
                ed[col] = pd.to_numeric(ed[col], errors="coerce")
            except Exception:
                ed[col] = ed[col].astype(str)

    # Save full dataset (all months including COVID)
    ed.to_parquet(ARTIFACTS / "hscrc_all_months.parquet", index=False)

    # Compute baselines EXCLUDING covid_era
    non_covid = ed[~ed["covid_era"]].copy()

    # Annual average per hospital (excluding COVID)
    annual_avg = non_covid.groupby("hospital_code")["TOTAL_ED_VOLUME"].mean()

    # Per-hospital, per-calendar-month baselines
    baselines = (
        non_covid.groupby(["hospital_code", "MONTH"])
        .agg(
            avg_monthly_volume=("TOTAL_ED_VOLUME", "mean"),
            avg_monthly_visits=("TOTAL_ED_VISITS", "mean"),
            avg_outpatient_volume=("VOL_OUT", lambda x: x.fillna(0).mean()),
            avg_admit_rate=("ADMIT_RATE", "mean"),
            licensed_beds=("CNTR_BED", "last"),
        )
        .reset_index()
        .rename(columns={"MONTH": "month"})
    )

    # Seasonal index: avg_monthly_volume / hospital annual average
    baselines["seasonal_index"] = baselines.apply(
        lambda row: row["avg_monthly_volume"] / annual_avg.get(row["hospital_code"], np.nan),
        axis=1,
    )

    baselines.to_parquet(ARTIFACTS / "hscrc_baselines.parquet", index=False)

    # Hospital metadata
    meta = {}
    for hcode, group in ed.groupby("hospital_code"):
        non_covid_group = group[~group["covid_era"]]
        latest = group.sort_values("REPORT_DATE").iloc[-1]
        hosp_num = int(latest["HOSP_NUM"])
        hname = str(latest.get("HNAME", "")) if pd.notna(latest.get("HNAME")) else ""
        beds = int(latest.get("CNTR_BED", 0)) if pd.notna(latest.get("CNTR_BED")) else None
        avg_ar = float(non_covid_group["ADMIT_RATE"].mean()) if len(non_covid_group) > 0 and pd.notna(non_covid_group["ADMIT_RATE"].mean()) else None

        meta[str(hcode)] = {
            "hscrc_num": hosp_num,
            "name": hname,
            "system": HOSPITAL_SYSTEMS.get(hosp_num, "Unknown"),
            "latest_beds": beds,
            "avg_admit_rate": round(avg_ar, 4) if avg_ar is not None else None,
            "data_months": int(group["REPORT_DATE"].nunique()),
            "data_months_non_covid": int(non_covid_group["REPORT_DATE"].nunique()),
            "date_range": [
                group["REPORT_DATE"].min().strftime("%Y-%m-%d"),
                group["REPORT_DATE"].max().strftime("%Y-%m-%d"),
            ],
        }

    with open(ARTIFACTS / "hscrc_hospital_meta.json", "w") as f:
        json.dump(meta, f, indent=2)

    # ── Summary ────────────────────────────────────────────────────
    edas_codes = set(HSCRC_TO_EDAS.values())
    hscrc_mapped = set(ed["hospital_code"].unique()) & edas_codes
    edas_missing = edas_codes - hscrc_mapped
    months_per = non_covid.groupby("hospital_code")["REPORT_DATE"].nunique()

    print(f"\n{'='*60}")
    print(f"  HSCRC Parse Summary")
    print(f"{'='*60}")
    print(f"  Files parsed:            {files_parsed}")
    print(f"  Total rows loaded:       {total_rows:,}")
    print(f"  Total EMG/EM2 rows:      {len(ed):,}")
    print(f"  COVID-era rows:          {covid_count}")
    print(f"  Distinct hospitals:      {ed['hospital_code'].nunique()}")
    print(f"  Date range:              {ed['REPORT_DATE'].min().strftime('%Y-%m-%d')} to {ed['REPORT_DATE'].max().strftime('%Y-%m-%d')}")
    print(f"  Months/hospital (excl COVID): min={months_per.min()}, median={months_per.median():.0f}, max={months_per.max()}")
    print(f"  EDAS hospitals matched:  {len(hscrc_mapped)} / {len(edas_codes)}")
    if edas_missing:
        print(f"  EDAS codes without HSCRC: {sorted(edas_missing)}")
    print(f"\n  Output files:")
    print(f"    {ARTIFACTS / 'hscrc_baselines.parquet'} ({len(baselines)} rows)")
    print(f"    {ARTIFACTS / 'hscrc_all_months.parquet'} ({len(ed)} rows)")
    print(f"    {ARTIFACTS / 'hscrc_hospital_meta.json'} ({len(meta)} hospitals)")
    if parse_errors:
        print(f"\n  Parse errors:")
        for fname, err in parse_errors:
            print(f"    {fname}: {err}")


if __name__ == "__main__":
    main()
