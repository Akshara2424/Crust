# ── Stage 1: dependency installation ──────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /app

# Install build deps for cryptography / xgboost wheels
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libffi-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --upgrade pip \
 && pip install --no-cache-dir --prefix=/install -r requirements.txt

# ── Stage 2: lean production image ────────────────────────────────────────────
FROM python:3.12-slim

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /install /usr/local

# Copy application code
COPY . .

# Non-root user for security
RUN adduser --disabled-password --gecos "" crustuser
USER crustuser

EXPOSE 8000

# uvicorn with 2 workers; override via CMD in compose for dev --reload
CMD ["uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "2"]
