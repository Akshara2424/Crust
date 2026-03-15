"""
CRUST tests — JWT signing and verification.

Covers: valid token accepted, expired rejected, tampered signature rejected,
wrong issuer rejected, wrong subject rejected, missing claims rejected.
"""

from __future__ import annotations

import time

import pytest
from jose import jwt as jose_jwt

from jwt_utils import CrustJWTError, hash_feature_vector, sign_jwt, verify_jwt
from models import DecisionEnum


# ── Fixtures ──────────────────────────────────────────────────────────────────

SAMPLE_VECTOR = [0.5] * 40


# ── Helper ────────────────────────────────────────────────────────────────────

def _make_valid_token(rsa_keys: dict[str, str], ttl: int = 900) -> str:
    return sign_jwt(
        confidence=0.91,
        decision=DecisionEnum.PASS,
        feature_vector=SAMPLE_VECTOR,
        private_key_pem=rsa_keys["private"],
        ttl_seconds=ttl,
    )


# ── Valid token ───────────────────────────────────────────────────────────────

def test_valid_token_accepted(rsa_keys: dict[str, str]) -> None:
    token = _make_valid_token(rsa_keys)
    payload = verify_jwt(token, rsa_keys["public"])
    assert payload["decision"] == DecisionEnum.PASS.value
    assert payload["confidence"] == pytest.approx(0.91, abs=1e-5)
    assert payload["sub"] == "crust-session"
    assert payload["iss"] == "crust-verification-service"


def test_payload_contains_feature_hash(rsa_keys: dict[str, str]) -> None:
    token = _make_valid_token(rsa_keys)
    payload = verify_jwt(token, rsa_keys["public"])
    expected_hash = hash_feature_vector(SAMPLE_VECTOR)
    assert payload["feature_hash"] == expected_hash


def test_payload_exp_is_iat_plus_ttl(rsa_keys: dict[str, str]) -> None:
    token = _make_valid_token(rsa_keys, ttl=300)
    payload = verify_jwt(token, rsa_keys["public"])
    assert payload["exp"] == payload["iat"] + 300


# ── Expired token ─────────────────────────────────────────────────────────────

def test_expired_token_rejected(rsa_keys: dict[str, str]) -> None:
    # Sign a token that expired 1 second ago
    token = sign_jwt(
        confidence=0.9,
        decision=DecisionEnum.PASS,
        feature_vector=SAMPLE_VECTOR,
        private_key_pem=rsa_keys["private"],
        ttl_seconds=-1,   # already expired
    )
    with pytest.raises(CrustJWTError, match="expired"):
        verify_jwt(token, rsa_keys["public"])


# ── Tampered signature ────────────────────────────────────────────────────────

def test_tampered_signature_rejected(rsa_keys: dict[str, str]) -> None:
    token = _make_valid_token(rsa_keys)
    # Flip the last character of the signature segment
    parts = token.split(".")
    assert len(parts) == 3
    sig = parts[2]
    tampered_sig = sig[:-1] + ("A" if sig[-1] != "A" else "B")
    tampered_token = ".".join([parts[0], parts[1], tampered_sig])
    with pytest.raises(CrustJWTError):
        verify_jwt(tampered_token, rsa_keys["public"])


# ── Wrong issuer ──────────────────────────────────────────────────────────────

def test_wrong_issuer_rejected(rsa_keys: dict[str, str]) -> None:
    now = int(time.time())
    payload = {
        "sub": "crust-session",
        "iss": "evil-issuer",          # ← wrong
        "iat": now,
        "exp": now + 900,
        "confidence": 0.9,
        "decision": "PASS",
        "feature_hash": "abc123",
    }
    token = jose_jwt.encode(payload, rsa_keys["private"], algorithm="RS256")
    with pytest.raises(CrustJWTError, match="issuer"):
        verify_jwt(token, rsa_keys["public"])


# ── Wrong subject ─────────────────────────────────────────────────────────────

def test_wrong_subject_rejected(rsa_keys: dict[str, str]) -> None:
    now = int(time.time())
    payload = {
        "sub": "not-crust-session",    # ← wrong
        "iss": "crust-verification-service",
        "iat": now,
        "exp": now + 900,
        "confidence": 0.9,
        "decision": "PASS",
        "feature_hash": "abc123",
    }
    token = jose_jwt.encode(payload, rsa_keys["private"], algorithm="RS256")
    with pytest.raises(CrustJWTError, match="subject"):
        verify_jwt(token, rsa_keys["public"])


# ── Malformed token ───────────────────────────────────────────────────────────

def test_malformed_token_rejected(rsa_keys: dict[str, str]) -> None:
    with pytest.raises(CrustJWTError):
        verify_jwt("not.a.jwt", rsa_keys["public"])


def test_empty_token_rejected(rsa_keys: dict[str, str]) -> None:
    with pytest.raises(CrustJWTError):
        verify_jwt("", rsa_keys["public"])


# ── Wrong key ─────────────────────────────────────────────────────────────────

def test_wrong_public_key_rejected(rsa_keys: dict[str, str]) -> None:
    """Signing key and verification key do not match → should fail."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa as crypto_rsa

    other_key = crypto_rsa.generate_private_key(public_exponent=65537, key_size=2048)
    other_public_pem = other_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("utf-8")

    token = _make_valid_token(rsa_keys)
    with pytest.raises(CrustJWTError):
        verify_jwt(token, other_public_pem)


# ── feature_hash determinism ──────────────────────────────────────────────────

def test_feature_hash_deterministic() -> None:
    v = [0.1, 0.2, 0.3] + [0.0] * 37
    assert hash_feature_vector(v) == hash_feature_vector(v)


def test_feature_hash_differs_for_different_vectors() -> None:
    v1 = [0.1] * 40
    v2 = [0.2] * 40
    assert hash_feature_vector(v1) != hash_feature_vector(v2)
