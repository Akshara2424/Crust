import { Router } from 'express';

export const authRouter = Router();

/**
 * POST /api/auth/login
 * Protected by crustGuard — only reachable with a valid PASS JWT.
 * In a real app this would validate credentials; here it echoes the CRUST payload
 * back for demo visibility.
 */
authRouter.post('/login', (req, res) => {
  const crust = req.crustPayload!;  // populated by crustGuard

  console.log(JSON.stringify({
    level:         'info',
    event:         'login_attempt',
    confidence:    crust.confidence,
    decision:      crust.decision,
    correlationId: req.headers['x-correlation-id'],
    ts:            new Date().toISOString(),
  }));

  // Demo: accept any username/password as long as CRUST passed
  const { username } = req.body as { username?: string };

  res.json({
    success:    true,
    message:    `Welcome, ${username ?? 'user'}!`,
    crust: {
      confidence: crust.confidence,
      decision:   crust.decision,
    },
  });
});
