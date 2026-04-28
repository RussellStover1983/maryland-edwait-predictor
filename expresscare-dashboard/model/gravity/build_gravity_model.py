"""Build Huff gravity model for ExpressCare expansion volume estimation."""

import json
import math
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent.parent
SCRIPTS_DATA = ROOT / "scripts" / "data"
ARTIFACTS = ROOT / "model" / "artifacts"
GRAVITY_DIR = ROOT / "model" / "gravity"
PUBLIC_DATA = ROOT / "public" / "data"

DRIVE_TIME_FILE = SCRIPTS_DATA / "drive-time-matrix.json"
OUTPUT_FILE = SCRIPTS_DATA / "gravity-results.json"
CONFIG_FILE = GRAVITY_DIR / "gravity_config.json"


def haversine_miles(lat1, lng1, lat2, lng2):
    """Haversine distance in miles."""
    R = 3959
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


def load_config():
    with open(CONFIG_FILE) as f:
        return json.load(f)


def load_drive_times():
    with open(DRIVE_TIME_FILE) as f:
        return json.load(f)


def load_hscrc_baselines():
    df = pd.read_parquet(ARTIFACTS / "hscrc_baselines.parquet")
    baselines = {}
    for code, group in df.groupby("hospital_code"):
        baselines[str(code)] = {
            "avg_outpatient_volume": float(group["avg_outpatient_volume"].mean()),
        }
    return baselines


def load_edas_hourly_census():
    """Compute mean census score per hospital per hour of day."""
    df = pd.read_parquet(ARTIFACTS / "edas_snapshots.parquet")
    df["hour"] = pd.to_datetime(df["timestamp"]).dt.hour
    hourly = df.groupby(["hospital_code", "hour"])["ed_census_score"].mean()
    result = defaultdict(dict)
    for (code, hour), score in hourly.items():
        result[str(code)][int(hour)] = float(score)
    return dict(result)


def load_hex_scores():
    with open(SCRIPTS_DATA / "hex-base-scores.json") as f:
        all_hexes = json.load(f)
    return {h["h3Index"]: h for h in all_hexes if h.get("tractGeoid", "").startswith("24")}


def compute_hospital_attractiveness(hospitals, hourly_census, config):
    """Compute hospital attractiveness per time period."""
    base_a = config["hospital_base_attractiveness"]
    time_periods = config["time_periods"]

    attractiveness = {}
    for hosp in hospitals:
        hid = hosp["id"]
        code = hosp["code"]
        attractiveness[hid] = {}

        census_data = hourly_census.get(code, {})
        for period_name, period_cfg in time_periods.items():
            hours = period_cfg["hours"]
            scores = [census_data[h] for h in hours if h in census_data]
            if scores:
                avg_census = sum(scores) / len(scores)
                # Lower census = more attractive (less crowded)
                attractiveness[hid][period_name] = base_a * (5 - avg_census) / 4
            else:
                attractiveness[hid][period_name] = base_a

        # Average across all periods
        period_vals = list(attractiveness[hid].values())
        attractiveness[hid]["average"] = sum(period_vals) / len(period_vals) if period_vals else base_a

    return attractiveness


def distribute_volume_to_hexes(hospitals, hscrc_baselines, hex_scores, drive_time_data, config):
    """Distribute each hospital's outpatient volume to nearby hexes using population-weighted inverse distance."""
    beta = config["distance_decay_beta"]
    max_minutes = config["max_drive_minutes"]
    matrix = drive_time_data["matrix"]
    facilities = drive_time_data["facilities"]

    # Build facility index
    fac_index = {f["id"]: i for i, f in enumerate(facilities)}

    hex_demand = defaultdict(float)
    total_volume = 0

    for hosp in hospitals:
        hid = hosp["id"]
        code = hosp["code"]
        fac_idx = fac_index.get(hid)
        if fac_idx is None:
            continue

        baseline = hscrc_baselines.get(code, {})
        monthly_vol = baseline.get("avg_outpatient_volume", 0)
        if monthly_vol <= 0:
            continue
        total_volume += monthly_vol

        # Find all hexes within range and compute weights
        weighted_hexes = []
        for hex_id, hex_data in hex_scores.items():
            times = matrix.get(hex_id)
            if times is None or fac_idx >= len(times):
                continue
            dt = times[fac_idx]
            if dt is None or dt <= 0 or dt > max_minutes:
                continue
            pop = hex_data.get("population", 0)
            if pop <= 0:
                continue
            weight = pop / (dt ** beta)
            weighted_hexes.append((hex_id, weight))

        if not weighted_hexes:
            continue

        total_weight = sum(w for _, w in weighted_hexes)
        for hex_id, weight in weighted_hexes:
            hex_demand[hex_id] += monthly_vol * (weight / total_weight)

    return dict(hex_demand), total_volume


