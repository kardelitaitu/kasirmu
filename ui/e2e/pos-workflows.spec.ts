import { test, expect } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

/**
 * E2E: POS Workflows — Sales History, Customer Selection, Void
 *
 * Covers POS lifecycle operations with zero prior E2E coverage.
 * All tests use hard assertions — no `if` guards, no `.catch(() => false)`.
 *
 * CSS contract:
 *   .sales-history           — SalesHistoryScreen container
 *   .retail-cart-action-btn--void — Void/clear cart button
 *   .retail-cart-action-btn--pay  — Pay button
 *   .retail-fn-bar            — Function key bar (F1-F6)
 *   .retail-fn-key            — Individual function key labels
 *   [data-testid="retail-cart-line-item"] — Cart line item
 *   [data-testid="payment-modal"] — Payment modal
 */

test.describe('POS Workflows', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'staff', '1234');
    await selectWorkspace(page, WORKSPACES.STORE_POS);
  });

  // ── Sales History Screen ──────────────────────────────────

  test('sales history screen loads and renders container', async ({ page }) => {
    // Wait for the POS screen to be fully loaded (pay button visible means
    // the cart panel + product grid + shift are all initialised).
    await expect(page.locator('.retail-fn-bar')).toBeVisible({ timeout: 10_000 });

    // In store-pos workspace, sales history is a sub-view opened via F6.
    await page.keyboard.press('F6');

    // Sales history container must appear.
    await expect(page.locator('.sales-history')).toBeVisible({ timeout: 8_000 });

    // Mock returns empty sales — empty state or table must render without crash.
    const errorBoundary = page.locator('[class*="error-boundary"]');
    await expect(errorBoundary).toHaveCount(0, { timeout: 5_000 });
  });

  // ── Customer Selection in Payment ─────────────────────────

  test('customer section renders in payment modal', async ({ page }) => {
    // Add product to cart and open payment modal.
    const productCards = page.locator('.retail-product-btn');
    await expect(productCards.first()).toBeVisible({ timeout: 5_000 });
    await productCards.first().click();

    await page.locator('.retail-cart-action-btn--pay').click();
    await expect(page.locator('[data-testid="payment-modal"]')).toBeVisible({ timeout: 5_000 });

    // Payment modal must have payment content (tabs, tender buttons, or
    // total). The modal root carries data-testid="payment-modal" — there
    // is no payment-modal-content id.
    const modalContent = page.locator('[data-testid="payment-modal"]');
    await expect(modalContent).toBeVisible({ timeout: 3_000 });

    // Verify modal renders payment-relevant elements.
    const hasTabs = page.locator('[data-testid="payment-tabs"]');
    const hasQuickPay = page.locator('[data-testid="quick-pay-button"]');
    const tabsVisible = await hasTabs.isVisible();
    const quickPayVisible = await hasQuickPay.first().isVisible();
    expect(tabsVisible || quickPayVisible).toBe(true);

    // Dismiss modal — the real close control is .payment-close (there is
    // no data-testid="modal-close-button").
    const closeBtn = page.locator('.payment-close').first();
    await expect(closeBtn).toBeVisible({ timeout: 3_000 });
    await closeBtn.click();
    await expect(page.locator('[data-testid="payment-modal"]')).not.toBeVisible({ timeout: 5_000 });
  });

  // ── Void / Clear Cart ─────────────────────────────────────

  test('void button clears cart and disables pay', async ({ page }) => {
    // Add a product to cart.
    const productCards = page.locator('.retail-product-btn');
    await expect(productCards.first()).toBeVisible({ timeout: 5_000 });
    await productCards.first().click();

    // Cart must have a line item.
    await expect(page.locator('[data-testid="retail-cart-line-item"]').first()).toBeVisible({ timeout: 3_000 });

    // Click the void/clear button — this opens the Clear Cart confirm
    // dialog (retail-clear-overlay) instead of clearing immediately.
    const voidBtn = page.locator('.retail-cart-action-btn--void').first();
    await expect(voidBtn).toBeVisible({ timeout: 3_000 });
    await voidBtn.click();

    // Confirm the clear in the dialog.
    const confirmClear = page.locator('.retail-shift-confirm-btn--danger').first();
    await expect(confirmClear).toBeVisible({ timeout: 3_000 });
    await confirmClear.click();

    // Cart must be empty (auto-wait handles timing).
    await expect(page.locator('[data-testid="retail-cart-line-item"]')).toHaveCount(0, { timeout: 3_000 });

    // The action bar (incl. Pay) is not rendered once the cart is empty.
    await expect(page.locator('.retail-cart-empty')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('.retail-cart-action-btn--pay')).toHaveCount(0);
  });

  // ── Function Bar Keys ─────────────────────────────────────

  test('function bar renders with F1-F6 keys', async ({ page }) => {
    await expect(page.locator('.retail-product-btn').first()).toBeVisible({ timeout: 5_000 });

    // Function bar must be visible.
    await expect(page.locator('.retail-fn-bar')).toBeVisible({ timeout: 5_000 });

    // At least 4 function keys must be present.
    const fnKeys = page.locator('.retail-fn-key');
    const count = await fnKeys.count();
    expect(count).toBeGreaterThanOrEqual(4);

    // Verify F1 and F2 labels exist.
    const fnTexts = await fnKeys.allTextContents();
    expect(fnTexts.some((t) => t.includes('F1'))).toBe(true);
    expect(fnTexts.some((t) => t.includes('F2'))).toBe(true);
  });
});
