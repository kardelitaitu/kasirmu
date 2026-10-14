import { test, expect, type Page } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

// WHY THIS FILE EXISTS
//
// The tables screen at 7 of 17. Rounds 193-196 covered its destructive edges (release,
// delete, move, merge) and round 177 drove the floor plan live. What was left is the
// TOOLBAR and the detail-panel actions.
//
// The two controls here change what a tap on a tile DOES:
//
//   tables-legend-toggle-btn   shows the status key
//   tables-arrange-mode-btn    makes tiles draggable and stops them OPENING a table
//
// The second is the interesting one. `openDetail` is guarded by `if (arrangeMode) return;`
// (`:919` and `:928`) so an operator arranging the floor plan does not open a table every
// time they move one. A regression there would make rearranging the room unusable — and
// nothing tested it.

const TIMEOUT = 20_000;

const SEEDED_BILL = {
  id: 'held-e2e-table-1',
  label: 'Table 1',
  cart_data: JSON.stringify({ items: [] }),
  item_count: 1,
  total_minor: 250000,
  currency: 'IDR',
  created_at: '2026-01-01T10:00:00.000Z',
  bill_type: 'open_bill',
  customer_name: null,
  deduction_location_id: null,
};

// Open the tables screen with the grid populated (the round-177 setup).
async function openTables(page: Page): Promise<void> {
  await page.addInitScript((bill) => {
    const key = 'oz-dev-mock:held-carts';
    if (localStorage.getItem(key) !== null) return;
    localStorage.setItem(key, JSON.stringify([bill]));
  }, SEEDED_BILL);
  await loginAs(page, 'owner', '1234');
  await selectWorkspace(page, WORKSPACES.RESTAURANT_POS);
  await expect(page.locator('.restaurant-card').first()).toBeVisible({ timeout: TIMEOUT });
  await page.keyboard.press('Shift+L');
  // Data-shaped wait: the tile names, not the back button (round 186).
  await expect(page.getByText(/^Table \d+$/).first()).toBeVisible({ timeout: TIMEOUT });
}

test('the legend toggle shows and hides the status key', async ({ page }) => {
  await openTables(page);

  const toggle = page.locator('[data-testid="tables-legend-toggle-btn"]');
  const legend = page.locator('[data-testid="tables-legend-bar"]');
  await expect(toggle).toBeVisible({ timeout: TIMEOUT });

  // The legend starts hidden — the toolbar control is what reveals it.
  await expect(legend, 'the legend starts hidden').toHaveCount(0);

  await toggle.click();
  await expect(legend, 'the toggle reveals the key').toBeVisible({ timeout: TIMEOUT });

  // And it goes away again, so the control is a toggle rather than a reveal.
  await toggle.click();
  await expect(legend).toHaveCount(0, { timeout: TIMEOUT });
});

test('arrange mode stops a tile opening its table', async ({ page }) => {
  await openTables(page);

  const tile = page.locator('.tables-table').first();
  const arrange = page.locator('[data-testid="tables-arrange-mode-btn"]');
  await expect(tile).toBeVisible({ timeout: TIMEOUT });
  await expect(arrange).toBeVisible({ timeout: TIMEOUT });

  // Out of arrange mode a tap opens the detail panel — the baseline this case rests on.
  await tile.click();
  await expect(
    page.locator('.tables-detail-actions'),
    'a plain tap opens the table detail',
  ).toBeVisible({ timeout: TIMEOUT });

  // Leave the panel so the next tap is unambiguous, then enter arrange mode.
  await page.keyboard.press('Escape');
  await arrange.click();

  // THE GUARD: in arrange mode the same tap must NOT open the table. Without it an
  // operator moving furniture opens a table on every drag they start.
  await tile.click();
  await expect(
    page.locator('.tables-detail-actions'),
    'arrange mode must stop the tap opening a table',
  ).toHaveCount(0, { timeout: 5_000 });
});

test('the assign button names the action its state implies', async ({ page }) => {
  await openTables(page);

  const actions = page.locator('.tables-detail-actions');

  // THE BILLED TABLE (Table 1, seeded above). Its label offers to RESUME, because a tab
  // already exists — 'Select for Order' would wrongly imply starting fresh.
  const billed = page.locator('.tables-table--has-bill').first();
  await expect(billed).toBeVisible({ timeout: TIMEOUT });
  await billed.click();
  await expect(actions).toBeVisible({ timeout: TIMEOUT });

  const assign = page.locator('[data-testid="tables-assign-to-order-btn"]');
  await expect(assign).toBeVisible({ timeout: TIMEOUT });
  await expect(
    assign,
    'a table with a tab offers to resume it, not to start one',
  ).toContainText(/resume/i);

  // Close the panel, then open a FREE table. Its label is the other half of the pair —
  // the same control, and the state is what decides the verb.
  await page.keyboard.press('Escape');
  await expect(actions).toHaveCount(0, { timeout: 5_000 });

  const free = page.locator('.tables-table--available').first();
  await expect(free, 'the plan has a free table').toBeVisible({ timeout: TIMEOUT });
  await free.click();
  await expect(actions).toBeVisible({ timeout: TIMEOUT });
  await expect(
    page.locator('[data-testid="tables-assign-to-order-btn"]'),
    'a free table offers to start an order',
  ).toContainText(/select for order/i);
});
