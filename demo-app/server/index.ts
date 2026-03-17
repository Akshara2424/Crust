import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createProxyMiddleware } from 'http-proxy-middleware';
import cors from 'cors';
import crypto from 'crypto';

import { crustGuard, metricsHandler } from 'crust-middleware';
import { authRouter } from './routes/auth.js';
import { checkoutRouter } from './routes/checkout.js';
import { configRouter } from './routes/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Validate required env ─────────────────────────────────────────────────────

const PUBLIC_KEY_PEM = process.env.CRUST_PUBLIC_KEY_PEM;
const CRUST_SERVICE_URL = process.env.CRUST_SERVICE_URL ?? 'http://localhost:8000';
const PORT = parseInt(process.env.PORT ?? '3000', 10);

if (!PUBLIC_KEY_PEM) {
  console.error('FATAL: CRUST_PUBLIC_KEY_PEM env var is required');
  process.exit(1);
}

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('frontend/dist'));

// ── Serve CRUST SDK bundle + worker ──────────────────────────────────────────

const SDK_DIST = path.resolve(__dirname, '../../crust-sdk/dist');

app.get('/crust.js', (_req, res) => {
  res.sendFile(path.join(SDK_DIST, 'crust.iife.js'));
});

app.get('/dist/crust.worker.js', (_req, res) => {
  res.sendFile(path.join(SDK_DIST, 'crust.worker.js'));
});

// ── Assign correlation IDs ────────────────────────────────────────────────────

app.use((req, _res, next) => {
  if (!req.headers['x-correlation-id']) {
    req.headers['x-correlation-id'] = crypto.randomUUID();
  }
  next();
});

// ── Proxy CRUST service calls to Python backend ──────────────────────────────

app.use(
  '/api/crust/verify',
  createProxyMiddleware({
    target: CRUST_SERVICE_URL,
    changeOrigin: true,
  })
);

app.use(
  '/api/crust/challenge',
  createProxyMiddleware({
    target: CRUST_SERVICE_URL,
    changeOrigin: true,
  })
);

// ── Config endpoint (no auth) ─────────────────────────────────────────────────

app.use('/api/crust', configRouter);

// ── Guarded routes ────────────────────────────────────────────────────────────

const guard = crustGuard({
  publicKeyPem: PUBLIC_KEY_PEM,
  onFailure: (req, res, reason) => {
    const corrId = req.headers['x-correlation-id'] as string;

    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'crust_guard_failure',
        reason,
        correlationId: corrId,
        path: req.path,
        ts: new Date().toISOString(),
      })
    );

    res.status(403).json({
      error: 'CRUST_VERIFICATION_FAILED',
      reason,
      correlationId: corrId,
    });
  },
});

app.use('/api/auth', guard, authRouter);
app.use('/api/checkout', guard, checkoutRouter);

// ── Prometheus metrics ────────────────────────────────────────────────────────

app.get('/crust/metrics', metricsHandler);

// ── Health check ──────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── Start server ──────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(
    JSON.stringify({
      level: 'info',
      event: 'server_start',
      port: PORT,
      service: 'demo-app',
      ts: new Date().toISOString(),
    })
  );
});

export default app;
