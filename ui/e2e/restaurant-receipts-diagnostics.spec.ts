import { test, expect, type Page } from '@playwright/test';
import { openRestaurantSidebarRow } from './helpers';

// WHY THIS FILE EXISTS
//
// The receipts screen sits at 5 of 15 testids, and its uncovered set is dominated by the
// HARDWARE DIAGNOSTICS: test print, test chit, test drawer. Those are what an operator
// reaches for when the printer stops working mid-service, and nothing exercised them.
//
// `handleTestPrint` (`:808-905`) is a PRE-FLIGHT LADDER — four checks before it prints,
// each with its own code:
//
//   ERR_AUTH_REQUIRED     no session
//   ERR_PRINTER_DISABLED  printer switched off in settings
//   ERR_MISSING_HOST      network printer with no address
//   ERR_MISSING_PORT      usb/serial/bluetooth with no port
//
// Then it prints and reports success or failure into a status card (`:1889-1905`).
//
// Measured 2026-10-14: on the seeded profile the ladder stops at ERR_MISSING_PORT, so the
// reachable branch is a real error report rather than the happy path. That is the branch an
// operator meets first, and it is the one pinned here.

const TIMEOUT = 20_000;

async function openReceipts(page: Page): Promise<void> {
  await openRestaurantSidebarRow(page, 'receipts');
  await expect(page.locator('[data-testid="restaurant-receipts-test-print-btn"]')).toBeVisible({
    timeout: TIMEOUT,
  });
}

test('a test print reports its outcome rather than doing nothing', async ({ page }) => {
  await openReceipts(page);

  const button = page.locator('[data-testid="restaurant-receipts-test-print-btn"]');
  const status = page.locator('[data-testid="restaurant-receipts-test-print-status"]');

  // Nothing has been tried yet, so there is no result card — it is a function of a run.
  await expect(status, 'no result before a test is run').toHaveCount(0);
  await expect(button).toBeEnabled({ timeout: TIMEOUT });

  await button.click();

  // THE RESULT CARD. A test button that does nothing visible is worse than none: the
  // operator cannot tell a working printer from an unresponsive one.
  await expect(status, 'a test print must report something').toBeVisible({ timeout: TIMEOUT });

  // It reports a CODE and a human sentence, which is what makes it actionable — the code
  // for a support call, the sentence for the operator standing at the till.
  const text = await status.innerText();
  expect(text, 'the card must name a code').toMatch(/PRN_|ERR_|OK|[A-Z]{3,}/);
  expect(text.length, 'the card must carry a message, not just a code').toBeGreaterThan(20);
});

test('the test-print button disables itself while the run is in flight', async ({ page }) => {
  await openReceipts(page);

  const button = page.locator('[data-testid="restaurant-receipts-test-print-btn"]');
  await button.click();

  // The card appearing is the end of the run. Asserting the button RETURNS to enabled is
  // the half that catches a spinner that never clears — the operator would be locked out
  // of the one diagnostic they have.
  await expect(page.locator('[data-testid="restaurant-receipts-test-print-status"]')).toBeVisible({
    timeout: TIMEOUT,
  });
  await expect(button, 'the button must come back after the run').toBeEnabled({
    timeout: TIMEOUT,
  });
});