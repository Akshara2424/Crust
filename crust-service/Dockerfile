# ── Build stage ────────────────────────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /build

# Install build tools for any native extensions (xgboost wheels are pre-built)
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt


# ── Runtime stage ──────────────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

LABEL org.opencontainers.image.title="CRUST Verification Service" \
      org.opencontainers.image.description="ML-based passive human verification" \
      org.opencontainers.image.version="1.0.0"

# Non-root user for runtime isolation
RUN groupadd --gid 1001 crust \
    && useradd  --uid 1001 --gid crust --no-create-home --shell /bin/false crust

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /install /usr/local

# Copy application source (model/ directory is bind-mounted at runtime via compose)
COPY --chown=crust:crust . .

# Ensure the model directory exists (populated by train.py or a volume mount)
RUN mkdir -p model && chown crust:crust model

USER crust

# Expose port; actual binding is via uvicorn in CMD
EXPOSE 8000

# Lightweight health check using wget (available in slim)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/crust/health')" \
    || exit 1

# Uvicorn with 2 workers; tune via env var for production
CMD ["sh", "-c", \
     "uvicorn main:app \
      --host 0.0.0.0 \
      --port 8000 \
      --workers ${UVICORN_WORKERS:-2} \
      --log-config /dev/null \
      --no-access-log"]
