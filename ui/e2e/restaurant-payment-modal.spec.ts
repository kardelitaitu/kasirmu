import { test, expect } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

/**
 * E2E: Restaurant POS — payment modal (the "Charge" popup)
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The restaurant POS payment path had NO live coverage. The only spec that
 * drove it (e2e-pos-to-kds.spec.ts) is `test.fixme` — skipped as flaky
 * because the KDS mock auto-generates orders every 60s, so its
 * baselineCount+1 assertion cannot hold. Every other payment spec
 * (pos-workflows.spec.ts) drives the RETAIL terminal
 * (`.retail-cart-action-btn--pay`), a different cart panel and button.
 *
 * This spec covers the modal and nothing else — no KDS, no auto-generation,
 * no cross-workspace counting — so it can be stable.
 *
 * TWO SHELLS, TWO SHAPES
 * ----------------------
 * The same PosScreen renders the cart differently per shell, and this is the
 * trap the old skipped spec fell into:
 *
 *   desktop (landscape): the cart is INLINE — [data-testid="cart-panel-line-item"]
 *                        is on screen and .pos-cart-pay-btn is directly clickable.
 *   tablet  (portrait) : the cart lives in a bottom SHEET. The line item is NOT
 *                        in the DOM until .restaurant-floating-cart-trigger is
 *                        tapped to open .restaurant-cart-sheet-panel.
 *
 * openCart() below handles both, so the same assertions run on each.
 *
 * CSS contract:
 *   .restaurant-card                     — product tile in the menu grid
 *   .restaurant-floating-cart-trigger    — tablet: opens the cart sheet
 *   .restaurant-cart-sheet-panel         — tablet: the cart sheet
 *   [data-testid="cart-panel-line-item"] — cart line item
 *   .pos-cart-pay-btn                    — Charge button
 *   [data-testid="payment-modal"]        — the dialog panel
 *   .payment-overlay                     — the backdrop (role=presentation)
 *   .payment-tendered-input              — cash amount tendered
 */

const TIMEOUT = 15_000;

/**
 * Ensure the cart contents are on screen, whichever shell is rendering.
 * Returns nothing: callers just assert against the line items afterwards.
 */
async function openCart(page: import('@playwright/test').Page): Promise<void> {
  const lineItem = page.locator('[data-testid="cart-panel-line-item"]');
  if (await lineItem.first().isVisible().catch(() => false)) return;

  // Portrait restaurant: the cart is a bottom sheet behind the floating bar.
  const trigger = page.locator('.restaurant-floating-cart-trigger');
  if (await trigger.isVisible().catch(() => false)) {
    await trigger.click();
    await expect(page.locator('.restaurant-cart-sheet-panel')).toBeVisible({ timeout: 5_000 });
  }
}

/** Log in as staff, open the restaurant POS, and add one product. */
async function openRestaurantPosWithItem(page: import('@playwright/test').Page) {
  await loginAs(page, 'staff', '1234');
  await selectWorkspace(page, WORKSPACES.RESTAURANT_POS);

  // The restaurant menu renders .restaurant-card tiles, NOT the retail
  // .retail-product-btn table. The tile's accessible name ends in "Add".
  const productCards = page.locator('.restaurant-card');
  await expect(productCards.first()).toBeVisible({ timeout: TIMEOUT });
  await productCards.first().click();

  await openCart(page);
  await expect(page.locator('[data-testid="cart-panel-line-item"]').first())
    .toBeVisible({ timeout: 5_000 });
}

/** Add a product and press Charge, returning the modal locator. */
async function openRestaurantPaymentModal(page: import('@playwright/test').Page) {
  await openRestaurantPosWithItem(page);

  // The mock auto-opens a shift, which is the Charge button's precondition.
  const payBtn = page.locator('.pos-cart-pay-btn');
  await expect(payBtn).toBeVisible({ timeout: TIMEOUT });
  await expect(payBtn).toBeEnabled({ timeout: 8_000 });
  await payBtn.click();

  const modal = page.locator('[data-testid="payment-modal"]');
  await expect(modal).toBeVisible({ timeout: 5_000 });
  return modal;
}

