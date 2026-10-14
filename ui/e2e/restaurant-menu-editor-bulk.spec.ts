import { test, expect, type Page } from '@playwright/test';
import { openRestaurantSidebarRow } from './helpers';

/**
 * E2E: the Menu Editor's BULK availability controls.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Round 163 covered the editor's item form and its Save gate. The bulk controls are the other
 * half of the screen and the bigger operational lever: `86 All (Hide)` marks every item in
 * the current filter unavailable in one action — what a kitchen does when a supplier fails —
 * and `Make all available` puts them back before doors open.
 *
 * WHY IT IS WORTH PINNING RATHER THAN CLICKING ONCE:
 *   * the handler filters to items whose state DIFFERS from the target
 *     (`filteredItems.filter((p) => (p.is_active !== false) !== targetActive)`), so the two
 *     buttons are not symmetrical no-ops;
 *   * it applies the optimistic local update BEFORE awaiting the IPC, which is the shape where
 *     a failure leaves the screen lying about what it saved;
 *   * `bulkUpdating` guards re-entry, so a second click mid-flight must not double-apply.
 *
 * Selectors, read from the screen rather than guessed:
 *   [data-testid=restaurant-menu-editor-bulk-hide] / -bulk-avail   the two controls
 *   [data-testid^=menu-item-card-]                                 an item card
 *   .restaurant-menu-editor-card--hidden                           the 86'd modifier
 */

const TIMEOUT = 20_000;

async function openMenuEditor(page: Page): Promise<void> {
  await openRestaurantSidebarRow(page, 'menu-editor');
  await expect(page.locator('[data-testid="restaurant-menu-editor-header"]')).toBeVisible({
    timeout: TIMEOUT,
  });
}

test('86 All hides every listed item, and Make all available restores them', async ({
  page,
}) => {
  await openMenuEditor(page);

  const hide = page.locator('[data-testid="restaurant-menu-editor-bulk-hide"]');
  const show = page.locator('[data-testid="restaurant-menu-editor-bulk-avail"]');
  await expect(hide).toBeVisible({ timeout: TIMEOUT });
  await expect(show).toBeVisible({ timeout: TIMEOUT });

  const cards = page.locator('[data-testid^="menu-item-card-"]');
  const hidden = page.locator('.restaurant-menu-editor-card--hidden');
  const total = await cards.count();
  expect(total, 'the editor should list seeded items').toBeGreaterThan(0);
  const hiddenBefore = await hidden.count();

  await hide.click();

  // The optimistic update lands before the IPC resolves, so the cards change first. Polled
  // rather than read once: the state flips on the next render, not on the click.
  await expect
    .poll(() => hidden.count(), {
      timeout: TIMEOUT,
      message: '86 All should mark the listed items unavailable',
    })
    .toBe(total);

  // And back. The inverse control must undo it, or the screen has a one-way operation —
  // the state to return to is whatever was hidden before, not necessarily zero.
  await show.click();
  await expect
    .poll(() => hidden.count(), {
      timeout: TIMEOUT,
      message: 'Make all available should restore the earlier state',
    })
    .toBe(hiddenBefore);
});