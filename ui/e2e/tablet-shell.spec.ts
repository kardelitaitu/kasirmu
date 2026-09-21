import { test, expect } from '@playwright/test';

/**
 * E2E: Tablet Shell Entry (TAB-04)
 *
 * Exercises the REAL tablet entry point (`index.mobile.html` → `main.mobile.tsx`
 * → `TabletAppShell`), unlike `tablet-viewport.spec.ts` which only resized the
 * desktop app's viewport. The shared Vite dev server serves multi-page HTML,
 * so the tablet entry is reachable at `/index.mobile.html` on the same origin.
 *
 * Checks:
 *   - The tablet shell boots (login screen renders)
 *   - No horizontal overflow on the tablet viewport (1024×1366)
 *   - Touch targets are >= 44px on the tablet login screen
 */

test.describe('Tablet Shell Entry (index.mobile.html)', () => {
  test('boots the tablet entry and renders the login screen', async ({ page }) => {
    await page.goto('/index.mobile.html');
    await page.waitForSelector('.staff-login-screen', { timeout: 15_000 });
    await expect(page.locator('.staff-login-screen')).toBeVisible();
  });

  test('no horizontal overflow on the tablet entry', async ({ page }) => {
    await page.goto('/index.mobile.html');
    await page.waitForSelector('.staff-login-screen', { timeout: 15_000 });

    // Viewport-relative: this spec runs in both the desktop (1366px) and
    // tablet (1024px) Playwright projects, so a hardcoded 1024 would fail
    // the desktop run even with zero overflow.
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth);
  });

  test('touch targets are at least 44px on the tablet entry', async ({ page }) => {
    await page.goto('/index.mobile.html');
    await page.waitForSelector('.staff-login-screen', { timeout: 15_000 });

    const usernameInput = page.locator('.staff-login-input');
    await expect(usernameInput).toBeVisible();
    const inputBox = await usernameInput.boundingBox();
    expect(inputBox).not.toBeNull();
    if (inputBox) {
      // Math.round: getBoundingClientRect can report 43.99997 for a 44px
      // target due to sub-pixel rendering — the CSS-px target is what matters.
      expect(Math.round(inputBox.height)).toBeGreaterThanOrEqual(44);
    }

    // The 44px touch-target rule is scoped to coarse pointers
    // (StaffLoginScreen.css:379). This spec runs in BOTH projects, so key the
    // requirement off the ACTUAL pointer rather than the project name; each
    // branch is a hard assertion.
    const submitBtn = page.locator('.staff-login-submit-btn');
    const btnBox = await submitBtn.boundingBox();
    expect(btnBox).not.toBeNull();
    const coarse = await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches);
    if (coarse) {
      expect(Math.round(btnBox!.height)).toBeGreaterThanOrEqual(44);
    } else {
      // Fine pointer: the documented floor is the 40px base rule.
      expect(Math.round(btnBox!.height)).toBeGreaterThanOrEqual(40);
    }
  });

  test('login + workspace picker work on the tablet entry', async ({ page }) => {
    await page.goto('/index.mobile.html');
    await page.waitForSelector('.staff-login-screen', { timeout: 15_000 });

    await page.locator('.staff-login-input').fill('owner');
    await page.locator('.staff-login-submit-btn').click();
    await page.locator('.staff-login-pad').waitFor({ state: 'visible', timeout: 10_000 });

    for (const digit of '1234') {
      await page.locator('.staff-login-pad-key').filter({ hasText: digit }).click();
      await page.waitForTimeout(80);
    }

    await page.waitForSelector('.workspace-home', { timeout: 15_000 });
    await expect(page.locator('.workspace-home')).toBeVisible();

    // Viewport-relative: this spec runs in both the desktop (1366px) and
    // tablet (1024px) Playwright projects, so a hardcoded 1024 would fail
    // the desktop run even with zero overflow.
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth);
  });
});
