import { test, expect } from '@playwright/test';

/**
 * E2E: Tablet Viewport Smoke Test (E2E-30)
 *
 * Verifies the auth + sale happy-path tests render correctly on the
 * tablet viewport (1024×1366 portrait). The webServer starts a
 * separate Vite instance for tablet (vite.mobile.config.ts) or
 * we use the same dev server and just resize the viewport.
 *
 * This test uses the `tablet` Playwright project which sets the
 * viewport to 1024×1366.
 *
 * Checks:
 *   - No layout overflow (scrollWidth <= 1024)
 *   - All touch targets >= 44px tall (P7-2 compliance)
 *   - Login works on tablet viewport
 *   - Workspace picker renders correctly
 */

test.describe('Tablet Viewport (1024×1366)', () => {
  test('no horizontal overflow on login screen', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.staff-login-screen', { timeout: 15_000 });

    // Document body must not overflow the viewport width. Compare against
    // the actual viewport — this spec runs in BOTH Playwright projects
    // (desktop 1366px and tablet 1024px), so a hardcoded 1024 would fail
    // the desktop run even with zero overflow.
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth);
  });

  test('touch targets are at least 44px on login screen', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.staff-login-screen', { timeout: 15_000 });

    // Check interactive elements: input, submit button.
    const usernameInput = page.locator('.staff-login-input');
    await expect(usernameInput).toBeVisible();

    const inputBox = await usernameInput.boundingBox();
    expect(inputBox).not.toBeNull();
    if (inputBox) {
      // Math.round: getBoundingClientRect can report 43.99997 for a 44px
      // target due to sub-pixel rendering — the CSS-px target is what matters.
      expect(Math.round(inputBox.height)).toBeGreaterThanOrEqual(44);
    }

    // Submit button.
    const submitBtn = page.locator('.staff-login-submit-btn');
    const btnBox = await submitBtn.boundingBox();
    if (btnBox) {
      expect(Math.round(btnBox.height)).toBeGreaterThanOrEqual(44);
    }
  });

  test('successful login and workspace picker on tablet', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.staff-login-screen', { timeout: 15_000 });

    // Login.
    await page.locator('.staff-login-input').fill('owner');
    await page.locator('.staff-login-submit-btn').click();
    await page.locator('.staff-login-pad').waitFor({ state: 'visible', timeout: 10_000 });

    for (const digit of '1234') {
      await page.locator('.staff-login-pad-key').filter({ hasText: digit }).click();
      await page.waitForTimeout(80);
    }

    // Workspace picker must render.
    await page.waitForSelector('.workspace-home', { timeout: 15_000 });
    await expect(page.locator('.workspace-home')).toBeVisible();

    // No layout overflow after login (viewport-relative — the spec runs in
    // both the desktop and tablet Playwright projects).
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth);

    // Workspace cards must be visible.
    const cards = page.locator('.workspace-card');
    await expect(cards.first()).toBeVisible();

    // At least one card touch target is >= 44px.
    const firstCardBox = await cards.first().boundingBox();
    if (firstCardBox) {
      expect(firstCardBox.height).toBeGreaterThanOrEqual(44);
    }
  });
});
