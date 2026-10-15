import { test, expect, type Page } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

// WHY THIS FILE EXISTS
//
// `handleRequestExit` used to divert into `handleCloseShiftClick()` whenever a shift was
// open. The intent — reconcile the cash before leaving — is sound; the mechanism was not.
// Close Shift REFUSES when the cart is not empty and (round 294) when a tab is outstanding,
// so the diversion turned a NAVIGATION action into a dead end. Measured in a browser with
// an open tab:
//
//   PROBE RESULT homescreen=false closeshift=false opentab=true
//
// The operator pressed "Exit Workspace", got an error about a tab, and stayed exactly where
// they were. `setShowExitConfirm` was only reachable when `activeShift === null`, so there
// was no second route out — the till could not be left at all until the tab was dealt with.
//
// The two actions are now separate and the dialog carries the warning instead of the guard:
//   · Exit Workspace — always available; the dialog says a shift is still open
//   · Close Shift    — still guarded, because that IS the cash-reconciliation surface

const TIMEOUT = 20_000;

async function openSidebar(page: Page): Promise<void> {
  const b = page.locator('.restaurant-sidebar-btn');
  await expect(b).toBeVisible({ timeout: TIMEOUT });
  await b.click();
}

async function openRestaurantPos(page: Page): Promise<void> {
  await loginAs(page, 'owner', '1234');
  await selectWorkspace(page, WORKSPACES.RESTAURANT_POS);
  await expect(page.locator('.restaurant-card').first()).toBeVisible({ timeout: TIMEOUT });
}

test('Exit Terminal offers the exit even while an open tab blocks the shift close', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'needs the cart and the tiles at once');

  await openRestaurantPos(page);

  // Park and resume a tab, then clear the cart — the state that used to dead-end: the tab
  // guard refuses the close, and before this fix `activeShift !== null` meant the exit was
  // never offered either.
  await page.locator('.restaurant-card').first().click();
  const sheet = page.locator('[data-testid="restaurant-cart-sheet-backdrop"]');
  if (await sheet.isVisible().catch(() => false)) {
    await sheet.click({ position: { x: 5, y: 5 } });
  }
  await expect(page.locator('.pos-cart-table-input').first()).toBeVisible({ timeout: TIMEOUT });
  await page.locator('.pos-cart-table-input').first().fill('9');
  await page.locator('[data-testid="pos-cart-save-tab-btn"]').click();
  const badge = page.locator('.pos-cart-held-badge');
  await expect(badge).toBeVisible({ timeout: TIMEOUT });
  await badge.click();
  await page.locator('.pos-held-item-resume').first().click();
  await expect(page.locator('[data-testid="pos-active-tab-banner"]')).toBeVisible({
    timeout: TIMEOUT,
  });
  await page.locator('.pos-cart-clear-btn').click();
  await expect(page.locator('[data-testid="cart-panel-line-item"]')).toHaveCount(0, {
    timeout: TIMEOUT,
  });

  // THE ASSERTION. The exit dialog must appear — this is what a browser probe measured as
  // absent (homescreen=false closeshift=false) before the fix.
  await openSidebar(page);
  await page.getByRole('button', { name: /exit terminal/i }).click();

  await expect(
    page.getByRole('dialog').filter({ hasText: /exit workspace/i }),
    'Exit Terminal must offer the exit even with a tab outstanding',
  ).toBeVisible({ timeout: 5_000 });

  // And it WARNS about the open shift rather than silently navigating.
  await expect(
    page.getByText(/shift is still open/i).first(),
    'the operator must be told the shift is being left unreconciled',
  ).toBeVisible({ timeout: 5_000 });
});

test('Exit Terminal still warns, and still exits, with no tab outstanding', async ({ page }) => {
  // The plain case, on both projects: this is pure navigation and needs nothing from the
  // cart, so portrait can run it too.
  await openRestaurantPos(page);
  await openSidebar(page);
  await page.getByRole('button', { name: /exit terminal/i }).click();

  const dialog = page.getByRole('dialog').filter({ hasText: /exit workspace/i });
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  // Confirming actually leaves — a dialog nobody can act on is the same dead end.
  await dialog.getByRole('button', { name: /^exit$/i }).click();
  await expect(
    page.locator('.restaurant-card').first(),
    'confirming must leave the till',
  ).toHaveCount(0, { timeout: 10_000 });
});
