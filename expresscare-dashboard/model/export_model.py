"""Export trained LightGBM models to JSON for browser-side inference."""

import json
import math
import shutil
from pathlib import Path

import lightgbm as lgb

from config import settings


def sanitize_nans(obj):
    """Replace NaN/Inf floats with null for valid JSON output.

    LightGBM's dump_model() can produce NaN values in tree thresholds
    and leaf values. NaN is not valid JSON — browsers reject it.
    """
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    if isinstance(obj, dict):
        return {k: sanitize_nans(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize_nans(v) for v in obj]
    return obj

ARTIFACTS = settings.model_artifacts_dir
PUBLIC_MODEL = Path(__file__).resolve().parent.parent / "public" / "data" / "model"


def main():
    PUBLIC_MODEL.mkdir(parents=True, exist_ok=True)

    # Load training metadata
    meta_path = ARTIFACTS / "training_meta.json"
    with open(meta_path) as f:
        training_meta = json.load(f)

    # Load and export 1h model
    model_1h_path = ARTIFACTS / "lgbm_1h.txt"
    if model_1h_path.exists():
        print("Exporting 1h model...")
        booster_1h = lgb.Booster(model_file=str(model_1h_path))
        model_json_1h = sanitize_nans(booster_1h.dump_model())
        with open(ARTIFACTS / "lgbm_1h.json", "w") as f:
            json.dump(model_json_1h, f)
        shutil.copy(ARTIFACTS / "lgbm_1h.json", PUBLIC_MODEL / "lgbm_1h.json")
        print(f"  to {PUBLIC_MODEL / 'lgbm_1h.json'} ({(PUBLIC_MODEL / 'lgbm_1h.json').stat().st_size / 1024:.0f} KB)")
    else:
        print("WARNING: lgbm_1h.txt not found, skipping 1h export")

    # Load and export 4h model
    model_4h_path = ARTIFACTS / "lgbm_4h.txt"
    if model_4h_path.exists():
        print("Exporting 4h model...")
        booster_4h = lgb.Booster(model_file=str(model_4h_path))
        model_json_4h = sanitize_nans(booster_4h.dump_model())
        with open(ARTIFACTS / "lgbm_4h.json", "w") as f:
            json.dump(model_json_4h, f)
        shutil.copy(ARTIFACTS / "lgbm_4h.json", PUBLIC_MODEL / "lgbm_4h.json")
        print(f"  to {PUBLIC_MODEL / 'lgbm_4h.json'} ({(PUBLIC_MODEL / 'lgbm_4h.json').stat().st_size / 1024:.0f} KB)")
    else:
        print("WARNING: lgbm_4h.txt not found, skipping 4h export")

    # Build inference config
    hospital_label_map = {}
    label_map_path = ARTIFACTS / "hospital_label_map.json"
    if label_map_path.exists():
        with open(label_map_path) as f:
            hospital_label_map = json.load(f)

    inference_config = {
        "feature_names": training_meta.get("feature_names", []),
        "hospital_label_map": hospital_label_map,
        "horizons": [1, 4],
        "target_clamp": [1.0, 4.0],
        "trained_date": training_meta.get("train_date_range", ["unknown"])[0][:10] if training_meta.get("train_date_range") else "unknown",
        "train_samples": training_meta.get("train_rows", 0),
        "test_mae_1h": training_meta.get("models", {}).get("1h", {}).get("mae", None),
        "test_mae_4h": training_meta.get("models", {}).get("4h", {}).get("mae", None),
    }

    config_path = PUBLIC_MODEL / "inference_config.json"
    with open(config_path, "w") as f:
        json.dump(inference_config, f, indent=2)
    print(f"\nInference config to {config_path}")

    # Also save to artifacts
    with open(ARTIFACTS / "inference_config.json", "w") as f:
        json.dump(inference_config, f, indent=2)

    print("\nExport complete.")
    print(f"Files in {PUBLIC_MODEL}:")
    for p in sorted(PUBLIC_MODEL.iterdir()):
        print(f"  {p.name} ({p.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
