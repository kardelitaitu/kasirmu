import { test, expect } from '@playwright/test';
import { openRestaurantPosWithItem as openRestaurantPosWithItemShared } from './helpers';

/**
 * E2E: Restaurant POS — the cart footer's restaurant capabilities.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Five restaurant-only capabilities had NO live coverage. A sweep of every spec in
 * `ui/e2e` for the selectors they use found nothing at all for:
 *
 *   `pos-cart-send-kitchen-btn`      — dispatch to the kitchen printer and KDS
 *   `pos-cart-split-bill-btn`        — split a bill by line item
 *   `pos-cart-discount-btn`          — the inline discount form
 *   `pos-cart-promotion-btn`         — the promotions modal
 *   the restaurant Settings toggles  — `restaurant-sidebar-settings`
 *
 * The payment modal, the order lifecycle, the portrait cart sheet and the layout contract
 * are covered by sibling specs; these are the remaining footer controls.
 *
 * TWO SHELLS, TWO SHAPES
 * ----------------------
 * Same trap as `restaurant-payment-modal.spec.ts`: desktop renders the cart inline, the
 * portrait tablet puts it in a bottom sheet behind `.restaurant-floating-cart-trigger`.
 * `openRestaurantPosWithItem` below handles both, so each case runs on either project.
 *
 * Selector notes measured on the live screen:
 *   `.restaurant-card`               — menu tile (NOT `.restaurant-grid-item`, which is the
 *                                      desktop grid's own class; the tile's accessible name
 *                                      ends in "Add")
 *   `.pos-cart-discount-btn`         — matched by TWO buttons; the promotions one ALSO
 *                                      carries `.pos-cart-promotion-btn` (CartFooterTotals.tsx:136,:145),
 *                                      so address each by its own class and never by the shared one
 */

const TIMEOUT = 15_000;

// The two-shell cart setup is shared — `openRestaurantPosWithItem` in `helpers.ts`.
//
// 'staff' is EXPLICIT, and was already this spec's role before the extraction: these are
// cart controls that need no `settings:edit`, so the least-privileged account that can reach
// the till is the one that should exercise them. Round 161 parameterised the shared helper
// rather than quietly promoting this spec to owner.
async function openRestaurantPosWithItem(page: import('@playwright/test').Page) {
  await openRestaurantPosWithItemShared(page, 'staff');
}

test.describe('Restaurant POS — cart footer capabilities', () => {
  test('the discount form opens inline and the Apply button arms only for a valid value', async ({
    page,
  }) => {
    await openRestaurantPosWithItem(page);

    // The form is INLINE, not a modal: `restaurant-pos-cart-footer-live-controls.md`
    // (2026-10-12) records that scanning `[role=dialog]` for its inputs finds nothing.
    await page.locator('.pos-cart-discount-btn').first().click();
    const form = page.locator('.pos-cart-discount-form');
    await expect(form).toBeVisible({ timeout: 5_000 });

    // An empty field must not arm Apply — a discount of nothing is not a discount.
    const apply = form.getByRole('button', { name: /apply/i });
    await expect(apply).toBeDisabled();

    // 10 is a valid percentage; the same form rejects >100 and refuses fractional input.
    const input = form.locator('input').first();
    await input.fill('10');
    await expect(apply).toBeEnabled({ timeout: 5_000 });
  });

  test('the promotions button opens the promotions modal', async ({ page }) => {
    await openRestaurantPosWithItem(page);

    // `.pos-cart-promotion-btn` — NOT `.pos-cart-discount-btn`, which both buttons share.
    await page.locator('.pos-cart-promotion-btn').first().click();
    await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 5_000 });
  });

  test('Split Bill opens its editor over the cart', async ({ page }) => {
    await openRestaurantPosWithItem(page);

    const split = page.locator('[data-testid="pos-cart-split-bill-btn"]');
    await expect(split).toBeVisible({ timeout: TIMEOUT });
    await split.click();

    // `pos-split-bill-modal` is the dialog; its confirm control repeats the amount it
    // will charge, which is the figure the cashier reads back to the guest.
    await expect(page.locator('[data-testid="pos-split-bill-modal"]')).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.locator('[data-testid="pos-split-modal-confirm-btn"]')).toBeVisible();
  });

  test('Send to Kitchen needs a table or an open bill before it appears', async ({ page }) => {
    await openRestaurantPosWithItem(page);

    // The gate is CartActionBar.tsx:190 — `hasLines && (tableNumber || activeOpenBillId)
    // && hasUndispatchedItems`. A restaurant kitchen ticket is about a table, so the button
    // is absent rather than disabled until one is named.
    const kitchen = page.locator('[data-testid="pos-cart-send-kitchen-btn"]');
    await expect(kitchen).toHaveCount(0);

    const table = page.getByLabel(/table number/i).first();
    await table.fill('T12');
    await expect(kitchen).toBeVisible({ timeout: 5_000 });
    await kitchen.click();

    // The dispatched line is marked so the cashier can see what the kitchen already has:
    // `CartLineItem.tsx:192-195` renders a bare `<span>Sent</span>` when
    // `dispatchedQty >= qty`, so it is addressed by text.
    await expect(page.getByText('Sent', { exact: true }).first()).toBeVisible({
      timeout: TIMEOUT,
    });
  });
});
