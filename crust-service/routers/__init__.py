"""CRUST Verification Service — API routers."""

# Import models FIRST to establish the type namespace
from models import *  # noqa: F401, F403

# Now import the routers (they depend on models being available)
from . import challenge, health, verify

__all__ = ["challenge", "health", "verify"]
