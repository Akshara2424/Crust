# CRUST — Passive Human Verification System

A machine-learning based CAPTCHA replacement that distinguishes humans from bots
using passive browser behavioural signals. No user interruption unless the model
is uncertain — only then does a lightweight pizza-assembly challenge appear.

---

## Architecture

```
Browser
  └─► CRUST SDK (Web Worker, < 8 KB)
        │  40 behavioural signals collected passively
        │  POST /api/crust/verify  { feature_vector: float[40] }
        ▼
  demo-app (Express proxy)
        │
        ▼
  crust-service (Python / FastAPI / XGBoost)
        │  confidence 0.0–1.0  →  DecisionEnum  →  RS256 JWT
        ▼
  crustGuard middleware
        │  validates JWT locally (no network call)
        ├─► 200 OK   (PASS)
        └─► 403      (BLOCK / expired / tampered)

  Toppings Challenge (React, inline)
        Triggered only on SOFT_CHALLENGE (confidence 0.60–0.84)
        Collects 8 extra interaction signals during pizza assembly
```

---

## Repo structure

```
/
├── crust-service/          Phase 2 — Python FastAPI ML service
├── crust-toppings/         Phase 3 — React Toppings Challenge component
├── crust-middleware/       Phase 4A — Express crustGuard middleware
├── demo-app/               Phase 4B — Wired demo (Express + React)
│   ├── frontend/           Vite + React frontend
│   └── server/             Express server with guarded routes
├── docker-compose.yml      Full stack orchestration
├── prometheus.yml          Scrape config
├── grafana/                Dashboard + datasource provisioning
└── .env.example            Required environment variables
```

---

## Quick start

### Option A — Docker Compose (full stack)

**1. Generate RSA keys**

```bash
openssl genrsa -out crust_private.pem 2048
openssl rsa -in crust_private.pem -pubout -out crust_public.pem
```

**2. Set environment variables**

```bash
cp .env.example .env

# Fill in the base64-encoded keys:
export CRUST_PRIVATE_KEY_PEM=$(base64 -w 0 crust_private.pem)
export CRUST_PUBLIC_KEY_PEM=$(base64 -w 0 crust_public.pem)

# Write them into .env
echo "CRUST_PRIVATE_KEY_PEM=$CRUST_PRIVATE_KEY_PEM" >> .env
echo "CRUST_PUBLIC_KEY_PEM=$CRUST_PUBLIC_KEY_PEM"   >> .env
```

**3. Start everything**

```bash
docker compose up --build
```

| Service      | URL                      |
|-------------|--------------------------|
| Demo app     | http://localhost:3000    |
| ML service   | http://localhost:8000    |
| Prometheus   | http://localhost:9090    |
| Grafana      | http://localhost:3001    |

Grafana login: `admin` / `admin`

---

### Option B — Local dev (no Docker)

**Prerequisites:** Node 20+, Python 3.12+

**1. Start the Python ML service**

```bash
cd crust-service
pip install -r requirements.txt
export CRUST_PRIVATE_KEY_PEM=$(cat ../crust_private.pem)
export CRUST_PUBLIC_KEY_PEM=$(cat ../crust_public.pem)
uvicorn app.main:app --port 8000 --reload
```

**2. Build and link crust-middleware**

```bash
cd crust-middleware
npm install
npm run build
npm link
```

**3. Start the demo app server**

```bash
cd demo-app
npm link crust-middleware
npm install

# Set env vars
export CRUST_PUBLIC_KEY_PEM=$(cat ../crust_public.pem)
export CRUST_SERVICE_URL=http://localhost:8000

npm run dev:server   # Express on :3000
```

**4. Start the frontend dev server**

```bash
# In a second terminal, from demo-app/
npm run dev:frontend  # Vite on :5173 (proxies /api → :3000)
```

Open http://localhost:5173

---

## Running tests

**Middleware (25 tests)**
```bash
cd crust-middleware
npm install
npm test
```

**Toppings Challenge (16 tests)**
```bash
cd crust-toppings
npm install
npm test
```

---

## Running Storybook (Toppings Challenge)

```bash
cd crust-toppings
npm install
npm run storybook
# → http://localhost:6006
```

---

## Environment variables reference

| Variable              | Used by          | Description |
|-----------------------|-----------------|-------------|
| `CRUST_PRIVATE_KEY_PEM` | crust-service  | Base64-encoded RS256 private key PEM for JWT signing |
| `CRUST_PUBLIC_KEY_PEM`  | demo-app       | Base64-encoded RS256 public key PEM for JWT verification |
| `CRUST_SERVICE_URL`     | demo-app       | URL the Express server proxies verify/challenge requests to |
| `CRUST_MODEL_PATH`      | crust-service  | Path to the XGBoost model JSON inside the container |
| `PORT`                  | demo-app       | Express server port (default: 3000) |
| `LOG_LEVEL`             | crust-service  | Uvicorn log level (default: info) |

---

## API reference

### POST `/api/crust/verify`
Proxied to crust-service. Accepts 40-float feature vector, returns signed JWT.

### POST `/api/crust/challenge/order`
Proxied to crust-service. Returns a randomised pizza order for the SOFT_CHALLENGE.

### POST `/api/crust/challenge/result`
Proxied to crust-service. Submits completed pizza order + 8 game signals, returns new JWT.

### POST `/api/auth/login` *(guarded)*
Requires valid `x-crust-jwt: <PASS JWT>` header. Returns 403 if missing/invalid.

### POST `/api/checkout` *(guarded)*
Requires valid `x-crust-jwt: <PASS JWT>` header.

### GET `/crust/metrics`
Prometheus text exposition of `crust_requests_total`, `crust_failures_total`,
`crust_validation_duration_ms`.

---

## Decision thresholds

| Decision        | Confidence   | Behaviour |
|----------------|-------------|-----------|
| `PASS`          | ≥ 0.85      | Transparent — user never interrupted |
| `SOFT_CHALLENGE`| 0.60–0.84   | Pizza assembly challenge shown inline |
| `HARD_CHALLENGE`| 0.40–0.59   | Escalated challenge (configurable per endpoint) |
| `BLOCK`         | < 0.40      | 403 Forbidden |

---

## JWT structure

```json
{
  "alg": "RS256",
  "typ": "JWT"
}
{
  "sub":          "crust-session",
  "iss":          "crust-verification-service",
  "iat":          1714000000,
  "exp":          1714000900,
  "confidence":   0.91,
  "decision":     "PASS",
  "feature_hash": "<sha256 of feature vector>"
}
```

Valid for **15 minutes** (`exp = iat + 900`). Gateway validates locally — no
network call to crust-service on every request.
