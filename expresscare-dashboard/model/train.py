"""Train LightGBM models for 1h and 4h ED census score prediction."""

import json
from pathlib import Path

import lightgbm as lgb
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import shap
from sklearn.metrics import mean_absolute_error, mean_squared_error, confusion_matrix

from config import settings

ARTIFACTS = settings.model_artifacts_dir

PARAMS = {
    "objective": "regression",
    "metric": "mae",
    "learning_rate": 0.05,
    "num_leaves": 63,
    "max_depth": 8,
    "min_child_samples": 50,
    "feature_fraction": 0.8,
    "bagging_fraction": 0.8,
    "bagging_freq": 5,
    "verbose": -1,
    "n_jobs": -1,
}
NUM_ROUNDS = 1000
EARLY_STOPPING = 50


def train_model(X_train, y_train, X_test, y_test, feature_names, horizon_label):
    """Train a single LightGBM model and return (booster, metrics)."""
    dtrain = lgb.Dataset(X_train, label=y_train, feature_name=feature_names)
    dtest = lgb.Dataset(X_test, label=y_test, feature_name=feature_names, reference=dtrain)

    callbacks = [
        lgb.early_stopping(EARLY_STOPPING),
        lgb.log_evaluation(100),
    ]

    booster = lgb.train(
        PARAMS, dtrain,
        num_boost_round=NUM_ROUNDS,
        valid_sets=[dtest],
        valid_names=["test"],
        callbacks=callbacks,
    )

    # Predictions
    preds = booster.predict(X_test)
    preds_clamped = np.clip(preds, 1.0, 4.0)

    # Metrics
    mae = mean_absolute_error(y_test, preds_clamped)
    rmse = np.sqrt(mean_squared_error(y_test, preds_clamped))

    print(f"\n{'='*50}")
    print(f"  {horizon_label} Model Results")
    print(f"{'='*50}")
    print(f"  MAE:  {mae:.4f}")
    print(f"  RMSE: {rmse:.4f}")
    print(f"  Best iteration: {booster.best_iteration}")

    return booster, preds_clamped, {"mae": mae, "rmse": rmse, "best_iteration": booster.best_iteration}


def per_hospital_mae(df_test, preds, target_col, hospital_col="hospital_code"):
    """Compute MAE per hospital."""
    df = df_test[[hospital_col, target_col]].copy()
    df["pred"] = preds
    return df.groupby(hospital_col).apply(
        lambda g: mean_absolute_error(g[target_col], g["pred"])
    ).to_dict()


def per_hour_mae(df_test, preds, target_col, ts_col="timestamp"):
    """Compute MAE per hour of day."""
    df = df_test[[ts_col, target_col]].copy()
    df["pred"] = preds
    df["hour"] = pd.to_datetime(df[ts_col]).dt.hour
    return df.groupby("hour").apply(
        lambda g: mean_absolute_error(g[target_col], g["pred"])
    ).to_dict()


def rounded_confusion(y_true, y_pred):
    """Confusion matrix with predictions rounded to integers 1-4."""
    y_pred_int = np.clip(np.round(y_pred), 1, 4).astype(int)
    y_true_int = np.clip(np.round(y_true), 1, 4).astype(int)
    labels = [1, 2, 3, 4]
    cm = confusion_matrix(y_true_int, y_pred_int, labels=labels)
    return cm.tolist()


