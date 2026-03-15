import { createPublicKey, verify as cryptoVerify } from 'crypto';
import type { CrustJwtPayload, FailureReason } from './types';

// ── Internal result type ───────────────────────────────────────────────────────

export type VerifyResult =
  | { ok: true;  payload: CrustJwtPayload }
  | { ok: false; reason: FailureReason };

// ── Key cache — parsed once per CrustGuard instance ───────────────────────────

export function parsePublicKey(pem: string): ReturnType<typeof createPublicKey> {
  try {
    return createPublicKey({ key: pem, format: 'pem' });
  } catch {
    throw new Error('CRUST: invalid publicKeyPem — could not parse RSA public key');
  }
}

// ── Base64url helpers ─────────────────────────────────────────────────────────

function b64urlDecode(input: string): Buffer {
  // Normalise base64url → base64
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded  = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  return Buffer.from(padded, 'base64');
}

function b64urlToObj<T>(input: string): T {
  return JSON.parse(b64urlDecode(input).toString('utf8')) as T;
}

// ── Core verifier ─────────────────────────────────────────────────────────────

export function verifyJwt(
  token:            string,
  publicKey:        ReturnType<typeof createPublicKey>,
  issuer:           string,
  allowedDecisions: string[],
  clockSkewSeconds: number,
): VerifyResult {
  // ── 1. Split token ──────────────────────────────────────────────────────────
  const parts = token.split('.');
  if (parts.length !== 3) {
    return { ok: false, reason: 'malformed' };
  }
  const [headerB64, payloadB64, sigB64] = parts;

  // ── 2. Decode header ────────────────────────────────────────────────────────
  let header: { alg?: string; typ?: string };
  try {
    header = b64urlToObj<{ alg?: string; typ?: string }>(headerB64);
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (header.alg !== 'RS256') {
    return { ok: false, reason: 'malformed' };
  }

  // ── 3. Verify RS256 signature ───────────────────────────────────────────────
  const signingInput = Buffer.from(`${headerB64}.${payloadB64}`, 'utf8');
  const signature    = b64urlDecode(sigB64);

  let sigValid: boolean;
  try {
    sigValid = cryptoVerify('sha256', signingInput, publicKey, signature);
  } catch {
    return { ok: false, reason: 'invalid_signature' };
  }

  if (!sigValid) {
    return { ok: false, reason: 'invalid_signature' };
  }

  // ── 4. Decode payload ───────────────────────────────────────────────────────
  let payload: CrustJwtPayload;
  try {
    payload = b64urlToObj<CrustJwtPayload>(payloadB64);
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (
    typeof payload.sub !== 'string' ||
    typeof payload.iss !== 'string' ||
    typeof payload.iat !== 'number' ||
    typeof payload.exp !== 'number' ||
    typeof payload.confidence !== 'number' ||
    typeof payload.decision !== 'string' ||
    typeof payload.feature_hash !== 'string'
  ) {
    return { ok: false, reason: 'malformed' };
  }

  // ── 5. Issuer check ─────────────────────────────────────────────────────────
  if (payload.iss !== issuer) {
    return { ok: false, reason: 'invalid_issuer' };
  }

  // ── 6. Expiry check with clock skew ────────────────────────────────────────
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (payload.exp + clockSkewSeconds < nowSeconds) {
    return { ok: false, reason: 'expired' };
  }

  // ── 7. Decision check ───────────────────────────────────────────────────────
  if (!allowedDecisions.includes(payload.decision)) {
    return { ok: false, reason: 'wrong_decision' };
  }

  return { ok: true, payload };
}
