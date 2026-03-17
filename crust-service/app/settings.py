"""
CRUST service settings — loaded from environment variables via pydantic-settings.
"""
from __future__ import annotations

import base64
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # RSA keys — stored base64-encoded in env, decoded here
    crust_private_key_pem: str
    crust_public_key_pem:  str

    # Model
    crust_model_path: str = "/app/model/crust_model.json"

    # JWT
    jwt_expiry_seconds: int = 900      # 15 minutes
    jwt_issuer:         str = "crust-verification-service"

    # Decision thresholds
    threshold_pass:           float = 0.55   # anything above 0.55 → PASS
    threshold_soft_challenge: float = 0.35
    threshold_hard_challenge: float = 0.20

    # Server
    log_level: str = "info"

    @property
    def private_key_pem(self) -> str:
        """Base64-decode the private key PEM."""
        try:
            return base64.b64decode(self.crust_private_key_pem).decode()
        except Exception:
            # Already raw PEM (local dev without base64 encoding)
            return self.crust_private_key_pem

    @property
    def public_key_pem(self) -> str:
        """Base64-decode the public key PEM."""
        try:
            return base64.b64decode(self.crust_public_key_pem).decode()
        except Exception:
            return self.crust_public_key_pem


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
