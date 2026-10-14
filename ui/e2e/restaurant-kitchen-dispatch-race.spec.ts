import { test, expect, type Page } from '@playwright/test';
import { openRestaurantPosWithItem } from './helpers';

// WHY THIS FILE EXISTS
//
// `handleSendToKitchen` (PosScreen.tsx) sends a DELTA of undispatched lines and then
// records what was sent. The record used to be built from `lines` — this render's
// CLOSURE, captured before the await — and `setLines` REPLACES the cart with it:
//
//   const updatedLines = lines.map((l) => ({ ...l, dispatchedQty: l.qty }));
//   setLines(updatedLines);
//
// The cart stays editable while the send is in flight (`sendingToKitchen` drives only a
// button's processing state and is never read as a guard), so a line the operator added
// during the await was absent from the replacement array and was DROPPED. Measured
// live before the fix: two lines, Send, add a third — the cart came back with TWO, and
// the operator's item was gone with no message.
//
// That is the worst shape this class can take. A wrong 'Sent' badge misleads; a lost
// line loses an order. Both are pinned below.

const TIMEOUT = 20_000;

/**
 * Open the POS with a cart and leave the PRODUCT GRID reachable.
 *
 * On the tablet/portrait layout the cart is a bottom SHEET whose backdrop is
 * `position: fixed; inset: 0; z-index: 100`
 * (`RestaurantCartSheet.css:6-16`) — correct while the sheet is open, and it
 * intercepts every click on the grid behind it. `openRestaurantPosWithItem`
 * leaves the sheet open, so a spec that adds more items must dismiss it first.
 */
async function openPosWithDismissedSheet(page: Page): Promise<void> {
  await openRestaurantPosWithItem(page);
  const backdrop = page.locator('[data-testid="restaurant-cart-sheet-backdrop"]');
  if (await backdrop.isVisible().catch(() => false)) {
    await backdrop.click({ position: { x: 5, y: 5 } });
    await expect(backdrop).toHaveCount(0, { timeout: 8_000 });
  }
}

test('a line added while the kitchen send is in flight survives', async ({ page }, testInfo) => {
  // DESKTOP ONLY, and that is a measured constraint rather than a convenience.
  //
  // The race needs the product grid CLICKABLE while the cart is visible. In
  // portrait/tablet the cart IS the sheet: its backdrop covers the grid while it is
  // open, and dismissing the sheet unmounts the cart panel entirely, so there is no
  // layout in which both are reachable. Measured 2026-10-14 — the dismissed-sheet
  // variant reported `line.count() === 0`.
  test.skip(testInfo.project.name !== 'desktop', 'needs the grid and the cart visible at once');
  await openPosWithDismissedSheet(page);

  const line = page.locator('[data-testid="cart-panel-line-item"]');
  const sent = page.locator('[data-testid="cart-line-dispatched-badge"]');

  // Two lines so the cart is genuinely a cart rather than a single item.
  await page.locator('.restaurant-card').nth(1).click();
  await expect.poll(() => line.count(), { timeout: TIMEOUT }).toBe(2);
  await expect(sent, 'nothing is sent before Send').toHaveCount(0);

  // Send, then add a third WITHOUT waiting — that is the race.
  await page.keyboard.press('Shift+K');
  await page.locator('.restaurant-card').nth(2).click();

  // THE REGRESSION: three lines must be present. Two means the third was dropped by
  // the closure replacement.
  await expect
    .poll(() => line.count(), {
      timeout: TIMEOUT,
      message: 'the line added during the send must not be dropped',
    })
    .toBe(3);

  // And exactly TWO carry 'Sent' — the two that were in the cart at Send. A third
  // badge would mean the added line was falsely recorded as reaching the kitchen.
  await expect
    .poll(() => sent.count(), {
      timeout: TIMEOUT,
      message: 'only the lines actually sent may show Sent',
    })
    .toBe(2);
});

test('the Sent badge follows the quantity actually dispatched', async ({ page }) => {
  await openRestaurantPosWithItem(page);

  const line = page.locator('[data-testid="cart-panel-line-item"]').first();
  const sent = line.locator('[data-testid="cart-line-dispatched-badge"]');
  await expect(sent, 'a fresh line is not sent').toHaveCount(0);

  await page.keyboard.press('Shift+K');
  await expect(sent, 'the sent line carries the badge').toBeVisible({ timeout: TIMEOUT });

  // Raise the quantity AFTER the send. The kitchen has one; the cart now holds two, so
  // the line is no longer fully dispatched and the badge must clear — the waiter has to
  // know there is a portion not yet sent.
  const plus = line.locator('.pos-cart-qty-btn').last();
  await plus.click();
  await expect(sent, 'a raised quantity is not yet sent').toHaveCount(0, { timeout: TIMEOUT });
});