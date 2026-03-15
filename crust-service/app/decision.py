"""
CRUST decision logic — maps a confidence score to a DecisionEnum.
"""
from __future__ import annotations

from .schemas import DecisionEnum


def confidence_to_decision(
    confidence: float,
    threshold_pass:            float = 0.85,
    threshold_soft_challenge:  float = 0.60,
    threshold_hard_challenge:  float = 0.40,
) -> DecisionEnum:
    """
    Apply threshold ladder:
      ≥ 0.85  → PASS
      ≥ 0.60  → SOFT_CHALLENGE
      ≥ 0.40  → HARD_CHALLENGE
      < 0.40  → BLOCK
    """
    if confidence >= threshold_pass:
        return DecisionEnum.PASS
    if confidence >= threshold_soft_challenge:
        return DecisionEnum.SOFT_CHALLENGE
    if confidence >= threshold_hard_challenge:
        return DecisionEnum.HARD_CHALLENGE
    return DecisionEnum.BLOCK