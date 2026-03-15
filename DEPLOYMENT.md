# CRUST — Deployment Guide

This guide takes an engineer unfamiliar with CRUST from zero to a fully running
stack in under 20 minutes.

---

## 1. Prerequisites

Install these before starting:

| Tool | Version | Check |
|------|---------|-------|
| Git | any | `git --version` |
| Node.js | 20+ | `node --version` |
| Python | 3.12+ | `python3 --version` |
| Docker | any | `docker --version` |
| Docker Compose | v2+ | `docker compose version` |

On macOS, Docker Desktop includes Docker Compose v2.
On Linux: `sudo apt install docker-compose-plugin` or follow the [official guide](https://docs.docker.com/compose/install/).

---

## 2. Clone and set up

```bash
git clone <repo-url> crust
cd crust
```

---

## 3. Generate RSA keys

CRUST uses RS256 JWTs. You need a 2048-bit key pair. The script generates
them and writes them directly into `.env`:

```bash
pip install cryptography      # one-time, if not already installed
python crust-service/generate_keys.py
```

Expected output:
```
🔑 Generating RSA-2048 key pair for CRUST...
   Written: crust_private.pem
   Written: crust_public.pem
   Written: .env (CRUST_PRIVATE_KEY_PEM + CRUST_PUBLIC_KEY_PEM)

✅ Keys generated successfully.
```

> ⚠️ **Never commit `crust_private.pem` or `.env` to version control.**
> Both are in `.gitignore` by default.

---

## 4. Train the model

The XGBoost classifier needs to be trained before the service can run.
This step generates synthetic training data and writes the model file:

```bash
cd crust-service
pip install -r requirements.txt
python model/train.py
cd ..
```

Expected output:
```
🤖 Training CRUST XGBoost model...

  Generating 8000 human samples + 2000 bot samples...
  Training XGBoost classifier...
  [50]    val-auc: 0.97821
  [100]   val-auc: 0.98634
  Validation accuracy: 0.964
  Model saved to: model/crust_model.json

✅ Model training complete.
```

> The synthetic model is for demo purposes only. See the
> **Production Checklist** at the end of this guide.

---

## 5. Start all services

```bash
docker compose up --build
```

First build takes ~2–3 minutes (pulling base images, installing deps).
Subsequent starts take ~20 seconds.

Wait until you see all four services healthy:

```
crust-service  | INFO: CRUST service ready
demo-app       | {"event":"server_start","port":3000}
prometheus     | Server is ready to receive web requests
grafana        | HTTP Server Listen on 0.0.0.0:3000
```

Verify health:
```bash
curl http://localhost:8000/health
# → {"status":"ok","model_version":"xgboost-loaded"}
```

---

## 6. Access the demo

| URL | What you'll see |
|-----|----------------|
| http://localhost:3000 | Login page — CRUST-protected |
| http://localhost:3000/checkout | Checkout page — CRUST-protected |

**Try it:**
1. Open http://localhost:3000 in Chrome
2. Press **F12** → Network tab
3. Type a username and password
4. Click **Sign in**
5. Watch the `POST /api/auth/login` request — it has an `x-crust-jwt` header
6. Bottom-right corner shows the **CrustStatusBadge**: `PASS 0.91`

**Trigger a challenge:**
The confidence score is deterministic from the feature vector. To force
a `SOFT_CHALLENGE`, open a fresh private/incognito window (no mouse movement
history) and submit immediately without moving the mouse. The badge will show
`SOFT 0.72` and the pizza challenge will appear inline.

---

## 7. Access observability

| Service | URL | Credentials |
|---------|-----|-------------|
| Prometheus | http://localhost:9090 | none |
| Grafana | http://localhost:3001 | admin / admin |

In Grafana, two dashboards are auto-provisioned:
- **CRUST — Human Verification** (request traffic, latency, failure reasons)
- **CRUST — Overview** (challenge rate, decision distribution, bot block rate)

Both appear under **Dashboards → CRUST** in the left sidebar.

---

## 8. Run E2E tests

The Playwright tests require the demo-app server to be running.
Docker Compose handles that, or start it manually (see local dev below).

```bash
cd e2e
npm install
npx playwright install chromium
npx playwright test
```

Expected output:
```
Running 4 test suites...

  ✓ human-flow.spec.ts (9 tests) — 12s
  ✓ challenge-flow.spec.ts (8 tests) — 18s
  ✓ bot-rejection.spec.ts (7 tests) — 8s
  ✓ failure-modes.spec.ts (6 tests) — 22s

  30 passed (60s)
```

To run with a visible browser window:
```bash
npx playwright test --headed
```

To debug a specific test:
```bash
npx playwright test human-flow --debug
```

---

## 9. Local development (without Docker)

If you want hot-reload during development:

**Terminal 1 — Python service:**
```bash
cd crust-service
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt

export CRUST_PRIVATE_KEY_PEM=$(cat ../crust_private.pem)
export CRUST_PUBLIC_KEY_PEM=$(cat ../crust_public.pem)

uvicorn app.main:app --port 8000 --reload
```

**Terminal 2 — Express + React:**
```bash
cd crust-middleware
npm install && npm run build && npm link

cd ../demo-app
npm link crust-middleware
npm install

export CRUST_PUBLIC_KEY_PEM=$(cat ../crust_public.pem)
export CRUST_SERVICE_URL=http://localhost:8000

npm run dev        # starts both Express :3000 and Vite :5173
```

Open http://localhost:5173

---

## 10. Stopping everything

```bash
# Stop containers (preserves volumes)
docker compose stop

# Stop and remove containers + volumes
docker compose down -v
```

---

## 11. Production checklist

Complete every item before directing real traffic at CRUST:

```
□ Rotate RSA keys
    Re-run: python crust-service/generate_keys.py
    Deploy new CRUST_PUBLIC_KEY_PEM to all middleware instances.
    Old JWTs will be invalid immediately — plan for a brief grace period.

□ Replace synthetic model with real traffic data
    Run in shadow mode (see below) for ≥ 4 weeks.
    Export shadow logs, label them, retrain:
        python crust-service/model/train.py --data path/to/real_logs.csv

□ Enable shadow mode first
    Set CRUST_SHADOW_MODE=true in crust-service env.
    In shadow mode, the service logs decisions but always returns PASS.
    Monitor Grafana for 4+ weeks before switching to enforcement.

□ Calibrate thresholds on real traffic
    After shadow mode, analyse the confidence score distribution.
    Adjust via env vars:
        CRUST_THRESHOLD_PASS=0.85
        CRUST_THRESHOLD_SOFT_CHALLENGE=0.60
        CRUST_THRESHOLD_HARD_CHALLENGE=0.40

□ Rate limiting at load balancer
    Apply per-IP rate limits upstream (NGINX / Cloudflare / ALB).
    The service itself rate-limits at 5 req/s per IP but this
    should not be the first line of defence.

□ TLS everywhere
    Ensure all traffic to /verify uses HTTPS.
    The feature vector contains behavioural signals — treat as PII.

□ Key rotation schedule
    Rotate RSA keys at least quarterly.
    Set a calendar reminder now.

□ Remove CrustStatusBadge from production builds
    The badge in demo-app/frontend/src/components/CrustStatusBadge.tsx
    exposes confidence scores. Gate it behind a dev-only flag:
        {process.env.NODE_ENV === 'development' && <CrustStatusBadge ... />}

□ Audit logging
    Every /verify response includes a feature_hash in the JWT.
    Archive JWTs in your access logs for fraud investigation.

□ Monitor the Grafana Overview dashboard
    Set alerts on:
        - Bot block rate < 80%  (possible model degradation)
        - Challenge trigger rate > 20%  (possible false-positive spike)
        - Service error rate > 0.1 req/s  (infra issue)
```

---

## Quick reference

```bash
# Generate keys (once, or after rotation)
python crust-service/generate_keys.py

# Train model
cd crust-service && python model/train.py && cd ..

# Start full stack
docker compose up --build

# Run E2E tests
cd e2e && npm install && npx playwright install chromium && npx playwright test

# View logs
docker compose logs -f crust-service
docker compose logs -f demo-app

# Restart a single service
docker compose restart crust-service
```
