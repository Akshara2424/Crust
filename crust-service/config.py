"""
CRUST Verification Service — Configuration
Reads all tuneable values from environment variables.
No secrets are hardcoded; keys are base64-encoded PEMs in env vars.
"""

from __future__ import annotations

import base64
from functools import lru_cache

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
        protected_namespaces=(),  # Allow 'model_' prefix for fields
    )

    # ── Service identity ──────────────────────────────────────────────────────
    jwt_issuer: str = Field(default="crust-verification-service")
    jwt_subject: str = Field(default="crust-session")
    jwt_ttl_seconds: int = Field(default=900)  # 15 min
    model_version: str = Field(default="1.0.0")

    # ── RSA keys (base64-encoded PEM strings) ─────────────────────────────────
    crust_private_key_pem: str = Field(
        default="",
        description="Base64-encoded RS256 private key PEM for JWT signing",
    )
    crust_public_key_pem: str = Field(
        default="",
        description="Base64-encoded RS256 public key PEM for JWT verification",
    )

    # ── Decision thresholds ───────────────────────────────────────────────────
    threshold_pass: float = Field(default=0.85, ge=0.0, le=1.0)
    threshold_soft: float = Field(default=0.60, ge=0.0, le=1.0)
    threshold_hard: float = Field(default=0.40, ge=0.0, le=1.0)

    # ── Rate limiting ─────────────────────────────────────────────────────────
    rate_limit_verify: str = Field(default="5/second")

    # ── Model path ────────────────────────────────────────────────────────────
    model_path: str = Field(default="model/crust_model.json")

    # ── Inference guard ───────────────────────────────────────────────────────
    inference_latency_warn_ms: float = Field(default=15.0)

    # ── Challenge store ───────────────────────────────────────────────────────
    challenge_ttl_seconds: int = Field(default=60)
    challenge_boost_fast: float = Field(default=0.15)   # solved ≤ 20 s
    challenge_boost_slow: float = Field(default=0.10)   # solved ≤ 60 s
    challenge_fast_threshold_s: float = Field(default=20.0)

    # ── Derived: decoded PEM strings ─────────────────────────────────────────
    @model_validator(mode="after")
    def decode_keys(self) -> "Settings":
        """
        Decode base64-encoded keys to raw PEM strings so jwt_utils can use
        them directly.  Falls back gracefully if keys are empty (test env).
        """
        if self.crust_private_key_pem:
            try:
                self.crust_private_key_pem = base64.b64decode(
                    self.crust_private_key_pem
                ).decode("utf-8")
            except Exception:
                pass  # already decoded or invalid — leave as-is

        if self.crust_public_key_pem:
            try:
                self.crust_public_key_pem = base64.b64decode(
                    self.crust_public_key_pem
                ).decode("utf-8")
            except Exception:
                pass

        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return a cached singleton Settings instance."""
    return Settings()
