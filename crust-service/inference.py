"""
CRUST Verification Service — Inference module.

Responsibilities:
  - Load the XGBoost model at startup and store it in app.state
  - Validate that every feature vector has exactly 40 (or 48) dimensions
  - Apply clip + per-feature min-max normalisation before inference
  - Return confidence = predict_proba(vector)[0][1]
  - Log a WARNING if any inference call exceeds 15 ms
"""

from __future__ import annotations

import logging
import os
import time
from typing import TYPE_CHECKING

import numpy as np
import xgboost as xgb

if TYPE_CHECKING:
    pass

logger = logging.getLogger("crust.inference")

# ── Per-feature normalisation ranges ─────────────────────────────────────────
# These are the min/max values used during training (after clipping to [-10, 1000]).
# All SDK-produced values are already in [0, 1] for most features; the ranges
# below handle any out-of-distribution inputs from custom clients.
# Each entry: (feature_min, feature_max)

_FEATURE_RANGES_40: list[tuple[float, float]] = [
    # env (1–8)
    (0.0, 1.0),   # env_webdriver_flag
    (0.0, 1.0),   # env_canvas_hash
    (0.0, 1.0),   # env_plugin_count
    (0.0, 1.0),   # env_language_mismatch
    (0.0, 1.0),   # env_screen_depth
    (0.0, 1.0),   # env_timezone_offset
    (0.0, 1.0),   # env_touch_support
    (0.0, 1.0),   # env_devtools_open
    # mouse (9–18)
    (0.0, 1.0),   # mouse_trajectory_linearity
    (0.0, 1.0),   # mouse_avg_velocity
    (0.0, 1.0),   # mouse_velocity_variance
    (0.0, 1.0),   # mouse_curvature_mean
    (0.0, 1.0),   # mouse_pause_count
    (0.0, 1.0),   # mouse_overshoot_count
    (0.0, 1.0),   # mouse_click_pressure_variance
    (0.0, 1.0),   # mouse_event_count
    (0.0, 1.0),   # mouse_idle_ratio
    (0.0, 1.0),   # mouse_fitts_adherence
    # keystroke (19–26)
    (0.0, 1.0),   # ks_iki_mean
    (0.0, 1.0),   # ks_iki_variance
    (0.0, 1.0),   # ks_hold_time_mean
    (0.0, 1.0),   # ks_hold_time_variance
    (0.0, 1.0),   # ks_bigram_consistency
    (0.0, 1.0),   # ks_event_count
    (0.0, 1.0),   # ks_backspace_ratio
    (0.0, 1.0),   # ks_burst_ratio
    # session (27–34)
    (0.0, 1.0),   # sess_first_interaction_delay
    (0.0, 1.0),   # sess_focus_switches
    (0.0, 1.0),   # sess_tab_hidden_duration
    (0.0, 1.0),   # sess_scroll_velocity_mean
    (0.0, 1.0),   # sess_scroll_direction_reversals
    (0.0, 1.0),   # sess_form_focus_count
    (0.0, 1.0),   # sess_copy_paste_detected
    (0.0, 1.0),   # sess_total_duration
    # network (35–40)
    (0.0, 1.0),   # net_request_jitter
    (0.0, 1.0),   # net_ja3_fingerprint
    (0.0, 1.0),   # net_connection_type
    (0.0, 1.0),   # net_rtt_estimate
    (0.0, 1.0),   # net_downlink_estimate
    (0.0, 1.0),   # net_preflight_timing
]

# Game-signal ranges (dims 41–48) — extend ranges for the 48-dim case
_GAME_SIGNAL_RANGES: list[tuple[float, float]] = [
    (0.0,   50.0),   # drag_velocity_mean        (px/ms normalised)
    (0.0, 5000.0),   # placement_hesitation_ms
    (0.0,   20.0),   # correction_count
    (0.0, 60_000.0), # completion_time_ms
    (0.0,    1.0),   # overshoot_ratio
    (0.0,    1.0),   # idle_ratio_during_play
    (0.0,   10.0),   # ingredient_reorder_count
    (0.0,    5.0),   # interaction_entropy
]

