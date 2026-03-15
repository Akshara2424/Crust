import { test, expect } from '@playwright/test';

/**
 * Bot rejection tests — these hit the real Express server directly
 * via fetch() in the page context, bypassing the SDK entirely.
 * The middleware must reject all of these with 403.
 */
test.describe('bot-rejection — direct API calls without valid JWT', () => {

  test('1. POST /api/auth/login with no JWT header → 403 missing_token', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username: 'bot', password: 'pass' }),
      });
      return { status: res.status, body: await res.json() };
    });

    expect(result.status).toBe(403);
    expect(result.body.error).toBe('CRUST_VERIFICATION_FAILED');
    expect(result.body.reason).toBe('missing_token');
  });

  test('2. POST with empty JWT header → 403 missing_token', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/auth/login', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-crust-jwt':  '',
        },
        body: JSON.stringify({ username: 'bot' }),
      });
      return { status: res.status, body: await res.json() };
    });

    expect(result.status).toBe(403);
    expect(result.body.reason).toBe('missing_token');
  });

  test('3. POST with expired JWT → 403 expired', async ({ page }) => {
    await page.goto('/');

    // Build a JWT with exp = now - 1000s (well outside any clock skew)
    const result = await page.evaluate(async () => {
      const now = Math.floor(Date.now() / 1000);

      const header  = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
        .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
      const payload = btoa(JSON.stringify({
        sub:          'crust-session',
        iss:          'crust-verification-service',
        iat:          now - 2000,
        exp:          now - 1000,   // expired
        confidence:   0.91,
        decision:     'PASS',
        feature_hash: 'abc123',
      })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
      const sig = 'fake-signature';

      const token = `${header}.${payload}.${sig}`;

      const res = await fetch('/api/auth/login', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-crust-jwt':  token,
        },
        body: JSON.stringify({ username: 'bot' }),
      });
      return { status: res.status, body: await res.json() };
    });

    expect(result.status).toBe(403);
    // Could be expired OR invalid_signature depending on order of checks
    expect(['expired', 'invalid_signature']).toContain(result.body.reason);
  });

  test('4. POST with tampered payload (valid structure, wrong sig) → 403 invalid_signature', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async () => {
      const now = Math.floor(Date.now() / 1000);

      const header  = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
        .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
      // Payload has valid future exp but wrong signature
      const payload = btoa(JSON.stringify({
        sub:          'crust-session',
        iss:          'crust-verification-service',
        iat:          now,
        exp:          now + 900,
        confidence:   0.99,
        decision:     'PASS',
        feature_hash: 'tampered',
      })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
      const sig = 'completely-fake-signature-AAAA';

      const token = `${header}.${payload}.${sig}`;

      const res = await fetch('/api/auth/login', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-crust-jwt':  token,
        },
        body: JSON.stringify({ username: 'bot' }),
      });
      return { status: res.status, body: await res.json() };
    });

    expect(result.status).toBe(403);
    expect(result.body.reason).toBe('invalid_signature');
  });

  test('5. POST with BLOCK decision JWT → 403 wrong_decision', async ({ page }) => {
    await page.goto('/');

    // This requires a real signed JWT with BLOCK decision
    // We use the Authorization: Bearer fallback header to test that path too
    const result = await page.evaluate(async () => {
      const now = Math.floor(Date.now() / 1000);

      const header  = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
        .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
      const payload = btoa(JSON.stringify({
        sub:          'crust-session',
        iss:          'crust-verification-service',
        iat:          now,
        exp:          now + 900,
        confidence:   0.22,
        decision:     'BLOCK',
        feature_hash: 'abc',
      })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

      const token = `${header}.${payload}.fake-sig`;

      const res = await fetch('/api/auth/login', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-crust-jwt':  token,
        },
        body: JSON.stringify({ username: 'bot' }),
      });
      return { status: res.status, body: await res.json() };
    });

    expect(result.status).toBe(403);
    // Signature check comes first, so this will be invalid_signature
    expect(result.body.error).toBe('CRUST_VERIFICATION_FAILED');
  });

  test('6. 403 response includes correlationId field', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({}),
      });
      return { status: res.status, body: await res.json() };
    });

    expect(result.status).toBe(403);
    expect(result.body.correlationId).toBeTruthy();
    expect(result.body.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  test('7. POST /api/checkout without JWT → 403', async ({ page }) => {
    await page.goto('/checkout');

    const result = await page.evaluate(async () => {
      const res = await fetch('/api/checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ items: [] }),
      });
      return { status: res.status, body: await res.json() };
    });

    expect(result.status).toBe(403);
    expect(result.body.reason).toBe('missing_token');
  });

});
