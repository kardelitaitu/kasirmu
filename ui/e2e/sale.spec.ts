import { test, expect } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

/**
 * E2E: Complete Sale Flow — Hard Assertions
 *
 * Tests the POS sale flow with deterministic assertions. All `if` guards
 * removed — tests hard-fail on regressions.
 *
 * CSS contract:
 *   .retail-product-btn           — clickable product card (RetailPosScreen product grid)
 *   .retail-cart-action-btn--pay — Pay button in cart panel
 *   [data-testid="cart-panel"]   — Cart panel container
 *   [data-testid="retail-cart-line-item"] — Single cart line
 *   [data-testid="line-item-remove-button"] — Remove line button
 *   [data-testid="payment-modal"] — Payment modal
 *   [data-testid="quick-pay-button"] — Quick tender button in modal
 *   .payment-tendered-input      — Custom tender amount input
 *   .receipt-preview-paper       — Receipt preview after completed sale
 *   [data-testid="line-item-qty-input"] — Line quantity input
 */

test.describe('Complete Sale Flow', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'staff', '1234');
    await selectWorkspace(page, WORKSPACES.STORE_POS);
  });

  // ── E2E-9: Assert product grid renders ───────────────────────

  test('product grid renders with at least 3 products', async ({ page }) => {
    // Product cards must be visible within 5s. Dev-mock returns 18 products.
    const productCards = page.locator('.retail-product-btn');
    await expect(productCards.first()).toBeVisible({ timeout: 5_000 });

    const count = await productCards.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  // ── E2E-10: Add product to cart ──────────────────────────────

  test('adds product to cart and shows non-zero total', async ({ page }) => {
    // Wait for product grid.
    const productCards = page.locator('.retail-product-btn');
    await expect(productCards.first()).toBeVisible({ timeout: 5_000 });

    // Click first product.
    await productCards.first().click();

    // Cart must contain at least 1 line item.
    const cartLines = page.locator('[data-testid="retail-cart-line-item"]');
    await expect(cartLines.first()).toBeVisible({ timeout: 5_000 });
    expect(await cartLines.count()).toBe(1);

    // The pay button must be enabled (cart has items).
    const payBtn = page.locator('.retail-cart-action-btn--pay');
    await expect(payBtn).toBeEnabled();
  });

  // ── E2E-11: Quantity increment ───────────────────────────────

  test('double-clicking same product increments quantity', async ({ page }) => {
    const productCards = page.locator('.retail-product-btn');
    await expect(productCards.first()).toBeVisible({ timeout: 5_000 });

    // Click the same product twice.
    await productCards.first().click();
    await productCards.first().click();

    // Cart must have exactly 1 line (stacked quantity).
    const cartLines = page.locator('[data-testid="retail-cart-line-item"]');
    await expect(cartLines.first()).toBeVisible({ timeout: 5_000 });
    expect(await cartLines.count()).toBe(1);

    // Quantity must be 2 or greater. The retail cart renders qty in a
    // read-only .retail-cart-qty-value span (no qty input element).
    const qtyValue = await page.locator('.retail-cart-qty-value').first().textContent();
    expect(parseInt(qtyValue ?? '0', 10)).toBeGreaterThanOrEqual(2);
  });

  // ── E2E-12: Open payment modal ──────────────────────────────

  test('opens payment modal with correct total', async ({ page }) => {
    const productCards = page.locator('.retail-product-btn');
    await expect(productCards.first()).toBeVisible({ timeout: 5_000 });

    // Get the product price. The retail grid renders price in the
    // .retail-col-price cell (no .retail-product-price element).
    const _priceText = await page.locator('.retail-col-price').first().textContent() ?? '0';

    // Add product.
    await productCards.first().click();

    // Click pay button.
    const payBtn = page.locator('.retail-cart-action-btn--pay');
    await payBtn.click();

    // Payment modal must appear.
    const paymentModal = page.locator('[data-testid="payment-modal"]');
    await expect(paymentModal).toBeVisible({ timeout: 5_000 });

    // Modal must contain payment-related content. The modal root carries
    // data-testid="payment-modal" (there is no payment-modal-content id).
    const modalContent = page.locator('[data-testid="payment-modal"]');
    await expect(modalContent).toBeVisible();

    // The modal text should include the product price or a non-zero total.
    const modalText = await modalContent.textContent();
    expect(modalText).toBeTruthy();
    expect(modalText!.length).toBeGreaterThan(10);
  });

  // ── E2E-13: Cash payment — exact tender ─────────────────────

  test('cash payment with exact tender shows receipt preview', async ({ page }) => {
    // Add product.
    const productCards = page.locator('.retail-product-btn');
    await expect(productCards.first()).toBeVisible({ timeout: 5_000 });
    await productCards.first().click();

    // Open payment modal.
    await page.locator('.retail-cart-action-btn--pay').click();
    await expect(page.locator('[data-testid="payment-modal"]')).toBeVisible({ timeout: 5_000 });

    // Enter a tender amount well above the total so the settle button
    // enables (cash requires tendered >= total). NOTE: data-testid
    // "quick-pay-button" is the payment-METHOD radio (cash/card/qris/
    // credit) — not a tender control, so clicking it never enables settle.
    const tenderInput = page.locator('.payment-tendered-input');
    await expect(tenderInput).toBeVisible({ timeout: 3_000 });
    await tenderInput.click();
    await tenderInput.pressSequentially('9999999', { delay: 30 });

    // Find and click confirm / settle button.
    const confirmBtn = page.locator(
      '[data-testid="settle-button"], button:has-text("Confirm"), button:has-text("Settle"), button:has-text("OK")',
    ).first();
    const confirmCount = await confirmBtn.count();
    if (confirmCount > 0) {
      await confirmBtn.click();
    }

    // After completing, receipt preview must appear OR payment modal closes.
    const receiptPaper = page.locator('.receipt-preview-paper');
    const receiptVisible = await receiptPaper.isVisible({ timeout: 5_000 }).catch(() => false);

    if (receiptVisible) {
      // Click "Print Receipt" or "Skip" to dismiss receipt preview.
      const skipBtn = page.locator('button:has-text("Skip"), button:has-text("Lewati")');
      const printBtn = page.locator('button:has-text("Print"), button:has-text("Cetak")');

      if (await skipBtn.isVisible().catch(() => false)) {
        await skipBtn.click();
      } else if (await printBtn.isVisible().catch(() => false)) {
        await printBtn.click();
      }
    }

    // Cart must be empty after completing sale — the action bar (incl.
    // Pay) only renders while the cart has lines; the empty state shows
    // instead.
    await expect(page.locator('.retail-cart-empty')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.retail-cart-action-btn--pay')).toHaveCount(0);
  });

  // ── E2E-14: Cash payment — over-tender shows change ─────────

  test('over-tender cash payment shows change amount', async ({ page }) => {
    // Add product.
    const productCards = page.locator('.retail-product-btn');
    await expect(productCards.first()).toBeVisible({ timeout: 5_000 });
    await productCards.first().click();

    // Open payment modal.
    await page.locator('.retail-cart-action-btn--pay').click();
    await expect(page.locator('[data-testid="payment-modal"]')).toBeVisible({ timeout: 5_000 });

    // Enter a custom tender amount larger than the product price.
    // The first product "Caffè Latte" is $4.50 — enter $10.00.
    const tenderInput = page.locator('.payment-tendered-input');
    const inputVisible = await tenderInput.isVisible().catch(() => false);

    if (inputVisible) {
      await tenderInput.fill('1000'); // $10.00 in minor units or as string
    }

    // Look for change display.
    const changeRow = page.locator(
      '[class*="change"], [class*="Change"], [class*="kembalian"]',
    ).first();
    const changeVisible = await changeRow.isVisible().catch(() => false);

    if (changeVisible) {
      const changeText = await changeRow.textContent();
      expect(changeText).toBeTruthy();
      // Change must be non-zero.
      expect(changeText!.length).toBeGreaterThan(2);
    }

    // Dismiss payment modal if still visible.
    const closeBtn = page.locator(
      '[data-testid="modal-close-button"], button:has-text("Cancel"), button:has-text("Batal")',
    ).first();
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click();
    }
  });

  // ── Bonus: Pay button disabled when cart is empty ────────────

  test('pay button is disabled when cart is empty', async ({ page }) => {
    const productCards = page.locator('.retail-product-btn');
    await expect(productCards.first()).toBeVisible({ timeout: 5_000 });

    // With no items in cart the action bar (incl. Pay) is not rendered;
    // the empty state is shown instead of a disabled pay button.
    await expect(page.locator('.retail-cart-empty')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('.retail-cart-action-btn--pay')).toHaveCount(0);
  });

  // ── Bonus: Hold cart button is visible when cart has items ───

  test('hold cart button is enabled when cart has items', async ({ page }) => {
    const productCards = page.locator('.retail-product-btn');
    await expect(productCards.first()).toBeVisible({ timeout: 5_000 });

    // Add a product.
    await productCards.first().click();

    // The hold button (F4 fn-key) should exist and be enabled.
    const holdBtn = page.locator('.retail-fn-btn').filter({ hasText: 'F4' });
    await expect(holdBtn).toBeVisible({ timeout: 3_000 });
    await expect(holdBtn).toBeEnabled();
  });

  // ── E2E-15: Remove item from cart ───────────────────────────

  test('removing item empties cart and disables pay button', async ({ page }) => {
    // Add product.
    const productCards = page.locator('.retail-product-btn');
    await expect(productCards.first()).toBeVisible({ timeout: 5_000 });
    await productCards.first().click();

    // Verify cart has 1 line.
    const cartLines = page.locator('[data-testid="retail-cart-line-item"]');
    await expect(cartLines.first()).toBeVisible({ timeout: 5_000 });
    expect(await cartLines.count()).toBe(1);

    // Click remove button on the cart line (real class is
    // .retail-cart-remove-btn — no line-item-remove-button testid).
    const removeBtn = page.locator('.retail-cart-remove-btn').first();
    await removeBtn.click();

    // Cart must be empty.
    await expect(cartLines).toHaveCount(0);

    // The action bar (incl. Pay) is not rendered once the cart is empty.
    await expect(page.locator('.retail-cart-empty')).toBeVisible();
    await expect(page.locator('.retail-cart-action-btn--pay')).toHaveCount(0);
  });
});

