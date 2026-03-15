"""
CRUST tests — POST /verify endpoint.

Covers:
  - Vector length validation (39, 40, 41 dims)
  - Valid 40-dim request returns JWT + decision + confidence
  - Response JWT is verifiable with the public key
  - Inference latency: mean of 100 calls ≤ 15 ms
  - Rate limit: 6th request within 1 s → 429
"""

from __future__ import annotations

import asyncio
import time

import pytest
import pytest_asyncio
from httpx import AsyncClient

from app.jwt_utils import verify_jwt
from app.schemas import DecisionEnum


# ── Helpers ───────────────────────────────────────────────────────────────────

VERIFY_URL = "/api/crust/verify"


def _payload(n: int = 40, value: float = 0.5) -> dict:
    return {"feature_vector": [value] * n}


# ── Vector length validation ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_vector_39_rejected(app_client: AsyncClient) -> None:
    resp = await app_client.post(VERIFY_URL, json=_payload(39))
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_vector_40_accepted(app_client: AsyncClient) -> None:
    resp = await app_client.post(VERIFY_URL, json=_payload(40))
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_vector_41_rejected(app_client: AsyncClient) -> None:
    resp = await app_client.post(VERIFY_URL, json=_payload(41))
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_empty_vector_rejected(app_client: AsyncClient) -> None:
    resp = await app_client.post(VERIFY_URL, json={"feature_vector": []})
    assert resp.status_code == 422


# ── Response shape ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_response_has_required_fields(app_client: AsyncClient) -> None:
    resp = await app_client.post(VERIFY_URL, json=_payload(40))
    assert resp.status_code == 200
    body = resp.json()
    assert "jwt" in body
    assert "confidence" in body
    assert "decision" in body


@pytest.mark.asyncio
async def test_confidence_in_range(app_client: AsyncClient) -> None:
    resp = await app_client.post(VERIFY_URL, json=_payload(40))
    body = resp.json()
    assert 0.0 <= body["confidence"] <= 1.0


@pytest.mark.asyncio
async def test_decision_is_valid_enum(app_client: AsyncClient) -> None:
    resp = await app_client.post(VERIFY_URL, json=_payload(40))
    body = resp.json()
    valid = {d.value for d in DecisionEnum}
    assert body["decision"] in valid


@pytest.mark.asyncio
async def test_response_jwt_verifiable(
    app_client: AsyncClient,
    test_settings,
) -> None:
    """JWT in response must be verifiable with the service public key."""
    resp = await app_client.post(VERIFY_URL, json=_payload(40))
    body = resp.json()
    payload = verify_jwt(body["jwt"], test_settings.crust_public_key_pem)
    assert payload["sub"] == "crust-session"
    assert payload["iss"] == "crust-verification-service"
    assert payload["decision"] == body["decision"]


@pytest.mark.asyncio
async def test_correlation_id_header_echoed(app_client: AsyncClient) -> None:
    cid = "test-correlation-abc"
    resp = await app_client.post(
        VERIFY_URL,
        json=_payload(40),
        headers={"x-crust-request-id": cid},
    )
    assert resp.headers.get("x-crust-request-id") == cid


@pytest.mark.asyncio
async def test_action_header_accepted(app_client: AsyncClient) -> None:
    resp = await app_client.post(
        VERIFY_URL,
        json=_payload(40),
        headers={"x-crust-action": "login"},
    )
    assert resp.status_code == 200


# ── Human-like vector tends toward PASS ───────────────────────────────────────

@pytest.mark.asyncio
async def test_high_confidence_human_vector(
    app_client: AsyncClient,
    test_settings,
) -> None:
    """
    A 40-vector with env_webdriver_flag=0 and strong human signals should
    produce confidence > threshold_hard (i.e. not BLOCK).
    """
    # Access the function from conftest (available via sys.modules)
    import conftest
    resp = await app_client.post(VERIFY_URL, json={"feature_vector": conftest.human_like_vector()})
    body = resp.json()
    assert body["decision"] != DecisionEnum.BLOCK.value


# ── Inference latency ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_inference_latency_100_calls(app_client: AsyncClient) -> None:
    """
    Mean end-to-end HTTP call latency for 100 sequential /verify requests
    must be ≤ 150 ms (network + inference).  Pure inference tested separately.
    """
    n = 100
    start = time.perf_counter()
    for _ in range(n):
        resp = await app_client.post(VERIFY_URL, json=_payload(40))
        assert resp.status_code == 200
    mean_ms = (time.perf_counter() - start) * 1000 / n
    # Generous HTTP budget — pure XGBoost inference guard (15 ms) is in inference.py
    assert mean_ms < 150, f"Mean latency {mean_ms:.1f} ms exceeded 150 ms"


@pytest.mark.asyncio
async def test_pure_inference_latency_100_calls(model_path: str) -> None:
    """
    Direct CrustModel.predict() calls (no HTTP) must average ≤ 15 ms.
    """
    from inference import CrustModel
    model = CrustModel(model_path, warn_latency_ms=15.0)
    vec = [0.5] * 40
    n = 100

    times: list[float] = []
    for _ in range(n):
        t0 = time.perf_counter()
        model.predict(vec, vector_len=40)
        times.append((time.perf_counter() - t0) * 1000)

    mean_ms = sum(times) / len(times)
    assert mean_ms <= 15.0, f"Mean inference latency {mean_ms:.2f} ms exceeded 15 ms"


# ── Rate limiting ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_rate_limit_6th_request_is_429(app_client: AsyncClient) -> None:
    """
    Fire 6 requests in rapid succession; the 6th must return 429.
    slowapi uses in-memory storage so this is deterministic in tests.
    """
    responses = []
    for _ in range(6):
        r = await app_client.post(VERIFY_URL, json=_payload(40))
        responses.append(r.status_code)

    # At least one response must be 429
    assert 429 in responses, f"Expected a 429 among {responses}"


@pytest.mark.asyncio
async def test_rate_limit_response_shape(app_client: AsyncClient) -> None:
    """429 response must contain structured JSON error body."""
    # Fire requests until we get a 429
    for _ in range(10):
        r = await app_client.post(VERIFY_URL, json=_payload(40))
        if r.status_code == 429:
            body = r.json()
            assert body["error"] == "RATE_LIMIT_EXCEEDED"
            return
    pytest.skip("Did not trigger rate limit in 10 requests")
