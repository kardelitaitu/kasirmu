import { test, expect } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

/**
 * E2E: the Table Management screen's Save Table gate.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The screen carries 17 testids and E2E touched exactly one of them — the back button, added
 * by round 149 to prove the sidebar route. Nothing exercised the table form.
 *
 * THE DEFECT THIS PINS, measured 2026-10-14 before the fix:
 *
 *   `+ Add Table` seeds the modal from `{ name: '', capacity: 4, … }` (`:296-301`). The Save
 *   Table button carried NO `disabled` gate at all, while `handleSaveTableModal` returns
 *   silently on a blank name (`:323`). So Save rendered ENABLED beside an empty required
 *   field, and clicking it produced no request, no error banner and no state change — the
 *   operator taps Save and the till does nothing without saying why.
 *
 *   Probed: `SUBMIT_DISABLED=false`, and after the click `ERROR_SHOWN=0`. The identical shape
 *   to round 163's menu-editor defect, on a different screen.
 *
 * HOW THIS SCREEN IS REACHED. The sidebar ROW is feature-gated (`FEATURES.TABLE_MANAGEMENT`,
 * which the dev mock omits), but the SCREEN is not — `Shift+L` reaches it, which is the
 * restaurant shortcut added in rounds 158-160. So the route under test doubles as coverage
 * that the shortcut lands somewhere real.
 */

const TIMEOUT = 20_000;

async function openTables(page: import('@playwright/test').Page): Promise<void> {
  await loginAs(page, 'owner', '1234');
  await selectWorkspace(page, WORKSPACES.RESTAURANT_POS);
  await expect(page.locator('.restaurant-card').first()).toBeVisible({ timeout: TIMEOUT });
  await page.keyboard.press('Shift+L');
  await expect(page.locator('[data-testid="tables-back-btn"]')).toBeVisible({
    timeout: TIMEOUT,
  });
}

test('Add Table opens the form with Save DISABLED until a name is typed', async ({ page }) => {
  await openTables(page);

  await page.locator('[data-testid="tables-add-table-btn"]').click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible({ timeout: 8_000 });

  const submit = page.getByRole('button', { name: /save table/i });
  await expect(submit, 'Save must not be armed beside an empty required name').toBeDisabled();

  // Naming the table arms it, so the gate is on the NAME rather than something incidental.
  const nameField = dialog.locator('input').first();
  await nameField.fill('E2E Table 7');
  await expect(submit).toBeEnabled({ timeout: 8_000 });

  // Whitespace is not a name — `handleSaveTableModal` tests `tableModal.name.trim()`.
  await nameField.fill('   ');
  await expect(submit).toBeDisabled({ timeout: 8_000 });

  // And the modal has not been dismissed by any of that: the operator is still in the form.
  await expect(dialog).toBeVisible();
});

test('Cancel leaves the table list untouched', async ({ page }) => {
  await openTables(page);

  await page.locator('[data-testid="tables-add-table-btn"]').click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible({ timeout: 8_000 });

  await page.getByRole('button', { name: /cancel/i }).click();
  await expect(dialog).toHaveCount(0);
  // The screen is still mounted — cancelling must not fall back to the sale.
  await expect(page.locator('[data-testid="tables-back-btn"]')).toBeVisible();
});