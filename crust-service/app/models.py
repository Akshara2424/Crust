"""
CRUST ML model — XGBoost inference wrapper.

Loads the model once at startup; predict() is thread-safe (XGBoost releases the GIL).
Falls back to a stub scorer if no model file is present (dev / CI).
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

import numpy as np

logger = logging.getLogger("crust.model")


class CrustModel:
    def __init__(self, model_path: str) -> None:
        self._model = None
        self._stub  = False

        if not Path(model_path).exists():
            logger.warning(
                "Model file not found at %s — using stub scorer (always returns 0.75).",
                model_path,
            )
            self._stub = True
            return

        try:
            import xgboost as xgb  # noqa: PLC0415
            booster = xgb.Booster()
            booster.load_model(model_path)
            self._model = booster
            logger.info("XGBoost model loaded from %s", model_path)
        except Exception as exc:
            logger.error("Failed to load model: %s — falling back to stub", exc)
            self._stub = True

    def predict(self, feature_vector: list[float]) -> float:
        """
        Return a confidence score 0.0–1.0.
        Higher = more likely human.
        """
        if self._stub:
            return self._stub_score(feature_vector)

        import xgboost as xgb  # noqa: PLC0415

        arr = np.array([feature_vector], dtype=np.float32)
        dm  = xgb.DMatrix(arr)
        # Model outputs probability of class 1 (human)
        prob: float = float(self._model.predict(dm)[0])
        return max(0.0, min(1.0, prob))

    @staticmethod
    def _stub_score(fv: list[float]) -> float:
        """
        Deterministic stub: uses the mean of the first 8 env dims
        plus a hash of the full vector for repeatable demo output.
        Returns a value in [0.55, 0.95] so demos hit different decision paths.
        """
        env_mean = sum(fv[:8]) / 8 if len(fv) >= 8 else 0.5
        fv_hash  = sum(abs(v) * (i + 1) for i, v in enumerate(fv)) % 1.0
        raw      = 0.55 + (env_mean * 0.2) + (fv_hash * 0.2)
        return max(0.0, min(1.0, raw))


_instance: CrustModel | None = None


def get_model(model_path: str | None = None) -> CrustModel:
    global _instance
    if _instance is None:
        path = model_path or os.getenv("CRUST_MODEL_PATH", "/app/model/crust_model.json")
        _instance = CrustModel(path)
    return _instance