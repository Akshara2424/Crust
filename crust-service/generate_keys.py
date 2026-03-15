"""
CRUST — RSA key pair generator.

Generates a 2048-bit RS256 key pair and writes them base64-encoded
into .env at the repo root.

Usage:
    python crust-service/generate_keys.py
"""
from __future__ import annotations

import base64
import os
import sys
from pathlib import Path


def generate_keys() -> tuple[str, str]:
    """Generate RSA-2048 key pair. Returns (private_pem, public_pem)."""
    try:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
    except ImportError:
        print("ERROR: cryptography package not installed.")
        print("Run: pip install cryptography")
        sys.exit(1)

    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
    )

    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()

    public_pem = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()

    return private_pem, public_pem


def write_env(private_pem: str, public_pem: str, env_path: Path) -> None:
    """Write or update CRUST key vars in .env file."""
    private_b64 = base64.b64encode(private_pem.encode()).decode()
    public_b64  = base64.b64encode(public_pem.encode()).decode()

    # Read existing .env if present
    existing: dict[str, str] = {}
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                existing[k.strip()] = v.strip()

    existing["CRUST_PRIVATE_KEY_PEM"] = private_b64
    existing["CRUST_PUBLIC_KEY_PEM"]  = public_b64

    lines = [f"{k}={v}" for k, v in existing.items()]
    env_path.write_text("\n".join(lines) + "\n")


def main() -> None:
    # Resolve repo root (parent of crust-service/)
    script_dir = Path(__file__).parent
    repo_root  = script_dir.parent
    env_path   = repo_root / ".env"

    print("🔑 Generating RSA-2048 key pair for CRUST...")
    private_pem, public_pem = generate_keys()

    # Also write raw PEM files for local dev convenience
    (repo_root / "crust_private.pem").write_text(private_pem)
    (repo_root / "crust_public.pem").write_text(public_pem)
    print(f"   Written: crust_private.pem")
    print(f"   Written: crust_public.pem")

    # Write base64-encoded vars into .env
    write_env(private_pem, public_pem, env_path)
    print(f"   Written: {env_path} (CRUST_PRIVATE_KEY_PEM + CRUST_PUBLIC_KEY_PEM)")

    print()
    print("✅ Keys generated successfully.")
    print()
    print("   For Docker Compose:  docker compose up --build")
    print("   For local dev:       source .env  (or set vars manually)")
    print()
    print("⚠️  Keep crust_private.pem secret — never commit it.")


if __name__ == "__main__":
    main()
