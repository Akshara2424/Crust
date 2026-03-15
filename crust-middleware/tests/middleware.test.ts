/**
 * crust-middleware tests
 * Uses node:crypto to generate real RS256 keys so every test signs real JWTs.
 */
import { describe, it, expect, beforeAll, jest } from '@jest/globals';
import {
  generateKeyPairSync,
  createSign,
  type KeyObject,
} from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { crustGuard } from '../src/index';
import { requestsTotal, failuresTotal } from '../src/metrics';

// ── Key generation (once for all tests) ───────────────────────────────────────

let privateKey: KeyObject;
let publicKeyPem: string;
let altPrivateKey: KeyObject; // different key — for tampered-sig tests

beforeAll(() => {
  const kp = generateKeyPairSync('rsa', { modulusLength: 2048 });
  privateKey   = kp.privateKey;
  publicKeyPem = kp.publicKey.export({ type: 'spki', format: 'pem' }) as string;

  const altKp   = generateKeyPairSync('rsa', { modulusLength: 2048 });
  altPrivateKey = altKp.privateKey;
});

// ── JWT builder ───────────────────────────────────────────────────────────────

interface PayloadOverrides {
  sub?:          string;
  iss?:          string;
  iat?:          number;
  exp?:          number;
  confidence?:   number;
  decision?:     string;
  feature_hash?: string;
}

function buildJwt(
  overrides: PayloadOverrides = {},
  signingKey: KeyObject = privateKey,
  badAlg = false,
): string {
  const now     = Math.floor(Date.now() / 1000);
  const header  = { alg: badAlg ? 'HS256' : 'RS256', typ: 'JWT' };
  const payload = {
    sub:          'crust-session',
    iss:          'crust-verification-service',
    iat:          now,
    exp:          now + 900,
    confidence:   0.91,
    decision:     'PASS',
    feature_hash: 'abc123',
    ...overrides,
  };

  const b64url = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const headerB64  = b64url(header);
  const payloadB64 = b64url(payload);
  const sigInput   = `${headerB64}.${payloadB64}`;

  const sign = createSign('sha256');
  sign.update(sigInput);
  const sig = sign
    .sign(signingKey)
    .toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  return `${headerB64}.${payloadB64}.${sig}`;
}

// ── Mock Express helpers ───────────────────────────────────────────────────────

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    route:   { path: '/test' },
    path:    '/test',
    ...overrides,
  } as unknown as Request;
}

function mockRes(): { res: Response; status: jest.Mock; json: jest.Mock; } {
  const json   = jest.fn().mockReturnThis();
  const status = jest.fn().mockReturnValue({ json });
  const res    = { status, json } as unknown as Response;
  return { res, status, json };
}

