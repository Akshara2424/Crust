"""
CRUST Verification Service — Threshold logic.

Converts a raw confidence score (0.0–1.0) to a DecisionEnum value.
All four thresholds are injected from Settings so they can be overridden
via environment variables without touching code.
"""

from __future__ import annotations

from app.schemas import DecisionEnum


def confidence_to_decision(
    confidence: float,
    *,
    threshold_pass: float = 0.85,
    threshold_soft: float = 0.60,
    threshold_hard: float = 0.40,
) -> DecisionEnum:
    """
    Map a confidence score to a decision.

    Boundary values are inclusive on the upper end of each band:

        confidence ≥ threshold_pass              → PASS
        threshold_soft ≤ confidence < threshold_pass → SOFT_CHALLENGE
        threshold_hard ≤ confidence < threshold_soft → HARD_CHALLENGE
        confidence < threshold_hard              → BLOCK

    Args:
        confidence:       Model output probability (human class), in [0, 1].
        threshold_pass:   Minimum confidence for PASS.    Default 0.85.
        threshold_soft:   Minimum confidence for SOFT_CHALLENGE. Default 0.60.
        threshold_hard:   Minimum confidence for HARD_CHALLENGE. Default 0.40.

    Returns:
        DecisionEnum member.

    Raises:
        ValueError: if thresholds are not monotonically increasing, or if
                    confidence is outside [0, 1].
    """
    if not (0.0 <= confidence <= 1.0):
        raise ValueError(f"confidence must be in [0, 1], got {confidence}")

    if not (0.0 <= threshold_hard < threshold_soft < threshold_pass <= 1.0):
        raise ValueError(
            f"Thresholds must satisfy 0 ≤ hard < soft < pass ≤ 1; "
            f"got hard={threshold_hard}, soft={threshold_soft}, pass={threshold_pass}"
        )

    if confidence >= threshold_pass:
        return DecisionEnum.PASS
    if confidence >= threshold_soft:
        return DecisionEnum.SOFT_CHALLENGE
    if confidence >= threshold_hard:
        return DecisionEnum.HARD_CHALLENGE
    return DecisionEnum.BLOCK


def clamp_confidence(confidence: float) -> float:
    """Clamp an arbitrary float to the valid [0.0, 1.0] range."""
    return max(0.0, min(1.0, float(confidence)))
