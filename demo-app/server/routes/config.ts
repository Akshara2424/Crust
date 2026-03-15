import { Router } from 'express';

export const configRouter = Router();

/**
 * GET /api/crust/config
 * Returns public CRUST configuration the frontend SDK needs.
 * The public key is intentionally NOT returned — the SDK only needs the service URL.
 */
configRouter.get('/config', (_req, res) => {
  res.json({
    serviceUrl: '/api/crust',
  });
});
