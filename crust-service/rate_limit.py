"""
CRUST Verification Service — Rate limiting.

Uses slowapi (a Starlette-compatible wrapper around limits) to enforce
a per-IP rate limit of 5 requests/second on POST /verify.

The limiter instance is created here and imported by both the FastAPI app
(for middleware registration) and the verify router (for the decorator).
"""

from __future__ import annotations

import logging

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

logger = logging.getLogger("crust.rate_limit")

# ── Limiter singleton ─────────────────────────────────────────────────────────

limiter = Limiter(
    key_func=get_remote_address,
    default_limits=[],        # no blanket default; applied per-route
    storage_uri="memory://",  # in-process; replace with redis:// for multi-instance
)


# ── 429 exception handler ─────────────────────────────────────────────────────

async def rate_limit_exceeded_handler(
    request: Request,
    exc: RateLimitExceeded,
) -> Response:
    """Return a structured JSON 429 instead of slowapi's default plain-text."""
    logger.warning(
        "Rate limit exceeded for %s on %s",
        get_remote_address(request),
        request.url.path,
    )
    return JSONResponse(
        status_code=429,
        content={
            "error": "RATE_LIMIT_EXCEEDED",
            "detail": f"Too many requests. Limit: {exc.limit}",
        },
        headers={"Retry-After": "1"},
    )
