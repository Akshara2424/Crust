"""
CRUST — Model training script.

Run once to generate model/crust_model.json:

    python model/train.py

Synthetic data is generated to approximate the statistical profile of real
browser sessions (human) versus Selenium/Puppeteer/scripted bots.

Feature order matches the SDK FeatureVector spec exactly (40 dims).
"""

from __future__ import annotations

import os
import sys

import numpy as np
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split

# Allow running from the repo root or from inside model/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import xgboost as xgb  # noqa: E402

# ── Constants ─────────────────────────────────────────────────────────────────

SEED          = 42
N_HUMAN       = 10_000
N_BOT         = 5_000
OUTPUT_PATH   = os.path.join(os.path.dirname(__file__), "crust_model.json")

# Feature names — used for column ordering and any downstream inspection
FEATURE_NAMES: list[str] = [
    # Environment (1–8)
    "env_webdriver_flag", "env_canvas_hash", "env_plugin_count",
    "env_language_mismatch", "env_screen_depth", "env_timezone_offset",
    "env_touch_support", "env_devtools_open",
    # Mouse (9–18)
    "mouse_trajectory_linearity", "mouse_avg_velocity", "mouse_velocity_variance",
    "mouse_curvature_mean", "mouse_pause_count", "mouse_overshoot_count",
    "mouse_click_pressure_variance", "mouse_event_count",
    "mouse_idle_ratio", "mouse_fitts_adherence",
    # Keystroke (19–26)
    "ks_iki_mean", "ks_iki_variance", "ks_hold_time_mean", "ks_hold_time_variance",
    "ks_bigram_consistency", "ks_event_count", "ks_backspace_ratio", "ks_burst_ratio",
    # Session (27–34)
    "sess_first_interaction_delay", "sess_focus_switches", "sess_tab_hidden_duration",
    "sess_scroll_velocity_mean", "sess_scroll_direction_reversals",
    "sess_form_focus_count", "sess_copy_paste_detected", "sess_total_duration",
    # Network (35–40)
    "net_request_jitter", "net_ja3_fingerprint", "net_connection_type",
    "net_rtt_estimate", "net_downlink_estimate", "net_preflight_timing",
]

assert len(FEATURE_NAMES) == 40, "Feature name list must have exactly 40 entries"


# ── Synthetic data generation ─────────────────────────────────────────────────

