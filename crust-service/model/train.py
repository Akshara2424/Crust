"""
CRUST — XGBoost model trainer.

Generates synthetic human vs. bot training data based on the
40-feature vector specification, trains an XGBoost classifier,
and writes the model to model/crust_model.json.

Usage:
    cd crust-service
    python model/train.py

The synthetic data is intentionally simple — replace with real
shadow-mode traffic logs before any production deployment.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import numpy as np

# ── Feature index reference (0-based) ─────────────────────────────────────────
# 0–7   Environment: webdriver_flag, canvas_hash, plugin_count,
#                    language_mismatch, screen_depth, timezone_offset,
#                    touch_support, devtools_open
# 8–17  Mouse: trajectory_linearity, avg_velocity, velocity_variance,
#              curvature_mean, pause_count, overshoot_count,
#              click_pressure_variance, event_count, idle_ratio, fitts_adherence
# 18–25 Keystroke: iki_mean, iki_variance, hold_time_mean, hold_time_variance,
#                  bigram_consistency, event_count, backspace_ratio, burst_ratio
# 26–33 Session: first_interaction_delay, focus_switches, tab_hidden_duration,
#                scroll_velocity_mean, scroll_direction_reversals,
#                form_focus_count, copy_paste_detected, total_duration
# 34–39 Network: request_jitter, ja3_fingerprint, connection_type,
#                rtt_estimate, downlink_estimate, preflight_timing

N_FEATURES = 40
N_HUMAN    = 8_000
N_BOT      = 2_000
RANDOM_SEED = 42


def generate_human_samples(n: int, rng: np.random.Generator) -> np.ndarray:
    """Simulate realistic human browser signals."""
    samples = np.zeros((n, N_FEATURES))

    # Environment — humans rarely have webdriver flag or devtools open
    samples[:, 0] = rng.choice([0, 1], size=n, p=[0.97, 0.03])   # webdriver_flag
    samples[:, 1] = rng.uniform(0.3, 1.0, n)                      # canvas_hash (normalised)
    samples[:, 2] = rng.integers(2, 20, n) / 20                   # plugin_count
    samples[:, 3] = rng.choice([0, 1], size=n, p=[0.92, 0.08])   # language_mismatch
    samples[:, 4] = rng.choice([0.75, 1.0], size=n)               # screen_depth (24/32 bit)
    samples[:, 5] = rng.uniform(-0.5, 0.5, n)                     # timezone_offset normalised
    samples[:, 6] = rng.choice([0, 1], size=n, p=[0.6, 0.4])     # touch_support
    samples[:, 7] = rng.choice([0, 1], size=n, p=[0.95, 0.05])   # devtools_open

    # Mouse — humans have natural variance
    samples[:, 8]  = rng.beta(5, 2, n)                            # trajectory_linearity (high)
    samples[:, 9]  = rng.normal(0.4, 0.15, n).clip(0.05, 1.0)    # avg_velocity
    samples[:, 10] = rng.exponential(0.1, n).clip(0, 0.8)        # velocity_variance
    samples[:, 11] = rng.beta(2, 5, n)                            # curvature_mean (low)
    samples[:, 12] = rng.poisson(3, n) / 20                       # pause_count normalised
    samples[:, 13] = rng.poisson(2, n) / 15                       # overshoot_count
    samples[:, 14] = rng.beta(3, 5, n)                            # click_pressure_variance
    samples[:, 15] = rng.uniform(0.3, 1.0, n)                     # event_count normalised
    samples[:, 16] = rng.beta(2, 8, n)                            # idle_ratio (low)
    samples[:, 17] = rng.beta(6, 2, n)                            # fitts_adherence (high)

    # Keystroke — humans have natural IKI variance
    samples[:, 18] = rng.normal(0.15, 0.05, n).clip(0.02, 0.8)   # iki_mean (seconds)
    samples[:, 19] = rng.exponential(0.04, n).clip(0.001, 0.3)   # iki_variance
    samples[:, 20] = rng.normal(0.08, 0.02, n).clip(0.01, 0.3)   # hold_time_mean
    samples[:, 21] = rng.exponential(0.02, n).clip(0.001, 0.2)   # hold_time_variance
    samples[:, 22] = rng.beta(6, 2, n)                            # bigram_consistency (high)
    samples[:, 23] = rng.uniform(0.2, 1.0, n)                     # event_count
    samples[:, 24] = rng.beta(2, 10, n)                           # backspace_ratio (low)
    samples[:, 25] = rng.beta(4, 4, n)                            # burst_ratio

    # Session
    samples[:, 26] = rng.exponential(0.3, n).clip(0, 5) / 5      # first_interaction_delay
    samples[:, 27] = rng.poisson(2, n) / 10                       # focus_switches
    samples[:, 28] = rng.exponential(0.1, n).clip(0, 1)          # tab_hidden_duration
    samples[:, 29] = rng.uniform(0.1, 0.8, n)                     # scroll_velocity_mean
    samples[:, 30] = rng.poisson(3, n) / 20                       # scroll_direction_reversals
    samples[:, 31] = rng.integers(1, 5, n) / 5                    # form_focus_count
    samples[:, 32] = rng.choice([0, 1], size=n, p=[0.7, 0.3])    # copy_paste_detected
    samples[:, 33] = rng.uniform(0.1, 1.0, n)                     # total_duration

    # Network
    samples[:, 34] = rng.exponential(0.05, n).clip(0, 0.5)       # request_jitter
    samples[:, 35] = rng.uniform(0.2, 1.0, n)                     # ja3_fingerprint
    samples[:, 36] = rng.choice([0.25, 0.5, 0.75, 1.0], size=n)  # connection_type
    samples[:, 37] = rng.uniform(0.05, 0.5, n)                    # rtt_estimate
    samples[:, 38] = rng.uniform(0.3, 1.0, n)                     # downlink_estimate
    samples[:, 39] = rng.exponential(0.03, n).clip(0, 0.3)       # preflight_timing

    return samples.clip(0, 1)


def generate_bot_samples(n: int, rng: np.random.Generator) -> np.ndarray:
    """Simulate bot browser signals — too perfect or clearly automated."""
    samples = np.zeros((n, N_FEATURES))

    # Bots often have webdriver flag, no plugins, language mismatch
    samples[:, 0] = rng.choice([0, 1], size=n, p=[0.2, 0.8])    # webdriver_flag HIGH
    samples[:, 1] = rng.uniform(0.0, 0.3, n)                     # canvas_hash LOW
    samples[:, 2] = rng.integers(0, 3, n) / 20                   # plugin_count very low
    samples[:, 3] = rng.choice([0, 1], size=n, p=[0.4, 0.6])    # language_mismatch HIGH
    samples[:, 4] = rng.choice([0.5, 0.75], size=n)              # screen_depth unusual
    samples[:, 5] = rng.uniform(-1, 1, n)                        # timezone_offset random
    samples[:, 6] = np.zeros(n)                                   # no touch
    samples[:, 7] = rng.choice([0, 1], size=n, p=[0.5, 0.5])    # devtools_open HIGH

    # Mouse — bots move in straight lines or not at all
    samples[:, 8]  = rng.beta(9, 1, n)                           # trajectory_linearity VERY HIGH
    samples[:, 9]  = rng.choice([0.0, 0.9, 1.0], size=n)        # avg_velocity extreme
    samples[:, 10] = rng.beta(1, 9, n)                           # velocity_variance VERY LOW
    samples[:, 11] = rng.beta(1, 9, n)                           # curvature_mean VERY LOW
    samples[:, 12] = np.zeros(n)                                  # no pauses
    samples[:, 13] = np.zeros(n)                                  # no overshoots
    samples[:, 14] = rng.beta(1, 9, n)                           # click_pressure_variance LOW
    samples[:, 15] = rng.choice([0.0, 0.01, 1.0], size=n)       # event_count extreme
    samples[:, 16] = rng.beta(8, 2, n)                           # idle_ratio HIGH
    samples[:, 17] = rng.beta(2, 8, n)                           # fitts_adherence LOW

    # Keystroke — machine-perfect timing
    samples[:, 18] = rng.normal(0.05, 0.001, n).clip(0.04, 0.06) # iki_mean UNIFORM
    samples[:, 19] = rng.beta(1, 20, n)                           # iki_variance VERY LOW
    samples[:, 20] = rng.normal(0.05, 0.001, n).clip(0.04, 0.06) # hold_time_mean uniform
    samples[:, 21] = rng.beta(1, 20, n)                           # hold_time_variance VERY LOW
    samples[:, 22] = rng.beta(1, 5, n)                            # bigram_consistency LOW
    samples[:, 23] = rng.choice([0.0, 1.0], size=n)              # event_count extreme
    samples[:, 24] = np.zeros(n)                                   # no backspaces
    samples[:, 25] = rng.beta(9, 1, n)                            # burst_ratio HIGH

    # Session — no natural browsing patterns
    samples[:, 26] = rng.beta(1, 9, n)                           # first_interaction_delay LOW
    samples[:, 27] = np.zeros(n)                                  # no focus switches
    samples[:, 28] = np.zeros(n)                                  # no tab hiding
    samples[:, 29] = rng.choice([0.0, 1.0], size=n)              # scroll_velocity extreme
    samples[:, 30] = np.zeros(n)                                  # no scroll reversals
    samples[:, 31] = rng.beta(1, 9, n)                           # form_focus_count LOW
    samples[:, 32] = rng.choice([0, 1], size=n, p=[0.5, 0.5])   # copy_paste HIGH
    samples[:, 33] = rng.beta(1, 5, n)                           # total_duration LOW

    # Network — scripted requests
    samples[:, 34] = rng.beta(1, 9, n)                           # request_jitter LOW
    samples[:, 35] = rng.uniform(0.0, 0.2, n)                    # ja3_fingerprint LOW
    samples[:, 36] = np.ones(n) * 0.25                           # connection_type fixed
    samples[:, 37] = rng.beta(1, 9, n)                           # rtt_estimate very low
    samples[:, 38] = rng.uniform(0.0, 0.2, n)                    # downlink LOW
    samples[:, 39] = rng.beta(1, 9, n)                           # preflight_timing LOW

    return samples.clip(0, 1)


def train(output_path: Path) -> None:
    try:
        import xgboost as xgb
    except ImportError:
        print("ERROR: xgboost not installed. Run: pip install xgboost")
        sys.exit(1)

    rng = np.random.default_rng(RANDOM_SEED)

    print(f"  Generating {N_HUMAN} human samples + {N_BOT} bot samples...")
    human_X = generate_human_samples(N_HUMAN, rng)
    bot_X   = generate_bot_samples(N_BOT, rng)

    X = np.vstack([human_X, bot_X])
    y = np.array([1] * N_HUMAN + [0] * N_BOT, dtype=np.float32)

    # Shuffle
    idx = rng.permutation(len(X))
    X, y = X[idx], y[idx]

    # Train/val split (80/20)
    split  = int(0.8 * len(X))
    X_train, X_val = X[:split], X[split:]
    y_train, y_val = y[:split], y[split:]

    dtrain = xgb.DMatrix(X_train, label=y_train)
    dval   = xgb.DMatrix(X_val,   label=y_val)

    params = {
        "objective":        "binary:logistic",
        "eval_metric":      "auc",
        "max_depth":        6,
        "eta":              0.1,
        "subsample":        0.8,
        "colsample_bytree": 0.8,
        "min_child_weight": 5,
        "scale_pos_weight": N_BOT / N_HUMAN,   # handle class imbalance
        "seed":             RANDOM_SEED,
    }

    print("  Training XGBoost classifier...")
    booster = xgb.train(
        params,
        dtrain,
        num_boost_round=200,
        evals=[(dval, "val")],
        early_stopping_rounds=20,
        verbose_eval=50,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    booster.save_model(str(output_path))

    # Quick eval
    preds  = booster.predict(dval)
    acc    = float(np.mean((preds > 0.5) == y_val))
    print(f"  Validation accuracy: {acc:.3f}")
    print(f"  Best iteration:      {booster.best_iteration}")
    print(f"  Model saved to:      {output_path}")


def main() -> None:
    script_dir  = Path(__file__).parent
    output_path = script_dir / "crust_model.json"

    print("🤖 Training CRUST XGBoost model...")
    print()
    train(output_path)
    print()
    print("✅ Model training complete.")
    print()
    print("   Next step: docker compose up --build")


if __name__ == "__main__":
    main()
