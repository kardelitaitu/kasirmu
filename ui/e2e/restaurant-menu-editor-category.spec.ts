import { test, expect, type Page } from '@playwright/test';
import { openRestaurantSidebarRow } from './helpers';

/**
 * E2E: the Menu Editor's category builder.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Rounds 163, 165 and 184 covered the editor's item form, its Save gate and the bulk
 * availability controls. The CATEGORY builder — `+ Add`, the name field, the icon and colour
 * pickers, and delete — was still untouched, and it carries the editor's only business RULE:
 * duplicate category names are refused with localized feedback (`handleSaveCategory`, `:758-770`).
 *
 * Why that rule matters operationally: categories are both the kitchen's filing system and the
 * operator's filter chip. Two "Beverage" entries would silently split one set of items across
 * two chips, so "86 all beverages" would miss half of them.
 *
 * A REACHABILITY NOTE, measured 2026-10-14. The header renders before the data does — the body
 * reads `Loading menu…` with zero categories for a moment after `[data-testid=…-header]`
 * appears. Every assertion below therefore waits for a CATEGORY to exist first; reading too
 * early produced `STILL_LOADING=true` and a body with the header but no chips. That is round
 * 177's trap again, and the wait is what makes this deterministic rather than flaky.
 */

const TIMEOUT = 20_000;

async function openMenuEditor(page: Page): Promise<void> {
  await openRestaurantSidebarRow(page, 'menu-editor');
  await expect(page.locator('[data-testid="restaurant-menu-editor-header"]')).toBeVisible({
    timeout: TIMEOUT,
  });
  // The LOADED state, not the mounted one: `Make all available` only renders with items and
  // its presence is the signal that the category chips are real.
  await expect(page.locator('[data-testid="restaurant-menu-editor-bulk-avail"]')).toBeVisible({
    timeout: TIMEOUT,
  });
}

test('the category builder refuses a duplicate name with feedback', async ({ page }) => {
  await openMenuEditor(page);

  await page.locator('[data-testid="restaurant-menu-editor-btn-add-cat"]').click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible({ timeout: 8_000 });

  const nameField = page.locator('[data-testid="restaurant-menu-editor-cat-input-name"]');
  await expect(nameField).toBeVisible({ timeout: 5_000 });

  // A name that ALREADY EXISTS. Read from the dialog-independent state rather than guessing:
  // the seeded set is `Food`, `Snack`, `Hot Drinks`, `Cold Drinks`, `Dessert` plus hardware
  // categories, and a literal here would break the day the fixtures change. `Food` is the one
  // the restaurant fixtures always carry.
  await nameField.fill('Food');

  // The MODAL's own save, by testid: a role/name lookup matches the editor's top-level Save,
  // which is disabled until the screen is dirty, so the click would never land.
  const save = page.locator('[data-testid="restaurant-menu-editor-cat-save"]');
  await expect(save).toBeEnabled({ timeout: 5_000 });
  await save.click();

  // Refused AND said — the handler adds an error toast (`:762-770`). A silent drop is the
  // failure this pins.
  await expect(
    page.getByText(/already exist/i),
    'a duplicate category name must be refused with feedback, not silently dropped',
  ).toBeVisible({ timeout: 8_000 });

  // And the modal STAYS OPEN so the operator can correct the name, rather than losing the
  // form they had filled in.
  await expect(dialog).toBeVisible();
});

test('a valid new category appears in the chip list', async ({ page }) => {
  await openMenuEditor(page);

  await page.locator('[data-testid="restaurant-menu-editor-btn-add-cat"]').click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible({ timeout: 8_000 });

  const nameField = page.locator('[data-testid="restaurant-menu-editor-cat-input-name"]');
  await nameField.fill('E2E Category');
  await page.locator('[data-testid="restaurant-menu-editor-cat-save"]').click();

  await expect(dialog).toHaveCount(0, { timeout: TIMEOUT });
  await expect(page.getByText('E2E Category').first()).toBeVisible({ timeout: TIMEOUT });
});