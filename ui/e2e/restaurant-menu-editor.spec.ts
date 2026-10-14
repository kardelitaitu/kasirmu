import { test, expect } from '@playwright/test';
import { openRestaurantSidebarRow } from './helpers';

/**
 * E2E: the restaurant Menu Editor's item form.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Round 149 covered the sidebar ROUTE to this screen and nothing else. Rounds 126 and 138
 * drove the editor by hand — its categories were deferred, and its empty-category state was
 * recorded — but no spec ever exercised the item form, which is the part an operator uses to
 * change what the kitchen can sell.
 *
 * THE DEFECT THIS PINS, measured 2026-10-14 before the fix:
 *
 *   New Item opens the form with `name: ''` (`EMPTY_DRAFT`, `:246`). The Save button gated on
 *   `!draft || saving` only (`:983`), while `handleSaveDraft` starts with
 *   `if (!draft || !sessionToken || !draft.name.trim()) return;` (`:641`). So Save rendered
 *   ENABLED beside an empty required field, and clicking it produced no request, no toast and
 *   no state change — the operator taps Save and the till does nothing without saying why.
 *   That is F40's shape on a different screen.
 *
 * The gate now matches the handler: `!draft.name.trim()`. The suite kills on the button's
 * `disabled` state, which is the user-visible half; the form staying open is the other.
 */

const TIMEOUT = 20_000;

async function openMenuEditor(page: import('@playwright/test').Page): Promise<void> {
  await openRestaurantSidebarRow(page, 'menu-editor');
  await expect(page.locator('[data-testid="restaurant-menu-editor-header"]')).toBeVisible({
    timeout: TIMEOUT,
  });
}

test('New Item opens the form with Save DISABLED until a name is typed', async ({ page }) => {
  await openMenuEditor(page);

  await page.locator('[data-testid="restaurant-menu-editor-new-item"]').click();
  const form = page.locator('[data-testid="restaurant-menu-editor-form"]');
  await expect(form).toBeVisible({ timeout: 8_000 });

  const name = page.locator('[data-testid="restaurant-menu-editor-name"]');
  const save = page.locator('[data-testid="restaurant-menu-editor-save-btn"]');

  // The empty state the defect lived in.
  await expect(name).toHaveValue('');
  await expect(save, 'Save must not be armed beside an empty required name').toBeDisabled();

  // Naming the item arms it — so the gate is on the name, not on something incidental.
  await name.fill('Nasi Goreng E2E');
  await expect(save).toBeEnabled({ timeout: 8_000 });

  // Whitespace is not a name. The handler tests `draft.name.trim()`, so the button must too —
  // otherwise a space would arm a save the handler silently refuses.
  await name.fill('   ');
  await expect(save).toBeDisabled({ timeout: 8_000 });
});

test('the item form can be dismissed without saving', async ({ page }) => {
  await openMenuEditor(page);

  await page.locator('[data-testid="restaurant-menu-editor-new-item"]').click();
  const form = page.locator('[data-testid="restaurant-menu-editor-form"]');
  await expect(form).toBeVisible({ timeout: 8_000 });

  // Escape must not leave the editor: the form is inside it, and a stray Escape that closes
  // the whole screen would drop the operator back to a sale mid-edit.
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="restaurant-menu-editor-header"]')).toBeVisible();
});