function mockNext(): NextFunction {
  return jest.fn() as unknown as NextFunction;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('crustGuard — happy path', () => {
  it('1. valid PASS JWT → calls next() and populates req.crustPayload', () => {
    const token = buildJwt();
    const req   = mockReq({ headers: { 'x-crust-jwt': token } });
    const { res } = mockRes();
    const next  = mockNext();

    crustGuard({ publicKeyPem })(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.crustPayload).toBeDefined();
    expect(req.crustPayload?.decision).toBe('PASS');
    expect(req.crustPayload?.confidence).toBe(0.91);
  });

  it('2. JWT in Authorization: Bearer fallback header', () => {
    const token = buildJwt();
    const req   = mockReq({ headers: { authorization: `Bearer ${token}` } });
    const { res } = mockRes();
    const next  = mockNext();

    crustGuard({ publicKeyPem })(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.crustPayload?.decision).toBe('PASS');
  });

  it('3. custom headerName option is respected', () => {
    const token = buildJwt();
    const req   = mockReq({ headers: { 'x-custom-header': token } });
    const { res } = mockRes();
    const next  = mockNext();

    crustGuard({ publicKeyPem, headerName: 'x-custom-header' })(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('4. allowedDecisions includes SOFT_CHALLENGE → accepts that decision', () => {
    const token = buildJwt({ decision: 'SOFT_CHALLENGE' });
    const req   = mockReq({ headers: { 'x-crust-jwt': token } });
    const { res } = mockRes();
    const next  = mockNext();

    crustGuard({ publicKeyPem, allowedDecisions: ['PASS', 'SOFT_CHALLENGE'] })(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('crustGuard — expiry', () => {
  it('5. expired JWT (exp = now - 1s, no skew) → 403 expired', () => {
    const now   = Math.floor(Date.now() / 1000);
    const token = buildJwt({ exp: now - 1 });
    const req   = mockReq({ headers: { 'x-crust-jwt': token } });
    const { res, status, json } = mockRes();
    const next  = mockNext();

    crustGuard({ publicKeyPem, clockSkewSeconds: 0 })(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'expired' })
    );
  });

  it('6. JWT exp within clock skew (exp = now - 25s, skew = 30s) → accepted', () => {
    const now   = Math.floor(Date.now() / 1000);
    const token = buildJwt({ exp: now - 25 });
    const req   = mockReq({ headers: { 'x-crust-jwt': token } });
    const { res } = mockRes();
    const next  = mockNext();

    crustGuard({ publicKeyPem, clockSkewSeconds: 30 })(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('7. JWT exp outside clock skew (exp = now - 35s, skew = 30s) → 403 expired', () => {
    const now   = Math.floor(Date.now() / 1000);
    const token = buildJwt({ exp: now - 35 });
    const req   = mockReq({ headers: { 'x-crust-jwt': token } });
    const { res, status, json } = mockRes();
    const next  = mockNext();

    crustGuard({ publicKeyPem, clockSkewSeconds: 30 })(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ reason: 'expired' }));
  });

  it('8. JWT exactly at skew boundary (exp = now - 30s, skew = 30s) → accepted', () => {
    const now   = Math.floor(Date.now() / 1000);
    const token = buildJwt({ exp: now - 30 });
    const req   = mockReq({ headers: { 'x-crust-jwt': token } });
    const { res } = mockRes();
    const next  = mockNext();

    crustGuard({ publicKeyPem, clockSkewSeconds: 30 })(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('crustGuard — signature', () => {
  it('9. tampered signature → 403 invalid_signature', () => {
    const token  = buildJwt();
    const parts  = token.split('.');
    // Flip one character in signature
    parts[2] = parts[2].split('').reverse().join('');
    const req    = mockReq({ headers: { 'x-crust-jwt': parts.join('.') } });
    const { res, status, json } = mockRes();
    const next   = mockNext();

    crustGuard({ publicKeyPem })(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ reason: 'invalid_signature' }));
  });

  it('10. JWT signed with different private key → 403 invalid_signature', () => {
    const token = buildJwt({}, altPrivateKey);
    const req   = mockReq({ headers: { 'x-crust-jwt': token } });
    const { res, status, json } = mockRes();
    const next  = mockNext();

    crustGuard({ publicKeyPem })(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ reason: 'invalid_signature' }));
  });

  it('11. tampered payload (base64 swap) → 403 invalid_signature', () => {
    const token = buildJwt();
    const parts = token.split('.');
    // Modify payload segment directly
    const decoded = JSON.parse(Buffer.from(
      parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64'
    ).toString());
    decoded.decision = 'BLOCK';
    parts[1] = Buffer.from(JSON.stringify(decoded))
      .toString('base64')
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const req   = mockReq({ headers: { 'x-crust-jwt': parts.join('.') } });
    const { res, status, json } = mockRes();
    const next  = mockNext();

    crustGuard({ publicKeyPem })(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ reason: 'invalid_signature' }));
  });
});

describe('crustGuard — decision', () => {
  it('12. SOFT_CHALLENGE decision (default allowedDecisions=PASS) → 403 wrong_decision', () => {
    const token = buildJwt({ decision: 'SOFT_CHALLENGE' });
    const req   = mockReq({ headers: { 'x-crust-jwt': token } });
    const { res, status, json } = mockRes();
    const next  = mockNext();

    crustGuard({ publicKeyPem })(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ reason: 'wrong_decision' }));
  });

  it('13. BLOCK decision → 403 wrong_decision', () => {
    const token = buildJwt({ decision: 'BLOCK' });
    const req   = mockReq({ headers: { 'x-crust-jwt': token } });
    const { res, status, json } = mockRes();
    const next  = mockNext();

    crustGuard({ publicKeyPem })(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ reason: 'wrong_decision' }));
  });
});

describe('crustGuard — missing / malformed', () => {
  it('14. no header at all → 403 missing_token', () => {
    const req  = mockReq({ headers: {} });
    const { res, status, json } = mockRes();
    const next = mockNext();

    crustGuard({ publicKeyPem })(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ reason: 'missing_token' }));
  });

  it('15. completely invalid string → 403 malformed', () => {
    const req  = mockReq({ headers: { 'x-crust-jwt': 'not.a.jwt.at.all' } });
    const { res, status, json } = mockRes();
    const next = mockNext();

    crustGuard({ publicKeyPem })(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ reason: 'malformed' }));
  });

  it('16. two-part token (missing sig) → 403 malformed', () => {
    const req  = mockReq({ headers: { 'x-crust-jwt': 'header.payload' } });
    const { res, status, json } = mockRes();
    const next = mockNext();

    crustGuard({ publicKeyPem })(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ reason: 'malformed' }));
  });

  it('17. empty string header → 403 missing_token', () => {
    const req  = mockReq({ headers: { 'x-crust-jwt': '' } });
    const { res, status, json } = mockRes();
    const next = mockNext();

    crustGuard({ publicKeyPem })(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ reason: 'missing_token' }));
  });
});

