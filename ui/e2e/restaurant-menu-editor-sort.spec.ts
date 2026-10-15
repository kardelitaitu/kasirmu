import { test, expect, type Page } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

// WHY THIS FILE EXISTS
//
// `restaurant-menu-editor-sort-select` is the menu editor's last BEHAVIOURAL id — its siblings are
// a title, an icon, and the recipe button round 258 covered.
//
// It is a NATIVE `<select>` with real `<option>` elements (`:1203-1215`), which is worth stating
// because this session has met three other dropdown shapes on these screens:
//
//   SettingsSelect triggers   button[aria-haspopup=listbox]   rounds 225, 230, 265
//   role=switch inputs        the LABEL's htmlFor              rounds 148, 170, 179, 228, 242
//   portal option lists       role=option in a portal         rounds 225, 230
//
// Here `selectOption()` addresses it directly — the fourth shape, and the simplest.
//
// WHAT IT DOES: reorders the item list. So the assertion is not that the value changed but that
// the ORDER did, which is the only thing that makes the control useful to an operator scanning a
// menu.

const TIMEOUT = 20_000;

async function openMenuEditor(page: Page): Promise<void> {
  await loginAs(page, 'owner', '1234');
  await selectWorkspace(page, WORKSPACES.RESTAURANT_POS);
  await expect(page.locator('.restaurant-card').first()).toBeVisible({ timeout: TIMEOUT });
  await page.locator('.restaurant-sidebar-btn').first().click();
  await page.locator('[data-testid="restaurant-sidebar-menu-editor"]').click();
  // Wait for CARDS, not the container: the list populates asynchronously (round 258's note).
  await expect(
    page.locator('[data-testid^="restaurant-menu-editor-recipe-"]').first(),
  ).toBeVisible({ timeout: TIMEOUT });
}

/** The visible item names, in the order the operator reads them. */
async function itemOrder(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const names = document.querySelectorAll('.restaurant-menu-editor-item-name, .restaurant-menu-editor-card-name');
    return Array.from(names).map((n) => (n.textContent || '').trim());
  });
}

test('the sort control reorders the item list, not just its own value', async ({ page }) => {
  await openMenuEditor(page);

  const sort = page.locator('[data-testid="restaurant-menu-editor-sort-select"]');
  await expect(sort, 'the editor offers a sort control').toBeVisible({ timeout: TIMEOUT });

  const before = await itemOrder(page);
  expect(before.length, 'the seeded menu has items to order').toBeGreaterThan(1);

  // Sort by NAME ASCENDING. A control that only stored its value would leave the list as it was.
  await sort.selectOption('name-asc');
  await expect.poll(async () => (await itemOrder(page)).join('|'), { timeout: 8_000 })
    .not.toBe(before.join('|'));

  const asc = await itemOrder(page);
  // AND THE ORDER IS THE ONE THE LABEL PROMISES. Ascending means the sequence is sorted; asserting
  // only that it CHANGED would pass on a control wired to the wrong comparator.
  const sorted = [...asc].sort((a, b) => a.localeCompare(b));
  expect(asc, 'name-asc must actually be ascending').toEqual(sorted);

  // THE OTHER DIRECTION, so the case cannot pass on a control that sorts unconditionally.
  await sort.selectOption('name-desc');
  await expect.poll(async () => (await itemOrder(page)).join('|'), { timeout: 8_000 })
    .not.toBe(asc.join('|'));
  const desc = await itemOrder(page);
  expect(
    desc,
    'name-desc must be the reverse of the ascending order',
  ).toEqual([...asc].reverse());
});