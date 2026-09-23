import { test, expect } from '@playwright/test';

/**
 * E2E: the device-pairing URL on both screens that show a pairing code.
 *
 * THE DEFECT THIS PINS (measured 2026-09-23). The dev-mock answered
 * `base_url` + `qr_payload` for `start_device_pairing`; the real Rust
 * `PairingSessionStart` (kasirmu-core/src/desktop_link.rs:38) declares
 * `code`, `poll_token`, `expires_at`, `qr_url` and nothing else. So `qr_url`
 * was UNDEFINED on every pairing screen, and Fluent — which reports an unknown
 * variable by echoing the message pattern back — rendered the literal
 * "…or visit {$url}" to the merchant instead of the URL.
 *
 * It looked fine: the QR still drew, because QRCodeSVG was handed `undefined`
 * and encoded the STRING "undefined". A merchant scanning that code, or typing
 * the printed address, would get nowhere.
 *
 * Both screens are asserted because both read the same DTO and both were broken.
 */

const PAIRING_URL = /https:\/\/kasir\.mu\/pair\?code=/;

test.describe('Device pairing URL', () => {
  test('the provisioning flow prints the real URL, not the Fluent pattern', async ({ page }) => {
    await page.goto('/index.mobile.html?unprovisioned=1');
    await page.waitForSelector('[data-testid="pairing-qr-wrapper"]', { timeout: 20_000 });

    const note = page.locator('.provisioning-note').first();
    await expect(note).toContainText(PAIRING_URL, { timeout: 10_000 });
    // The regression itself: the raw placeholder must never reach the screen.
    await expect(note).not.toContainText('{$url}');
  });

  test('the activation screen prints the real URL, not the Fluent pattern', async ({ page }) => {
    // Three seams: an inactive licence (routes to activation), no users and no
    // provisioning so the boot gate cannot fall through past it.
    await page.goto('/index.mobile.html?license=inactive&nousers=1&unprovisioned=1');
    // The screen opens on the setup choice (Google / pair); the pairing view —
    // and so the printed URL — is one step behind it.
    await page.click('[data-testid="setup-pair"]');
    await page.waitForSelector('[data-testid="pairing-qr-code"]', { timeout: 20_000 });

    const instructions = page.locator('.license-pairing-instructions');
    await expect(instructions).toContainText(PAIRING_URL, { timeout: 10_000 });
    await expect(instructions).not.toContainText('{$url}');
  });
});
