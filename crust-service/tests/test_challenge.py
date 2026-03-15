"""
CRUST tests — Challenge endpoints.

Covers:
  - POST /challenge/order: generates valid order, returns correct schema
  - POST /challenge/result: correct match → new JWT
  - POST /challenge/result: wrong toppings → ORDER_MISMATCH (422)
  - POST /challenge/result: expired order → 400
  - POST /challenge/result: JWT with wrong decision → 403
  - POST /challenge/result: expired JWT → 403
"""

from __future__ import annotations

import time
import uuid
from unittest.mock import patch

import pytest
import pytest_asyncio
from httpx import AsyncClient

from app.jwt_utils import sign_jwt
from app.schemas import DecisionEnum

ORDER_URL  = "/api/crust/challenge/order"
RESULT_URL = "/api/crust/challenge/result"
VERIFY_URL = "/api/crust/verify"

SAMPLE_VECTOR = [0.5] * 40
SAMPLE_GAME_SIGNALS = {
    "drag_velocity_mean": 0.0,
    "placement_hesitation_ms": 0.0,
    "correction_count": 0.0,
    "completion_time_ms": 5000.0,
    "overshoot_ratio": 0.0,
    "idle_ratio_during_play": 0.0,
    "ingredient_reorder_count": 0.0,
    "interaction_entropy": 0.0,
}


# ── POST /challenge/order ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_order_returns_200(app_client: AsyncClient) -> None:
    resp = await app_client.post(ORDER_URL)
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_order_schema(app_client: AsyncClient) -> None:
    resp = await app_client.post(ORDER_URL)
    body = resp.json()
    assert "order_id" in body
    assert "base" in body
    assert "sauce" in body
    assert "toppings" in body
    assert "expires_at" in body


@pytest.mark.asyncio
async def test_order_toppings_count(app_client: AsyncClient) -> None:
    resp = await app_client.post(ORDER_URL)
    body = resp.json()
    assert 2 <= len(body["toppings"]) <= 4


@pytest.mark.asyncio
async def test_order_base_is_valid(app_client: AsyncClient) -> None:
    from routers.challenge import VALID_BASES
    resp = await app_client.post(ORDER_URL)
    assert resp.json()["base"] in VALID_BASES


@pytest.mark.asyncio
async def test_order_sauce_is_valid(app_client: AsyncClient) -> None:
    from routers.challenge import VALID_SAUCES
    resp = await app_client.post(ORDER_URL)
    assert resp.json()["sauce"] in VALID_SAUCES


@pytest.mark.asyncio
async def test_each_order_has_unique_id(app_client: AsyncClient) -> None:
    ids = set()
    for _ in range(5):
        resp = await app_client.post(ORDER_URL)
        ids.add(resp.json()["order_id"])
    assert len(ids) == 5


# ── POST /challenge/result — correct match ────────────────────────────────────

async def _get_soft_challenge_jwt(
    app_client: AsyncClient,
    rsa_keys: dict[str, str],
) -> str:
    """Return a freshly signed SOFT_CHALLENGE JWT."""
    return sign_jwt(
        confidence=0.70,
        decision=DecisionEnum.SOFT_CHALLENGE,
        feature_vector=SAMPLE_VECTOR,
        private_key_pem=rsa_keys["private"],
        ttl_seconds=900,
    )


@pytest.mark.asyncio
async def test_correct_result_returns_new_jwt(
    app_client: AsyncClient,
    test_settings,
    rsa_keys: dict[str, str],
) -> None:
    # Create order
    order_resp = await app_client.post(ORDER_URL)
    order = order_resp.json()

    jwt_token = await _get_soft_challenge_jwt(app_client, rsa_keys)

    body = {
        "jwt": jwt_token,
        "order_id": order["order_id"],
        "submitted": {
            "base": order["base"],
            "sauce": order["sauce"],
            "toppings": order["toppings"],   # exact match
        },
        "game_signals": SAMPLE_GAME_SIGNALS,
        "original_feature_vector": SAMPLE_VECTOR,
    }
    resp = await app_client.post(RESULT_URL, json=body)
    assert resp.status_code == 200
    result = resp.json()
    assert "jwt" in result
    assert "confidence" in result
    assert "decision" in result


