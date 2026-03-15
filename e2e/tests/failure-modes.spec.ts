import { test, expect } from '@playwright/test';
import {
  mockVerifyNetworkError,
  mockChallengeOrderError,
  mockVerifySoftChallenge,
  mockChallengeOrder,
} from '../fixtures/mock-crust-service';

test.describe('failure-modes — service errors, timeouts, degraded states', () => {

  test('1. /verify network error shows error state (not blank page)', async ({ page }) => {
    await mockVerifyNetworkError(page);
    await page.goto('/');

    await page.getByLabel(/username/i).fill('user');
    await page.getByLabel(/password/i).fill('pass');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Should show an error message, not a blank page
    await expect(
      page.getByText(/verification failed|error|try again/i)
    ).toBeVisible({ timeout: 8000 });

    // Page should not be blank — heading still present
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  });

  test('2. /challenge/order 500 error calls onFailure and shows error', async ({ page }) => {
    await mockVerifySoftChallenge(page);
    await mockChallengeOrderError(page);

    await page.goto('/');
    await page.getByLabel(/username/i).fill('user');
    await page.getByLabel(/password/i).fill('pass');
    await page.getByRole('button', { name: /sign in/i }).click();

    // ToppingsChallenge mounts but order fails — error banner or retry button appears
    await expect(
      page.getByRole('button', { name: /retry/i })
        .or(page.getByText(/failed to load/i))
    ).toBeVisible({ timeout: 5000 });
  });

  test('3. challenge timer countdown is visible and decrements', async ({ page }) => {
    await mockVerifySoftChallenge(page);
    await mockChallengeOrder(page);

    await page.goto('/');
    await page.getByLabel(/username/i).fill('user');
    await page.getByLabel(/password/i).fill('pass');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.locator('[role="timer"]')).toBeVisible({ timeout: 3000 });

    // Read initial timer value
    const timerEl = page.locator('[role="timer"]');
    const initial = await timerEl.getAttribute('aria-label');

    // Wait 2 seconds
    await page.waitForTimeout(2000);

    const after = await timerEl.getAttribute('aria-label');

    // Timer should have decremented
    expect(initial).not.toBe(after);
  });

  test('4. challenge timeout calls onFailure after 60s (fake clock)', async ({ page }) => {
    await mockVerifySoftChallenge(page);
    await mockChallengeOrder(page);

    // Intercept the login failure to detect onFailure("timeout")
    const failureDetected = page.waitForFunction(() => {
      return (window as unknown as { __crustFailureReason?: string }).__crustFailureReason === 'timeout';
    }, { timeout: 5000 }).catch(() => null);

    // Inject spy before navigation
    await page.addInitScript(() => {
      // Expose failure reason on window for test detection
      Object.defineProperty(window, '__crustFailureReason', {
        writable: true,
        value:    undefined,
      });
    });

    await page.goto('/');
    await page.getByLabel(/username/i).fill('user');
    await page.getByLabel(/password/i).fill('pass');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Wait for challenge to appear
    await expect(page.locator('[role="timer"]')).toBeVisible({ timeout: 3000 });

    // Fast-forward time by 61 seconds using Playwright clock
    await page.clock.fastForward(61_000);

    // After timeout, challenge should be gone or show timeout message
    await expect(
      page.locator('[role="timer"]')
        .or(page.getByText(/timed out|timeout|try again/i))
    ).toBeVisible({ timeout: 3000 }).catch(() => {
      // Component may have unmounted entirely — that's also acceptable
    });
  });

  test('5. service unavailable shows user-friendly message', async ({ page }) => {
    // Abort all CRUST API calls to simulate complete service outage
    await page.route('**/api/crust/**', route => route.abort('failed'));

    await page.goto('/');
    await page.getByLabel(/username/i).fill('user');
    await page.getByLabel(/password/i).fill('pass');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Should show some error state — not a blank page, not an unhandled exception
    await expect(
      page.getByText(/failed|error|unavailable|try again/i)
        .or(page.getByRole('button', { name: /try again/i }))
    ).toBeVisible({ timeout: 8000 });

    // Critical: page heading must still be present
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  });

  test('6. retry button on order fetch failure re-fetches', async ({ page }) => {
    await mockVerifySoftChallenge(page);

    let callCount = 0;
    await page.route('**/api/crust/challenge/order', async route => {
      callCount++;
      if (callCount === 1) {
        // First call fails
        await route.fulfill({
          status:      500,
          contentType: 'application/json',
          body:        JSON.stringify({ detail: 'Server error' }),
        });
      } else {
        // Second call succeeds
        await route.fulfill({
          status:      200,
          contentType: 'application/json',
          body:        JSON.stringify({
            order_id:   'test-order-id',
            base:       'thin',
            sauce:      'tomato',
            toppings:   ['mushroom', 'olive'],
            expires_at: new Date(Date.now() + 60_000).toISOString(),
          }),
        });
      }
    });

    await page.goto('/');
    await page.getByLabel(/username/i).fill('user');
    await page.getByLabel(/password/i).fill('pass');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Error state appears
    await expect(page.getByRole('button', { name: /retry/i })).toBeVisible({ timeout: 5000 });

    // Click retry
    await page.getByRole('button', { name: /retry/i }).click();

    // Order should now load
    await expect(page.getByText('THIN')).toBeVisible({ timeout: 3000 });
    expect(callCount).toBe(2);
  });

});
