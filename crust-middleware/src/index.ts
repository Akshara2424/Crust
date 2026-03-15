import { randomUUID } from 'crypto';
import type { RequestHandler, Request, Response, NextFunction } from 'express';
import { parsePublicKey, verifyJwt } from './verify';
import {
  requestsTotal,
  failuresTotal,
  validationDurationMs,
} from './metrics';
import type { CrustGuardOptions, FailureReason } from './types';

export { metricsHandler } from './metrics';
export type { CrustGuardOptions, FailureReason, CrustJwtPayload } from './types';

const DEFAULT_HEADER           = 'x-crust-jwt';
const DEFAULT_ISSUER           = 'crust-verification-service';
const DEFAULT_ALLOWED          = ['PASS'];
const DEFAULT_CLOCK_SKEW_SECS  = 30;

/**
 * crustGuard — Express middleware that validates a CRUST RS256 JWT on every request.
 *
 * The public key is parsed exactly once at middleware creation time.
 * All subsequent validation is pure in-process crypto — no network calls.
 */
export function crustGuard(options: CrustGuardOptions): RequestHandler {
  const {
    publicKeyPem,
    headerName       = DEFAULT_HEADER,
    issuer           = DEFAULT_ISSUER,
    allowedDecisions = DEFAULT_ALLOWED,
    clockSkewSeconds = DEFAULT_CLOCK_SKEW_SECS,
    onFailure,
  } = options;

  // Parse key once — throws immediately if PEM is invalid
  const publicKey = parsePublicKey(publicKeyPem);

  return function crustGuardMiddleware(
    req:  Request,
    res:  Response,
    next: NextFunction,
  ): void {
    const startNs = process.hrtime.bigint();
    const route   = req.route?.path ?? req.path ?? 'unknown';
    const corrId  = (req.headers['x-correlation-id'] as string | undefined)
                    ?? randomUUID();

    // ── Extract token ──────────────────────────────────────────────────────────
    let token: string | undefined =
      req.headers[headerName.toLowerCase()] as string | undefined;

    // Fallback: Authorization: Bearer <token>
    if (!token) {
      const auth = req.headers['authorization'];
      if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
        token = auth.slice(7).trim();
      }
    }

    if (!token) {
      return handleFailure(req, res, 'missing_token', corrId, route, startNs, onFailure);
    }

    // ── Verify ─────────────────────────────────────────────────────────────────
    const result = verifyJwt(token, publicKey, issuer, allowedDecisions, clockSkewSeconds);

    const durationMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;
    validationDurationMs.observe({ route }, durationMs);

    if (!result.ok) {
      return handleFailure(req, res, result.reason, corrId, route, startNs, onFailure);
    }

    // ── Success ────────────────────────────────────────────────────────────────
    req.crustPayload = result.payload;
    requestsTotal.inc({ decision: result.payload.decision, route });
    next();
  };
}

// ── Internal failure handler ──────────────────────────────────────────────────

function handleFailure(
  req:       Request,
  res:       Response,
  reason:    FailureReason,
  corrId:    string,
  route:     string,
  startNs:   bigint,
  onFailure: CrustGuardOptions['onFailure'],
): void {
  const durationMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;
  validationDurationMs.observe({ route }, durationMs);
  failuresTotal.inc({ reason, route });

  if (onFailure) {
    onFailure(req, res, reason);
    return;
  }

  res.status(403).json({
    error:         'CRUST_VERIFICATION_FAILED',
    reason,
    correlationId: corrId,
  });
}
