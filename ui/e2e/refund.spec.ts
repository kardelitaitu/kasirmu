import { test, expect } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

/**
 * E2E: Refund Flow — Complete a sale, find it in history, and process a refund.
 *
 * CSS contract:
 *   POS screen:           .retail-product-btn, .retail-cart-panel, .retail-cart-action-btn--pay
 *   Sales History:        .sales-history, .sales-history-table,
 *                         .sales-history-action-btn (View button),
 *                         .sales-history-modal (detail overlay),
 *                         .sales-history-modal-body (detail content)
 *   Refund Modal:         .refund-overlay, .refund-modal,
 *                         .refund-line, .refund-line-label (checkbox),
 *                         .refund-input (reason field),
 *                         .refund-actions button (Process Refund),
 *                         .refund-done (success state)
 *
 * Route: #/sales-history (available in store-pos workspace via sales module)
 */

const TIMEOUT = 8_000;

test.describe('Refund Flow', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'admin', '9999');
    await selectWorkspace(page, WORKSPACES.STORE_POS);
  });

  test('E2E-37: complete sale → open history → process refund → verify done', async ({ page }) => {
    // ── Step 1: Complete a sale in the POS screen ──────────────

    // Wait for the POS screen to load (product grid visible).
    await expect(page.locator('.retail-product-btn').first()).toBeVisible({ timeout: TIMEOUT });

    // Add a product to the cart.
    const firstProduct = page.locator('.retail-product-btn').first();
    await firstProduct.click();

    // The cart panel should show at least one line item. The panel
    // container is .retail-cart (no data-testid="cart-panel" exists).
    await expect(page.locator('[data-testid="retail-cart-line-item"]').first()).toBeVisible({ timeout: 5_000 });

    // Click the Pay button to open the payment modal.
    const payBtn = page.locator('.retail-cart-action-btn--pay').first();
    await expect(payBtn).toBeVisible({ timeout: 5_000 });
    await payBtn.click();

    // Payment modal must appear.
    await expect(page.locator('[data-testid="payment-modal"]')).toBeVisible({ timeout: 5_000 });

    // Enter a tender amount above the total so the settle button enables
    // (default method is cash; cash requires tendered >= total). NOTE:
    // data-testid "quick-pay-button" is the payment-METHOD radio
    // (cash/card/qris/credit) — clicking it never enables settle.
    const tenderInput = page.locator('.payment-tendered-input');
    await expect(tenderInput).toBeVisible({ timeout: 5_000 });
    await tenderInput.click();
    await tenderInput.pressSequentially('9999999', { delay: 30 });

    // Find and click settle/confirm button.
    const settleBtn = page.locator('[data-testid="settle-button"], button:has-text("Settle"), button:has-text("Confirm")').first();
    await expect(settleBtn).toBeVisible({ timeout: 5_000 });
    await settleBtn.click();

    // After sale completes, the cart should reset (product grid remains).
    await expect(page.locator('.retail-product-btn').first()).toBeVisible({ timeout: TIMEOUT });

    // ── Step 2: Navigate to Sales History ──────────────────────

    // In store-pos workspace, sales history is a sub-view opened via F6.
    await page.keyboard.press('F6');

    // Sales history container must render.
    await expect(page.locator('.sales-history')).toBeVisible({ timeout: TIMEOUT });
    await expect(page.locator('.sales-history-title')).toContainText('Sales', { timeout: 5_000 });

    // The sales table must have at least one row (pre-seeded + the one we just completed).
    const rows = page.locator('.sales-history-table tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 5_000 });

    // ── Step 3: View a completed sale ─────────────────────────

    // Click "View" on the first sale row to open the detail modal.
    const viewBtn = page.locator('.sales-history-action-btn').first();
    await expect(viewBtn).toBeVisible({ timeout: 5_000 });
    await viewBtn.click();

    // Detail modal must open.
    await expect(page.locator('.sales-history-modal')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.sales-history-modal-body')).toBeVisible({ timeout: 5_000 });

    // The "Refund" button must be visible (only for Completed status).
    const refundBtn = page.locator('.sales-history-modal-body button:has-text("Refund")').first();
    await expect(refundBtn).toBeVisible({ timeout: 5_000 });

    // ── Step 4: Open Refund Modal ─────────────────────────────

    await refundBtn.click();

    // Refund modal must be visible.
    await expect(page.locator('.refund-overlay')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.refund-modal')).toBeVisible({ timeout: 5_000 });

    // Refund title must be present.
    await expect(page.locator('.refund-title')).toContainText('Refund', { timeout: 3_000 });

    // ── Step 5: Select items to refund ────────────────────────

    // Check the first refund line item's checkbox.
    const firstLineCheckbox = page.locator('.refund-line-label input[type="checkbox"]').first();
    await expect(firstLineCheckbox).toBeVisible({ timeout: 5_000 });
    await firstLineCheckbox.click();

    // After checking, the line should have the "selected" class.
    await expect(page.locator('.refund-line-selected')).toBeVisible({ timeout: 3_000 });

    // ── Step 6: Enter refund reason ───────────────────────────

    const reasonInput = page.locator('.refund-input').first();
    await expect(reasonInput).toBeVisible({ timeout: 3_000 });
    await reasonInput.fill('Customer returned item — wrong size');

    // ── Step 7: Click Process Refund ──────────────────────────

    const processBtn = page.locator('.refund-actions button:has-text("Process Refund"), .refund-actions button:has-text("Proses")').first();
    await expect(processBtn).toBeEnabled({ timeout: 3_000 });
    await processBtn.click();

    // ── Step 8: Verify refund processed state ─────────────────

    // The refund-done success state must appear.
    await expect(page.locator('.refund-done')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.refund-done-title')).toContainText('Refund', { timeout: 3_000 });

    // No error boundary anywhere.
    await expect(page.locator('[class*="error-boundary"]')).toHaveCount(0, { timeout: 3_000 });
  });
});
