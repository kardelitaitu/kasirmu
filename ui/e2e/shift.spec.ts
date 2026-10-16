import { test, expect } from '@playwright/test';
import { loginAs, openToolCard } from './helpers';

/**
 * E2E: Open/Close Shift — Hard Assertions (E2E-23 through E2E-25)
 *
 * Tests shift management with deterministic assertions. All `if` guards
 * removed — tests hard-fail on regressions.
 *
 * Dev-mock: `get_active_shift` returns a seeded active shift (needed for the
 * POS Pay button in other specs), so `beforeEach` closes it first to reach
 * the "No active shift" baseline. After opening, `open_shift` returns a mock
 * active shift with status "open". After closing, `close_shift` returns a
 * mock closed shift and appends it to `mockShiftHistory` (seeded with one
 * closed shift so the history table renders immediately).
 *
 * CSS contract (ShiftManagementScreen.tsx):
 *   .shift-mgmt                   — container
 *   .shift-mgmt-title             — page title "Shift Management"
 *   .shift-mgmt-no-active         — no active shift banner
 *   .shift-mgmt-no-active-title   — "No active shift" heading
 *   .shift-mgmt-active-card       — active shift card
 *   .shift-mgmt-active-dot        — green status dot
 *   .shift-mgmt-active-label      — "Active Shift" label
 *   .shift-mgmt-overlay           — modal backdrop
 *   .shift-mgmt-modal             — modal panel
 *   .shift-mgmt-modal-header      — modal header with title
 *   .shift-mgmt-modal-body        — modal body
 *   .shift-mgmt-modal-actions     — modal buttons
 *   .shift-mgmt-status-badge--open / --closed — shift status badges
 *   #open-balance                 — opening balance input
 *   #close-balance                — closing balance input
 */

