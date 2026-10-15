import { test, expect, type Page } from '@playwright/test';
import { dismissRestaurantCartSheet, openRestaurantPosWithItem } from './helpers';

// WHY THIS FILE EXISTS
//
// `CartPanel` is the coverage outlier — 2 of 10 through rounds 204-215, which concentrated
// on `CartLineItem`. This covers the panel's own REACHABLE controls: the customer field and
// the floor-plan button. (The header said "and the KDS launcher" until 2026-10-14; there is no
// KDS case here, and `pos-cart-kds-btn` is not reachable in this workspace at all -- see the
// `sidebarOwnsTerminalActions` note below, which round 217 added.)
//
// ⚠️ THE TWO IT DOES NOT COVER, and why (measured 2026-10-14, round 216):
//
//   pos-cart-conflict-alert / pos-cart-conflict-takeover-btn
//
// The multi-terminal takeover warning. `getConflict` (`useTabLeases.ts:193-203`) reports a
// conflict only when a LIVE lease belongs to a DIFFERENT terminal, and `leases` is
// `useState` over `memoryLeases` (`:58`) — in-memory, not persisted, so a second terminal
// cannot be simulated from one page. Recording it rather than shipping a spec that would
// have to fake the state it claims to test.

const TIMEOUT = 20_000;

/** Open the till with one item and no sheet in the way. */
async function openTillWithItem(page: Page): Promise<void> {
  await openRestaurantPosWithItem(page);
  await dismissRestaurantCartSheet(page);
  await expect(page.locator('.pos-cart-table-input').first()).toBeVisible({ timeout: TIMEOUT });
}

test('the customer field stamps the order and survives a table change', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'needs the cart and the tiles at once');

  await openTillWithItem(page);

  // The name travels into the parked tab (round 215's cycle), so it has to actually
  // accept and hold input rather than merely render.
  const customer = page.locator('[data-testid="pos-cart-customer-input"]');
  await expect(customer, 'the till offers a customer field').toBeVisible({ timeout: TIMEOUT });
  await customer.fill('Bapak Budi');
  await expect(customer).toHaveValue('Bapak Budi');

  // ⚠️ The name must SURVIVE a table edit. They are separate fields of the same order, and
  // a re-render that dropped one when the other changed would lose the guest's name — the
  // class round 201 found on the dispatch record.
  await page.locator('.pos-cart-table-input').first().fill('7');
  await expect(customer, 'editing the table must not clear the customer').toHaveValue(
    'Bapak Budi',
  );
});

/**
 * The floor-plan button is FEATURE-GATED, and the preview does not enable its feature.
 *
 * `pos-cart-open-tables-btn` sits behind `isEnabled(FEATURES.TABLE_MANAGEMENT)`
 * (`CartPanel.tsx:927`), and the flag set comes from `get_enabled_features`. The dev-mock
 * answers `['sales', 'inventory', 'reporting', 'staff', 'settings']`
 * (`dev-mock/handlers/system.ts:744`) — **no `table-management`** — so the button is
 * correctly absent in this preview.
 *
 * That is a deliberate fixture rather than a defect, and it is also why the TABLES screens
 * are reachable in the specs that cover them: `TableManagementScreen` is opened through the
 * restaurant sidebar (`restaurant-sidebar-tables`), not through this button.
 *
 * Recorded rather than forced. Making this case run would mean editing the mock's feature
 * set, which every feature-gated surface reads.
 */
test('the floor-plan button is absent when its feature is off', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'needs the cart and the tiles at once');

  await openTillWithItem(page);

  // The NEGATIVE is the assertion: the gate is what keeps the button off, so a button that
  // appeared here would mean the feature check had stopped working.
  await expect(
    page.locator('[data-testid="pos-cart-open-tables-btn"]'),
    'the tables button must stay hidden while table-management is not in the enabled set',
  ).toHaveCount(0);

  // And the feature-gated surfaces that ARE enabled still render, so this is a gate and not
  // a wholesale failure to load features.
  await expect(page.locator('[data-testid="pos-cart-customer-input"]')).toBeVisible({
    timeout: TIMEOUT,
  });
});