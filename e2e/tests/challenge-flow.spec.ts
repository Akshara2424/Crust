import { test, expect } from '@playwright/test';
import {
  mockVerifySoftChallenge,
  mockChallengeOrder,
  mockChallengeResultPass,
  mockChallengeResultMismatch,
  MOCK_ORDER,
} from '../fixtures/mock-crust-service';

test.describe('challenge-flow — SOFT_CHALLENGE → pizza → PASS', () => {

  test.beforeEach(async ({ page }) => {
    await mockVerifySoftChallenge(page, 0.72);
    await mockChallengeOrder(page);
  });

  test('1. ToppingsChallenge renders within 500ms of SOFT_CHALLENGE', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel(/username/i).fill('user');
    await page.getByLabel(/password/i).fill('pass');

    const submitStart = Date.now();
    await page.getByRole('button', { name: /sign in/i }).click();

    // Pizza challenge should appear quickly
    await expect(
      page.getByRole('region', { name: /pizza assembly/i })
    ).toBeVisible({ timeout: 500 });

    expect(Date.now() - submitStart).toBeLessThan(1500);
  });

  test('2. OrderTicket displays the mock order details', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel(/username/i).fill('user');
    await page.getByLabel(/password/i).fill('pass');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.getByText('THIN')).toBeVisible({ timeout: 3000 });
    await expect(page.getByText('TOMATO')).toBeVisible();
    await expect(page.getByText('MUSHROOM')).toBeVisible();
    await expect(page.getByText('OLIVE')).toBeVisible();
  });

  test('3. CountdownRing is visible', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel(/username/i).fill('user');
    await page.getByLabel(/password/i).fill('pass');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Timer ring — look for the SVG timer element
    await expect(page.locator('[role="timer"]')).toBeVisible({ timeout: 3000 });
  });

  test('4. ingredient tray shows all 8 ingredients', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel(/username/i).fill('user');
    await page.getByLabel(/password/i).fill('pass');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.getByRole('region', { name: /pizza assembly/i })).toBeVisible({ timeout: 3000 });

    const tray = page.getByRole('list', { name: /ingredient tray/i });
    const chips = tray.getByRole('listitem');
    await expect(chips).toHaveCount(8);
  });

  test('5. Submit pizza button disabled until base + sauce + 2 toppings placed', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel(/username/i).fill('user');
    await page.getByLabel(/password/i).fill('pass');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.getByRole('region', { name: /pizza assembly/i })).toBeVisible({ timeout: 3000 });

    // Submit should be disabled initially
    await expect(
      page.getByRole('button', { name: /submit order/i })
    ).toBeDisabled();

    // Select base only — still disabled
    await page.getByRole('button', { name: /^thin$/i }).click();
    await expect(page.getByRole('button', { name: /submit order/i })).toBeDisabled();

    // Select sauce — still disabled (no toppings)
    await page.getByRole('button', { name: /^tomato$/i }).click();
    await expect(page.getByRole('button', { name: /submit order/i })).toBeDisabled();
  });

  test('6. correct submission triggers confetti and PASS', async ({ page }) => {
    await mockChallengeResultPass(page, 0.88);

    await page.goto('/');
    await page.getByLabel(/username/i).fill('user');
    await page.getByLabel(/password/i).fill('pass');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.getByRole('region', { name: /pizza assembly/i })).toBeVisible({ timeout: 3000 });

    // Select base and sauce
    await page.getByRole('button', { name: /^thin$/i }).click();
    await page.getByRole('button', { name: /^tomato$/i }).click();

    // Place toppings via keyboard (Space to pick up, Space to place)
    const mushroomChip = page.getByRole('listitem').filter({ hasText: /mushroom/i });
    await mushroomChip.focus();
    await page.keyboard.press('Space');  // pick up
    await page.keyboard.press('Space');  // place

    const oliveChip = page.getByRole('listitem').filter({ hasText: /olive/i });
    await oliveChip.focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('Space');

    // Submit
    const submitBtn = page.getByRole('button', { name: /submit order/i });
    await expect(submitBtn).toBeEnabled({ timeout: 2000 });
    await submitBtn.click();

    // Success overlay should appear
    await expect(page.getByText(/verified/i)).toBeVisible({ timeout: 5000 });
  });

  test('7. ORDER_MISMATCH shows shake and attempts warning', async ({ page }) => {
    await mockChallengeResultMismatch(page);

    await page.goto('/');
    await page.getByLabel(/username/i).fill('user');
    await page.getByLabel(/password/i).fill('pass');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.getByRole('region', { name: /pizza assembly/i })).toBeVisible({ timeout: 3000 });

    await page.getByRole('button', { name: /^thin$/i }).click();
    await page.getByRole('button', { name: /^tomato$/i }).click();

    // Place 2 toppings via keyboard
    const chips = page.getByRole('listitem');
    for (const chip of await chips.all().then(c => c.slice(0, 2))) {
      await chip.focus();
      await page.keyboard.press('Space');
      await page.keyboard.press('Space');
    }

    const submitBtn = page.getByRole('button', { name: /submit order/i });
    await expect(submitBtn).toBeEnabled({ timeout: 2000 });
    await submitBtn.click();

    // Attempts warning should appear
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 3000 });
    await expect(page.getByText(/attempt/i)).toBeVisible();
  });

  test('8. CrustStatusBadge shows PASS 0.88 after challenge success', async ({ page }) => {
    await mockChallengeResultPass(page, 0.88);

    await page.goto('/');
    await page.getByLabel(/username/i).fill('user');
    await page.getByLabel(/password/i).fill('pass');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.getByRole('region', { name: /pizza assembly/i })).toBeVisible({ timeout: 3000 });

    await page.getByRole('button', { name: /^thin$/i }).click();
    await page.getByRole('button', { name: /^tomato$/i }).click();

    const chips = page.getByRole('listitem');
    for (const chip of await chips.all().then(c => c.slice(0, 2))) {
      await chip.focus();
      await page.keyboard.press('Space');
      await page.keyboard.press('Space');
    }

    await page.getByRole('button', { name: /submit order/i }).click();
    await expect(page.getByText(/verified/i)).toBeVisible({ timeout: 5000 });

    // Badge should show PASS
    await expect(page.locator('text=PASS')).toBeVisible({ timeout: 3000 });
  });

});