def huff_probabilities(hex_id, facilities, fac_attractiveness, drive_times, beta, max_minutes):
    """Compute Huff model probability of choosing each facility from a hex."""
    times = drive_times.get(hex_id)
    if times is None:
        return {}

    probs = {}
    total = 0
    for i, fac in enumerate(facilities):
        if i >= len(times):
            continue
        dt = times[i]
        if dt is None or dt <= 0 or dt > max_minutes:
            continue
        a = fac_attractiveness.get(fac["id"], 1.0)
        utility = a / (dt ** beta)
        probs[fac["id"]] = utility
        total += utility

    if total > 0:
        for fid in probs:
            probs[fid] /= total

    return probs


def compute_calibration_factor(drive_time_data, hex_scores):
    """Compute median ratio of ORS drive time to haversine estimate."""
    matrix = drive_time_data["matrix"]
    facilities = drive_time_data["facilities"]
    ratios = []

    sample_hexes = list(hex_scores.keys())[:2000]  # Sample for speed

    for hex_id in sample_hexes:
        times = matrix.get(hex_id)
        if times is None:
            continue
        hc = hex_scores[hex_id]["centroid"]
        for i, fac in enumerate(facilities):
            if i >= len(times):
                continue
            dt = times[i]
            if dt is None or dt <= 0:
                continue
            dist_mi = haversine_miles(hc["lat"], hc["lng"], fac["lat"], fac["lng"])
            if dist_mi < 0.5:
                continue
            haversine_min = dist_mi / 30 * 60  # ~30mph average
            ratio = dt / haversine_min
            if 0.3 < ratio < 5.0:  # Filter outliers
                ratios.append(ratio)

    ratios.sort()
    median = ratios[len(ratios) // 2] if ratios else 1.3
    print(f"Calibration factor (median ORS/haversine): {median:.3f} (from {len(ratios)} pairs)")
    return median


def estimate_drive_time(hex_centroid, fac_lat, fac_lng, calibration_factor):
    """Estimate drive time in minutes using haversine + calibration factor."""
    dist_mi = haversine_miles(hex_centroid["lat"], hex_centroid["lng"], fac_lat, fac_lng)
    haversine_min = dist_mi / 30 * 60
    return haversine_min * calibration_factor


def run_expansion_simulation(candidates, hex_scores, hex_divertible_daily, facilities, drive_time_data,
                              hosp_attractiveness, config, calibration_factor):
    """Simulate placing a new ExpressCare at each candidate location."""
    beta = config["distance_decay_beta"]
    max_minutes = config["max_drive_minutes"]
    ec_attractiveness = config["expresscare_attractiveness"]
    time_periods = config["time_periods"]
    matrix = drive_time_data["matrix"]

    # Build attractiveness lookup for existing facilities
    fac_attractiveness_avg = {}
    for fac in facilities:
        if fac["type"] == "expresscare":
            fac_attractiveness_avg[fac["id"]] = ec_attractiveness
        elif fac["type"] == "competitor":
            fac_attractiveness_avg[fac["id"]] = config["competitor_attractiveness"]
        elif fac["id"] in hosp_attractiveness:
            fac_attractiveness_avg[fac["id"]] = hosp_attractiveness[fac["id"]].get("average", 1.0)
        else:
            fac_attractiveness_avg[fac["id"]] = config["hospital_base_attractiveness"]

    results = []

    for rank, candidate in enumerate(candidates):
        h3idx = candidate["h3Index"]
        centroid = candidate["centroid"]

        # Estimate drive times from all hexes to the proposed location
        proposed_times = {}
        for hex_id, hex_data in hex_scores.items():
            dt = estimate_drive_time(hex_data["centroid"], centroid["lat"], centroid["lng"], calibration_factor)
            if dt <= max_minutes:
                proposed_times[hex_id] = dt

        # Run Huff model with proposed facility added
        captured_daily = 0
        captured_from = defaultdict(float)
        captured_by_period = {p: 0 for p in time_periods}

        for hex_id in proposed_times:
            divertible = hex_divertible_daily.get(hex_id, 0)
            if divertible <= 0:
                continue

            existing_times = matrix.get(hex_id)
            if existing_times is None:
                continue

            # Compute utility for existing facilities
            total_utility = 0
            fac_utilities = {}
            for i, fac in enumerate(facilities):
                if i >= len(existing_times):
                    continue
                dt = existing_times[i]
                if dt is None or dt <= 0 or dt > max_minutes:
                    continue
                a = fac_attractiveness_avg.get(fac["id"], 1.0)
                u = a / (dt ** beta)
                fac_utilities[fac["id"]] = u
                total_utility += u

            # Add proposed facility utility
            proposed_dt = proposed_times[hex_id]
            if proposed_dt <= 0.1:
                proposed_dt = 0.1
            proposed_u = ec_attractiveness / (proposed_dt ** beta)
            total_utility += proposed_u

            if total_utility <= 0:
                continue

            proposed_prob = proposed_u / total_utility
            increment = divertible * proposed_prob
            if math.isfinite(increment):
                captured_daily += increment

            # Track which hospitals lose volume
            for fac_id, u in fac_utilities.items():
                if fac_id.startswith("hosp_"):
                    old_prob = u / (total_utility - proposed_u + u) if (total_utility - proposed_u + u) > 0 else 0
                    new_prob = u / total_utility
                    lost = divertible * (old_prob - new_prob)
                    if lost > 0 and math.isfinite(lost):
                        captured_from[fac_id] += lost

        # Time-of-day breakdown
        for period_name, period_cfg in time_periods.items():
            period_total = 0
            for hex_id in proposed_times:
                divertible = hex_divertible_daily.get(hex_id, 0)
                if divertible <= 0:
                    continue
                existing_times = matrix.get(hex_id)
                if existing_times is None:
                    continue

                total_utility = 0
                for i, fac in enumerate(facilities):
                    if i >= len(existing_times):
                        continue
                    dt = existing_times[i]
                    if dt is None or dt <= 0 or dt > max_minutes:
                        continue
                    # Use period-specific attractiveness for hospitals
                    if fac["id"] in hosp_attractiveness:
                        a = hosp_attractiveness[fac["id"]].get(period_name, 1.0)
                    elif fac["type"] == "expresscare":
                        a = ec_attractiveness
                    elif fac["type"] == "competitor":
                        a = config["competitor_attractiveness"]
                    else:
                        a = 1.0
                    u = a / (dt ** beta)
                    total_utility += u

                proposed_dt = max(proposed_times[hex_id], 0.1)
                proposed_u = ec_attractiveness / (proposed_dt ** beta)
                total_utility += proposed_u

                if total_utility > 0:
                    inc = divertible * (proposed_u / total_utility)
                    if math.isfinite(inc):
                        period_total += inc

            captured_by_period[period_name] = round(period_total, 1)

        # Find nearby population within 5 miles
        nearby_pop = sum(
            h["population"] for h in hex_scores.values()
            if haversine_miles(centroid["lat"], centroid["lng"],
                              h["centroid"]["lat"], h["centroid"]["lng"]) <= 5
        )

        # Sort captured_from by volume lost
        fac_lookup = {f["id"]: f for f in facilities}
        captured_from_list = sorted(
            [
                {
                    "hospital": fac_lookup[fid]["name"] if fid in fac_lookup else fid,
                    "code": fac_lookup[fid]["code"] if fid in fac_lookup else "",
                    "daily_lost": round(vol, 1),
                }
                for fid, vol in captured_from.items()
                if vol >= 0.5
            ],
            key=lambda x: x["daily_lost"],
            reverse=True,
        )[:10]

        results.append({
            "rank": rank + 1,
            "h3Index": h3idx,
            "centroid": centroid,
            "base_score": candidate.get("baseScore", 0),
            "captured_daily_avg": round(captured_daily, 1),
            "captured_by_period": captured_by_period,
            "captured_from": captured_from_list,
            "nearest_expresscare_miles": round(candidate.get("nearestExpressCare", {}).get("distanceMiles", 0), 1),
            "nearby_population_5mi": nearby_pop,
            "divertible_pct_used": config["divertible_pct"],
        })

    # Sort by captured volume
    results.sort(key=lambda x: x["captured_daily_avg"], reverse=True)
    for i, r in enumerate(results):
        r["rank"] = i + 1

    return results


def main():
    config = load_config()
    print("Gravity model configuration:")
    print(f"  Divertible %: {config['divertible_pct'] * 100:.0f}%")
    print(f"  Distance decay beta: {config['distance_decay_beta']}")
    print(f"  Max drive minutes: {config['max_drive_minutes']}")

    # Load inputs
    print("\nLoading inputs...")
    drive_time_data = load_drive_times()
    hscrc_baselines = load_hscrc_baselines()
    hourly_census = load_edas_hourly_census()
    hex_scores = load_hex_scores()

    facilities = drive_time_data["facilities"]
    matrix = drive_time_data["matrix"]

    hospitals = [f for f in facilities if f["type"] == "hospital"]
    print(f"  {len(facilities)} facilities ({len(hospitals)} hospitals)")
    print(f"  {len(hex_scores)} Maryland hex cells")
    print(f"  {len(hscrc_baselines)} HSCRC baselines")
    print(f"  {len(hourly_census)} hospitals with census data")

    # Step 4b: Hospital attractiveness by time period
    print("\nComputing hospital attractiveness by time period...")
    hosp_attractiveness = compute_hospital_attractiveness(hospitals, hourly_census, config)

    # Step 4c: Distribute HSCRC volume to hexes
    print("Distributing HSCRC volume to hex cells...")
    hex_demand, total_volume = distribute_volume_to_hexes(
        hospitals, hscrc_baselines, hex_scores, drive_time_data, config
    )
    print(f"  Total monthly outpatient volume: {total_volume:,.0f}")
    print(f"  Hexes with demand: {len(hex_demand)}")

    # Step 4d: Divertible demand
    divertible_pct = config["divertible_pct"]
    hex_divertible_daily = {
        h: (demand * divertible_pct) / 30
        for h, demand in hex_demand.items()
    }
    total_divertible_daily = sum(hex_divertible_daily.values())
    print(f"  Total divertible daily: {total_divertible_daily:,.0f} patients/day")

    # Step 4e: Current Huff model probabilities
    print("\nRunning Huff model for current facility network...")
    beta = config["distance_decay_beta"]
    max_minutes = config["max_drive_minutes"]

    # Build attractiveness lookup
    fac_attractiveness = {}
    for fac in facilities:
        if fac["type"] == "expresscare":
            fac_attractiveness[fac["id"]] = config["expresscare_attractiveness"]
        elif fac["type"] == "competitor":
            fac_attractiveness[fac["id"]] = config["competitor_attractiveness"]
        elif fac["id"] in hosp_attractiveness:
            fac_attractiveness[fac["id"]] = hosp_attractiveness[fac["id"]].get("average", 1.0)
        else:
            fac_attractiveness[fac["id"]] = config["hospital_base_attractiveness"]

    # Step 4f: Facility capture volumes
    facility_capture = defaultdict(float)
    hex_primary = {}

    for hex_id in hex_scores:
        divertible = hex_divertible_daily.get(hex_id, 0)
        if divertible <= 0:
            continue

        probs = huff_probabilities(hex_id, facilities, fac_attractiveness, matrix, beta, max_minutes)
        if not probs:
            continue

        best_fac = max(probs, key=probs.get)
        hex_primary[hex_id] = (best_fac, probs[best_fac])

        for fid, prob in probs.items():
            val = divertible * prob
            if math.isfinite(val):
                facility_capture[fid] += val

    # Step 4g: Expansion simulation
    print("\nSelecting expansion candidates...")
    min_score = config["expansion_candidate_min_score"]
    min_dist = config["expansion_candidate_min_distance_mi"]
    top_n = config["expansion_top_n"]

    candidates = [
        h for h in hex_scores.values()
        if h.get("baseScore", 0) >= min_score
        and h.get("nearestExpressCare", {}).get("distanceMiles", 0) >= min_dist
    ]
    candidates.sort(key=lambda h: h.get("baseScore", 0), reverse=True)
    candidates = candidates[:top_n]
    print(f"  {len(candidates)} candidates (score >= {min_score}, dist >= {min_dist}mi)")

    # Calibration factor
    calibration_factor = compute_calibration_factor(drive_time_data, hex_scores)

    print("Simulating expansion opportunities...")
    expansion_results = run_expansion_simulation(
        candidates, hex_scores, hex_divertible_daily, facilities, drive_time_data,
        hosp_attractiveness, config, calibration_factor
    )
    print(f"  Top candidate: {expansion_results[0]['captured_daily_avg']} patients/day" if expansion_results else "  No candidates")

    # Build hex_demand output (abbreviated — top 1000 by demand)
    hex_demand_sorted = sorted(hex_demand.items(), key=lambda x: x[1], reverse=True)
    hex_demand_output = {}
    for hex_id, monthly in hex_demand_sorted[:1000]:
        primary = hex_primary.get(hex_id, (None, 0))
        fac_lookup = {f["id"]: f for f in facilities}
        primary_fac = fac_lookup.get(primary[0], {})
        m = round(monthly, 1) if math.isfinite(monthly) else 0
        d = hex_divertible_daily.get(hex_id, 0)
        d = round(d, 2) if math.isfinite(d) else 0
        p = round(primary[1], 3) if math.isfinite(primary[1]) else 0
        hex_demand_output[hex_id] = {
            "monthly_demand": m,
            "divertible_daily": d,
            "primary_hospital": primary_fac.get("code", ""),
            "primary_hospital_prob": p,
        }

    # Build facility_capture output
    fac_lookup = {f["id"]: f for f in facilities}
    facility_capture_output = {}
    for fid, daily in sorted(facility_capture.items(), key=lambda x: x[1] if math.isfinite(x[1]) else 0, reverse=True):
        fac = fac_lookup.get(fid, {})
        daily_val = round(daily, 1) if math.isfinite(daily) else 0
        facility_capture_output[fid] = {
            "daily_avg": daily_val,
            "name": fac.get("name", fid),
        }

    # Assemble output
    output = {
        "computed_at": datetime.now(timezone.utc).isoformat(),
        "config": {
            "divertible_pct": config["divertible_pct"],
            "beta": config["distance_decay_beta"],
            "max_drive_minutes": config["max_drive_minutes"],
            "expresscare_attractiveness": config["expresscare_attractiveness"],
            "competitor_attractiveness": config["competitor_attractiveness"],
        },
        "statewide": {
            "total_outpatient_monthly": round(total_volume),
            "total_divertible_monthly": round(total_volume * divertible_pct),
            "total_divertible_daily": round(total_divertible_daily),
            "calibration_factor_median": round(calibration_factor, 3),
        },
        "hex_demand": hex_demand_output,
        "facility_capture": facility_capture_output,
        "expansion_opportunities": expansion_results,
    }

    # Save
    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, indent=2)
    print(f"\nSaved gravity results to {OUTPUT_FILE}")

    # Copy to public/data
    public_dest = PUBLIC_DATA / "gravity-results.json"
    if PUBLIC_DATA.exists():
        with open(public_dest, "w") as f:
            json.dump(output, f, indent=2)
        print(f"Copied to {public_dest}")

    # Summary
    print("\n" + "=" * 60)
    print("GRAVITY MODEL SUMMARY")
    print("=" * 60)
    print(f"Total monthly outpatient volume: {total_volume:,.0f}")
    print(f"Divertible daily ({divertible_pct*100:.0f}%): {total_divertible_daily:,.0f} patients/day")
    print(f"Calibration factor: {calibration_factor:.3f}")
    print(f"\nTop 5 Expansion Opportunities:")
    for r in expansion_results[:5]:
        print(f"  #{r['rank']} h3={r['h3Index'][:12]}... "
              f"~{r['captured_daily_avg']} pts/day, "
              f"score={r['base_score']}, "
              f"pop={r['nearby_population_5mi']:,}")

    return output


if __name__ == "__main__":
    main()
