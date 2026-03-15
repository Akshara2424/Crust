"""
CRUST Verification Service — POST /verify router.

Accepts a 40-float feature vector, runs ML inference, and returns a
signed RS256 JWT with the confidence score and decision.

Rate-limited to 5 requests/second per IP via slowapi.
"""

import logging
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status

from config import Settings, get_settings
from inference import CrustModel
from jwt_utils import sign_jwt
from models import DecisionEnum, VerifyRequest, VerifyResponse
from rate_limit import limiter
from thresholds import clamp_confidence, confidence_to_decision

logger = logging.getLogger("crust.verify")

router = APIRouter(tags=["verify"])


def _get_model(request: Request) -> CrustModel:
    """Extract the loaded model from app.state."""
    model: CrustModel = request.app.state.model
    return model


@router.post(
    "/verify",
    response_model=VerifyResponse,
    summary="Verify a browser session feature vector",
    responses={
        429: {"description": "Rate limit exceeded"},
        422: {"description": "Invalid feature vector"},
        503: {"description": "Model not loaded"},
    },
)
@limiter.limit("5/second")
async def verify(
    request: Request,                          # required by slowapi
    body: VerifyRequest,
    x_crust_action: str | None = Header(default=None, alias="x-crust-action"),
    settings: Settings = Depends(get_settings),
    model: CrustModel = Depends(_get_model),
) -> VerifyResponse:
    """
    POST /verify

    Accepts a 40-float feature vector and returns a signed JWT.

    Headers:
        x-crust-action:   Optional; logged for audit purposes.
        x-crust-request-id: Set on response for correlation.
    """
    correlation_id = str(uuid.uuid4())

    logger.info(
        "verify request",
        extra={
            "correlation_id": correlation_id,
            "action":         x_crust_action or "unknown",
            "client_ip":      request.client.host if request.client else "unknown",
        },
    )

    # ── Inference ─────────────────────────────────────────────────────────────
    try:
        raw_confidence = model.predict(body.feature_vector, vector_len=40)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        logger.error("Inference error: %s", exc, extra={"correlation_id": correlation_id})
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Model inference failed",
        ) from exc

    confidence = clamp_confidence(raw_confidence)
    decision   = confidence_to_decision(
        confidence,
        threshold_pass=settings.threshold_pass,
        threshold_soft=settings.threshold_soft,
        threshold_hard=settings.threshold_hard,
    )

    # ── Sign JWT ──────────────────────────────────────────────────────────────
    token = sign_jwt(
        confidence=confidence,
        decision=decision,
        feature_vector=body.feature_vector,
        private_key_pem=settings.crust_private_key_pem,
        issuer=settings.jwt_issuer,
        subject=settings.jwt_subject,
        ttl_seconds=settings.jwt_ttl_seconds,
    )

    logger.info(
        "verify response",
        extra={
            "correlation_id": correlation_id,
            "decision":       decision.value,
            "confidence":     round(confidence, 4),
        },
    )

    return VerifyResponse(jwt=token, confidence=confidence, decision=decision)
