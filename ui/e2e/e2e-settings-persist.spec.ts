import { test, expect } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

/**
 * E2E Critical Path #3: Settings Change → Persistence
 *
 * Full end-to-end workflow: navigate to Settings → open Business Defaults →
 * change a receipt setting → navigate to another section → return → verify
 * the setting persisted.
 *
 * The settings hub was redesigned into a flat 14-page IA
 * (SettingsNavTree.NAV_ITEMS). There is no Appearance or Receipt page any
 * more: receipt settings live in the "Receipt format" card on the
 * Business Defaults screen (screens/ReceiptFormatSettingsCard.tsx), which
 * edits the layout half (workspace layer, via set_receipt_layout_scoped)
 * and the statutory-content half (legal-entity layer, via
 * set_receipt_content_scoped).
 *
 * CSS contract:
 *   [data-testid="settings-sidebar"] — sidebar navigation
 *   .settings-nav-item              — sidebar nav items
 *   .settings-nav-item--active      — active nav item
 *   .settings-screen-placeholder-title — screen heading
 *   .settings-section-title         — card heading ("Receipt format")
 *   #rcptfmt-paper-width-label      — paper-width input label
 *   #rcptfmt-footer-text-label      — statutory footer-text input label
 *   .rcptfmt-save                   — card save button
 *   .rcptfmt-status                 — card saved status
 */

test.describe('Critical Path: Settings Persistence', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'admin', '9999');
    await selectWorkspace(page, WORKSPACES.ADMIN);
  });

  test('change receipt paper width, navigate away, return, verify persisted', async ({ page }) => {
    // ── Step 1: Navigate to Settings → Business Defaults ────────────
    await page.evaluate(() => { window.location.hash = '#/settings'; });

    // Wait for settings sidebar.
    const sidebar = page.locator('[data-testid="settings-sidebar"]');
    await expect(sidebar).toBeVisible({ timeout: 10_000 });

    const businessNav = page.locator('.settings-nav-item').filter({ hasText: 'Business Defaults' });
    await expect(businessNav).toBeVisible({ timeout: 3_000 });
    await businessNav.click();

    // Verify the Business Defaults screen heading.
    await expect(
      page.locator('.settings-screen-placeholder-title').filter({ hasText: 'Business Defaults' }),
    ).toBeVisible({ timeout: 5_000 });

    // ── Step 2: Change the receipt paper width ──────────────────────
    const paperWidth = page.locator('input[aria-labelledby="rcptfmt-paper-width-label"]');
    await expect(paperWidth).toBeVisible({ timeout: 10_000 });

    const currentValue = await paperWidth.inputValue();
    const changedValue = currentValue === '58' ? '80' : '58';
    await paperWidth.fill(changedValue);
    expect(await paperWidth.inputValue()).toBe(changedValue);

    // Persist it through the card's own save (the layout write).
    await page.getByRole('button', { name: 'Save receipt format' }).click();
    await expect(page.locator('.rcptfmt-status')).toContainText('Receipt format saved.', { timeout: 5_000 });

    // ── Step 3: Navigate to a different section ─────────────────────
    await page.locator('.settings-nav-item').filter({ hasText: 'General' }).click();
    await expect(
      page.locator('.settings-screen-placeholder-title').filter({ hasText: 'General' }),
    ).toBeVisible({ timeout: 5_000 });

    // ── Step 4: Return to Business Defaults ─────────────────────────
    await page.locator('.settings-nav-item').filter({ hasText: 'Business Defaults' }).click();

    // The card re-reads the persisted value on mount — it must match.
    const paperWidthAfter = page.locator('input[aria-labelledby="rcptfmt-paper-width-label"]');
    await expect(paperWidthAfter).toBeVisible({ timeout: 10_000 });
    expect(await paperWidthAfter.inputValue()).toBe(changedValue);

    // ── Step 5: Verify no crash ─────────────────────────────────────
    await expect(page.locator('[class*="error-boundary"]')).toHaveCount(0, { timeout: 3_000 });

    // Sidebar must still be visible (layout intact).
    await expect(page.locator('[data-testid="settings-sidebar"]')).toBeVisible({ timeout: 3_000 });
  });

  test('change statutory receipt footer, navigate away, return, verify persisted', async ({ page }) => {
    // ── Step 1: Navigate to Settings → Business Defaults ────────────
    await page.evaluate(() => { window.location.hash = '#/settings'; });

    await expect(page.locator('[data-testid="settings-sidebar"]')).toBeVisible({ timeout: 10_000 });

    await page.locator('.settings-nav-item').filter({ hasText: 'Business Defaults' }).click();
    await expect(
      page.locator('.settings-screen-placeholder-title').filter({ hasText: 'Business Defaults' }),
    ).toBeVisible({ timeout: 5_000 });

    // ── Step 2: Change the statutory footer text ────────────────────
    const footerText = page.locator('input[aria-labelledby="rcptfmt-footer-text-label"]');
    await expect(footerText).toBeVisible({ timeout: 10_000 });

    const originalValue = await footerText.inputValue();
    const newValue = `E2E footer ${Date.now()}`;
    await footerText.fill(newValue);
    expect(await footerText.inputValue()).toBe(newValue);

    // Persist it through the card's own save (the statutory-content write).
    await page.getByRole('button', { name: 'Save statutory content' }).click();
    await expect(page.locator('.rcptfmt-status')).toContainText('Statutory content saved.', { timeout: 5_000 });

    // ── Step 3: Navigate away ───────────────────────────────────────
    await page.locator('.settings-nav-item').filter({ hasText: 'General' }).click();
    await expect(
      page.locator('.settings-screen-placeholder-title').filter({ hasText: 'General' }),
    ).toBeVisible({ timeout: 5_000 });

    // ── Step 4: Navigate back ───────────────────────────────────────
    await page.locator('.settings-nav-item').filter({ hasText: 'Business Defaults' }).click();

    // ── Step 5: Verify the footer text persisted ────────────────────
    const footerTextAfter = page.locator('input[aria-labelledby="rcptfmt-footer-text-label"]');
    await expect(footerTextAfter).toBeVisible({ timeout: 10_000 });
    expect(await footerTextAfter.inputValue()).toBe(newValue);

    // ── Step 6: Restore the original value ──────────────────────────
    await footerTextAfter.fill(originalValue);
    await page.getByRole('button', { name: 'Save statutory content' }).click();
    await expect(page.locator('.rcptfmt-status')).toContainText('Statutory content saved.', { timeout: 5_000 });

    // Verify no crash.
    await expect(page.locator('[class*="error-boundary"]')).toHaveCount(0, { timeout: 3_000 });
  });
});
