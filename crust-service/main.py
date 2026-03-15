"""
CRUST Verification Service — Application entry point.

Initialises FastAPI with:
  - Lifespan handler: loads XGBoost model into app.state at startup
  - Structured JSON logging with correlation ID middleware
  - slowapi rate-limit middleware + 429 handler
  - All routers: /verify, /challenge, /health, /metrics
"""

from __future__ import annotations

import json
import logging
import sys
import time
import uuid
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from config import get_settings
from inference import load_model
from models import DecisionEnum, VerifyRequest, VerifyResponse, ChallengeOrderResponse, ChallengeResultRequest
from rate_limit import limiter, rate_limit_exceeded_handler
from routers import challenge, health, verify


# ── Structured JSON logging ───────────────────────────────────────────────────

class _JsonFormatter(logging.Formatter):
    """Emit each log record as a single-line JSON object."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict = {
            "ts":      self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
            "level":   record.levelname,
            "logger":  record.name,
            "message": record.getMessage(),
        }
        # Merge any extra fields attached by the caller
        for key, val in record.__dict__.items():
            if key not in (
                "args", "asctime", "created", "exc_info", "exc_text",
                "filename", "funcName", "levelname", "levelno", "lineno",
                "message", "module", "msecs", "msg", "name", "pathname",
                "process", "processName", "relativeCreated", "stack_info",
                "taskName", "thread", "threadName",
            ):
                payload[key] = val
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload)


def _configure_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(_JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(logging.INFO)
    # Silence noisy third-party loggers
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("xgboost").setLevel(logging.WARNING)


_configure_logging()
logger = logging.getLogger("crust.main")


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Load model on startup; release resources on shutdown."""
    settings = get_settings()
    logger.info(
        "CRUST service starting",
        extra={"model_path": settings.model_path, "version": settings.model_version},
    )
    app.state.model = load_model(
        settings.model_path,
        warn_latency_ms=settings.inference_latency_warn_ms,
    )
    logger.info("Model loaded successfully")

    yield  # ← service is live

    logger.info("CRUST service shutting down")
    # No explicit teardown needed for XGBoost; GC handles memory.


# ── App factory ───────────────────────────────────────────────────────────────

def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="CRUST Verification Service",
        description=(
            "ML-based passive human verification. "
            "Accepts browser behavioural feature vectors and returns signed JWTs."
        ),
        version=settings.model_version,
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url=None,
    )

    # ── Rate limiting ─────────────────────────────────────────────────────────
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)  # type: ignore[arg-type]
    app.add_middleware(SlowAPIMiddleware)

    # ── CORS (tighten origins in production) ──────────────────────────────────
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["POST", "GET", "OPTIONS"],
        allow_headers=["*"],
    )

    # ── Request correlation ID middleware ─────────────────────────────────────
    @app.middleware("http")
    async def correlation_middleware(request: Request, call_next) -> Response:  # type: ignore[type-arg]
        cid = request.headers.get("x-crust-request-id", str(uuid.uuid4()))
        t0  = time.perf_counter()
        response: Response = await call_next(request)
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        response.headers["x-crust-request-id"] = cid
        logger.info(
            "http",
            extra={
                "correlation_id": cid,
                "method":  request.method,
                "path":    request.url.path,
                "status":  response.status_code,
                "ms":      round(elapsed_ms, 2),
            },
        )
        return response

    # ── Routers ───────────────────────────────────────────────────────────────
    app.include_router(verify.router,    prefix="/api/crust")
    app.include_router(challenge.router, prefix="/api/crust")
    app.include_router(health.router,    prefix="/api/crust")

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
        log_config=None,   # disable uvicorn's own logging; we use JSON formatter
    )
