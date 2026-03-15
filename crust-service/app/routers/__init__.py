"""CRUST Verification Service — API routers."""

# Import schemas FIRST to establish the type namespace
from ..schemas import *  # noqa: F401, F403

# Now import the routers (they depend on schemas being available)
from . import challenge, health, verify

__all__ = ["challenge", "health", "verify"]
