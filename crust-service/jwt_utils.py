"""
CRUST Verification Service — JWT utilities.

All tokens are RS256-signed with a 2048-bit key pair.
Payload structure matches the CRUST spec exactly:

    {
        "sub":          "crust-session",
        "iss":          "crust-verification-service",
        "iat":          <epoch int>,
        "exp":          <iat + 900>,
        "confidence":   <float>,
        "decision":     <DecisionEnum string>,
        "feature_hash": <SHA-256 hex of the serialised feature vector>
    }
"""

from __future__ import annotations

import hashlib
import json
import time
from typing import Any

from jose import JWTError, jwt
from jose.exceptions import ExpiredSignatureError, JWTClaimsError

from models import DecisionEnum

_ALGORITHM = "RS256"
_EXPECTED_ISS = "crust-verification-service"
_EXPECTED_SUB = "crust-session"


# ── Feature hashing ───────────────────────────────────────────────────────────

def hash_feature_vector(feature_vector: list[float]) -> str:
    """
    Compute SHA-256 hex digest of the feature vector.

    The vector is serialised to a compact JSON array (no whitespace) with
    6 decimal places of precision so the hash is deterministic across
    language boundaries.
    """
    serialised = json.dumps(
        [round(float(v), 6) for v in feature_vector],
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(serialised).hexdigest()


# ── Token signing ─────────────────────────────────────────────────────────────

def sign_jwt(
    *,
    confidence: float,
    decision: DecisionEnum,
    feature_vector: list[float],
    private_key_pem: str,
    issuer: str = _EXPECTED_ISS,
    subject: str = _EXPECTED_SUB,
    ttl_seconds: int = 900,
) -> str:
    """
    Sign and return a CRUST JWT.

    Args:
        confidence:      Model confidence score (0–1).
        decision:        DecisionEnum value.
        feature_vector:  The 40-float input vector (hashed, not embedded).
        private_key_pem: RS256 private key in PEM format.
        issuer:          JWT `iss` claim.
        subject:         JWT `sub` claim.
        ttl_seconds:     Token lifetime in seconds (default 900 = 15 min).

    Returns:
        Signed JWT string.
    """
    now = int(time.time())
    payload: dict[str, Any] = {
        "sub":          subject,
        "iss":          issuer,
        "iat":          now,
        "exp":          now + ttl_seconds,
        "confidence":   round(float(confidence), 6),
        "decision":     decision.value,
        "feature_hash": hash_feature_vector(feature_vector),
    }
    return jwt.encode(payload, private_key_pem, algorithm=_ALGORITHM)


# ── Token verification ────────────────────────────────────────────────────────

class CrustJWTError(Exception):
    """Raised when a CRUST JWT is invalid for any reason."""


def verify_jwt(token: str, public_key_pem: str) -> dict[str, Any]:
    """
    Verify a CRUST JWT signature, expiry, issuer, and subject.

    Args:
        token:          JWT string.
        public_key_pem: RS256 public key in PEM format.

    Returns:
        Decoded payload dict.

    Raises:
        CrustJWTError: for any validation failure (expired, tampered,
                       wrong issuer/subject, malformed).
    """
    try:
        payload = jwt.decode(
            token,
            public_key_pem,
            algorithms=[_ALGORITHM],
            options={"require": ["exp", "iat", "sub", "iss"]},
        )
    except ExpiredSignatureError as exc:
        raise CrustJWTError("Token has expired") from exc
    except JWTClaimsError as exc:
        raise CrustJWTError(f"Invalid claims: {exc}") from exc
    except JWTError as exc:
        raise CrustJWTError(f"Invalid token: {exc}") from exc

    if payload.get("iss") != _EXPECTED_ISS:
        raise CrustJWTError(
            f"Wrong issuer: expected '{_EXPECTED_ISS}', got '{payload.get('iss')}'"
        )
    if payload.get("sub") != _EXPECTED_SUB:
        raise CrustJWTError(
            f"Wrong subject: expected '{_EXPECTED_SUB}', got '{payload.get('sub')}'"
        )

    return payload