def generate_human_samples(n: int, rng: np.random.Generator) -> np.ndarray:
    """Generate n synthetic human browser sessions (label = 1)."""
    rows: list[np.ndarray] = []

    for _ in range(n):
        row = np.array([
            # env_webdriver_flag
            rng.binomial(1, 0.01),
            # env_canvas_hash
            rng.uniform(0.0, 1.0),
            # env_plugin_count (Poisson(5) / 20, clipped)
            min(rng.poisson(5), 20) / 20.0,
            # env_language_mismatch
            rng.binomial(1, 0.05),
            # env_screen_depth: 24 → 24/32, 32 → 1.0
            rng.choice([24.0, 32.0]) / 32.0,
            # env_timezone_offset: map (−720,720) → (0,1)
            (rng.uniform(-720.0, 720.0) + 720.0) / 1440.0,
            # env_touch_support
            rng.binomial(1, 0.45),
            # env_devtools_open
            rng.binomial(1, 0.02),
            # mouse_trajectory_linearity — Beta(8,2), humans curve naturally
            rng.beta(8, 2),
            # mouse_avg_velocity — LogNormal(2.5, 0.4), /3 to normalise ≤ 1
            min(rng.lognormal(2.5, 0.4) / 3.0, 1.0),
            # mouse_velocity_variance — LogNormal(1.0, 0.5), /9
            min(rng.lognormal(1.0, 0.5) / 9.0, 1.0),
            # mouse_curvature_mean — Beta(3,5)
            rng.beta(3, 5),
            # mouse_pause_count — Poisson(3)/20
            min(rng.poisson(3), 20) / 20.0,
            # mouse_overshoot_count — Poisson(1)/10
            min(rng.poisson(1), 10) / 10.0,
            # mouse_click_pressure_variance — Beta(2,5)
            rng.beta(2, 5),
            # mouse_event_count — Poisson(120)/2000
            min(rng.poisson(120), 2000) / 2000.0,
            # mouse_idle_ratio — Beta(2,5)
            rng.beta(2, 5),
            # mouse_fitts_adherence — Beta(7,2)
            rng.beta(7, 2),
            # ks_iki_mean — LogNormal(log(180), 0.4)/500
            min(rng.lognormal(np.log(180), 0.4) / 500.0, 1.0),
            # ks_iki_variance — LogNormal(log(3000), 0.5)/250000
            min(rng.lognormal(np.log(3000), 0.5) / 250_000.0, 1.0),
            # ks_hold_time_mean — LogNormal(log(100), 0.3)/300
            min(rng.lognormal(np.log(100), 0.3) / 300.0, 1.0),
            # ks_hold_time_variance — LogNormal(log(500), 0.4)/90000
            min(rng.lognormal(np.log(500), 0.4) / 90_000.0, 1.0),
            # ks_bigram_consistency — Beta(6,2)
            rng.beta(6, 2),
            # ks_event_count — Poisson(40)/500
            min(rng.poisson(40), 500) / 500.0,
            # ks_backspace_ratio — Beta(2,10)
            rng.beta(2, 10),
            # ks_burst_ratio — Beta(2,8)
            rng.beta(2, 8),
            # sess_first_interaction_delay — LogNormal(log(800), 0.5)/30000
            min(rng.lognormal(np.log(800), 0.5) / 30_000.0, 1.0),
            # sess_focus_switches — Poisson(1)/20
            min(rng.poisson(1), 20) / 20.0,
            # sess_tab_hidden_duration — Exponential(scale=2000)/120000
            min(rng.exponential(2000) / 120_000.0, 1.0),
            # sess_scroll_velocity_mean — LogNormal(log(1.5), 0.4)/5
            min(rng.lognormal(np.log(1.5), 0.4) / 5.0, 1.0),
            # sess_scroll_direction_reversals — Poisson(2)/30
            min(rng.poisson(2), 30) / 30.0,
            # sess_form_focus_count — Poisson(3)/20
            min(rng.poisson(3), 20) / 20.0,
            # sess_copy_paste_detected
            rng.binomial(1, 0.15),
            # sess_total_duration — LogNormal(log(12000), 0.4)/120000
            min(rng.lognormal(np.log(12_000), 0.4) / 120_000.0, 1.0),
            # net_request_jitter — LogNormal(log(8), 0.5)/200
            min(rng.lognormal(np.log(8), 0.5) / 200.0, 1.0),
            # net_ja3_fingerprint — Uniform(0,1)
            rng.uniform(0.0, 1.0),
            # net_connection_type — ordinal from {3,4,5}, p=[0.1,0.3,0.6]
            rng.choice([3.0, 4.0, 5.0], p=[0.1, 0.3, 0.6]) / 7.0,
            # net_rtt_estimate — LogNormal(log(20), 0.5)/2000
            min(rng.lognormal(np.log(20), 0.5) / 2_000.0, 1.0),
            # net_downlink_estimate — LogNormal(log(15), 0.6)/100
            min(rng.lognormal(np.log(15), 0.6) / 100.0, 1.0),
            # net_preflight_timing — LogNormal(log(25), 0.4)/1000
            min(rng.lognormal(np.log(25), 0.4) / 1_000.0, 1.0),
        ], dtype=np.float32)
        rows.append(row)

    return np.stack(rows)


