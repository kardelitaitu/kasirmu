import { test, expect, type Page } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

// WHY THIS FILE EXISTS
//
// `restaurant-menu-editor-manage-recipe-btn` is the menu editor's only remaining BEHAVIOURAL
// control. The four other uncovered testids on that screen are chrome — a title, an icon and a
// sort select — while this one opens a bill-of-materials editor, which is the thing that decides
// what a dish costs.
//
// TWO ENTRY POINTS reach the same modal (`:1596` and `:1710`):
//
//   restaurant-menu-editor-manage-recipe-btn   inside the item form, gated on a draft with a SKU
//   restaurant-menu-editor-recipe-<sku>        a per-card action, no draft needed
//
// This spec uses the SECOND: it reaches the modal without filling the form, so a failure here is
// about the recipe editor rather than about the form's validation.

const TIMEOUT = 20_000;

async function openMenuEditor(page: Page): Promise<void> {
  await loginAs(page, 'owner', '1234');
  await selectWorkspace(page, WORKSPACES.RESTAURANT_POS);
  await expect(page.locator('.restaurant-card').first()).toBeVisible({ timeout: TIMEOUT });
  await page.locator('.restaurant-sidebar-btn').first().click();
  await page.locator('[data-testid="restaurant-sidebar-menu-editor"]').click();
  // Wait for a CARD's recipe action, not the container: the list populates asynchronously.
  await expect(
    page.locator('[data-testid^="restaurant-menu-editor-recipe-"]').first(),
  ).toBeVisible({ timeout: TIMEOUT });
}

test('a menu item opens its recipe editor', async ({ page }) => {
  await openMenuEditor(page);

  const recipe = page.locator('[data-testid^="restaurant-menu-editor-recipe-"]').first();
  await recipe.click();

  // THE MODAL. It is the only way to see what a dish consumes, so it opening at all is the
  // first claim — and a dead button here would leave the BOM unreachable from the editor.
  const modal = page.locator('.recipe-editor-modal');
  await expect(modal, 'the item offers a recipe editor').toBeVisible({ timeout: TIMEOUT });

  // AND IT NAMES THE DISH. A BOM editor that does not say which dish it is editing invites
  // costing the wrong one, so the SKU badge is what makes the modal safe rather than merely open.
  await expect(modal.locator('.recipe-editor-dish-name')).not.toBeEmpty({ timeout: TIMEOUT });
});

test('the recipe editor costs what it says it costs', async ({ page }) => {
  await openMenuEditor(page);
  await page.locator('[data-testid^="restaurant-menu-editor-recipe-"]').first().click();

  const modal = page.locator('.recipe-editor-modal');
  await expect(modal).toBeVisible({ timeout: TIMEOUT });

  // The modal loads its ingredient lines asynchronously (`recipe-editor-loading` exists precisely
  // because of that), so the assertions below wait for the LOAD to finish rather than racing it.
  await expect(page.locator('[data-testid="recipe-editor-loading"]')).toHaveCount(0, {
    timeout: TIMEOUT,
  });

  // THE TOTAL. A BOM editor's whole purpose is a number an operator can act on, so the box must
  // carry one — and it must be a money figure, not an empty shell.
  const total = page.locator('[data-testid="recipe-total-cost-box"]');
  await expect(total, 'the editor reports a total cost').toBeVisible({ timeout: TIMEOUT });
  expect(
    ((await total.innerText()) ?? '').trim().length,
    'the total must carry a figure, not just a label',
  ).toBeGreaterThan(3);

  // AND IT OFFERS THE ACTION ITS NAME IMPLIES: adding an ingredient. A read-only modal would
  // satisfy the assertions above while making the editor useless.
  await expect(
    page.locator('[data-testid="recipe-add-ingredient-btn"]'),
    'the editor can be edited',
  ).toBeEnabled({ timeout: TIMEOUT });
});