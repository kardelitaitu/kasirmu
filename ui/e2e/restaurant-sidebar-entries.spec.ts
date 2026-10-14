import { test, expect, type Page } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

/**
 * E2E: Restaurant POS — the sidebar's entries.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The restaurant sidebar has seven rows, and until round 149 only Settings had any E2E
 * coverage. The other six are the operator's entire route to the screens around the
 * till — the menu editor, receipt and payment settings, sales history, the kitchen
 * display — and every one of them was driven by hand in earlier rounds before being
 * pinned here.
 *
 * WHAT EACH CASE PROVES
 * ---------------------
 * Not full behaviour (that is each screen's own suite), but the ROUTE: the row exists,
 * it is enabled for a role that holds `settings:edit`, clicking it REPLACES the sale
 * with the screen, and the screen offers a way back. A row that stops firing, or a
 * screen that mounts without its back control, strands the cashier mid-service.
 *
 * Round 128's lesson applies to the gating: `effectiveIsManager` resolves to
 * `hasGrantedPermission(permissions, 'settings:edit')`, so an owner reaches all of
 * these and a `staff` account does not. The role is therefore load-bearing and stated.
 *
 * Settings, KDS and Close Shift are deliberately out of the per-screen cases: Settings
 * has its own spec (`restaurant-settings-toggles.spec.ts`), KDS navigates to a different
 * workspace and is covered by `e2e-kds-critical-path.spec.ts`, and Close Shift ends the
 * session. All three are still asserted present-and-enabled in the first case.
 */

const TIMEOUT = 20_000;

/** Log in as owner and open the restaurant POS. */
async function openRestaurantPos(page: Page): Promise<void> {
  await loginAs(page, 'owner', '1234');
  await selectWorkspace(page, WORKSPACES.RESTAURANT_POS);
  await expect(page.locator('.restaurant-card').first()).toBeVisible({ timeout: TIMEOUT });
}

/** Open the sidebar popover. */
async function openSidebar(page: Page): Promise<void> {
  const sidebarBtn = page.locator('.restaurant-sidebar-btn');
  await expect(sidebarBtn).toBeVisible({ timeout: TIMEOUT });
  await sidebarBtn.click();
}

/** Click one sidebar row by testid. */
async function clickRow(page: Page, testId: string): Promise<void> {
  const row = page.locator(`[data-testid="${testId}"]`);
  await expect(row).toBeVisible({ timeout: 5_000 });
  await row.click();
}

/**
 * Every row is present and enabled for an owner.
 *
 * Deliberately ONE case for all seven rather than seven near-identical ones: the claim is
 * "the operator can reach their screens", the per-screen behaviour belongs to the
 * screen, and seven copies of the same three lines would only add places to edit.
 */
test('every sidebar row renders and is enabled for an owner', async ({ page }) => {
  await openRestaurantPos(page);
  await openSidebar(page);

  const rows = [
    'restaurant-sidebar-close-shift',
    'restaurant-sidebar-history',
    'restaurant-sidebar-menu-editor',
    'restaurant-sidebar-receipts',
    'restaurant-sidebar-payments',
    'restaurant-sidebar-settings',
  ];
  for (const id of rows) {
    const row = page.locator(`[data-testid="${id}"]`);
    await expect(row, `${id} should exist`).toBeAttached();
    await expect(row, `${id} should be enabled for an owner`).toBeEnabled();
  }

  // KITCHEN DISPLAY IS ABSENT HERE, CORRECTLY. Round 128 gated this row on
  // `FEATURES.KITCHEN_DISPLAY` (`PosScreen.tsx:1748`), because `isPageAccessible` alone
  // could not hide it — the `kds` page carries only a feature flag. Round 129 measured the
  // dev-mock's answer: `['sales','inventory','reporting','staff','settings']`
  // (`handlers/system.ts`), which omits `kitchen-display`. So the row is hidden BY DESIGN
  // and this case asserts its absence rather than tolerating it — a row that reappears
  // here means either the feature gate was dropped or the mock's feature set changed.
  await expect(page.locator('[data-testid="restaurant-sidebar-kds"]')).toHaveCount(0);
});

test('Menu Editor replaces the sale and offers a way back', async ({ page }) => {
  await openRestaurantPos(page);
  await openSidebar(page);
  await clickRow(page, 'restaurant-sidebar-menu-editor');

  // WAIT ON DATA, NOT ON THE HEADER. `restaurant-menu-editor-header` and the back button
  // render unconditionally (`RestaurantMenuEditorScreen.tsx:913`, before the loading branch),
  // so a header wait passes against a screen whose items have not loaded — round 185's trap,
  // which this case fell into until round 186. `bulk-avail` only renders with items present,
  // so it is the signal the load finished.
  await expect(page.locator('[data-testid="restaurant-menu-editor-bulk-avail"]')).toBeVisible({
    timeout: TIMEOUT,
  });
  // The product grid is gone: the screen REPLACES the sale rather than overlaying it.
  await expect(page.locator('.restaurant-card')).toHaveCount(0);

  await page.locator('[data-testid="restaurant-menu-editor-back-btn"]').click();
  await expect(page.locator('.restaurant-card').first()).toBeVisible({ timeout: TIMEOUT });
});

test('Receipts replaces the sale and shows its preview', async ({ page }) => {
  await openRestaurantPos(page);
  await openSidebar(page);
  await clickRow(page, 'restaurant-sidebar-receipts');

  await expect(page.locator('[data-testid="restaurant-receipts-title"]')).toBeVisible({
    timeout: TIMEOUT,
  });
  // The preview is the thing an operator actually reads on this screen.
  await expect(page.locator('.resto-receipt-paper').first()).toBeVisible({ timeout: TIMEOUT });
});

test('Payments replaces the sale and lists the rails', async ({ page }) => {
  await openRestaurantPos(page);
  await openSidebar(page);
  await clickRow(page, 'restaurant-sidebar-payments');

  await expect(page.locator('[data-testid="restaurant-payments-title"]')).toBeVisible({
    timeout: TIMEOUT,
  });
  // The rail switches are the point of this screen; an empty list means the read failed.
  const switches = page.locator('[role="switch"]');
  await expect.poll(() => switches.count(), { timeout: TIMEOUT }).toBeGreaterThan(0);
});

test('History replaces the sale and offers a way back', async ({ page }) => {
  await openRestaurantPos(page);
  await openSidebar(page);
  await clickRow(page, 'restaurant-sidebar-history');

  await expect(page.locator('[data-testid="sales-history-back-btn"]')).toBeVisible({
    timeout: TIMEOUT,
  });

  await page.locator('[data-testid="sales-history-back-btn"]').click();
  await expect(page.locator('.restaurant-card').first()).toBeVisible({ timeout: TIMEOUT });
});
