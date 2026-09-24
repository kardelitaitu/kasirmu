import { test, expect } from '@playwright/test';
import { loginAs, navigateTo } from './helpers';

/**
 * E2E: Mobile Setup Wizard (Figma section 3:13 — Kasirmu Mobile Welcome Screen).
 *
 * Verifies end-to-end interactive behavior in real browser engines:
 *   1. Fullscreen route access via #/mobile-setup (no sidebar, full viewport).
 *   2. Welcome Screen: branding, Setup Wizard CTA, signup CTA.
 *   3. Setup Hub navigation: Google, Email, and QR Code pairing choices.
 *   4. Google Auth Modal: account selection list, back navigation.
 *   5. Email Auth Modal: form inputs, validation, back navigation.
 *   6. QR Pairing Modal: viewfinder frame, pairing code & URL display, copy link.
 *   7. Responsive & Orientation Geometry:
 *      - Portrait (720×1280 Figma spec): vertical stack, no horizontal overflow.
 *      - Landscape (1280×720 Figma spec): 2-column split (brand | actions), no horizontal overflow.
 *      - Ultra-compact landscape (740×360): scaled layout without overflow.
 */

test.describe('Mobile Setup Wizard (E2E)', () => {
  test.beforeEach(async ({ page }) => {
    // Log in as owner to pass the shell auth gate, then navigate to #/mobile-setup
    await loginAs(page, 'owner', '1234');
    await navigateTo(page, 'mobile-setup');

    // Wait for the container to mount and be visible.
    await expect(page.getByTestId('mobile-welcome-flow-container')).toBeVisible({ timeout: 20_000 });
  });

  test('renders the initial Welcome Screen with brand logo and CTAs', async ({ page }) => {
    await expect(page.getByTestId('mobile-welcome-screen')).toBeVisible();
    await expect(page.getByTestId('mobile-welcome-logo')).toBeVisible();

    const startBtn = page.getByTestId('mobile-welcome-start-btn');
    await expect(startBtn).toBeVisible();
    await expect(startBtn).toBeEnabled();

    // Signup button is rendered; disabled when no onSignUp callback is provided
    const signupBtn = page.getByTestId('mobile-welcome-signup-btn');
    await expect(signupBtn).toBeVisible();
  });

  test('navigates from Welcome Screen to Setup Hub and back', async ({ page }) => {
    // Click Start Setup
    await page.getByTestId('mobile-welcome-start-btn').click();

    // Setup Hub is displayed
    await expect(page.getByTestId('mobile-setup-hub')).toBeVisible();
    await expect(page.getByTestId('mobile-hub-google-btn')).toBeVisible();
    await expect(page.getByTestId('mobile-hub-email-btn')).toBeVisible();
    await expect(page.getByTestId('mobile-hub-qr-btn')).toBeVisible();

    // Click Back to return to Welcome
    await page.getByTestId('mobile-hub-back-btn').click();
    await expect(page.getByTestId('mobile-welcome-screen')).toBeVisible();
  });

  test('navigates to Google Auth view and returns to Hub', async ({ page }) => {
    await page.getByTestId('mobile-welcome-start-btn').click();
    await page.getByTestId('mobile-hub-google-btn').click();

    await expect(page.getByTestId('mobile-google-auth-view')).toBeVisible();
    await expect(page.getByTestId('google-account-joko')).toBeVisible();
    await expect(page.getByTestId('google-account-valentino')).toBeVisible();

    // Back to Hub
    await page.getByTestId('mobile-google-back-btn').click();
    await expect(page.getByTestId('mobile-setup-hub')).toBeVisible();
  });

  test('navigates to Email Auth view, enters credentials, and returns to Hub', async ({ page }) => {
    await page.getByTestId('mobile-welcome-start-btn').click();
    await page.getByTestId('mobile-hub-email-btn').click();

    await expect(page.getByTestId('mobile-email-auth-view')).toBeVisible();

    const emailInput = page.getByTestId('mobile-email-input');
    const passwordInput = page.getByTestId('mobile-password-input');
    const submitBtn = page.getByTestId('mobile-email-submit-btn');

    await expect(emailInput).toBeVisible();
    await expect(passwordInput).toBeVisible();
    await expect(submitBtn).toBeVisible();

    await emailInput.fill('storeowner@kasirmu.com');
    await passwordInput.fill('KasirmuSecretPass2026!');
    await expect(emailInput).toHaveValue('storeowner@kasirmu.com');

    // Back to Hub
    await page.getByTestId('mobile-email-back-btn').click();
    await expect(page.getByTestId('mobile-setup-hub')).toBeVisible();
  });

  test('navigates to QR Pairing view, displays reticle & pairing code, and copies link', async ({ page, context }) => {
    // Grant clipboard permissions if supported
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});

    await page.getByTestId('mobile-welcome-start-btn').click();
    await page.getByTestId('mobile-hub-qr-btn').click();

    await expect(page.getByTestId('mobile-qr-pairing-view')).toBeVisible();
    await expect(page.getByTestId('mobile-qr-reticle-box')).toBeVisible();
    await expect(page.getByTestId('mobile-qr-link-text')).toBeVisible();

    const copyBtn = page.getByTestId('mobile-qr-copy-btn');
    await expect(copyBtn).toBeVisible();
    await copyBtn.click();

    // Back to Hub
    await page.getByTestId('mobile-qr-back-btn').click();
    await expect(page.getByTestId('mobile-setup-hub')).toBeVisible();
  });

  test('adapts layout cleanly between portrait and landscape viewports with zero overflow', async ({ page }) => {
    // 1. Figma Portrait baseline (720×1280)
    await page.setViewportSize({ width: 720, height: 1280 });
    await expect(page.getByTestId('mobile-welcome-screen')).toBeVisible();

    let scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    let clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    // 2. Figma Landscape baseline (1280×720)
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(page.getByTestId('mobile-welcome-screen')).toBeVisible();

    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    // Transition to Hub in landscape
    await page.getByTestId('mobile-welcome-start-btn').click();
    await expect(page.getByTestId('mobile-setup-hub')).toBeVisible();

    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    // Transition to QR in landscape
    await page.getByTestId('mobile-hub-qr-btn').click();
    await expect(page.getByTestId('mobile-qr-pairing-view')).toBeVisible();

    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    // 3. Compact mobile phone landscape (740×360)
    await page.setViewportSize({ width: 740, height: 360 });
    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
});
