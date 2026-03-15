"""
CRUST Verification Service — Health + metrics endpoints.

GET /health   → { "status": "ok", "model_version": "..." }
GET /metrics  → Prometheus exposition format (text/plain)
"""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import PlainTextResponse
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest

from config import get_settings
from models import HealthResponse

router = APIRouter(tags=["observability"])

# ── Prometheus metrics ────────────────────────────────────────────────────────

verify_requests_total = Counter(
    "crust_verify_requests_total",
    "Total number of /verify requests processed",
    ["decision"],
)

verify_latency_seconds = Histogram(
    "crust_verify_latency_seconds",
    "End-to-end /verify request latency in seconds",
    buckets=[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0],
)

inference_latency_seconds = Histogram(
    "crust_inference_latency_seconds",
    "XGBoost inference latency in seconds",
    buckets=[0.001, 0.002, 0.005, 0.010, 0.015, 0.025, 0.05],
)

challenge_orders_total = Counter(
    "crust_challenge_orders_total",
    "Total Toppings challenge orders generated",
)

challenge_results_total = Counter(
    "crust_challenge_results_total",
    "Total Toppings challenge results submitted",
    ["outcome"],   # "pass", "mismatch", "expired"
)


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Service health check",
)
async def health(request: Request) -> HealthResponse:
    """
    GET /health

    Returns 200 with model version if the service is healthy.
    The gateway or load balancer can poll this endpoint.
    """
    settings = get_settings()
    # Model readiness check — raises AttributeError if lifespan didn't complete
    model_loaded: bool = hasattr(request.app.state, "model")

    return HealthResponse(
        status="ok" if model_loaded else "degraded",
        model_version=settings.model_version,
    )


@router.get(
    "/metrics",
    summary="Prometheus metrics",
    response_class=PlainTextResponse,
)
async def metrics() -> PlainTextResponse:
    """
    GET /metrics

    Returns all registered Prometheus counters and histograms in the
    standard text exposition format.
    """
    data = generate_latest()
    return PlainTextResponse(
        content=data.decode("utf-8"),
        media_type=CONTENT_TYPE_LATEST,
    )
