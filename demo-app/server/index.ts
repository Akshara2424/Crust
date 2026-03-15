import 'dotenv/config';
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import cors from 'cors';
import { crustGuard, metricsHandler } from 'crust-middleware';
import { authRouter }     from './routes/auth';
import { checkoutRouter } from './routes/checkout';
import { configRouter }   from './routes/config';


// ── Validate required env ─────────────────────────────────────────────────────

const PUBLIC_KEY_PEM   = process.env.CRUST_PUBLIC_KEY_PEM;
const CRUST_SERVICE_URL = process.env.CRUST_SERVICE_URL ?? 'http://localhost:8000';
const PORT              = parseInt(process.env.PORT ?? '3000', 10);

if (!PUBLIC_KEY_PEM) {
  console.error('FATAL: CRUST_PUBLIC_KEY_PEM env var is required');
  process.exit(1);
}

// ── Express app ────────────────────────────────────────────────────────────────

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('frontend/dist'));

// ── Assign correlation IDs ─────────────────────────────────────────────────────
app.use((req, _res, next) => {
  if (!req.headers['x-correlation-id']) {
    req.headers['x-correlation-id'] = crypto.randomUUID();
  }
  next();
});

// ── Proxy CRUST service calls to the Python backend ───────────────────────────
app.use(
  '/api/crust/verify',
  createProxyMiddleware({
    target:      CRUST_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { '^/api/crust': '' },
  }),
);

app.use(
  '/api/crust/challenge',
  createProxyMiddleware({
    target:       CRUST_SERVICE_URL,
    changeOrigin: true,
    pathRewrite:  { '^/api/crust': '' },
  }),
);

// ── Config endpoint (no auth) ─────────────────────────────────────────────────
app.use('/api/crust', configRouter);

// ── Guarded routes ─────────────────────────────────────────────────────────────

const guard = crustGuard({
  publicKeyPem: PUBLIC_KEY_PEM,
  onFailure: (req, res, reason) => {
    const corrId = req.headers['x-correlation-id'] as string;
    console.warn(JSON.stringify({
      level:         'warn',
      event:         'crust_guard_failure',
      reason,
      correlationId: corrId,
      path:          req.path,
      ts:            new Date().toISOString(),
    }));
    res.status(403).json({
      error:         'CRUST_VERIFICATION_FAILED',
      reason,
      correlationId: corrId,
    });
  },
});

app.use('/api/auth',     guard, authRouter);
app.use('/api/checkout', guard, checkoutRouter);

// ── Prometheus metrics ────────────────────────────────────────────────────────
app.get('/crust/metrics', metricsHandler);

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(JSON.stringify({
    level:   'info',
    event:   'server_start',
    port:    PORT,
    service: 'demo-app',
    ts:      new Date().toISOString(),
  }));
});

export default app;