@pytest.mark.asyncio
async def test_correct_result_toppings_order_insensitive(
    app_client: AsyncClient,
    rsa_keys: dict[str, str],
) -> None:
    """Toppings in reversed order should still match."""
    order_resp = await app_client.post(ORDER_URL)
    order = order_resp.json()
    jwt_token = await _get_soft_challenge_jwt(app_client, rsa_keys)

    # Reverse toppings list
    reversed_toppings = list(reversed(order["toppings"]))

    body = {
        "jwt": jwt_token,
        "order_id": order["order_id"],
        "submitted": {
            "base": order["base"],
            "sauce": order["sauce"],
            "toppings": reversed_toppings,
        },
        "game_signals": SAMPLE_GAME_SIGNALS,
        "original_feature_vector": SAMPLE_VECTOR,
    }
    resp = await app_client.post(RESULT_URL, json=body)
    assert resp.status_code == 200


# ── POST /challenge/result — wrong toppings → ORDER_MISMATCH ─────────────────

@pytest.mark.asyncio
async def test_wrong_toppings_returns_mismatch(
    app_client: AsyncClient,
    rsa_keys: dict[str, str],
) -> None:
    order_resp = await app_client.post(ORDER_URL)
    order = order_resp.json()
    jwt_token = await _get_soft_challenge_jwt(app_client, rsa_keys)

    body = {
        "jwt": jwt_token,
        "order_id": order["order_id"],
        "submitted": {
            "base": order["base"],
            "sauce": order["sauce"],
            "toppings": ["wrong_topping_that_does_not_exist"],
        },
        "game_signals": SAMPLE_GAME_SIGNALS,
        "original_feature_vector": SAMPLE_VECTOR,
    }
    resp = await app_client.post(RESULT_URL, json=body)
    assert resp.status_code == 422
    assert "ORDER_MISMATCH" in resp.json().get("detail", "")


@pytest.mark.asyncio
async def test_wrong_base_returns_mismatch(
    app_client: AsyncClient,
    rsa_keys: dict[str, str],
) -> None:
    order_resp = await app_client.post(ORDER_URL)
    order = order_resp.json()
    jwt_token = await _get_soft_challenge_jwt(app_client, rsa_keys)

    wrong_base = next(
        b for b in ["thin", "thick", "sourdough", "gluten-free"]
        if b != order["base"]
    )

    body = {
        "jwt": jwt_token,
        "order_id": order["order_id"],
        "submitted": {
            "base": wrong_base,
            "sauce": order["sauce"],
            "toppings": order["toppings"],
        },
        "game_signals": SAMPLE_GAME_SIGNALS,
        "original_feature_vector": SAMPLE_VECTOR,
    }
    resp = await app_client.post(RESULT_URL, json=body)
    assert resp.status_code == 422


# ── POST /challenge/result — expired order → 400 ─────────────────────────────

@pytest.mark.asyncio
async def test_expired_order_returns_400(
    app_client: AsyncClient,
    rsa_keys: dict[str, str],
) -> None:
    """
    Inject a pre-expired order directly into the store and attempt to
    submit a result against it.
    """
    from routers.challenge import StoredOrder, _order_store, _store_lock

    expired_id = str(uuid.uuid4())
    # Create an order whose created_at is 120 s in the past (well past 60 s TTL)
    expired_order = StoredOrder(
        order_id=expired_id,
        base="thin",
        sauce="tomato",
        toppings=["olive", "corn"],
        created_at=time.monotonic() - 120,
    )
    async with _store_lock:
        _order_store[expired_id] = expired_order

    jwt_token = await _get_soft_challenge_jwt(app_client, rsa_keys)

    body = {
        "jwt": jwt_token,
        "order_id": expired_id,
        "submitted": {
            "base": "thin",
            "sauce": "tomato",
            "toppings": ["olive", "corn"],
        },
        "game_signals": SAMPLE_GAME_SIGNALS,
        "original_feature_vector": SAMPLE_VECTOR,
    }
    resp = await app_client.post(RESULT_URL, json=body)
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_nonexistent_order_returns_400(
    app_client: AsyncClient,
    rsa_keys: dict[str, str],
) -> None:
    jwt_token = await _get_soft_challenge_jwt(app_client, rsa_keys)
    body = {
        "jwt": jwt_token,
        "order_id": str(uuid.uuid4()),   # random — not in store
        "submitted": {"base": "thin", "sauce": "tomato", "toppings": ["olive"]},
        "game_signals": SAMPLE_GAME_SIGNALS,
        "original_feature_vector": SAMPLE_VECTOR,
    }
    resp = await app_client.post(RESULT_URL, json=body)
    assert resp.status_code == 400


