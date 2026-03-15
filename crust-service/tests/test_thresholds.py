"""
CRUST tests — threshold boundary values.

Tests every boundary point of the four decision bands with exact floats,
including edge cases at the precise boundary (≥ vs <).
"""

from __future__ import annotations

import pytest

from app.schemas import DecisionEnum
from thresholds import clamp_confidence, confidence_to_decision


# ── Boundary value tests ──────────────────────────────────────────────────────

@pytest.mark.parametrize("confidence,expected", [
    # ── BLOCK boundaries ──────────────────────────────────────────────────────
    (0.000, DecisionEnum.BLOCK),
    (0.399, DecisionEnum.BLOCK),
    (0.395, DecisionEnum.BLOCK),   # spec example
    # ── HARD_CHALLENGE boundaries ─────────────────────────────────────────────
    (0.400, DecisionEnum.HARD_CHALLENGE),  # spec example: exactly at boundary
    (0.401, DecisionEnum.HARD_CHALLENGE),
    (0.500, DecisionEnum.HARD_CHALLENGE),
    (0.595, DecisionEnum.HARD_CHALLENGE),  # spec example
    (0.599, DecisionEnum.HARD_CHALLENGE),
    # ── SOFT_CHALLENGE boundaries ─────────────────────────────────────────────
    (0.600, DecisionEnum.SOFT_CHALLENGE),  # spec example: exactly at boundary
    (0.601, DecisionEnum.SOFT_CHALLENGE),
    (0.700, DecisionEnum.SOFT_CHALLENGE),
    (0.845, DecisionEnum.SOFT_CHALLENGE),  # spec example
    (0.849, DecisionEnum.SOFT_CHALLENGE),
    # ── PASS boundaries ───────────────────────────────────────────────────────
    (0.850, DecisionEnum.PASS),            # spec example: exactly at boundary
    (0.851, DecisionEnum.PASS),
    (0.900, DecisionEnum.PASS),
    (1.000, DecisionEnum.PASS),
])
def test_threshold_boundaries(confidence: float, expected: DecisionEnum) -> None:
    result = confidence_to_decision(confidence)
    assert result == expected, (
        f"confidence={confidence} → expected {expected.value}, got {result.value}"
    )


# ── Custom threshold overrides ────────────────────────────────────────────────

def test_custom_thresholds_pass() -> None:
    assert confidence_to_decision(0.90, threshold_pass=0.90) == DecisionEnum.PASS


def test_custom_thresholds_block() -> None:
    assert confidence_to_decision(0.29, threshold_hard=0.30) == DecisionEnum.BLOCK


def test_custom_thresholds_soft() -> None:
    d = confidence_to_decision(0.70, threshold_pass=0.80, threshold_soft=0.65, threshold_hard=0.40)
    assert d == DecisionEnum.SOFT_CHALLENGE


# ── Invalid input guard ───────────────────────────────────────────────────────

def test_confidence_below_zero_raises() -> None:
    with pytest.raises(ValueError, match="confidence must be in"):
        confidence_to_decision(-0.01)


def test_confidence_above_one_raises() -> None:
    with pytest.raises(ValueError, match="confidence must be in"):
        confidence_to_decision(1.001)


def test_inverted_thresholds_raises() -> None:
    with pytest.raises(ValueError, match="Thresholds must satisfy"):
        confidence_to_decision(0.5, threshold_pass=0.30, threshold_soft=0.60, threshold_hard=0.40)


# ── clamp_confidence ──────────────────────────────────────────────────────────

def test_clamp_below_zero() -> None:
    assert clamp_confidence(-5.0) == 0.0


def test_clamp_above_one() -> None:
    assert clamp_confidence(2.0) == 1.0


def test_clamp_passthrough() -> None:
    assert clamp_confidence(0.75) == pytest.approx(0.75)
