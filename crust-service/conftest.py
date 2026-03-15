"""
CRUST tests — shared pytest fixtures.

Provides:
  - rsa_keys:       freshly generated 2048-bit RS256 keypair (session-scoped)
  - trained_model:  CrustModel trained on minimal synthetic data (session-scoped)
  - app_client:     httpx AsyncClient against the FastAPI app (function-scoped)
  - mock_settings:  Settings override pointing at test keys + temp model
"""

from __future__ import annotations

import base64
import os
import sys
import tempfile
from collections.abc import AsyncIterator

import numpy as np
import pytest
import pytest_asyncio

# Ensure project root is on the path when running from tests/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import xgboost as xgb
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from httpx import ASGITransport, AsyncClient


# ── RSA keypair ───────────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def rsa_keys() -> dict[str, str]:
    """Generate a fresh 2048-bit RSA keypair for the test session."""
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    private_pem: str = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")

    public_pem: str = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("utf-8")

    return {"private": private_pem, "public": public_pem}


# ── Minimal trained model ─────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def model_path(tmp_path_factory: pytest.TempPathFactory) -> str:
    """
    Train a tiny XGBoost model on synthetic data and return the path to the
    saved JSON file.  Runs once per test session.
    """
    rng = np.random.default_rng(0)
    n_human, n_bot = 500, 250

    # Quick synthetic dataset — same structure as model/train.py but smaller
    X_human = rng.random((n_human, 40)).astype(np.float32)
    X_bot   = rng.random((n_bot,   40)).astype(np.float32)
    # Make bots obviously different: zero out the first 3 dims
    X_bot[:, 0] = 1.0   # webdriver flag
    X_bot[:, 1] = 0.0   # low canvas hash
    X_bot[:, 2] = 0.0   # no plugins

    X = np.vstack([X_human, X_bot])
    y = np.array([1] * n_human + [0] * n_bot, dtype=np.int32)

    model = xgb.XGBClassifier(
        n_estimators=20,
        max_depth=3,
        use_label_encoder=False,
        eval_metric="auc",
        random_state=42,
        tree_method="hist",
    )
    model.fit(X, y, verbose=False)

    tmp_dir = tmp_path_factory.mktemp("model")
    path = str(tmp_dir / "crust_model.json")
    model.save_model(path)
    return path


# ── Settings override ─────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def test_settings(rsa_keys: dict[str, str], model_path: str):
    """Return a Settings instance wired to test keys and temp model."""
    from config import Settings

    private_b64 = base64.b64encode(rsa_keys["private"].encode()).decode()
    public_b64  = base64.b64encode(rsa_keys["public"].encode()).decode()

    return Settings(
        crust_private_key_pem=private_b64,
        crust_public_key_pem=public_b64,
        model_path=model_path,
        model_version="test-1.0",
        threshold_pass=0.85,
        threshold_soft=0.60,
        threshold_hard=0.40,
        challenge_ttl_seconds=60,
        challenge_boost_fast=0.15,
        challenge_boost_slow=0.10,
        challenge_fast_threshold_s=20.0,
    )


# ── FastAPI test client ───────────────────────────────────────────────────────

@pytest_asyncio.fixture()
async def app_client(test_settings) -> AsyncIterator[AsyncClient]:
    """
    Yield an httpx AsyncClient backed by the FastAPI app.
    Overrides get_settings() dependency so the app uses test keys + model.
    """
    from config import get_settings
    from main import create_app

    app = create_app()
    app.dependency_overrides[get_settings] = lambda: test_settings

    # Manually load model into app.state (bypasses lifespan for speed)
    from inference import load_model
    app.state.model = load_model(test_settings.model_path)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


# ── Helpers ───────────────────────────────────────────────────────────────────

def make_feature_vector(n: int = 40, value: float = 0.5) -> list[float]:
    """Return a list of `n` floats all equal to `value`."""
    return [value] * n


def human_like_vector() -> list[float]:
    """Return a 40-float vector that looks like a real human session."""
    rng = np.random.default_rng(1)
    v = rng.random(40).tolist()
    v[0] = 0.0   # no webdriver
    v[17] = 0.9  # high Fitts adherence
    return v


def bot_like_vector() -> list[float]:
    """Return a 40-float vector that looks like a bot."""
    v = [0.5] * 40
    v[0] = 1.0   # webdriver flag
    v[1] = 0.0   # zero canvas hash
    v[2] = 0.0   # no plugins
    v[17] = 0.1  # poor Fitts adherence
    v[18] = 0.01 # very fast IKI
    return v