test.describe('Restaurant POS — payment modal', () => {
  /**
   * The shift-service-down path, which is the ONE thing here that cannot be
   * reached from the mock's data: `shiftUnavailable` is set by a REJECTED
   * `get_active_shift_scoped` (usePosShifts.ts:167-168) and the mock answers
   * that name from a hardcoded object (handlers/shifts.ts:124). Without
   * `window.__MOCK_FAIL` this branch had no end-to-end coverage at all.
   *
   * Why it matters: the guard in PosScreen's handlePay
   * (`!activeShiftRef.current && !shiftUnavailableRef.current`) exists so an
   * unreachable shift service cannot block the till — the comment at
   * usePosShifts.ts:44-55 records that an informational feature once "silently
   * blocked every sale". The button's `disabled` attribute was gated on
   * `!activeShift` alone, so the guard was unreachable dead code and the till
   * was still blocked. This test is what keeps that from regressing.
   */
  test('Charge stays ENABLED when the shift service is unreachable', async ({ page }) => {
    // Must be installed before the app boots: usePosShifts loads the shift on
    // mount, so a failure injected after navigation would be too late.
    await page.addInitScript(() => {
      (window as unknown as { __MOCK_FAIL?: string[] }).__MOCK_FAIL = [
        'get_active_shift_scoped',
      ];
    });

    await openRestaurantPosWithItem(page);

    const payBtn = page.locator('.pos-cart-pay-btn');
    await expect(payBtn).toBeVisible({ timeout: TIMEOUT });

    // The assertion under test: an unreachable shift service must NOT disable
    // Charge. If the button is disabled here, the guard's stand-down branch can
    // never run and an informational feature is blocking every sale again.
    await expect(payBtn).toBeEnabled({ timeout: 8_000 });
    await expect(payBtn).not.toHaveClass(/pos-cart-pay-btn--disabled/);

    // And it must actually open the modal, not merely look enabled.
    await payBtn.click();
    await expect(page.locator('[data-testid="payment-modal"]')).toBeVisible({ timeout: 5_000 });
  });

  test('Charge opens the payment modal on the restaurant terminal', async ({ page }) => {
    const modal = await openRestaurantPaymentModal(page);

    // The dialog must be a real dialog with an accessible name, and the
    // backdrop must NOT be the dialog (it is role=presentation so that a
    // click handler on it is legal).
    await expect(modal).toHaveAttribute('role', 'dialog');
    await expect(modal).toHaveAttribute('aria-modal', 'true');
    const label = await modal.getAttribute('aria-label');
    expect(label && label.length > 0).toBe(true);

    const backdrop = page.locator('.payment-overlay');
    await expect(backdrop).toHaveAttribute('role', 'presentation');

    await expect(page.locator('[class*="error-boundary"]')).toHaveCount(0);
  });

  test('clicking the backdrop closes the modal', async ({ page }) => {
    await openRestaurantPaymentModal(page);

    // Click the backdrop itself, near a corner so the click cannot land on the
    // centred panel: Playwright's .click() targets the element centre, which
    // for a full-viewport overlay IS behind the panel.
    await page.locator('.payment-overlay').click({ position: { x: 8, y: 8 } });

    await expect(page.locator('[data-testid="payment-modal"]')).toBeHidden({ timeout: 5_000 });
    // Dismissing a payment is not clearing the sale: the cart survives.
    await openCart(page);
    await expect(page.locator('[data-testid="cart-panel-line-item"]').first())
      .toBeVisible({ timeout: 5_000 });
  });

  test('a click inside the panel does NOT close the modal', async ({ page }) => {
    const modal = await openRestaurantPaymentModal(page);

    // Select the Card tender — a click inside the dialog. Without the
    // target===currentTarget guard this bubbles to the overlay handler and
    // dismisses the modal, which is the regression the guard prevents.
    await modal.getByText(/^Card$/).click();
    await page.waitForTimeout(600); // longer than the 300ms leave animation
    await expect(modal).toBeVisible();
  });

  test('cash sale completes and the modal closes', async ({ page }) => {
    await openRestaurantPaymentModal(page);

    // Cash is the default. Type char-by-char: a single fill() can be reverted
    // by a re-render of the controlled input, leaving tender at 0.00.
    const tendered = page.locator('.payment-tendered-input');
    await expect(tendered).toBeVisible({ timeout: 3_000 });
    await tendered.click();
    await tendered.pressSequentially('9999999', { delay: 30 });

    const complete = page.getByRole('button', { name: /complete/i });
    await expect(complete).toBeEnabled({ timeout: 5_000 });
    await complete.click();

    await expect(page.locator('[data-testid="payment-modal"]')).toBeHidden({ timeout: 15_000 });
    // A completed sale empties the cart.
    await openCart(page);
    await expect(page.locator('[data-testid="cart-panel-line-item"]')).toHaveCount(0, { timeout: 8_000 });
    await expect(page.locator('[class*="error-boundary"]')).toHaveCount(0);
  });
});
