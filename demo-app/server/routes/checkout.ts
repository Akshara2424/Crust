import { Router } from 'express';

export const checkoutRouter = Router();

/**
 * POST /api/checkout
 * Protected by crustGuard — only reachable with a valid PASS JWT.
 */
checkoutRouter.post('/', (req, res) => {
  const crust = req.crustPayload!;

  console.log(JSON.stringify({
    level:         'info',
    event:         'checkout_attempt',
    confidence:    crust.confidence,
    decision:      crust.decision,
    correlationId: req.headers['x-correlation-id'],
    ts:            new Date().toISOString(),
  }));

  const { items } = req.body as { items?: unknown[] };

  res.json({
    success:    true,
    orderId:    `order-${Date.now()}`,
    itemCount:  Array.isArray(items) ? items.length : 0,
    message:    'Checkout complete',
    crust: {
      confidence: crust.confidence,
      decision:   crust.decision,
    },
  });
});
