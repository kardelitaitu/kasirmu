import { test, expect, type Page } from '@playwright/test';
import { dismissRestaurantCartSheet, openRestaurantPosWithItem } from './helpers';

// WHY THIS FILE EXISTS
//
// CartPanel is the outlier at 1 of 10 testids after rounds 204-212 worked through
// CartLineItem. Its most valuable untested surface is the OPEN-BILLS badge — the only way
// an operator finds a tab they parked.
//
// THE MODEL, corrected twice (rounds 213-215). A SAVED tab is PARKED, not open:
// handleOpenBill resets the cart and clears `activeOpenBillId` deliberately
// (usePosHeldCarts.ts:301-306) — the tab goes to the Open Bills list, and
// handleResumeOpenBill (:326) is how it comes back. `pos-active-tab-banner` tracks a
// RESUMED tab, so expecting it straight after Save Tab was wrong in both earlier rounds.
//
// That also explains the toast: 'Tab for Table 12 saved' with an EMPTY cart afterwards is
// the feature working, not a defect. This spec pins the cycle instead of the banner.

const TIMEOUT = 20_000;

// Open the till with one item and no sheet in the way.
async function openTillWithItem(page: Page): Promise<void> {
  await openRestaurantPosWithItem(page);
  await dismissRestaurantCartSheet(page);
  // Let the shift read settle: Save Tab is gated on an active shift
  // (CartActionBar.tsx:113-120) and the dev-mock seeds one.
  await expect(page.locator('.pos-cart-table-input').first()).toBeVisible({ timeout: TIMEOUT });
}

// Park the current cart as a tab against `table`.
async function saveTabAs(page: Page, table: string): Promise<void> {
  await page.locator('.pos-cart-table-input').first().fill(table);
  await page.locator('[data-testid="pos-cart-save-tab-btn"]').click();
  // The save reports itself and the form clears.
  await expect(page.locator('.pos-cart-table-input').first()).toHaveValue('', {
    timeout: TIMEOUT,
  });
}

test('saving a tab parks it: the cart clears and the badge counts it', async ({
  page,
}, testInfo) => {
  // Desktop only: the badge lives in the cart panel, which portrait puts behind the sheet
  // whose backdrop covers the tiles (round 201's constraint).
  test.skip(testInfo.project.name !== 'desktop', 'needs the cart and the tiles at once');

  await openTillWithItem(page);

  // No tabs yet, so no badge — it renders only when open bills exist (CartPanel.tsx:1110).
  const badge = page.locator('.pos-cart-held-badge');
  await expect(badge, 'no parked tabs means no badge').toHaveCount(0);

  await saveTabAs(page, '12');

  // THE PARK. The cart is deliberately empty and the table field cleared — this is the
  // behaviour rounds 213-214 read as a missing banner, and it is the feature working.
  await expect(
    page.locator('[data-testid="cart-panel-line-item"]'),
    'a parked tab leaves the cart empty for the next order',
  ).toHaveCount(0, { timeout: TIMEOUT });
  await expect(page.locator('.pos-cart-table-input').first()).toHaveValue('');

  // And the badge appears, counting it — the operator's way back.
  await expect(badge, 'the parked tab must be findable').toBeVisible({ timeout: TIMEOUT });
  await expect(badge).toContainText('1');
});

test('a parked tab can be reopened from the badge', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'needs the cart and the tiles at once');

  await openTillWithItem(page);
  await saveTabAs(page, '12');

  // Open the list.
  const badge = page.locator('.pos-cart-held-badge');
  await expect(badge).toBeVisible({ timeout: TIMEOUT });
  await badge.click();

  // The list shows the tab by its label, so the operator can tell which one it is:
  // `heldCartLabel` composes 'Table 12', not 'Table Table 12'.
  await expect(
    page.getByText(/Table 12/).first(),
    'the parked tab is listed by name',
  ).toBeVisible({ timeout: 10_000 });
});