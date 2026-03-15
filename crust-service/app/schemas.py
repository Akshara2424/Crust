"""
CRUST Verification Service — Pydantic v2 request / response schemas.
"""
from __future__ import annotations

from enum import Enum
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class DecisionEnum(str, Enum):
    PASS           = "PASS"
    SOFT_CHALLENGE = "SOFT_CHALLENGE"
    HARD_CHALLENGE = "HARD_CHALLENGE"
    BLOCK          = "BLOCK"


FeatureVector40 = Annotated[
    list[float],
    Field(min_length=40, max_length=40, description="Exactly 40 normalised floats"),
]

FeatureVector48 = Annotated[
    list[float],
    Field(min_length=48, max_length=48, description="Exactly 48 floats (40 + 8 game signals)"),
]


class VerifyRequest(BaseModel):
    feature_vector: FeatureVector40

    @field_validator("feature_vector")
    @classmethod
    def validate_length(cls, v: list[float]) -> list[float]:
        if len(v) != 40:
            raise ValueError(f"feature_vector must have exactly 40 elements, got {len(v)}")
        return v


class VerifyResponse(BaseModel):
    jwt:        str
    confidence: float = Field(ge=0.0, le=1.0)
    decision:   DecisionEnum


class ChallengeOrderResponse(BaseModel):
    order_id:   UUID
    base:       str
    sauce:      str
    toppings:   list[str]
    expires_at: str


class SubmittedOrder(BaseModel):
    base:     str
    sauce:    str
    toppings: list[str]


class GameSignals(BaseModel):
    drag_velocity_mean:       float = Field(ge=0.0)
    placement_hesitation_ms:  float = Field(ge=0.0)
    correction_count:         float = Field(ge=0.0)
    completion_time_ms:       float = Field(ge=0.0)
    overshoot_ratio:          float = Field(ge=0.0, le=1.0)
    idle_ratio_during_play:   float = Field(ge=0.0, le=1.0)
    ingredient_reorder_count: float = Field(ge=0.0)
    interaction_entropy:      float = Field(ge=0.0)

    def to_vector(self) -> list[float]:
        return [
            self.drag_velocity_mean,
            self.placement_hesitation_ms,
            self.correction_count,
            self.completion_time_ms,
            self.overshoot_ratio,
            self.idle_ratio_during_play,
            self.ingredient_reorder_count,
            self.interaction_entropy,
        ]


class ChallengeResultRequest(BaseModel):
    jwt:                    str
    order_id:               UUID
    submitted:              SubmittedOrder
    game_signals:           GameSignals
    original_feature_vector: FeatureVector40

    @field_validator("original_feature_vector")
    @classmethod
    def validate_fv_length(cls, v: list[float]) -> list[float]:
        if len(v) != 40:
            raise ValueError(f"original_feature_vector must have exactly 40 elements, got {len(v)}")
        return v


class ChallengeResultResponse(BaseModel):
    jwt:        str
    confidence: float = Field(ge=0.0, le=1.0)
    decision:   DecisionEnum


class ErrorResponse(BaseModel):
    error:  str
    detail: str | None = None


class HealthResponse(BaseModel):
    status:        str
    model_version: str
