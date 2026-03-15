import type { Request, Response } from 'express';

// ── Failure reasons ────────────────────────────────────────────────────────────

export type FailureReason =
  | 'missing_token'
  | 'invalid_signature'
  | 'expired'
  | 'wrong_decision'
  | 'invalid_issuer'
  | 'malformed';

// ── Options ───────────────────────────────────────────────────────────────────

export interface CrustGuardOptions {
  /** RS256 public key PEM string — loaded once at startup */
  publicKeyPem: string;
  /** Header to read JWT from. Default: "x-crust-jwt" */
  headerName?: string;
  /** Expected issuer claim. Default: "crust-verification-service" */
  issuer?: string;
  /** Decisions considered valid. Default: ["PASS"] */
  allowedDecisions?: string[];
  /** Clock skew tolerance in seconds. Default: 30 */
  clockSkewSeconds?: number;
  /** Custom failure handler — if omitted, sends 403 JSON */
  onFailure?: (req: Request, res: Response, reason: FailureReason) => void;
}

// ── JWT payload ───────────────────────────────────────────────────────────────

export interface CrustJwtPayload {
  sub:          string;
  iss:          string;
  iat:          number;
  exp:          number;
  confidence:   number;
  decision:     string;
  feature_hash: string;
}

// ── Express request extension ─────────────────────────────────────────────────

export interface CrustRequestExtension {
  crustPayload?: CrustJwtPayload;
}

// Augment Express Request globally
declare global {
  namespace Express {
    interface Request {
      crustPayload?: CrustJwtPayload;
    }
  }
}
