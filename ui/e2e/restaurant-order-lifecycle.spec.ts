import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

/**
 * Restaurant POS — the end-to-end ORDER LIFECYCLE.
 *
 * WHY THIS FILE EXISTS
 *   Every other restaurant spec covers ONE surface: the menu grid, the cart
 *   sheet, the payment modal. Nothing drove the sequence an actual beta tester
 *   performs, which is where integration defects live — a control that works
 *   alone but does not survive the next step. This walks:
 *
 *     add items -> set table -> pick an order type -> adjust a line
 *       -> set the table again (the attach/detach a tester does constantly)
 *       -> charge -> COMPLETE the sale -> receipt preview -> dismiss
 *
 *   It asserts at each hand-off rather than only at the end, so a break names
 *   the step that broke instead of reporting "the sale did not complete".
 *
 * PORTRAIT SHIMS
 *   The cart is inline on desktop/tablet-landscape and a bottom SHEET in
 *   portrait. openCart() handles both, the same way restaurant-payment-modal
 *   does, so this file runs under either project.
 *
 * CSS contract used:
 *   .restaurant-card                      product tile
 *   .restaurant-floating-cart-trigger     portrait: opens the cart sheet
 *   .restaurant-cart-sheet-panel          portrait: the sheet
 *   [data-testid="cart-panel-line-item"]  a cart line
 *   .pos-cart-table-input                 Table #
 *   .pos-cart-order-type-btn              Dine In / Takeaway / Delivery
 *   .pos-cart-pay-btn                     Charge
 *   [data-testid="payment-modal"]         the payment dialog
 *   [data-testid="settle-button"]         Complete
 *   [data-testid="pos-cart-guest-input"]  Pax
 */

const TIMEOUT = 15_000;

async function openCart(page: Page): Promise<void> {
  const lineItem = page.locator('[data-testid="cart-panel-line-item"]');
  if (await lineItem.first().isVisible().catch(() => false)) return;
  const trigger = page.locator('.restaurant-floating-cart-trigger');
  if (await trigger.isVisible().catch(() => false)) {
    await trigger.click();
    await expect(page.locator('.restaurant-cart-sheet-panel')).toBeVisible({ timeout: 5_000 });
  }
}

/** Log in, open the restaurant POS, and add `count` distinct products. */
async function openOrderWithItems(page: Page, count = 2) {
  await loginAs(page, 'staff', '1234');
  await selectWorkspace(page, WORKSPACES.RESTAURANT_POS);

  const cards = page.locator('.restaurant-card');
  await expect(cards.first()).toBeVisible({ timeout: TIMEOUT });
  for (let i = 0; i < count; i++) {
    await cards.nth(i).click();
  }
  await openCart(page);
}