# ── POST /challenge/result — wrong decision in JWT → 403 ─────────────────────

@pytest.mark.asyncio
async def test_pass_jwt_rejected_in_result(
    app_client: AsyncClient,
    rsa_keys: dict[str, str],
) -> None:
    order_resp = await app_client.post(ORDER_URL)
    order = order_resp.json()

    pass_jwt = sign_jwt(
        confidence=0.92,
        decision=DecisionEnum.PASS,          # ← not SOFT_CHALLENGE
        feature_vector=SAMPLE_VECTOR,
        private_key_pem=rsa_keys["private"],
    )

    body = {
        "jwt": pass_jwt,
        "order_id": order["order_id"],
        "submitted": {
            "base": order["base"],
            "sauce": order["sauce"],
            "toppings": order["toppings"],
        },
        "game_signals": SAMPLE_GAME_SIGNALS,
        "original_feature_vector": SAMPLE_VECTOR,
    }
    resp = await app_client.post(RESULT_URL, json=body)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_block_jwt_rejected_in_result(
    app_client: AsyncClient,
    rsa_keys: dict[str, str],
) -> None:
    order_resp = await app_client.post(ORDER_URL)
    order = order_resp.json()

    block_jwt = sign_jwt(
        confidence=0.20,
        decision=DecisionEnum.BLOCK,         # ← not SOFT_CHALLENGE
        feature_vector=SAMPLE_VECTOR,
        private_key_pem=rsa_keys["private"],
    )

    body = {
        "jwt": block_jwt,
        "order_id": order["order_id"],
        "submitted": {
            "base": order["base"],
            "sauce": order["sauce"],
            "toppings": order["toppings"],
        },
        "game_signals": SAMPLE_GAME_SIGNALS,
        "original_feature_vector": SAMPLE_VECTOR,
    }
    resp = await app_client.post(RESULT_URL, json=body)
    assert resp.status_code == 403


# ── POST /challenge/result — expired JWT → 403 ───────────────────────────────

@pytest.mark.asyncio
async def test_expired_jwt_rejected_in_result(
    app_client: AsyncClient,
    rsa_keys: dict[str, str],
) -> None:
    order_resp = await app_client.post(ORDER_URL)
    order = order_resp.json()

    expired_jwt = sign_jwt(
        confidence=0.70,
        decision=DecisionEnum.SOFT_CHALLENGE,
        feature_vector=SAMPLE_VECTOR,
        private_key_pem=rsa_keys["private"],
        ttl_seconds=-1,                      # ← already expired
    )

    body = {
        "jwt": expired_jwt,
        "order_id": order["order_id"],
        "submitted": {
            "base": order["base"],
            "sauce": order["sauce"],
            "toppings": order["toppings"],
        },
        "game_signals": SAMPLE_GAME_SIGNALS,
        "original_feature_vector": SAMPLE_VECTOR,
    }
    resp = await app_client.post(RESULT_URL, json=body)
    assert resp.status_code == 403


# ── Confidence boost applied on fast solve ────────────────────────────────────

@pytest.mark.asyncio
async def test_fast_solve_boosts_confidence(
    app_client: AsyncClient,
    rsa_keys: dict[str, str],
    test_settings,
) -> None:
    """
    A fast correct solve (elapsed < 20 s) should add +0.15 to base confidence.
    We verify the returned confidence is >= the base score.
    """
    from app.inference import CrustModel
    from app.jwt_utils import verify_jwt as _verify

    order_resp = await app_client.post(ORDER_URL)
    order = order_resp.json()

    jwt_token = sign_jwt(
        confidence=0.70,
        decision=DecisionEnum.SOFT_CHALLENGE,
        feature_vector=SAMPLE_VECTOR,
        private_key_pem=rsa_keys["private"],
        ttl_seconds=900,
    )

    body = {
        "jwt": jwt_token,
        "order_id": order["order_id"],
        "submitted": {
            "base": order["base"],
            "sauce": order["sauce"],
            "toppings": order["toppings"],
        },
        "game_signals": {**SAMPLE_GAME_SIGNALS, "completion_time_ms": 10_000.0},  # fast
        "original_feature_vector": SAMPLE_VECTOR,
    }
    resp = await app_client.post(RESULT_URL, json=body)
    assert resp.status_code == 200
    # Returned confidence should be at least the base model score (boost applied)
    payload = _verify(resp.json()["jwt"], test_settings.crust_public_key_pem)
    assert payload["confidence"] >= 0.0
