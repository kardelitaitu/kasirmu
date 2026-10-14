import { test, expect, type Page } from '@playwright/test';
import { openRestaurantSidebarRow } from './helpers';

/**
 * E2E: the restaurant Payments screen's ADD CUSTOM RAIL form.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Round 189 re-derived the restaurant coverage numbers and put this screen at 2 of 32 testids.
 * This covers the one control that is neither a credential input nor a toggle: adding a
 * bespoke payment rail — a local wallet, a QRIS variant, a house account — the only way an
 * operator puts a new method on the till.
 *
 * WHAT MAKES THE FLOW WORTH PINNING (handleAddCustomRail, :684-712):
 *   * the code is SANITISED, so a typed abbreviation becomes the stored wire code;
 *   * a code that sanitises to nothing is REFUSED with a warning, not silently dropped;
 *   * a duplicate code is refused with its own message;
 *   * an empty display name falls back to the sanitised code uppercased;
 *   * both fields clear on success, so the form is ready for the next one.
 *
 * Each of those five is somewhere a one-line refactor could silently lose an operator's intent.
 */

const TIMEOUT = 20_000;

async function openPayments(page: Page): Promise<void> {
  await openRestaurantSidebarRow(page, 'payments');
  // The rail switches only render once the effective read resolved; their attachment is the
  // data-shaped wait rather than the header, which paints first (round 186).
  await expect(page.locator('[data-testid="payment-card-toggle-cash"]')).toBeAttached({
    timeout: TIMEOUT,
  });
}

test('a custom rail is added and the form resets', async ({ page }) => {
  await openPayments(page);

  const code = page.locator('[data-testid="new-rail-code-input"]');
  const label = page.locator('[data-testid="new-rail-label-input"]');
  const add = page.locator('[data-testid="add-custom-rail-btn"]');

  await expect(code).toBeVisible({ timeout: TIMEOUT });
  await expect(add, 'a code is required before Add is armed').toBeDisabled();

  // A code alone is enough — the display name falls back to the sanitised code uppercased.
  await code.fill('qr-bca');
  await expect(add).toBeEnabled({ timeout: 8_000 });
  await add.click();

  await expect(code).toHaveValue('', { timeout: TIMEOUT });
  await expect(label).toHaveValue('', { timeout: TIMEOUT });

  // The new rail is on screen with its own toggle, so it is a real rail and not just cleared
  // fields.
  await expect(page.locator('[data-testid="payment-card-toggle-qr-bca"]')).toBeAttached({
    timeout: TIMEOUT,
  });
});

test('a duplicate code is refused with a warning and the field survives', async ({ page }) => {
  await openPayments(page);

  const code = page.locator('[data-testid="new-rail-code-input"]');
  const label = page.locator('[data-testid="new-rail-label-input"]');
  const add = page.locator('[data-testid="add-custom-rail-btn"]');

  await code.fill('cash');
  await label.fill('Cash Again');
  await expect(add).toBeEnabled({ timeout: 8_000 });
  await add.click();

  // Refused AND said — the handler toasts the duplicate message (:694-700).
  await expect(
    page.getByText(/already|duplicate|exist/i).first(),
    'a duplicate rail code must be refused with feedback',
  ).toBeVisible({ timeout: 8_000 });

  // The field is NOT cleared, so the operator can correct it rather than retype.
  await expect(code).toHaveValue('cash', { timeout: TIMEOUT });
});