def main():
    print("Loading feature matrix...")
    df = pd.read_parquet(ARTIFACTS / "feature_matrix.parquet")
    print(f"  {len(df):,} rows")

    with open(ARTIFACTS / "feature_names.json") as f:
        feature_names = json.load(f)

    # Time-based split: first 80% train, last 20% test
    df = df.sort_values("timestamp").reset_index(drop=True)
    split_idx = int(len(df) * 0.8)
    train_df = df.iloc[:split_idx]
    test_df = df.iloc[split_idx:]

    print(f"  Train: {len(train_df):,} rows ({train_df['timestamp'].min()} to {train_df['timestamp'].max()})")
    print(f"  Test:  {len(test_df):,} rows ({test_df['timestamp'].min()} to {test_df['timestamp'].max()})")

    X_train = train_df[feature_names]
    X_test = test_df[feature_names]

    training_meta = {
        "train_rows": len(train_df),
        "test_rows": len(test_df),
        "train_date_range": [str(train_df["timestamp"].min()), str(train_df["timestamp"].max())],
        "test_date_range": [str(test_df["timestamp"].min()), str(test_df["timestamp"].max())],
        "feature_names": feature_names,
        "feature_count": len(feature_names),
        "models": {},
    }

    # ── Train 1h model ──────────────────────────────────────────────
    target_1h = "target_census_score_1h"
    mask_1h_train = train_df[target_1h].notna()
    mask_1h_test = test_df[target_1h].notna()

    booster_1h, preds_1h, metrics_1h = train_model(
        X_train[mask_1h_train], train_df.loc[mask_1h_train, target_1h],
        X_test[mask_1h_test], test_df.loc[mask_1h_test, target_1h],
        feature_names, "1-Hour",
    )

    # Per-hospital and per-hour analysis
    hosp_mae_1h = per_hospital_mae(test_df[mask_1h_test].reset_index(drop=True), preds_1h, target_1h)
    hour_mae_1h = per_hour_mae(test_df[mask_1h_test].reset_index(drop=True), preds_1h, target_1h)
    cm_1h = rounded_confusion(test_df.loc[mask_1h_test, target_1h].values, preds_1h)

    print(f"\n  Per-hour MAE (1h):")
    for h in sorted(hour_mae_1h.keys()):
        print(f"    Hour {h:2d}: {hour_mae_1h[h]:.4f}")

    # Top 5 worst hospitals
    worst_hosp = sorted(hosp_mae_1h.items(), key=lambda x: x[1], reverse=True)[:5]
    print(f"\n  Worst 5 hospitals by MAE (1h):")
    for hcode, mae_val in worst_hosp:
        print(f"    {hcode}: {mae_val:.4f}")

    metrics_1h["per_hospital_mae"] = {str(k): round(v, 4) for k, v in hosp_mae_1h.items()}
    metrics_1h["per_hour_mae"] = {str(k): round(v, 4) for k, v in hour_mae_1h.items()}
    metrics_1h["confusion_matrix"] = cm_1h

    # Feature importance
    fi_1h = dict(zip(feature_names, booster_1h.feature_importance(importance_type="gain").tolist()))
    fi_1h_sorted = dict(sorted(fi_1h.items(), key=lambda x: x[1], reverse=True))
    with open(ARTIFACTS / "feature_importance_1h.json", "w") as f:
        json.dump(fi_1h_sorted, f, indent=2)

    print(f"\n  Top 10 features (1h, gain):")
    for feat, gain in list(fi_1h_sorted.items())[:10]:
        print(f"    {feat}: {gain:.1f}")

    # Save 1h model
    booster_1h.save_model(str(ARTIFACTS / "lgbm_1h.txt"))
    training_meta["models"]["1h"] = metrics_1h

    # ── Train 4h model ──────────────────────────────────────────────
    target_4h = "target_census_score_4h"
    mask_4h_train = train_df[target_4h].notna()
    mask_4h_test = test_df[target_4h].notna()

    if mask_4h_train.sum() > 100 and mask_4h_test.sum() > 100:
        booster_4h, preds_4h, metrics_4h = train_model(
            X_train[mask_4h_train], train_df.loc[mask_4h_train, target_4h],
            X_test[mask_4h_test], test_df.loc[mask_4h_test, target_4h],
            feature_names, "4-Hour",
        )

        fi_4h = dict(zip(feature_names, booster_4h.feature_importance(importance_type="gain").tolist()))
        fi_4h_sorted = dict(sorted(fi_4h.items(), key=lambda x: x[1], reverse=True))
        with open(ARTIFACTS / "feature_importance_4h.json", "w") as f:
            json.dump(fi_4h_sorted, f, indent=2)

        booster_4h.save_model(str(ARTIFACTS / "lgbm_4h.txt"))
        training_meta["models"]["4h"] = metrics_4h
    else:
        print(f"\nWARNING: Not enough 4h target data (train={mask_4h_train.sum()}, test={mask_4h_test.sum()})")
        print("Skipping 4h model training.")

    # ── SHAP analysis (1h model) ────────────────────────────────────
    print("\nGenerating SHAP summary plot...")
    try:
        explainer = shap.TreeExplainer(booster_1h)
        # Use a sample of test data for SHAP (max 2000 rows for speed)
        sample_size = min(2000, len(X_test[mask_1h_test]))
        X_shap = X_test[mask_1h_test].sample(n=sample_size, random_state=42)
        shap_values = explainer.shap_values(X_shap)

        fig, ax = plt.subplots(figsize=(10, 8))
        shap.summary_plot(shap_values, X_shap, show=False, max_display=20)
        plt.tight_layout()
        plt.savefig(str(ARTIFACTS / "shap_summary_1h.png"), dpi=150, bbox_inches="tight")
        plt.close()
        print("  Saved SHAP summary to artifacts/shap_summary_1h.png")
    except Exception as e:
        print(f"  SHAP analysis failed: {e}")

    # ── Save training metadata ──────────────────────────────────────
    with open(ARTIFACTS / "training_meta.json", "w") as f:
        json.dump(training_meta, f, indent=2, default=str)

    print(f"\n{'='*50}")
    print(f"  Training Complete")
    print(f"{'='*50}")
    print(f"  1h MAE: {metrics_1h['mae']:.4f}")
    if "4h" in training_meta["models"]:
        print(f"  4h MAE: {training_meta['models']['4h']['mae']:.4f}")
    print(f"  Artifacts saved to: {ARTIFACTS}")


if __name__ == "__main__":
    main()
