import { test, expect, type Page } from '@playwright/test';
import { dismissRestaurantCartSheet, openRestaurantPosWithItem } from './helpers';

// WHY THIS FILE EXISTS
//
// Round 215 pinned the PARK half of the tab cycle (save empties the cart, the badge counts
// the tab). Round 216 then claimed `pos-cart-kds-btn` was "reachable and uncovered" — that
// was wrong, and finding out why is what opened this file.
//
// ⚠️ CORRECTED 2026-10-14 (round 217). In the RESTAURANT workspace the cart header's
// terminal-action cluster does not render at all: it is wrapped in
// `!sidebarOwnsTerminalActions` (`CartPanel.tsx:649`, documented at `:641-648`), because
// PosScreen hands those controls to the sidebar popover. So `pos-cart-kds-btn` AND the
// floor-plan button inside that cluster are correctly absent here — round 216 read the
// second one as a feature gate (true, but not the whole story) and the first as reachable
// (false). The KDS route is covered through `restaurant-sidebar-kds`.
//
// What remains genuinely reachable and untested in `CartPanel` is the RESUME half:
// `pos-active-tab-banner` and `pos-cart-new-tab-btn`, both gated on `activeOpenBillId`,
// which only a resume sets (`OpenBillModals.tsx:158` → `handleResumeOpenBill`).

const TIMEOUT = 20_000;

/** Open the till with one item and no sheet in the way. */
async function openTillWithItem(page: Page): Promise<void> {
  await openRestaurantPosWithItem(page);
  await dismissRestaurantCartSheet(page);
  await expect(page.locator('.pos-cart-table-input').first()).toBeVisible({ timeout: TIMEOUT });
}

/** Park the current cart as a tab against `table`. */
async function saveTabAs(page: Page, table: string): Promise<void> {
  await page.locator('.pos-cart-table-input').first().fill(table);
  await page.locator('[data-testid="pos-cart-save-tab-btn"]').click();
  await expect(page.locator('.pos-cart-table-input').first()).toHaveValue('', {
    timeout: TIMEOUT,
  });
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

test('resuming a parked tab raises the banner and restores the order', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'needs the cart and the tiles at once');

  await openTillWithItem(page);
  await saveTabAs(page, '12');

  // The banner tracks a RESUMED tab, not a saved one — so there is none yet (round 215).
  const banner = page.locator('[data-testid="pos-active-tab-banner"]');
  await expect(banner, 'a parked tab does not raise the banner').toHaveCount(0);

  await resumeFirstTab(page);

  // RESUME is what raises it, and it names the tab (`heldCartLabel`, not 'Table Table 12').
  await expect(banner).toBeVisible({ timeout: TIMEOUT });
  await expect(banner).toContainText('Table 12');

  // And the ORDER comes back with it — a banner over an empty cart would be a lie.
  await expect(
    page.locator('[data-testid="cart-panel-line-item"]').first(),
    'resuming must restore the parked lines',
  ).toBeVisible({ timeout: TIMEOUT });
});

test('New Tab ends a resumed tab and frees the cart', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'needs the cart and the tiles at once');

  await openTillWithItem(page);
  await saveTabAs(page, '12');
  await resumeFirstTab(page);

  const banner = page.locator('[data-testid="pos-active-tab-banner"]');
  await expect(banner).toBeVisible({ timeout: TIMEOUT });

  // The way OUT of a tab. Without it an operator who resumed the wrong one is stuck
  // holding another table's order.
  const newTab = page.locator('[data-testid="pos-cart-new-tab-btn"]');
  await expect(newTab, 'a resumed tab offers a way out').toBeVisible({ timeout: TIMEOUT });
  await newTab.click();

  await expect(banner, 'New Tab ends the resumed tab').toHaveCount(0, { timeout: TIMEOUT });
  await expect(page.locator('[data-testid="cart-panel-line-item"]')).toHaveCount(0, {
    timeout: TIMEOUT,
  });
});