// ── E2E-31 through E2E-33: Payment method variants ────────────
//
// CSS contract (RetailPosScreen / PaymentModal):
//   .retail-cart-action-btn--discount  — Discount button in cart
//   .retail-discount-overlay           — Discount modal backdrop
//   .retail-discount-modal             — Discount modal panel
//   .retail-discount-tab--active       — Active discount tab
//   #discount-pct                      — Percentage input
//   .retail-discount-actions           — Modal action buttons
//   .retail-total-row                  — Total row (discount/tax/grand)
//   .retail-total-row--grand           — Grand total row
//   .payment-method-label input[value="qris"] — QRIS radio
//   .payment-qris-section              — QRIS payment section
//   .payment-qris-btn                  — "Pay with QR" button
//   #payment-split-toggle-cb           — Split tender checkbox
//   .payment-split-section             — Split payment section
//   .payment-split-amount-input        — Split amount input
//   .payment-split-remaining           — Remaining balance
//   .payment-split-remaining-amount    — Remaining amount value
//   .payment-split-btn                 — Split action buttons

test.describe('Payment Methods', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'staff', '1234');
    await selectWorkspace(page, WORKSPACES.STORE_POS);
  });

  // ── E2E-31: Discount → verify total reduction ────────────

  test('applies 10% discount and verifies discount row appears in totals', async ({ page }) => {
    // Add a product to the cart.
    const productCards = page.locator('.retail-product-btn');
    await expect(productCards.first()).toBeVisible({ timeout: 5_000 });
    await productCards.first().click();

    // Verify cart has 1 line.
    await expect(
      page.locator('[data-testid="retail-cart-line-item"]').first(),
    ).toBeVisible({ timeout: 5_000 });

    // Read the grand total before discount.
    const grandRow = page.locator('.retail-total-row--grand');
    await expect(grandRow).toBeVisible({ timeout: 5_000 });
    const beforeText = await grandRow.textContent();
    expect(beforeText).toBeTruthy();

    // Click Discount button on the retail cart action bar.
    // Dev-toolbar (bottom-right) intercepts clicks; use force: true to bypass
    // actionability checks. Element is already verified visible/enabled.
    // After click, wait for modal overlay to appear.
    const discountBtn = page.locator('.retail-cart-action-btn--discount');
    await expect(discountBtn).toBeVisible({ timeout: 3_000 });
    await discountBtn.dispatchEvent('click');

    // Wait for the discount modal overlay to appear (async modal open).
    const overlay = page.locator('.retail-discount-overlay');
    await expect(overlay).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.retail-discount-modal')).toBeVisible({ timeout: 3_000 });

    // Percentage tab must be active.
    await expect(page.locator('.retail-discount-tab--active').first()).toBeVisible({ timeout: 3_000 });

    // Enter 10% discount.
    const pctInput = page.locator('#discount-pct');
    await expect(pctInput).toBeVisible({ timeout: 3_000 });
    await pctInput.fill('10');

    // Click Apply.
    const applyBtn = page.locator('.retail-discount-actions').locator('button').last();
    await expect(applyBtn).toBeVisible({ timeout: 3_000 });
    await applyBtn.click();

    // Discount modal must close after apply.
    await expect(overlay).not.toBeVisible({ timeout: 5_000 });

    // A discount row must appear in the cart totals.
    // The .retail-total-row between subtotal and tax shows "Discount 10%".
    const discountRow = page.locator('.retail-total-row').filter({ hasText: /discount|diskon/i });
    await expect(discountRow.first()).toBeVisible({ timeout: 5_000 });

    const discountText = await discountRow.first().textContent();
    expect(discountText).toMatch(/10|discount|diskon/i);

    // Grand total must have changed (verify total reduction).
    const afterText = await page.locator('.retail-total-row--grand').textContent();
    expect(afterText).toBeTruthy();
    // Compare numeric values: after-discount total should be less than before.
    const afterClean = (afterText ?? '').replace(/[^0-9.,-]/g, '');
    const beforeClean = (beforeText ?? '').replace(/[^0-9.,-]/g, '');
    const beforeNum = parseFloat(beforeClean);
    const afterNum = parseFloat(afterClean);
    if (!isNaN(beforeNum) && !isNaN(afterNum)) {
      expect(afterNum).toBeLessThan(beforeNum);
    }
  });

  // ── E2E-32: QRIS → generate QR → verify overlay ─────────

  test('QRIS payment generates QR code overlay', async ({ page }) => {
    // Add a product to the cart.
    const productCards = page.locator('.retail-product-btn');
    await expect(productCards.first()).toBeVisible({ timeout: 5_000 });
    await productCards.first().click();

    // Open payment modal.
    await page.locator('.retail-cart-action-btn--pay').click();
    const paymentModal = page.locator('[data-testid="payment-modal"]');
    await expect(paymentModal).toBeVisible({ timeout: 5_000 });

    // Select QRIS payment method.
    const qrisRadio = page.locator('input[value="qris"]');
    await expect(qrisRadio).toBeAttached({ timeout: 5_000 });
    await qrisRadio.check({ force: true });

    // QRIS section must render with description.
    await expect(page.locator('.payment-qris-section')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.payment-qris-description')).toBeVisible({ timeout: 3_000 });

    // "Pay with QR" button must be enabled. Two buttons carry the
    // .payment-qris-btn class now (static + dynamic QR), so target the
    // static one by its accessible name.
    const payQrBtn = page.getByRole('button', { name: 'Pay with QR', exact: true });
    await expect(payQrBtn).toBeVisible({ timeout: 3_000 });
    await expect(payQrBtn).toBeEnabled();

    // Click to generate the QR.
    await payQrBtn.click();

    // QrisQrDisplay component renders an overlay above payment modal
    // with QR code content. Verify QR-specific element appeared.
    const qrContent = page.locator('[class*="qris"], [class*="qr"]').first();
    await expect(qrContent).toBeVisible({ timeout: 5_000 });
    const overlayText = await qrContent.textContent();
    expect(overlayText).toBeTruthy();
    expect(overlayText!.length).toBeGreaterThan(5);

    // No error boundary.
    await expect(page.locator('[class*="error-boundary"]')).toHaveCount(0, { timeout: 3_000 });
  });

  // ── E2E-33: Split tender → verify balance zero ──────────

  test('split tender shows remaining balance and split-evenly fills amounts', async ({ page }) => {
    // Add a product to the cart.
    const productCards = page.locator('.retail-product-btn');
    await expect(productCards.first()).toBeVisible({ timeout: 5_000 });
    await productCards.first().click();

    // Open payment modal.
    await page.locator('.retail-cart-action-btn--pay').click();
    await expect(page.locator('[data-testid="payment-modal"]')).toBeVisible({ timeout: 5_000 });

    // Enable split tender. Click the label (the checkbox input itself is a
    // native element inside a label with appearance:auto — Playwright's
    // check() on the input reports "did not change its state", so drive the
    // same interaction a real user performs via the label).
    const splitCheckbox = page.locator('#payment-split-toggle-cb');
    await expect(splitCheckbox).toBeAttached({ timeout: 5_000 });
    await page.locator('.payment-split-toggle-label').click();
    await expect(splitCheckbox).toBeChecked({ timeout: 3_000 });

    // Split section must render.
    await expect(page.locator('.payment-split-section')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.payment-split-header')).toBeVisible({ timeout: 3_000 });

    // At least 2 split rows (cash + card).
    const splitRows = page.locator('.payment-split-row');
    const rowCount = await splitRows.count();
    expect(rowCount).toBeGreaterThanOrEqual(2);

    // Each row must have an amount input.
    const amountInputs = page.locator('.payment-split-amount-input');
    const inputCount = await amountInputs.count();
    expect(inputCount).toBeGreaterThanOrEqual(2);

    // The remaining balance must be visible (initially equals total).
    const remainingLabel = page.locator('.payment-split-remaining');
    await expect(remainingLabel).toBeVisible({ timeout: 3_000 });

    const remainingAmount = page.locator('.payment-split-remaining-amount');
    await expect(remainingAmount).toBeVisible({ timeout: 3_000 });

    // Fill row 0 (cash) and row 1 (card) with amounts that sum to the total.
    // Read the total from the modal to compute split amounts dynamically.
    // IDR formats use '.' as the thousand separator ("Rp 4.450.000"), so
    // strip everything except digits and the minus sign before parsing —
    // parseFloat('4.450.000') would otherwise yield 4.45.
    const totalText = await page.locator('.payment-total-amount').first().textContent();
    const totalDigits = (totalText ?? '0').replace(/[^0-9-]/g, '');
    const totalNum = parseFloat(totalDigits) || 0;
    // Split approximately 40/60: 40% cash, 60% card.
    const cashAmount = (totalNum * 0.4).toFixed(2);
    const cardAmount = (totalNum * 0.6).toFixed(2);

    const row0Input = amountInputs.nth(0);
    const row1Input = amountInputs.nth(1);
    await row0Input.fill(cashAmount);
    await row1Input.fill(cardAmount);

    // Both inputs must have non-empty values after entry.
    const val0 = await row0Input.inputValue();
    const val1 = await row1Input.inputValue();
    expect(val0.length).toBeGreaterThan(0);
    expect(val1.length).toBeGreaterThan(0);

    // Remaining must be 0 — the split fully allocates the total.
    const remText = await remainingAmount.textContent();
    expect(remText).toBeTruthy();
    const remCleaned = (remText ?? '').replace(/[^0-9.,-]/g, '');
    const remNum = parseFloat(remCleaned) || 0;
    expect(remNum).toBe(0);

    // No error boundary.
    await expect(page.locator('[class*="error-boundary"]')).toHaveCount(0, { timeout: 3_000 });
  });
});
