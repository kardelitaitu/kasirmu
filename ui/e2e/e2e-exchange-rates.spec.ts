import { test, expect } from '@playwright/test';
import { loginAs, navigateViaSidebar } from './helpers';

/**
 * E2E: Exchange Rates screen contract (CUR-11 Playwright coverage)
 *
 * The rate screen had zero e2e coverage. NOTE: the exchange-rate IPC
 * commands have no cloud REST counterpart (ARCH-01 family — the web/e2e
 * build serves them from the dev-mock), so this spec asserts the screen
 * CONTRACT — route, table, modal validation, CUR-10 delete confirmation —
 * not a create/delete round-trip. Real CRUD is covered by the repository
 * tests (modules-currency) and the vitest contract suites.
 *
 * CSS/DOM contract (ExchangeRateScreen.tsx + features/currency/register.tsx):
 *   route #/exchange-rates — top-level page (finance nav section, manager+)
 *   .exchange-rate-title "Exchange Rates" — screen heading (currency-title)
 *   #er-field-from / #er-field-to — currency selects (option value = code)
 *   #er-field-rate / #er-field-source / #er-field-date — inputs
 *   role="dialog" — SettingsPopup (Save disabled until form valid)
 *   row delete button aria-label "Delete {from}-{to}" (currency-delete-label)
 *   CUR-10: delete goes through ConfirmDialog (confirm label "Delete")
 */

test.describe('Exchange Rates screen', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'admin', '9999');
    // REACH THE SCREEN THE WAY A USER DOES, through the workspace sidebar.
    //
    // `selectWorkspace(ADMIN) + window.location.hash = '#/exchange-rates'` cannot work:
    // `selectWorkspace` activates admin through the Settings card, and `exchange-rates`
    // is NOT a fullscreen page. WorkspaceHome.handleShortcutNav (WorkspaceHome.tsx:553-565)
    // sets a workspace for fullscreen destinations only, so a hash write to a plain page
    // arrives with no workspace — AppShell.tsx:708 then returns the picker.
    //
    // The screen IS a first-class in-workspace page: its own header calls it "top-level page
    // (finance nav section, manager+)" and it registers a nav item (features/currency/
    // register.tsx), which is why the sidebar is the correct route. Measured 2026-10-17:
    // the Finance section offers Exchange Rates and reaching it renders
    // `.exchange-rate-title`. See helpers.navigateViaSidebar.
    await navigateViaSidebar(page, 'Finance', 'Exchange Rates');
    await expect(page.locator('.exchange-rate-title')).toBeVisible({ timeout: 10_000 });
  });

  test('lists rates with the full column contract', async ({ page }) => {
    const table = page.getByRole('table');
    await expect(table).toBeVisible();
    for (const col of ['From', 'To', 'Rate', 'Source', 'Effective Date']) {
      await expect(table.getByRole('columnheader', { name: col })).toBeVisible();
    }
    // Mock-seeded USD→IDR row renders with its cells (dev-mock data).
    const row = table.locator('tbody tr').filter({ hasText: 'USD' }).filter({ hasText: 'IDR' });
    await expect(row.first()).toBeVisible({ timeout: 5_000 });
  });

  test('Add modal gates Save until the form is valid', async ({ page }) => {
    await page.getByRole('button', { name: 'Add' }).first().click();
    const popup = page.getByRole('dialog');
    await expect(popup).toBeVisible({ timeout: 3_000 });
    const save = popup.getByRole('button', { name: 'Save' });
    await expect(save).toBeDisabled();
    await page.selectOption('#er-field-from', 'USD');
    await page.selectOption('#er-field-to', 'IDR');
    await page.fill('#er-field-rate', '15000');
    await expect(save).toBeEnabled();
    // Same-currency pairs are rejected client-side (CUR-05 parity).
    await page.selectOption('#er-field-to', 'USD');
    await expect(save).toBeDisabled();
    await popup.getByRole('button', { name: 'Cancel' }).click();
    await expect(popup).toBeHidden();
  });

  test('delete requires confirmation and cancel keeps the row (CUR-10)', async ({ page }) => {
    const row = page.locator('tbody tr').filter({ hasText: 'USD' }).filter({ hasText: 'IDR' }).first();
    await expect(row).toBeVisible({ timeout: 5_000 });
    await row.getByRole('button', { name: 'Delete USD-IDR' }).click();
    const confirm = page.getByRole('dialog');
    await expect(confirm).toBeVisible({ timeout: 3_000 });
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toBeHidden({ timeout: 3_000 });
    await expect(row).toBeVisible();
  });
});