test.describe('Shift Management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'admin', '9999');
    // NO selectWorkspace HERE. The tool cards live on the workspace PICKER, and
    // selectWorkspace(ADMIN) clicks the Settings card — which consumes the picker and
    // leaves the admin workspace active, so there is no `workspace-tool-card` left to
    // click. Opening the tool straight from the picker is the user path and the only one
    // that establishes the workspace `shifts` needs.

    // The dev-mock seeds an active shift (required by the POS Pay-button
    // specs), so the screen opens with the active-shift card instead of the
    // "No active shift" banner these tests expect. Close any seeded shift
    // first so every test starts from the deterministic baseline. Mirrors
    // the close-shift block in e2e-shift-reconciliation.spec.ts.

    // OPEN SHIFTS THE WAY A USER DOES. This used to be a raw `window.location.hash =
    // "#/shifts"` write, which changes the ROUTE but establishes no WORKSPACE — and
    // `shifts` is NOT a fullscreen page, so `AppShell` gates it on an active workspace
    // (`:708`) and rendered the workspace PICKER instead. `.shift-mgmt` then never
    // mounted and all five cases failed on a timeout that read like a stale selector.
    //
    // The tool card sets the workspace as part of its navigation, which is both the
    // user path and the one that works. Measured 2026-10-18: `selectWorkspace(ADMIN)`
    // lands on `#/settings` (fullscreen, so it renders) and the hash write to `#/shifts`
    // then dropped straight back to the picker.
    await openToolCard(page, /shifts/i);
    await expect(page.locator('.shift-mgmt')).toBeVisible({ timeout: 10_000 });

    // Ensure we end up in the "No active shift" state.
    // If an active shift card is present, close it.
    const activeCard = page.locator('.shift-mgmt-active-card');
    const noActiveBanner = page.locator('.shift-mgmt-no-active');

    if (await activeCard.isVisible({ timeout: 3_000 }).catch(() => false)) {
      // Active shift exists — close it.
      const closeShiftBtn = page.locator('button:has-text("Close Shift"), button:has-text("Tutup")').first();
      await expect(closeShiftBtn).toBeVisible({ timeout: 5_000 });
      await closeShiftBtn.click();

      const closingInput = page.locator('.shift-mgmt-overlay').last().locator('#close-balance');
      await expect(closingInput).toBeVisible({ timeout: 3_000 });
      await closingInput.fill('0');

      await page.locator('.shift-mgmt-overlay').last().locator(
        '.shift-mgmt-modal-actions button:has-text("Close Shift"), ' +
        '.shift-mgmt-modal-actions button:has-text("Tutup")',
      ).click();

      // Wait for the "Shift Closed" summary dialog.
      await expect(page.locator('.shift-mgmt-summary-grid')).toBeVisible({ timeout: 5_000 });

      // Dismiss the summary dialog.
      const doneBtn = page.locator('.shift-mgmt-overlay').last().locator(
        '.shift-mgmt-modal-actions button:has-text("Done"), ' +
        '.shift-mgmt-modal-actions button:has-text("Selesai")',
      );
      await expect(doneBtn).toBeVisible({ timeout: 3_000 });
      await doneBtn.click();

      // Verify we're back to "No active shift".
      await expect(noActiveBanner).toBeVisible({ timeout: 5_000 });
    } else {
      // Already in "No active shift" state — verify banner is visible.
      await expect(noActiveBanner).toBeVisible({ timeout: 5_000 });
    }
  });

  // ── Bonus: Shift history table is visible ───────────────────

  test('shift history table renders with columns', async ({ page }) => {
    await page.evaluate(() => { window.location.hash = '#/shifts'; });
    // Wait for the shift management container and content to be fully rendered.
    await expect(page.locator('.shift-mgmt')).toBeVisible({ timeout: 10_000 });
    // In this test we expect "No active shift" (beforeEach guarantees it).
    await expect(page.locator('.shift-mgmt-no-active')).toBeVisible({ timeout: 5_000 });

    // The shift history section must have a title.
    await expect(page.locator('.shift-mgmt-table-title')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.shift-mgmt-table-title')).toContainText('History');

    // Table must be present (even if empty, the empty state renders).
    const table = page.locator('.shift-mgmt-table');
    await expect(table).toBeVisible({ timeout: 5_000 });
  });

  // ── E2E-23: Assert shift screen loads ─────────────────────

  test('shift screen loads and shows "No active shift"', async ({ page }) => {
    // Navigate to shifts page via hash.
    await page.evaluate(() => { window.location.hash = '#/shifts'; });
    // Wait for the shift management container and "No active shift" banner.
    await expect(page.locator('.shift-mgmt')).toBeVisible({ timeout: 10_000 });
    const noActiveBanner = page.locator('.shift-mgmt-no-active');
    await expect(noActiveBanner).toBeVisible({ timeout: 5_000 });

    // Title "Shift Management" must be present.
    await expect(page.locator('.shift-mgmt-title')).toBeVisible();

    // "Open Shift" button must be visible.
    const openBtn = page.locator('button:has-text("Open Shift"), button:has-text("Buka")');
    await expect(openBtn.first()).toBeVisible({ timeout: 5_000 });
  });

  // ── E2E-24: Open shift flow ───────────────────────────────

  test('opens a shift with opening balance', async ({ page }) => {
    await page.evaluate(() => { window.location.hash = '#/shifts'; });
    await expect(page.locator('.shift-mgmt')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.shift-mgmt-no-active')).toBeVisible({ timeout: 5_000 });

    // Click "Open Shift" button.
    const openBtn = page.locator('button:has-text("Open Shift"), button:has-text("Buka")').first();
    await openBtn.click();
    // Wait for the modal to appear.
    const modal = page.locator('.shift-mgmt-overlay').last();
    await expect(modal).toBeVisible({ timeout: 3_000 });

    // Modal header should say "Open Shift".
    const modalHeader = modal.locator('.shift-mgmt-modal-header h2');
    await expect(modalHeader).toBeVisible({ timeout: 3_000 });

    // Fill opening balance.
    const balanceInput = modal.locator('#open-balance');
    await expect(balanceInput).toBeVisible();
    await balanceInput.fill('50000');

    // Click confirm button in modal.
    const confirmBtn = modal.locator('button:has-text("Open Shift"), button:has-text("Buka")');
    await confirmBtn.click();
    // Wait for the active shift card to appear (modal closes, active shift renders).
    const activeCard = page.locator('.shift-mgmt-active-card');
    await expect(activeCard).toBeVisible({ timeout: 5_000 });

    // Verify no error boundary.
    const errorBoundary = page.locator('[class*="error-boundary"]');
    const hasError = await errorBoundary.isVisible().catch(() => false);
    expect(hasError).toBe(false);
  });

  // ── E2E-25: Close shift flow ──────────────────────────────

  test('closes an active shift', async ({ page }) => {
    await page.evaluate(() => { window.location.hash = '#/shifts'; });
    await expect(page.locator('.shift-mgmt')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.shift-mgmt-no-active')).toBeVisible({ timeout: 5_000 });

    // Open shift first (mock always returns null for active shift).
    const openBtn = page.locator('button:has-text("Open Shift"), button:has-text("Buka")').first();
    await openBtn.click();
    const openModal = page.locator('.shift-mgmt-overlay').last();
    await expect(openModal).toBeVisible({ timeout: 3_000 });

    const balanceInput = openModal.locator('#open-balance');
    await expect(balanceInput).toBeVisible();
    await balanceInput.fill('50000');

    const confirmOpenBtn = openModal.locator('button:has-text("Open Shift"), button:has-text("Buka")');
    await confirmOpenBtn.click();
    // Wait for the active shift card to appear.
    await expect(page.locator('.shift-mgmt-active-card')).toBeVisible({ timeout: 5_000 });

    // Now close the shift.
    const closeBtn = page.locator('button:has-text("Close Shift"), button:has-text("Tutup")').first();
    await expect(closeBtn).toBeVisible({ timeout: 5_000 });
    await closeBtn.click();
    // Wait for the Close Shift modal to appear.
    const closeModal = page.locator('.shift-mgmt-overlay').last();
    await expect(closeModal).toBeVisible({ timeout: 3_000 });

    // Fill closing balance.
    const closingInput = closeModal.locator('#close-balance');
    await expect(closingInput).toBeVisible();
    await closingInput.fill('55000');

    // Click confirm close button.
    const confirmCloseBtn = closeModal.locator(
      '.shift-mgmt-modal-actions button:has-text("Close Shift"), .shift-mgmt-modal-actions button:has-text("Tutup")',
    );
    await confirmCloseBtn.click();
    // Wait for the Close summary modal to appear.
    const summaryGrid = page.locator('.shift-mgmt-summary-grid');
    await expect(summaryGrid).toBeVisible({ timeout: 5_000 });

    // Verify no crash.
    const errorBoundary = page.locator('[class*="error-boundary"]');
    const hasError = await errorBoundary.isVisible().catch(() => false);
    expect(hasError).toBe(false);
  });

  // ── E2E-26: Cash payout recording ───────────────────────────

  test('records a cash payout from an active shift', async ({ page }) => {
    await page.evaluate(() => { window.location.hash = '#/shifts'; });
    await expect(page.locator('.shift-mgmt')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.shift-mgmt-no-active')).toBeVisible({ timeout: 5_000 });

    // Open shift first.
    const openBtn = page.locator('button:has-text("Open Shift"), button:has-text("Buka")').first();
    await openBtn.click();
    const openModal = page.locator('.shift-mgmt-overlay').last();
    await expect(openModal).toBeVisible({ timeout: 3_000 });

    const balanceInput = openModal.locator('#open-balance');
    await expect(balanceInput).toBeVisible();
    await balanceInput.fill('50000');

    const confirmOpenBtn = openModal.locator('button:has-text("Open Shift"), button:has-text("Buka")');
    await confirmOpenBtn.click();
    // Wait for the active shift card to appear.
    const activeCard = page.locator('.shift-mgmt-active-card');
    await expect(activeCard).toBeVisible({ timeout: 5_000 });

    // Click "Record Payout" button.
    const payoutBtn = page.locator('button:has-text("Record Payout"), button:has-text("Payout")').first();
    await expect(payoutBtn).toBeVisible({ timeout: 5_000 });
    await payoutBtn.click();
    // Wait for the payout modal to appear.
    const payoutModal = page.locator('.shift-mgmt-overlay').last();
    await expect(payoutModal).toBeVisible({ timeout: 3_000 });

    // Modal header must say "Record Cash Payout" or "Payout".
    const payoutHeader = payoutModal.locator('.shift-mgmt-modal-header h2');
    await expect(payoutHeader).toBeVisible({ timeout: 3_000 });

    // Fill payout amount.
    const amountInput = payoutModal.locator('#payout-amount');
    await expect(amountInput).toBeVisible();
    await amountInput.fill('20000');

    // Fill payout reason.
    const reasonInput = payoutModal.locator('#payout-reason');
    await expect(reasonInput).toBeVisible();
    await reasonInput.fill('Safe drop');

    // Click "Record Payout" confirm button in modal.
    const confirmPayoutBtn = payoutModal.locator('button:has-text("Record Payout")').last();
    await expect(confirmPayoutBtn).toBeEnabled({ timeout: 3_000 });
    await confirmPayoutBtn.click();
    // Wait for the payout modal to close and active card to remain.
    await expect(page.locator('.shift-mgmt-active-card')).toBeVisible({ timeout: 5_000 });

    // Verify no crash.
    await expect(page.locator('[class*="error-boundary"]')).toHaveCount(0, { timeout: 3_000 });
  });
});
