import { test, expect, type Page } from '@playwright/test';
import { openRestaurantSidebarRow } from './helpers';

/**
 * E2E: the Menu Editor's filter tabs, search and item form fields.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Rounds 163, 165, 184 and 185 covered the editor's item form SAVE, its Save gate, the bulk
 * 86 controls and the category builder. This file covers what an operator uses to FIND an
 * item before editing it — the status filter tabs and the search box — plus the form fields
 * that were never pressed in a test.
 *
 * WHY THE FILTER TABS MATTER: `Hidden (86)` is the triage view a kitchen lives in during a
 * service. If 86ing an item put it somewhere un-findable, un-86ing it would be guesswork; the
 * mock seeds items in both states, so the tab has content either way.
 */

const TIMEOUT = 20_000;

async function openMenuEditor(page: Page): Promise<void> {
  await openRestaurantSidebarRow(page, 'menu-editor');
  await expect(page.locator('[data-testid="restaurant-menu-editor-bulk-avail"]')).toBeVisible({
    timeout: TIMEOUT,
  });
}

/** One of the two status tabs, which filter the item grid. */
function statusTab(page: Page, filter: 'available' | 'hidden') {
  return page
    .locator('.restaurant-menu-editor-status-tab')
    .filter({ hasText: filter === 'available' ? /Available/ : /Hidden/ });
}

test('the Hidden (86) filter shows only hidden items', async ({ page }) => {
  await openMenuEditor(page);

  const allCards = page.locator('[data-testid^="menu-item-card-"]');
  const hiddenCards = page.locator('.restaurant-menu-editor-card--hidden');

  const totalAll = await allCards.count();
  expect(totalAll, 'the editor should list seeded items').toBeGreaterThan(0);
  const hiddenInAll = await hiddenCards.count();

  await statusTab(page, 'hidden').click();

  // Client-side filtering settles on the next render, so polled rather than read once.
  await expect
    .poll(() => hiddenCards.count(), {
      timeout: TIMEOUT,
      message: 'the 86 tab should list exactly the hidden items',
    })
    .toBe(hiddenInAll);

  // Every card left on screen is hidden — a mixed list means the filter lies.
  expect(await allCards.count()).toBe(hiddenInAll);

  // Back to Available restores the rest.
  await statusTab(page, 'available').click();
  await expect.poll(() => allCards.count(), { timeout: TIMEOUT }).toBe(totalAll);
});

test('search narrows the list to matching items, and clearing restores it', async ({ page }) => {
  await openMenuEditor(page);

  const allCards = page.locator('[data-testid^="menu-item-card-"]');
  const before = await allCards.count();
  expect(before).toBeGreaterThan(0);

  const search = page.locator('[data-testid="restaurant-menu-editor-search-input"]');
  await expect(search).toBeVisible({ timeout: TIMEOUT });

  // Reuse a name already on screen rather than guessing a fixture literal.
  const firstName = await allCards.first().innerText();
  const term = firstName.split('\n')[0]?.trim().slice(0, 12) ?? 'Latte';
  expect(term.length).toBeGreaterThan(2);
  await search.fill(term);

  const filtered = (await expect.poll(() => allCards.count(), { timeout: TIMEOUT }).toBeGreaterThan(0), await allCards.count());
  expect(filtered, 'search must narrow the list').toBeLessThan(before);

  // Every survivor actually matches — a filter that keeps non-matches is worse than none.
  const names = await allCards.allInnerTexts();
  for (const raw of names) expect(raw.toLowerCase()).toContain(term.toLowerCase());

  // Clearing restores the whole list, so the operator is never stuck filtered.
  await search.fill('');
  await expect.poll(() => allCards.count(), { timeout: TIMEOUT }).toBe(before);
});

test('the item form fields accept a price and an availability toggle', async ({ page }) => {
  await openMenuEditor(page);

  // Open an existing item so the form is pre-filled rather than blank.
  await page.locator('.restaurant-menu-editor-card-body').first().click();
  await expect(page.locator('.restaurant-menu-editor-form')).toBeVisible({ timeout: 8_000 });

  const price = page.locator('[data-testid="restaurant-menu-editor-price"]');
  await expect(price).toBeVisible({ timeout: 5_000 });
  await price.fill('25000');
  await expect(price).toHaveValue('25000');

  const active = page.locator('[data-testid="restaurant-menu-editor-active"]');
  const activeBefore = await active.isChecked();
  await active.click();
  expect(await active.isChecked()).toBe(!activeBefore);

  // An edited item must arm Save, or the form is inert.
  await expect(page.locator('[data-testid="restaurant-menu-editor-save-btn"]')).toBeEnabled({
    timeout: 8_000,
  });
});