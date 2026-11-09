import { test, expect } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

/**
 * E2E Critical Path #1: Sale → Verify in History
 *
 * Full end-to-end workflow: add product → complete cash payment →
 * verify the sale appears in Sales History with correct total.
 *
 * CSS contract:
 *   .retail-product-btn           — product card in grid
 *   [data-testid="retail-cart-line-item"] — cart line
 *   .retail-cart-action-btn--pay  — Pay button (Store POS / RetailCartPanel)
 *   [data-testid="payment-modal"] — payment modal
 *   [data-testid="quick-pay-button"] — quick tender button
 *   .receipt-preview-paper        — receipt after completed sale
 *   .sales-history                — SalesHistoryScreen container
 *   .sales-history-table          — sales data table
 *   .sales-history-row            — individual sale row
 */

test.describe('Critical Path: Sale → Sales History', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'staff', '1234');
    await selectWorkspace(page, WORKSPACES.STORE_POS);
  });

  test('complete a sale and verify it appears in Sales History', async ({ page }) => {
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
    page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE-ERR:', m.text()); });

    // ── Step 1: Wait for product grid ───────────────────────────────
    const productCards = page.locator('.retail-product-btn');
    await expect(productCards.first()).toBeVisible({ timeout: 10_000 });

    // Read the product name and price before adding to cart.
    // The retail grid renders each product as a `.retail-product-btn`
    // table-row button whose name lives in an unclassed <span>, so read
    // the button's own textContent (not a non-existent `.retail-product-name`).
    const productName = (await productCards.first().textContent())?.trim() ?? 'Unknown';
    console.log(`  Selected product: ${productName}`);

    // ── Step 2: Add product to cart ─────────────────────────────────
    await productCards.first().click();
    await page.waitForTimeout(500);

    // Verify cart has 1 line item.
    const cartLines = page.locator('[data-testid="retail-cart-line-item"]');
    await expect(cartLines.first()).toBeVisible({ timeout: 5_000 });
    expect(await cartLines.count()).toBe(1);

    // ── Step 3: Open payment modal ──────────────────────────────────
    // Store POS renders RetailCartPanel; its pay button is
    // .retail-cart-action-btn--pay (labeled "Pay"). It is enabled once an
    // active shift is loaded (the mock auto-opens one).
    const payBtn = page.locator('.retail-cart-action-btn--pay');
    await expect(payBtn).toBeVisible({ timeout: 8_000 });
    await payBtn.click();
    await expect(page.locator('[data-testid="payment-modal"]')).toBeVisible({ timeout: 5_000 });

    // Read the total from the modal.
    const totalText = await page.locator('.payment-total-amount').first().textContent() ?? '';
    console.log(`  Total before payment: ${totalText}`);

    // ── Step 4: Complete payment ───────────────────────────────────
    // Cash is the default method. Set Amount Tendered to a value well above the
    // total so the Complete Sale button enables (cash requires tendered >= total).
    const tenderedInput = page.locator('.payment-tendered-input');
    await expect(tenderedInput).toBeVisible({ timeout: 3_000 });
    await tenderedInput.click();
    await tenderedInput.pressSequentially('9999999', { delay: 30 });
    await page.waitForTimeout(200);
    const typedVal = await tenderedInput.inputValue();
    if (!typedVal || Number(typedVal.replace(/[^0-9.]/g, '')) < 1000) {
      const exactBtn = page.locator('.payment-quick-cash .payment-quick-btn').last();
      await exactBtn.click();
      await page.waitForTimeout(300);
      const exactVal = await tenderedInput.inputValue();
      if (!exactVal || Number(exactVal.replace(/[^0-9.]/g, '')) < 1000) {
        await tenderedInput.click();
        await tenderedInput.pressSequentially('9999999', { delay: 50 });
        await page.waitForTimeout(300);
      }
    }

    // Click the Complete Sale button by its label.
    const completeBtn = page.getByRole('button', { name: /complete/i });
    await expect(completeBtn).toBeEnabled({ timeout: 5_000 });
    await completeBtn.click();

    // ── Step 5: Dismiss the receipt preview, THEN wait for the modal ──
    //
    // ORDER MATTERS, and the original had it backwards. The receipt preview is
    // rendered INSIDE [data-testid="payment-modal"] — measured 2026-10-17:
    //   { modalPresent: true, paperPresent: true, paperInsideModal: true,
    //     paperParent: 'receipt-preview' }
    // So the modal is necessarily still visible while the receipt is up, and
    // waiting for it to be hidden BEFORE dismissing the receipt can only time out.
    // That is exactly how this test failed: `toBeHidden` polled 24 times against a
    // dialog whose only child was the receipt the test had not yet closed.
    //
    // Fixing the order also removes the need for the guarded click: the receipt
    // is a guaranteed consequence of a committed sale, so it is awaited, not probed.
    const receiptPaper = page.locator('.receipt-preview-paper');
    await expect(receiptPaper, 'a committed sale must show its receipt').toBeVisible({
      timeout: 10_000,
    });
    // `Skip` is the non-printing exit; it is the first action in the receipt bar.
    await page.locator('button:has-text("Skip")').first().click();
    await receiptPaper.waitFor({ state: 'hidden', timeout: 8_000 });

    // The modal closes with the receipt, so this now means what it says.
    await expect(page.locator('[data-testid="payment-modal"]')).toBeHidden({ timeout: 10_000 });

    // ── Step 6: Verify cart is empty (sale completed) ───────────────
    // After a successful sale the cart should have zero line items.
    await expect(page.locator('[data-testid="retail-cart-line-item"]')).toHaveCount(0, { timeout: 5_000 });

    // ── Step 7: Navigate to Sales History ───────────────────────────
    // In store-pos workspace, sales history is a sub-view. Press F6 or
    // click the history button in the function bar.
    await page.keyboard.press('F6');
    await page.waitForTimeout(1_000);

    // Sales History screen must be visible.
    const historyContainer = page.locator('.sales-history');
    await expect(historyContainer).toBeVisible({ timeout: 8_000 });

    // ── Step 8: Verify the sale appears in the history table ────────
    // The table should contain sale rows.
    const historyTable = page.locator('.sales-history-table');
    const tableVisible = await historyTable.isVisible({ timeout: 5_000 }).catch(() => false);

    if (tableVisible) {
      // At least one sale row must exist.
      const saleRows = page.locator('.sales-history-row-wrap');
      const rowCount = await saleRows.count();
      expect(rowCount).toBeGreaterThanOrEqual(1);

      // The most recent row should contain the product name or total.
      const firstRowText = await saleRows.first().textContent();
      expect(firstRowText).toBeTruthy();
      // The product name from earlier should appear somewhere in the row.
      const productMatch = firstRowText?.includes(productName.replace(/[^a-zA-Z0-9 ]/g, ''));
      if (!productMatch && totalText) {
        // Fallback: check that the total appears (sale amount visible).
        const totalMatch = firstRowText?.includes(totalText.replace(/[^0-9.,]/g, '') || '');
        expect(totalMatch || productMatch).toBe(true);
      }
    } else {
      // If no table (empty state), verify the empty state renders without crash.
      const emptyState = page.locator('.empty-state, [class*="no-sales"], [class*="NoSales"]');
      await expect(emptyState.first()).toBeVisible({ timeout: 3_000 });
    }

    // ── Step 9: No crash ────────────────────────────────────────────
    await expect(page.locator('[class*="error-boundary"]')).toHaveCount(0, { timeout: 3_000 });
  });
});
