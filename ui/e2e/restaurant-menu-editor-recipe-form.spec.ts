import { test, expect, type Page } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

// WHY THIS FILE EXISTS
//
// `restaurant-menu-editor-manage-recipe-btn` is the FORM's route into the recipe editor. Round 258
// covered the OTHER route — the per-card action `restaurant-menu-editor-recipe-<sku>` — and
// mentioned this testid only in a comment, which is why the coverage scan still lists it.
//
// **That is round 224's instrument lesson in a new form**: a spec that NAMES an id in prose does
// not cover it, and the scan is right to say so. What looked like a stale scan entry was a real
// gap on a second route into the same modal.
//
// The gates differ, which is the substance: the card action needs no draft (`:1710`), while this
// one is gated on `draft.sku` (`:1590`) — so it is reachable only with the item form open on an
// item that already exists.

const TIMEOUT = 20_000;

async function openMenuEditor(page: Page): Promise<void> {
  await loginAs(page, 'owner', '1234');
  await selectWorkspace(page, WORKSPACES.RESTAURANT_POS);
  await expect(page.locator('.restaurant-card').first()).toBeVisible({ timeout: TIMEOUT });
  await page.locator('.restaurant-sidebar-btn').first().click();
  await page.locator('[data-testid="restaurant-sidebar-menu-editor"]').click();
  await expect(
    page.locator('[data-testid^="restaurant-menu-editor-recipe-"]').first(),
  ).toBeVisible({ timeout: TIMEOUT });
}

test('the item form offers the recipe editor for an existing item', async ({ page }) => {
  await openMenuEditor(page);

  // Open an EXISTING item's form. The button is gated on `draft.sku` (`:1590`), so a New Item
  // draft would not offer it — which is the gate this case exists to exercise.
  await page.locator('.restaurant-menu-editor-card-body').first().click();
  await expect(page.locator('.restaurant-menu-editor-form')).toBeVisible({ timeout: TIMEOUT });

  const manage = page.locator('[data-testid="restaurant-menu-editor-manage-recipe-btn"]');
  await expect(
    manage,
    'an existing item offers its recipe from the form, not only from its card',
  ).toBeVisible({ timeout: TIMEOUT });

  // AND IT OPENS THE SAME EDITOR. Round 258 pinned that the modal works; this pins that a SECOND
  // entry reaches it, so the assertion is the modal and the dish it names.
  await manage.click();
  const modal = page.locator('.recipe-editor-modal');
  await expect(
    modal,
    'the form route opens the recipe editor',
  ).toBeVisible({ timeout: TIMEOUT });
  await expect(modal.locator('.recipe-editor-dish-name')).not.toBeEmpty({ timeout: TIMEOUT });
});

test('the recipe button is absent while the draft has no sku', async ({ page }) => {
  await openMenuEditor(page);

  // A NEW item has no sku, so there is nothing to attach a bill of materials to. The gate is
  // `{draft.sku && (…)}` (`:1590`), and this is the pair that makes the case above a check: a
  // button that always rendered would pass that one alone.
  await page.locator('[data-testid="restaurant-menu-editor-new-item"]').click();
  await expect(page.locator('.restaurant-menu-editor-form')).toBeVisible({ timeout: TIMEOUT });

  await expect(
    page.locator('[data-testid="restaurant-menu-editor-manage-recipe-btn"]'),
    'a new item has no recipe to manage',
  ).toHaveCount(0);
});