describe('crustGuard — issuer', () => {
  it('18. wrong issuer → 403 invalid_issuer', () => {
    const token = buildJwt({ iss: 'some-other-service' });
    const req   = mockReq({ headers: { 'x-crust-jwt': token } });
    const { res, status, json } = mockRes();
    const next  = mockNext();

    crustGuard({ publicKeyPem })(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ reason: 'invalid_issuer' }));
  });

  it('19. custom issuer option matches → accepted', () => {
    const token = buildJwt({ iss: 'my-crust-instance' });
    const req   = mockReq({ headers: { 'x-crust-jwt': token } });
    const { res } = mockRes();
    const next  = mockNext();

    crustGuard({ publicKeyPem, issuer: 'my-crust-instance' })(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('crustGuard — custom onFailure', () => {
  it('20. onFailure callback is called with correct reason', () => {
    const onFailure = jest.fn();
    const req  = mockReq({ headers: {} });
    const { res } = mockRes();
    const next = mockNext();

    crustGuard({ publicKeyPem, onFailure })(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledWith(req, res, 'missing_token');
  });

  it('21. onFailure receives correct reason for wrong_decision', () => {
    const onFailure = jest.fn();
    const token = buildJwt({ decision: 'BLOCK' });
    const req   = mockReq({ headers: { 'x-crust-jwt': token } });
    const { res } = mockRes();
    const next  = mockNext();

    crustGuard({ publicKeyPem, onFailure })(req, res, next);

    expect(onFailure).toHaveBeenCalledWith(req, res, 'wrong_decision');
  });

  it('22. correlationId from x-correlation-id header appears in 403', () => {
    const corrId = 'my-trace-id-abc';
    const req    = mockReq({
      headers: { 'x-correlation-id': corrId },
    });
    const { res, json } = mockRes();
    const next = mockNext();

    crustGuard({ publicKeyPem })(req, res, next);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: corrId })
    );
  });

  it('23. correlationId is generated UUID if header absent', () => {
    const req  = mockReq({ headers: {} });
    const { res, json } = mockRes();
    const next = mockNext();

    crustGuard({ publicKeyPem })(req, res, next);

    const call = (json as jest.Mock).mock.calls[0][0] as { correlationId: string };
    expect(call.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });
});

describe('crustGuard — Prometheus metrics', () => {
  it('24. successful request increments crust_requests_total', () => {
    // Read current baseline
    const token = buildJwt();
    const req   = mockReq({ headers: { 'x-crust-jwt': token }, route: { path: '/metrics-test' } as never });
    const { res } = mockRes();
    const next  = mockNext();

    crustGuard({ publicKeyPem })(req, res, next);

    expect(next).toHaveBeenCalled();
    // Verify counter instance recorded something (serialise output contains route)
    const output = requestsTotal.serialise();
    expect(output).toContain('crust_requests_total');
  });

  it('25. failed request increments crust_failures_total', () => {
    const req  = mockReq({ headers: {} });
    const { res } = mockRes();
    const next = mockNext();

    crustGuard({ publicKeyPem })(req, res, next);

    const output = failuresTotal.serialise();
    expect(output).toContain('missing_token');
  });
});
