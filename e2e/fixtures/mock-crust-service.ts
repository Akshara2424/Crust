import type { Page } from '@playwright/test';

// ── Shared mock JWT values ─────────────────────────────────────────────────────

export const MOCK_JWT_PASS = [
  'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9',
  'eyJzdWIiOiJjcnVzdC1zZXNzaW9uIiwiaXNzIjoiY3J1c3QtdmVyaWZpY2F0aW9uLXNlcnZpY2UiLCJpYXQiOjE3MTQwMDAwMDAsImV4cCI6MTcxNDAwMDkwMCwiY29uZmlkZW5jZSI6MC45MSwiZGVjaXNpb24iOiJQQVNTIiwiZmVhdHVyZV9oYXNoIjoiYWJjMTIzIn0',
  'mock-pass-signature',
].join('.');

export const MOCK_JWT_SOFT = [
  'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9',
  'eyJzdWIiOiJjcnVzdC1zZXNzaW9uIiwiaXNzIjoiY3J1c3QtdmVyaWZpY2F0aW9uLXNlcnZpY2UiLCJpYXQiOjE3MTQwMDAwMDAsImV4cCI6MTcxNDAwMDkwMCwiY29uZmlkZW5jZSI6MC43MiwiZGVjaXNpb24iOiJTT0ZUX0NIQUxMRU5HRSJ9',
  'mock-soft-signature',
].join('.');

export const MOCK_ORDER = {
  order_id:   'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  base:       'thin',
  sauce:      'tomato',
  toppings:   ['mushroom', 'olive'],
  expires_at: new Date(Date.now() + 60_000).toISOString(),
};

// ── Route interceptors ────────────────────────────────────────────────────────

/** Intercept /verify → respond with PASS */
export async function mockVerifyPass(page: Page, confidence = 0.91): Promise<void> {
  await page.route('**/api/crust/verify', async route => {
    await route.fulfill({
      status:      200,
      contentType: 'application/json',
      body: JSON.stringify({
        jwt:        MOCK_JWT_PASS,
        confidence,
        decision:   'PASS',
      }),
    });
  });
}

/** Intercept /verify → respond with SOFT_CHALLENGE */
export async function mockVerifySoftChallenge(page: Page, confidence = 0.72): Promise<void> {
  await page.route('**/api/crust/verify', async route => {
    await route.fulfill({
      status:      200,
      contentType: 'application/json',
      body: JSON.stringify({
        jwt:        MOCK_JWT_SOFT,
        confidence,
        decision:   'SOFT_CHALLENGE',
      }),
    });
  });
}

/** Intercept /verify → respond with BLOCK */
export async function mockVerifyBlock(page: Page): Promise<void> {
  await page.route('**/api/crust/verify', async route => {
    await route.fulfill({
      status:      200,
      contentType: 'application/json',
      body: JSON.stringify({
        jwt:        MOCK_JWT_PASS.replace('PASS', 'BLOCK'),
        confidence: 0.22,
        decision:   'BLOCK',
      }),
    });
  });
}

/** Intercept /challenge/order → respond with mock order */
export async function mockChallengeOrder(page: Page): Promise<void> {
  await page.route('**/api/crust/challenge/order', async route => {
    await route.fulfill({
      status:      200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_ORDER),
    });
  });
}

/** Intercept /challenge/result → respond with PASS */
export async function mockChallengeResultPass(page: Page, confidence = 0.88): Promise<void> {
  await page.route('**/api/crust/challenge/result', async route => {
    await route.fulfill({
      status:      200,
      contentType: 'application/json',
      body: JSON.stringify({
        jwt:        MOCK_JWT_PASS,
        confidence,
        decision:   'PASS',
      }),
    });
  });
}

/** Intercept /challenge/result → respond with ORDER_MISMATCH */
export async function mockChallengeResultMismatch(page: Page): Promise<void> {
  await page.route('**/api/crust/challenge/result', async route => {
    await route.fulfill({
      status:      422,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'ORDER_MISMATCH' }),
    });
  });
}

/** Intercept /verify → simulate network error */
export async function mockVerifyNetworkError(page: Page): Promise<void> {
  await page.route('**/api/crust/verify', async route => {
    await route.abort('failed');
  });
}

/** Intercept /challenge/order → 500 error */
export async function mockChallengeOrderError(page: Page): Promise<void> {
  await page.route('**/api/crust/challenge/order', async route => {
    await route.fulfill({
      status:      500,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Internal server error' }),
    });
  });
}
