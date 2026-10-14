import { test, expect, type Page } from '@playwright/test';
import { openRestaurantPosWithItem } from './helpers';

/**
 * E2E: the restaurant keyboard shortcuts reach their handlers in a browser (round 159/160).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Round 159 bound `features/restaurant/restaurantShortcuts.ts` to the POS, and round 158's
 * parity test proved the manifest is COHERENT — no duplicate keys, no collision with retail,
 * no advertised-but-unimplemented action. Neither proves a keypress reaches a handler while the
 * app is running. This does.
 *
 * Two cases, each chosen for what it can observe through the DOM:
 *
 *   * `Shift+L` opens Table Management, whose `[data-testid=tables-back-btn]` is only on
 *     screen when that sub-surface has mounted. No IPC, no timing, no fixture — the clearest
 *     signal the route fired.
 *   * `Shift+B` opens the split-bill modal, `[data-testid=pos-split-bill-modal]`, which is
 *     likewise not present otherwise.
 *
 * What is deliberately NOT asserted: that `Shift+K` dispatched to the kitchen and `Shift+P`
 * printed. Both are one-way IPC writes against the mock whose effect is a toast, and a toast
 * proves less than the modal does — a missing handler would also leave no toast. The two
 * routes that change what is VISIBLE are the two worth an E2E case.
 *
 * The editable guard is asserted too, because it is the part a refactor breaks silently: a
 * Shift+ letter typed into the table-number field must stay a capital K, not become a
 * keyboard dispatch.
 */

const TIMEOUT = 20_000;


async function openRestaurantPos(page: Page): Promise<void> {
  await openRestaurantPosWithItem(page);
}

test('Shift+L opens Table Management from the POS', async ({ page }) => {
  await openRestaurantPos(page);

  const back = page.locator('[data-testid="tables-back-btn"]');
  await expect(back, 'Table Management must not already be open').toHaveCount(0);

  await page.keyboard.press('Shift+L');

  await expect(back).toBeVisible({ timeout: TIMEOUT });

  // And the way back still works, so the shortcut has not trapped the operator.
  await back.click();
  await expect(back).toHaveCount(0);
});

test('Shift+B opens the split-bill modal from the POS', async ({ page }) => {
  await openRestaurantPos(page);

  const modal = page.locator('[data-testid="pos-split-bill-modal"]');
  await expect(modal).toHaveCount(0);

  await page.keyboard.press('Shift+B');

  await expect(modal).toBeVisible({ timeout: TIMEOUT });

  // Escape closes it — the manifest's `Shift+B` must not preempt the modal's own
  // dismissal, and plain Escape is the shell's documented close affordance.
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
});

test('a Shift+letter typed into a field is not a shortcut', async ({ page }) => {
  await openRestaurantPos(page);

  // The table-number field is the one an operator types into mid-service.
  const tableField = page.locator('.pos-cart-table-input');
  await expect(tableField).toBeVisible({ timeout: TIMEOUT });
  await tableField.click();
  await tableField.fill('');

  // Type SHIFT+L with the field focused. It must land in the field as a capital L and
  // must NOT open Table Management — which is what the manifest's `editableGuard` is for.
  await page.keyboard.type('KL');

  await expect(tableField).toHaveValue(/KL/);
  await expect(page.locator('[data-testid="tables-back-btn"]')).toHaveCount(0);
});