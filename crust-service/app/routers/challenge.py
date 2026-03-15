"""
CRUST Verification Service — Challenge endpoints.

POST /challenge/order  → generate a pizza order, store in-memory with 60 s TTL
POST /challenge/result → verify order correctness, re-score, return new JWT
"""

import asyncio
import logging
import random
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status

from config import Settings, get_settings
from inference import CrustModel
from ..jwt_utils import CrustJWTError, sign_jwt, verify_jwt
from ..schemas import (
    ChallengeOrderResponse,
    ChallengeResultRequest,
    ChallengeResultResponse,
    DecisionEnum,
    ErrorResponse,
)
from thresholds import clamp_confidence, confidence_to_decision

logger = logging.getLogger("crust.challenge")

router = APIRouter(prefix="/challenge", tags=["challenge"])

# ── Pizza constants ────────────────────────────────────────────────────────────

VALID_BASES    = ["thin", "thick", "sourdough", "gluten-free"]
VALID_SAUCES   = ["tomato", "pesto", "white", "bbq"]
TOPPING_POOL   = [
    "mushroom", "olive", "pepperoni", "onion",
    "pepper", "jalapeño", "corn", "spinach",
]


# ── In-memory order store ─────────────────────────────────────────────────────

@dataclass
class StoredOrder:
    order_id:   str
    base:       str
    sauce:      str
    toppings:   list[str]
    created_at: float = field(default_factory=time.monotonic)
    expires_at: float = field(default_factory=lambda: time.monotonic())

    def is_expired(self, ttl: int) -> bool:
        return time.monotonic() > (self.created_at + ttl)


# Module-level in-memory dict — replaced with a true cache for multi-instance deployments
_order_store: dict[str, StoredOrder] = {}
_store_lock = asyncio.Lock()


async def _prune_expired_orders(ttl: int) -> None:
    """Background task: remove orders older than `ttl` seconds."""
    async with _store_lock:
        expired = [oid for oid, o in _order_store.items() if o.is_expired(ttl)]
        for oid in expired:
            del _order_store[oid]
        if expired:
            logger.debug("Pruned %d expired challenge orders", len(expired))


def _get_model(request: Request) -> CrustModel:
    return request.app.state.model  # type: ignore[attr-defined]


# ── POST /challenge/order ─────────────────────────────────────────────────────

@router.post(
    "/order",
    response_model=ChallengeOrderResponse,
    summary="Generate a new Toppings challenge order",
)
async def create_order(
    request: Request,
    settings: Settings = Depends(get_settings),
) -> ChallengeOrderResponse:
    """
    POST /challenge/order

    Generates a random pizza configuration, stores it in-memory with a TTL,
    and returns the order details to the client.  A background task prunes
    stale entries so the store does not grow unboundedly.
    """
    # Prune stale entries on each order creation (lightweight, async)
    asyncio.ensure_future(
        _prune_expired_orders(settings.challenge_ttl_seconds)
    )

    order_id  = str(uuid.uuid4())
    base      = random.choice(VALID_BASES)
    sauce     = random.choice(VALID_SAUCES)
    n_toppings = random.randint(2, 4)
    toppings  = random.sample(TOPPING_POOL, n_toppings)

    created_epoch   = time.time()
    expires_epoch   = created_epoch + settings.challenge_ttl_seconds
    expires_iso     = datetime.fromtimestamp(expires_epoch, tz=timezone.utc).isoformat()

    order = StoredOrder(
        order_id=order_id,
        base=base,
        sauce=sauce,
        toppings=toppings,
        created_at=time.monotonic(),
    )

    async with _store_lock:
        _order_store[order_id] = order

    logger.info(
        "challenge order created",
        extra={"order_id": order_id, "toppings": toppings},
    )

    return ChallengeOrderResponse(
        order_id=uuid.UUID(order_id),
        base=base,
        sauce=sauce,
        toppings=toppings,
        expires_at=expires_iso,
    )


# ── POST /challenge/result ────────────────────────────────────────────────────

