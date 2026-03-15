import { test, expect } from '@playwright/test';
import { mockVerifyPass } from '../fixtures/mock-crust-service';

test.describe('human-flow — PASS decision, no challenge', () => {

  test.beforeEach(async ({ page }) => {
    await mockVerifyPass(page, 0.91);
  });

  test('1. login page loads and shows form', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    await expect(page.getByLabel(/username/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('2. natural typing triggers keystroke collection', async ({ page }) => {
    await page.goto('/');

    const usernameInput = page.getByLabel(/username/i);
    const passwordInput = page.getByLabel(/password/i);

    // Type with realistic delays to trigger keystroke collection
    await usernameInput.click();
    await page.keyboard.type('testuser', { delay: 120 });

    await passwordInput.click();
    await page.keyboard.type('password123', { delay: 100 });

    await expect(usernameInput).toHaveValue('testuser');
    await expect(passwordInput).toHaveValue('password123');
  });

  test('3. mouse movement is collected before submit', async ({ page }) => {
    await page.goto('/');

    // Simulate natural mouse movement for 300ms
    await page.mouse.move(100, 100);
    await page.mouse.move(200, 150, { steps: 10 });
    await page.mouse.move(300, 200, { steps: 10 });
    await page.waitForTimeout(300);

    // Form should still be interactive
    await expect(page.getByRole('button', { name: /sign in/i })).toBeEnabled();
  });

  test('4. submit sends x-crust-jwt header to /api/auth/login', async ({ page }) => {
    await page.goto('/');

    await page.getByLabel(/username/i).fill('testuser');
    await page.getByLabel(/password/i).fill('password123');

    // Capture the login request
    const [loginRequest] = await Promise.all([
      page.waitForRequest(req =>
        req.url().includes('/api/auth/login') && req.method() === 'POST'
      ),
      page.getByRole('button', { name: /sign in/i }).click(),
    ]);

    const headers = loginRequest.headers();
    expect(headers['x-crust-jwt']).toBeTruthy();
    expect(headers['x-crust-jwt']).toMatch(/^eyJ/); // JWT starts with eyJ
  });

  test('5. successful login returns 200', async ({ page }) => {
    await page.goto('/');

    await page.getByLabel(/username/i).fill('testuser');
    await page.getByLabel(/password/i).fill('password123');

    const [loginResponse] = await Promise.all([
      page.waitForResponse(res =>
        res.url().includes('/api/auth/login') && res.request().method() === 'POST'
      ),
      page.getByRole('button', { name: /sign in/i }).click(),
    ]);

    expect(loginResponse.status()).toBe(200);
  });

  test('6. CrustStatusBadge shows PASS after login', async ({ page }) => {
    await page.goto('/');

    await page.getByLabel(/username/i).fill('testuser');
    await page.getByLabel(/password/i).fill('password123');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Badge should update to show PASS
    await expect(page.locator('text=PASS')).toBeVisible({ timeout: 5000 });
  });

  test('7. success message shown after login', async ({ page }) => {
    await page.goto('/');

    await page.getByLabel(/username/i).fill('testuser');
    await page.getByLabel(/password/i).fill('password123');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.getByText(/login successful/i)).toBeVisible({ timeout: 5000 });
  });

  test('8. checkout page loads correctly', async ({ page }) => {
    await page.goto('/checkout');

    await expect(page.getByRole('heading', { name: /checkout/i })).toBeVisible();
    await expect(page.getByText(/margherita/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /pay/i })).toBeVisible();
  });

  test('9. checkout submit sends x-crust-jwt header', async ({ page }) => {
    await page.goto('/checkout');

    const [checkoutRequest] = await Promise.all([
      page.waitForRequest(req =>
        req.url().includes('/api/checkout') && req.method() === 'POST'
      ),
      page.getByRole('button', { name: /pay/i }).click(),
    ]);

    expect(checkoutRequest.headers()['x-crust-jwt']).toBeTruthy();
  });

});
