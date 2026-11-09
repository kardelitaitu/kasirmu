import { test, expect, type Page } from '@playwright/test';
import { dismissRestaurantCartSheet, openRestaurantPosWithItem, loginAs, selectWorkspace, WORKSPACES } from './helpers';

// WHY THIS FILE EXISTS
//
// `usePosShifts.handleCloseShiftClick` enforced only `lines.length > 0`. On restaurant
// POS that is NOT the empty state: a resumed tab's lines live in the cart only while it
// is being worked on, so "the cart is empty" is the NORMAL condition for "a customer
// has an open tab on this terminal". Round 294 added the guard and covered it with four
// vitest cases calling the hook directly — which cannot reach the real screen.
//
// WHAT ONLY A RENDERED TILL CAN SHOW. The unit cases pass `hasOpenTab` as a parameter.
// The real caller cannot: `activeOpenBillId` is produced by `usePosHeldCarts`, which
// PosScreen instantiates AFTER `usePosShifts`, so the value travels through a ref
// PosScreen assigns during render. Drop that assignment, or run it a render late, and
// every unit case stays green while the guard is dead on the real screen.
//
// THE TAB IS PARKED THROUGH THE REAL UI, not seeded into localStorage. Same choice
// `restaurant-tab-resume.spec.ts` makes, and for the same reason: a seeded row proves the
// seed works, while driving the operator's own route proves the route.

const TIMEOUT = 20_000;

/** Open the till with one item and no cart sheet in the way. */
async function openTillWithItem(page: Page): Promise<void> {
  await openRestaurantPosWithItem(page);
  await dismissRestaurantCartSheet(page);
  await expect(page.locator('.pos-cart-table-input').first()).toBeVisible({ timeout: TIMEOUT });
}

/** Park the current cart as a tab against `table`, through the operator's own controls. */
async function saveTabAs(page: Page, table: string): Promise<void> {
  await page.locator('.pos-cart-table-input').first().fill(table);
  await page.locator('[data-testid="pos-cart-save-tab-btn"]').click();
  await expect(page.locator('.pos-cart-table-input').first()).toHaveValue('', { timeout: TIMEOUT });
}

/** Resume the first parked tab from the Open Bills list. */
async function resumeFirstTab(page: Page): Promise<void> {
  const badge = page.locator('.pos-cart-held-badge');
  await expect(badge, 'a parked tab must be findable').toBeVisible({ timeout: TIMEOUT });
  await badge.click();
  const resume = page.locator('.pos-held-item-resume').first();
  await expect(resume, 'the list offers a way back in').toBeVisible({ timeout: 10_000 });
  await resume.click();
}

/** Open the sidebar popover and click one row by testid. */
async function clickSidebarRow(page: Page, testId: string): Promise<void> {
  const sidebarBtn = page.locator('.restaurant-sidebar-btn');
  await expect(sidebarBtn).toBeVisible({ timeout: TIMEOUT });
  await sidebarBtn.click();
  const row = page.locator(`[data-testid="${testId}"]`);
  await expect(row).toBeVisible({ timeout: 5_000 });
  await row.click();
}

test('a shift cannot be closed while a customer tab is open', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'needs the cart and the tiles at once');

  await openTillWithItem(page);
  await saveTabAs(page, '12');
  await resumeFirstTab(page);
  // Resuming raises the banner and restores the lines. The banner is what proves
  // `activeOpenBillId` is set on the real screen — the state this spec exists to exercise.
  await expect(page.locator('[data-testid="pos-active-tab-banner"]')).toBeVisible({
    timeout: TIMEOUT,
  });

  // ⚠️ THE CART MUST THEN BE EMPTIED, and the first two drafts of this spec missed it.
  //
  // The two guards are checked in order — cart first, then tab — so a resumed tab WITH
  // lines in the basket hits the cart message and never reaches the branch under test.
  // Both drafts failed on exactly that, which is the guard chain working correctly and
  // the test setting up the wrong state.
  //
  // Emptying is not a contrivance: it is the real-world shape. A waiter rings up a table's
  // food, saves the tab, and the cart clears — the tab lives on with an empty basket. That
  // is precisely the state the OLD guard read as "nothing outstanding".
  //
  // Cleared with the operator's own button rather than by seeding state, and `resetCart`
  // does NOT touch `activeOpenBillId` (PosScreen.tsx:1819 passes it straight through), so
  // the tab survives the clear — which is the assertion below.
  await page.locator('.pos-cart-clear-btn').click();
  await expect(page.locator('[data-testid="cart-panel-line-item"]')).toHaveCount(0, {
    timeout: TIMEOUT,
  });
  // The tab outlives the cart. If this ever fails the rest of the case is meaningless.
  await expect(page.locator('[data-testid="pos-active-tab-banner"]')).toBeVisible({
    timeout: TIMEOUT,
  });

  await clickSidebarRow(page, 'restaurant-sidebar-close-shift');

  // THE ASSERTION. The close-shift dialog must NOT appear, and the operator must be
  // told why in the words that fit: an open tab, not an un-empty cart.
  await expect(
    page.locator('.pos-close-shift-modal'),
    'closing a shift over an open tab orphans it',
  ).toHaveCount(0);
  await expect(
    page.getByText(/open tab/i).first(),
    'the operator must be told an open tab blocks the close, not left guessing',
  ).toBeVisible({ timeout: 5_000 });
});

test('a shift with no open tab still closes normally', async ({ page }) => {
  // RUNS ON BOTH PROJECTS, deliberately. Verified by lifting this file's other skip and
  // finding THIS case passes on tablet: it needs no parked tab and no cart interaction,
  // only the sidebar row and the dialog, both of which portrait renders. Skipping it too
  // would have thrown away real tablet coverage for a reason that does not apply to it.
  //
  // The over-correction guard at the browser level: were the new check wired to
  // something always-true, the till could never close a shift again.
  //
  // ⚠️ NO ITEM IS ADDED HERE, and that is load-bearing. The first draft used
  // `openTillWithItem` and failed against the CART message, not the tab one — the cart
  // guard fires before the tab guard, so an item in the basket makes this case test the
  // wrong branch. The cart being genuinely empty is the whole premise: it is the state
  // the old guard read as "nothing outstanding".
  await loginAs(page, 'owner', '1234');
  await selectWorkspace(page, WORKSPACES.RESTAURANT_POS);
  await expect(page.locator('.restaurant-card').first()).toBeVisible({ timeout: TIMEOUT });
  await clickSidebarRow(page, 'restaurant-sidebar-close-shift');

  await expect(
    page.locator('.pos-close-shift-modal'),
    'a quiet store must still be able to close its shift',
  ).toBeVisible({ timeout: 5_000 });
});
