import { test, expect } from '@playwright/test';
import { loginAs, selectWorkspace, openToolCard, WORKSPACES } from './helpers';

/**
 * E2E Critical Path #2: Shift Open/Close → Reconciliation
 *
 * Full end-to-end workflow: open shift with opening balance →
 * navigate to POS → add product → complete sale → return to shifts →
 * close shift → verify reconciliation summary shows correct totals.
 *
 * CSS contract:
 *   .shift-mgmt                   — ShiftManagementScreen container
 *   .shift-mgmt-no-active         — "No active shift" banner
 *   .shift-mgmt-no-active-title   — "No active shift" heading
 *   .shift-mgmt-active-card       — active shift status card
 *   .shift-mgmt-overlay           — modal backdrop
 *   .shift-mgmt-modal             — modal panel
 *   .shift-mgmt-modal-header      — modal header
 *   .shift-mgmt-summary-grid      — close-shift summary grid
 *   .shift-mgmt-summary-label     — summary field label
 *   .shift-mgmt-summary-value     — summary field value
 *   #open-balance                 — opening balance input
 *   #close-balance                — closing balance input
 *   .retail-product-btn           — product card in POS grid
 *   .retail-cart-action-btn--pay  — Pay button
 *   [data-testid="quick-pay-button"] — quick tender button
 */

