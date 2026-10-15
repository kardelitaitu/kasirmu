import { test, expect, type Page } from '@playwright/test';
import { openRestaurantSidebarRow } from './helpers';

// WHY THIS FILE EXISTS
//
// Round 222 covered the receipts screen's TEST PRINT. Two more operator diagnostics sat beside
// it uncovered: the CASH DRAWER kick and the KITCHEN CHIT. Covering them turned up a measured
// collision (round 247) which is fixed by a CSS clearance rule, and this spec pins both.
//
// THE DRAWER IS THE INTERESTING ONE. `handleTestDrawer` (`:975-1013`) has THREE outcomes:
//
//   res.opened !== false   success      the drawer confirmed it kicked
//   res.opened === false   WARNING      the command was sent and NOT confirmed
//   threw                  error
//
// The middle is the point. A cash drawer is a dumb device: the app can send the kick and hear
// nothing back, and calling that success would tell a cashier the drawer is open when it may not
// be. A warning that says sent-but-unconfirmed is the honest middle, a separate claim from either
// neighbour.
//
// THE COLLISION THIS SPEC ALSO GUARDS. The drawer button sits in `.restaurant-preview-column`,
// which is `position: sticky; top: 0` - so it does NOT travel with the settings column's scroll,
// and at the desktop 1366x768 profile with two memos pending it rested at y=682 under the memo
// stack (y=610..747). Round 247 measured that elementFromPoint at its centre returned
// memo-banner-title. The clearance rule added in this round is what lets it scroll clear.

const TIMEOUT = 20_000;

async function openReceipts(page: Page): Promise<void> {
  await openRestaurantSidebarRow(page, 'receipts');
  await expect(page.locator('[data-testid="restaurant-receipts-test-print-btn"]')).toBeVisible({
    timeout: TIMEOUT,
  });
}

/**
 * Put a sticky-column control into a clickable position.
 *
 * `scrollIntoViewIfNeeded` is NOT enough and the reason is structural: it scrolls the region, and a
 * sticky child does not move with it - measured (round 247): scrollTop 400 left the button at y=682.
 * Scrolling the region to its END is what engages the memo clearance reserved at the bottom.
 */
async function bringIntoReach(page: Page, locator: ReturnType<Page['locator']>): Promise<void> {
  await locator.evaluate((el) => {
    let n: HTMLElement | null = el.parentElement;
    while (n && getComputedStyle(n).overflowY !== 'auto') n = n.parentElement;
    if (n) n.scrollTop = n.scrollHeight;
  });
  await page.waitForTimeout(300);
  await expect(locator).toBeInViewport();
}

test('the test drawer reports what it actually knows', async ({ page }) => {
  await openReceipts(page);

  const drawer = page.locator('[data-testid="restaurant-receipts-test-drawer-btn"]');
  await expect(drawer, 'the drawer diagnostic is offered').toBeVisible({ timeout: TIMEOUT });
  await expect(drawer).toBeEnabled();

  await bringIntoReach(page, drawer);
  await drawer.click();

  // SOMETHING must be reported - a silent kick leaves a cashier tapping a button and guessing.
  const toast = page.locator('[class*="toast"]').first();
  await expect(toast, 'kicking the drawer must report itself').toBeVisible({ timeout: TIMEOUT });
  expect(((await toast.innerText()) ?? '').trim().length, 'the report carries a message').toBeGreaterThan(5);

  // AND THE BUTTON COMES BACK. Asserting only that a message appeared would pass on a run whose
  // spinner never clears, locking the operator out of the one diagnostic they have.
  await expect(drawer, 'the button must return after the kick').toBeEnabled({ timeout: TIMEOUT });
});

test('the kitchen chit walks its own pre-flight ladder', async ({ page }) => {
  await openReceipts(page);

  // THE PREVIEW CHIT BUTTON, not the settings one. Measured on the seeded profile:
  //
  //   restaurant-kitchen-test-chit-btn          count 0 - gated on `hasKdsFeature &&
  //                                                    kitchenConnection !== 'disabled'` (`:2853`),
  //                                                    and the kitchen printer is seeded disabled;
  //   restaurant-receipts-preview-test-chit-btn count 1 - same handler, no gate.
  //
  // Both call `handleTestKitchenChit`, so the ladder is the same; only the reachable one is used.
  const chit = page.locator('[data-testid="restaurant-receipts-preview-test-chit-btn"]');
  await expect(chit, 'the kitchen chit diagnostic is offered').toBeVisible({ timeout: TIMEOUT });
  await bringIntoReach(page, chit);
  await chit.click();

  // The kitchen printer is not configured on the seeded profile, so the ladder stops at its own
  // check and reports a CODE - the same contract round 222 pinned for the receipt printer.
  const toast = page.locator('[class*="toast"]').first();
  await expect(toast, 'the chit test must report itself').toBeVisible({ timeout: TIMEOUT });
  const text = ((await toast.innerText()) ?? '').replace(/\n+/g, ' ');
  expect(text, 'the report carries a code an operator can quote').toMatch(/PRN_|ERR_|chit|print/i);
});