def generate_bot_samples(n: int, rng: np.random.Generator) -> np.ndarray:
    """
    Generate n synthetic bot sessions (label = 0).

    Bot-specific features reflect Selenium/Puppeteer patterns; remaining
    dimensions are sampled from human distributions so bots cannot be
    trivially detected by zero-valued features alone.
    """
    # Start with human-like baseline for all dims, then overwrite bot dims
    base = generate_human_samples(n, rng)

    # dim 0: env_webdriver_flag — Bernoulli(0.85)
    base[:, 0] = rng.binomial(1, 0.85, size=n).astype(np.float32)
    # dim 1: env_canvas_hash — Uniform(0, 0.1)
    base[:, 1] = rng.uniform(0.0, 0.1, size=n).astype(np.float32)
    # dim 2: env_plugin_count — Poisson(0.3)/20
    base[:, 2] = np.clip(rng.poisson(0.3, size=n), 0, 20).astype(np.float32) / 20.0
    # dim 8: mouse_trajectory_linearity — Beta(2,8)
    base[:, 8] = rng.beta(2, 8, size=n).astype(np.float32)
    # dim 9: mouse_avg_velocity — Uniform(5,50)/3
    base[:, 9] = np.clip(rng.uniform(5.0, 50.0, size=n) / 3.0, 0.0, 1.0).astype(np.float32)
    # dim 17: mouse_fitts_adherence — Beta(1,4)
    base[:, 17] = rng.beta(1, 4, size=n).astype(np.float32)
    # dim 18: ks_iki_mean — Uniform(20,60)/500
    base[:, 18] = (rng.uniform(20.0, 60.0, size=n) / 500.0).astype(np.float32)
    # dim 19: ks_iki_variance — Uniform(0,200)/250000
    base[:, 19] = (rng.uniform(0.0, 200.0, size=n) / 250_000.0).astype(np.float32)
    # dim 26: sess_first_interaction_delay — Uniform(0,100)/30000
    base[:, 26] = (rng.uniform(0.0, 100.0, size=n) / 30_000.0).astype(np.float32)
    # dim 32: sess_copy_paste_detected — Bernoulli(0.7)
    base[:, 32] = rng.binomial(1, 0.70, size=n).astype(np.float32)

    return base


# ── Training pipeline ─────────────────────────────────────────────────────────

def train() -> None:
    rng = np.random.default_rng(SEED)

    print("Generating synthetic training data …")
    X_human = generate_human_samples(N_HUMAN, rng)   # label 1
    X_bot   = generate_bot_samples(N_BOT,   rng)     # label 0

    X = np.vstack([X_human, X_bot]).astype(np.float32)
    y = np.array([1] * N_HUMAN + [0] * N_BOT, dtype=np.int32)

    print(f"  Total samples: {len(X)} ({N_HUMAN} human, {N_BOT} bot)")

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.20, random_state=SEED, stratify=y
    )

    scale_pos_weight = N_BOT / N_HUMAN  # ~0.5 — corrects class imbalance

    model = xgb.XGBClassifier(
        n_estimators=200,
        max_depth=6,
        learning_rate=0.1,
        subsample=0.8,
        colsample_bytree=0.8,
        scale_pos_weight=scale_pos_weight,
        use_label_encoder=False,
        eval_metric="auc",
        random_state=SEED,
        tree_method="hist",   # fast on CPU
    )

    print("Training XGBoost model …")
    model.fit(
        X_train, y_train,
        eval_set=[(X_test, y_test)],
        verbose=False,
    )

    # ── Evaluation ────────────────────────────────────────────────────────────
    y_prob = model.predict_proba(X_test)[:, 1]
    y_pred_at_threshold = (y_prob >= 0.85).astype(int)

    acc  = accuracy_score(y_test, y_pred_at_threshold)
    prec = precision_score(y_test, y_pred_at_threshold, zero_division=0)
    rec  = recall_score(y_test, y_pred_at_threshold, zero_division=0)
    f1   = f1_score(y_test, y_pred_at_threshold, zero_division=0)
    auc  = roc_auc_score(y_test, y_prob)

    # FPR at 0.85 threshold
    fp = int(((y_pred_at_threshold == 1) & (y_test == 0)).sum())
    tn = int(((y_pred_at_threshold == 0) & (y_test == 0)).sum())
    fpr = fp / (fp + tn) if (fp + tn) > 0 else 0.0

    print("\n── Evaluation results (threshold = 0.85) ──────────────────────")
    print(f"  Accuracy:  {acc:.4f}")
    print(f"  Precision: {prec:.4f}")
    print(f"  Recall:    {rec:.4f}")
    print(f"  F1:        {f1:.4f}")
    print(f"  AUC-ROC:   {auc:.4f}")
    print(f"  FPR@0.85:  {fpr:.4f}")
    print("───────────────────────────────────────────────────────────────\n")

    # ── Save model ────────────────────────────────────────────────────────────
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    model.save_model(OUTPUT_PATH)
    print(f"Model saved → {OUTPUT_PATH}")

    # Also save feature names alongside the model for downstream inspection
    import json
    meta_path = OUTPUT_PATH.replace(".json", "_meta.json")
    with open(meta_path, "w") as f:
        json.dump({"feature_names": FEATURE_NAMES, "n_features": 40}, f, indent=2)
    print(f"Metadata saved → {meta_path}")


if __name__ == "__main__":
    train()