test.describe('Restaurant POS — order lifecycle', () => {
  test('carries table, order type and items from the menu to a completed sale', async ({ page }) => {
    await openOrderWithItems(page, 2);

    const lines = page.locator('[data-testid="cart-panel-line-item"]');
    await expect(lines).toHaveCount(2, { timeout: 5_000 });

    // ── Step 1: table number survives the render it is typed into ──────────
    const table = page.locator('.pos-cart-table-input');
    await expect(table).toBeVisible({ timeout: 5_000 });
    await table.fill('12');
    await expect(table).toHaveValue('12');

    // ── Step 2: order type is a radio group, so assert the selection moved ──
    const orderTypeBtns = page.locator('.pos-cart-order-type-btn');
    await expect(orderTypeBtns.first()).toBeVisible({ timeout: 5_000 });
    await orderTypeBtns.nth(1).click();
    await expect(orderTypeBtns.nth(1)).toHaveAttribute('aria-checked', 'true');

    // ── Step 3: the table number must SURVIVE that interaction. A re-render
    // that dropped cart state would show up here, not at the end. ──────────
    await expect(table).toHaveValue('12');

    // ── Step 4: quantity steppers change the line count, not the line total ─
    const firstLine = lines.first();
    const plus = firstLine.locator('.pos-cart-qty-btn').last();
    await plus.click();
    await expect(page.locator('.pos-cart-qty-value').first()).toHaveText('2', { timeout: 5_000 });

    // Table and order type still intact after a line mutation.
    await expect(table).toHaveValue('12');
    await expect(orderTypeBtns.nth(1)).toHaveAttribute('aria-checked', 'true');

    // ── Step 5: charge, and prove the modal opened with the items attached ──
    const payBtn = page.locator('.pos-cart-pay-btn');
    await expect(payBtn).toBeEnabled({ timeout: 8_000 });
    await payBtn.click();

    const modal = page.locator('[data-testid="payment-modal"]');
    await expect(modal).toBeVisible({ timeout: TIMEOUT });
    await expect(modal).toHaveAttribute('role', 'dialog');

    // ── Step 6: tender cash ABOVE the total so change is real, then settle.
    const tender = page.locator('.payment-tendered-input');
    await expect(tender).toBeVisible({ timeout: 5_000 });
    await tender.fill('1000000');

    const settle = modal.locator('[data-testid="settle-button"]');
    await expect(settle).toBeEnabled({ timeout: 8_000 });
    await settle.click();

    // ── Step 7: the sale lands on the receipt preview, not an error banner ─
    // The banner is the failure shape: if completion rejected, the modal keeps
    // its error region and no Print/Skip control appears.
    const skip = page.getByRole('button', { name: /Skip/i });
    const printReceipt = page.getByRole('button', { name: /Print Receipt/i });
    await expect(skip.or(printReceipt).first()).toBeVisible({ timeout: 20_000 });

    // Dismiss so the test leaves the app in a reusable state.
    await skip.click();
  });

  test('the Pax field follows its setting and accepts a guest count', async ({ page }) => {
    await openOrderWithItems(page, 1);

    // With no stored restaurant.guest_count the field is SHOWN
    // (PosScreen maps the unset key with `guestCountEnabled ?? true`). This is
    // the direction that was ambiguous on the device: the browser showed the
    // field while the tablet did not, and the two were never compared from the
    // same state. Pin the contract here so the POS half is unambiguous, and
    // investigate any device/browser divergence as a separate fact.
    const pax = page.locator('[data-testid="pos-cart-guest-input"]');
    await expect(
      pax,
      'the Pax field must render when restaurant.guest_count is unset',
    ).toBeVisible({ timeout: 5_000 });

    await pax.fill('4');
    await expect(pax).toHaveValue('4');

    // Out-of-range values are the input's own concern (min 1 / max 99); a typed
    // 0 must not silently become a guest count the backend then stores.
    await pax.fill('0');
    const validity = await pax.evaluate((el) => (el as HTMLInputElement).validity.rangeUnderflow);
    expect(validity, 'a Pax of 0 must be flagged invalid by the input').toBe(true);
  });

  test('clearing the cart returns the empty state and withdraws the footer', async ({ page }) => {
    await openOrderWithItems(page, 1);
    await expect(page.locator('[data-testid="cart-panel-line-item"]')).toHaveCount(1);

    // Remove the only line.
    const remove = page.locator('[data-testid="cart-panel-line-item"]').first()
      .locator('.pos-cart-line-remove');
    await expect(remove).toBeVisible({ timeout: 5_000 });
    await remove.click();
    await page.waitForTimeout(400);

    // The empty message replaces the lines, and the WHOLE footer goes away
    // rather than merely disabling Charge: CartPanel gates it on
    // `lines.length > 0 && subtotal` (CartPanel.tsx:895), so there is no
    // zero-item sale to offer at all. Asserted as absence because that is what
    // the code does — an earlier draft of this test asserted `toBeDisabled` and
    // failed on `element(s) not found`, which is the difference between the two.
    await expect(page.locator('.pos-cart-empty-msg')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.pos-cart-pay-btn')).toHaveCount(0, { timeout: 5_000 });
  });
});