_FEATURE_RANGES_48 = _FEATURE_RANGES_40 + _GAME_SIGNAL_RANGES


def _minmax_normalise(
    vector: np.ndarray,
    ranges: list[tuple[float, float]],
) -> np.ndarray:
    """Apply per-feature min-max normalisation to a 1-D float array."""
    result = vector.copy().astype(np.float32)
    for i, (lo, hi) in enumerate(ranges):
        span = hi - lo
        if span > 0:
            result[i] = (result[i] - lo) / span
        # If span == 0 the feature is constant — leave as-is

    # Final clamp: any adversarial value that survived the clip-then-normalise
    # pipeline (e.g. raw=2000 → clip=1000 → scale=1000 on a (0,1) range) is
    # forced back into [0, 1] so XGBoost never sees out-of-distribution inputs.
    return np.clip(result, 0.0, 1.0)


def preprocess(raw: list[float], expected_len: int = 40) -> np.ndarray:
    """
    Validate, clip, and normalise a raw feature vector.

    Steps:
      1. Length check (raises ValueError)
      2. Clip all values to [-10, 1000]
      3. Min-max normalise using training ranges

    Args:
        raw:          Raw feature vector (list of floats).
        expected_len: Expected vector length (40 or 48).

    Returns:
        Processed (1, N) float32 ndarray ready for XGBoost.

    Raises:
        ValueError: if len(raw) != expected_len.
    """
    if len(raw) != expected_len:
        raise ValueError(
            f"Feature vector must have exactly {expected_len} elements, got {len(raw)}"
        )

    arr = np.array(raw, dtype=np.float32)
    arr = np.clip(arr, -10.0, 1000.0)

    ranges = _FEATURE_RANGES_40 if expected_len == 40 else _FEATURE_RANGES_48
    arr = _minmax_normalise(arr, ranges)

    return arr.reshape(1, -1)


# ── Model wrapper ─────────────────────────────────────────────────────────────

class CrustModel:
    """
    Thin wrapper around an XGBoost Booster.

    Loaded once at startup and stored in app.state.model so every request
    reuses the same in-process model without re-reading disk.
    """

    def __init__(self, model_path: str, warn_latency_ms: float = 15.0) -> None:
        if not os.path.isfile(model_path):
            raise FileNotFoundError(
                f"CRUST model not found at '{model_path}'. "
                "Run `python model/train.py` first."
            )
        self._model = xgb.XGBClassifier()
        self._model.load_model(model_path)
        self._warn_latency_ms = warn_latency_ms
        logger.info("CRUST model loaded from %s", model_path)

    def predict(self, feature_vector: list[float], vector_len: int = 40) -> float:
        """
        Run inference on a pre-validated feature vector.

        Args:
            feature_vector: Raw floats (will be preprocessed internally).
            vector_len:     Expected length (40 for /verify, 40 for /challenge
                            with boost — 48-dim path uses the same model on
                            the 40 leading dims per the prototype spec).

        Returns:
            Confidence score (probability of human class) in [0.0, 1.0].
        """
        X = preprocess(feature_vector, expected_len=vector_len)

        t0 = time.perf_counter()
        proba = self._model.predict_proba(X)
        elapsed_ms = (time.perf_counter() - t0) * 1000.0

        if elapsed_ms > self._warn_latency_ms:
            logger.warning(
                "Inference latency %.2f ms exceeded %.0f ms threshold",
                elapsed_ms,
                self._warn_latency_ms,
            )

        # Class 1 = human; XGBoost preserves label order from training
        return float(proba[0][1])


def load_model(model_path: str, warn_latency_ms: float = 15.0) -> CrustModel:
    """Factory used in the FastAPI lifespan."""
    return CrustModel(model_path, warn_latency_ms=warn_latency_ms)