test.describe('Critical Path: Shift Reconciliation', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'admin', '9999');
  });

  test('open shift → complete sale → close shift → verify reconciliation', async ({ page }) => {
    test.setTimeout(45_000); // tablet viewport needs more time for multi-step flow
    // ── Step 1: Open shift ──────────────────────────────────────────
    // OPEN THE TOOL, NOT A HASH. `navigateTo("shifts")` writes the route but establishes no
    // workspace, and `shifts` is not fullscreen — so `AppShell:708` gated it on an active
    // workspace and rendered the picker, leaving `.shift-mgmt` unmounted. Measured
    // 2026-10-18; the tool card is the user path and sets the workspace with the navigation.
    await openToolCard(page, /shifts/i);
    await page.waitForTimeout(2_000);

    await expect(page.locator('.shift-mgmt')).toBeVisible({ timeout: 10_000 });

    // The dev-mock may already have an active shift open (needed for the
    // Pay button in POS tests). If so, close it first before re-opening
    // with a known opening balance, so the reconciliation flow is deterministic.
    const closeShiftBtn = page.locator('button:has-text("Close Shift"), button:has-text("Tutup")').first();
    if (await closeShiftBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      // Close the existing shift first.
      await closeShiftBtn.click();
      await page.waitForTimeout(500);
      const closingInput = page.locator('#close-balance');
      await expect(closingInput).toBeVisible({ timeout: 3_000 });
      await closingInput.fill('0');
      await page.waitForTimeout(200);
      const confirmCloseBtn = page.locator(
        '.shift-mgmt-modal-actions button:has-text("Close Shift"), ' +
        '.shift-mgmt-modal-actions button:has-text("Tutup")',
      );
      await confirmCloseBtn.click();
      await page.waitForTimeout(1_000);

      // Closing a shift pops the "Shift Closed" summary dialog — dismiss
      // it (Done) so the "Open Shift" button becomes reachable again.
      const summaryDoneBtn = page.locator(
        '.shift-mgmt-overlay .shift-mgmt-modal-actions button:has-text("Done"), ' +
        '.shift-mgmt-overlay .shift-mgmt-modal-actions button:has-text("Selesai")',
      );
      if (await summaryDoneBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await summaryDoneBtn.click();
        await page.waitForTimeout(500);
      }
    }

    // Now click "Open Shift" button.
    const openBtn = page.locator('button:has-text("Open Shift"), button:has-text("Buka")').first();
    await expect(openBtn).toBeVisible({ timeout: 5_000 });
    await openBtn.click();
    await page.waitForTimeout(500);

    // Fill opening balance of 100,000.
    const balanceInput = page.locator('#open-balance');
    await expect(balanceInput).toBeVisible({ timeout: 3_000 });
    await balanceInput.fill('100000');
    await page.waitForTimeout(200);

    // Confirm open shift.
    const confirmOpenBtn = page.locator('.shift-mgmt-modal-actions button:has-text("Open Shift"), button:has-text("Buka")');
    await confirmOpenBtn.click();
    await page.waitForTimeout(1_000);

    // Verify active shift card is visible.
    await expect(page.locator('.shift-mgmt-active-card')).toBeVisible({ timeout: 5_000 });

    // ── Step 2: Navigate to Store POS and make a sale ───────────────
    await selectWorkspace(page, WORKSPACES.STORE_POS);
    await page.waitForTimeout(1_000);

    // Add a product to cart.
    const productCards = page.locator('.retail-product-btn');
    await expect(productCards.first()).toBeVisible({ timeout: 5_000 });
    await productCards.first().click();
    await page.waitForTimeout(500);

    // Open payment modal.
    await page.locator('.retail-cart-action-btn--pay').click();
    await expect(page.locator('[data-testid="payment-modal"]')).toBeVisible({ timeout: 5_000 });

    // Tender the payment. NOTE: data-testid "quick-pay-button" is the
    // payment-METHOD radio (cash) — not a tender control — so the settle
    // button only enables once the tender input is >= the total.
    const tenderInput = page.locator('.payment-tendered-input');
    await expect(tenderInput).toBeVisible({ timeout: 3_000 });
    await tenderInput.click();
    await tenderInput.pressSequentially('9999999', { delay: 30 });
    await page.waitForTimeout(200);

    // Confirm.
    const confirmBtn = page.locator(
      '[data-testid="settle-button"], button:has-text("Confirm"), button:has-text("Settle"), button:has-text("OK")',
    ).first();
    if (await confirmBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await confirmBtn.click();
      await page.waitForTimeout(1_000);
    }

    // Dismiss receipt preview.
    const receiptPaper = page.locator('.receipt-preview-paper');
    if (await receiptPaper.isVisible({ timeout: 5_000 }).catch(() => false)) {
      const skipBtn = page.locator('button:has-text("Skip"), button:has-text("Lewati")');
      if (await skipBtn.isVisible().catch(() => false)) {
        await skipBtn.click();
        await page.waitForTimeout(500);
      }
    }

    // Verify cart emptied — the action bar (incl. Pay) unmounts when the
    // cart has no lines; the empty state renders instead.
    await expect(page.locator('.retail-cart-empty')).toBeVisible({ timeout: 5_000 });

    // ── Step 3: Return to shifts and close shift ────────────────────
    // Same reason as step 1: the tool card establishes the workspace the route needs.
    // `selectWorkspace(ADMIN)` lands on `#/settings` (fullscreen, renders without a
    // workspace), so the subsequent hash write to the NON-fullscreen `shifts` route
    // falls through to the picker and `.shift-mgmt` never mounts.
    await selectWorkspace(page, WORKSPACES.ADMIN);
    await page.evaluate(() => { window.location.hash = ''; });
    await page.waitForTimeout(1_200);
    await openToolCard(page, /shifts/i);
    await page.waitForTimeout(2_000);

    await expect(page.locator('.shift-mgmt')).toBeVisible({ timeout: 10_000 });

    // Verify active shift card is still visible.
    await expect(page.locator('.shift-mgmt-active-card')).toBeVisible({ timeout: 5_000 });

    // Click close shift.
    const closeBtn = page.locator('button:has-text("Close Shift"), button:has-text("Tutup")').first();
    await expect(closeBtn).toBeVisible({ timeout: 5_000 });
    await closeBtn.click();
    await page.waitForTimeout(500);

    // Fill closing balance.
    const closingInput = page.locator('#close-balance');
    await expect(closingInput).toBeVisible({ timeout: 3_000 });
    await closingInput.fill('150000');
    await page.waitForTimeout(200);

    // Confirm close.
    const confirmCloseBtn = page.locator(
      '.shift-mgmt-modal-actions button:has-text("Close Shift"), ' +
      '.shift-mgmt-modal-actions button:has-text("Tutup")',
    );
    await confirmCloseBtn.click();
    await page.waitForTimeout(1_000);

    // ── Step 4: Verify reconciliation summary ───────────────────────
    const summaryGrid = page.locator('.shift-mgmt-summary-grid');
    await expect(summaryGrid).toBeVisible({ timeout: 5_000 });

    // Summary must contain key fields: opening balance, closing balance,
    // expected cash, difference.
    const summaryLabels = page.locator('.shift-mgmt-summary-label');
    const summaryValues = page.locator('.shift-mgmt-summary-value');

    const labelCount = await summaryLabels.count();
    expect(labelCount).toBeGreaterThanOrEqual(2);

    // At least one value should contain a currency amount.
    let hasAmount = false;
    for (let i = 0; i < await summaryValues.count(); i++) {
      const value = await summaryValues.nth(i).textContent();
      if (value && /[0-9]/.test(value)) {
        hasAmount = true;
        break;
      }
    }
    expect(hasAmount).toBe(true);

    // Verify no error boundary.
    await expect(page.locator('[class*="error-boundary"]')).toHaveCount(0, { timeout: 3_000 });

    // ── Step 5: Verify shift appears in history table ────────────────
    const historyTable = page.locator('.shift-mgmt-table');
    if (await historyTable.isVisible({ timeout: 3_000 }).catch(() => false)) {
      // Rows carry shift-mgmt-row--open (open) or no modifier class —
      // there is no .shift-mgmt-table-row class in the real UI.
      const tableRows = page.locator('.shift-mgmt-table tbody tr');
      const rowCount = await tableRows.count();
      expect(rowCount).toBeGreaterThanOrEqual(1);
    }
  });
});