@router.post(
    "/result",
    response_model=ChallengeResultResponse,
    summary="Submit Toppings challenge result and receive updated JWT",
    responses={
        400: {"model": ErrorResponse, "description": "Order expired or not found"},
        403: {"model": ErrorResponse, "description": "Invalid SOFT_CHALLENGE JWT"},
        422: {"model": ErrorResponse, "description": "ORDER_MISMATCH"},
    },
)
async def submit_result(
    request: Request,
    body: ChallengeResultRequest,
    settings: Settings = Depends(get_settings),
    model: CrustModel = Depends(_get_model),
) -> ChallengeResultResponse:
    """
    POST /challenge/result

    1. Verify incoming JWT is valid RS256, not expired, decision == SOFT_CHALLENGE.
    2. Look up order_id — 400 if expired/missing.
    3. Check submitted order for correctness (set-comparison for toppings).
    4. ORDER_MISMATCH → return 422 without re-running inference.
    5. Correct → re-score using original 40-dim vector + confidence boost.
    6. Return new signed JWT.
    """
    correlation_id = str(uuid.uuid4())

    # ── Step 1: Verify the incoming SOFT_CHALLENGE JWT ────────────────────────
    try:
        claims = verify_jwt(body.jwt, settings.crust_public_key_pem)
    except CrustJWTError as exc:
        logger.warning(
            "challenge/result: invalid JWT — %s",
            exc,
            extra={"correlation_id": correlation_id},
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc

    if claims.get("decision") != DecisionEnum.SOFT_CHALLENGE.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="JWT decision must be SOFT_CHALLENGE",
        )

    # ── Step 2: Retrieve order ────────────────────────────────────────────────
    order_id_str = str(body.order_id)

    async with _store_lock:
        order = _order_store.get(order_id_str)

    if order is None or order.is_expired(settings.challenge_ttl_seconds):
        # Clean up if present but expired
        async with _store_lock:
            _order_store.pop(order_id_str, None)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Challenge order expired or not found",
        )

    # ── Step 3: Validate submitted order ──────────────────────────────────────
    submitted_base     = body.submitted.base.strip().lower()
    submitted_sauce    = body.submitted.sauce.strip().lower()
    submitted_toppings = {t.strip().lower() for t in body.submitted.toppings}
    expected_toppings  = {t.strip().lower() for t in order.toppings}

    order_correct = (
        submitted_base    == order.base.lower()
        and submitted_sauce == order.sauce.lower()
        and submitted_toppings == expected_toppings
    )

    # ── Step 4: Mismatch → reject without inference ───────────────────────────
    if not order_correct:
        logger.info(
            "challenge/result: ORDER_MISMATCH",
            extra={"order_id": order_id_str, "correlation_id": correlation_id},
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="ORDER_MISMATCH",
        )

    # ── Step 5: Re-score with confidence boost ────────────────────────────────
    # Determine elapsed time from JWT iat to now
    iat = claims.get("iat", 0)
    elapsed_s = time.time() - float(iat)

    try:
        base_confidence = model.predict(body.original_feature_vector, vector_len=40)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    if elapsed_s <= settings.challenge_fast_threshold_s:
        boost = settings.challenge_boost_fast
    elif elapsed_s <= settings.challenge_ttl_seconds:
        boost = settings.challenge_boost_slow
    else:
        # Solved after TTL window — no boost (TTL check above should have caught this)
        boost = 0.0

    confidence = clamp_confidence(base_confidence + boost)
    decision   = confidence_to_decision(
        confidence,
        threshold_pass=settings.threshold_pass,
        threshold_soft=settings.threshold_soft,
        threshold_hard=settings.threshold_hard,
    )

    # ── Step 6: Remove consumed order + sign new JWT ──────────────────────────
    async with _store_lock:
        _order_store.pop(order_id_str, None)

    token = sign_jwt(
        confidence=confidence,
        decision=decision,
        feature_vector=body.original_feature_vector,
        private_key_pem=settings.crust_private_key_pem,
        issuer=settings.jwt_issuer,
        subject=settings.jwt_subject,
        ttl_seconds=settings.jwt_ttl_seconds,
    )

    logger.info(
        "challenge/result: success",
        extra={
            "correlation_id": correlation_id,
            "order_id":       order_id_str,
            "decision":       decision.value,
            "confidence":     round(confidence, 4),
            "elapsed_s":      round(elapsed_s, 2),
            "boost":          boost,
        },
    )

    return ChallengeResultResponse(jwt=token, confidence=confidence, decision=decision)
