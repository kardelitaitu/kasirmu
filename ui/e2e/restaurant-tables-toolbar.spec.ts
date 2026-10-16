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
  //
  // The panel's OWN Close button — kept not because Escape is broken but because a Close
  // button is what an operator presses, and this case is about the PANEL leaving before
  // arrange mode is entered.
  //
  // ⚠️ The reason previously written here was WRONG and is corrected 2026-10-18. It said
  // Escape "belongs to the shell" and that the panel "is not an ARIA modal and could never
  // have owned the key". Both are false: the panel is `role="dialog" aria-modal="true"`
  // (`TableManagementScreen.tsx:1972`) and its focus trap DOES handle Escape. What actually
  // happened was an ORDER bug in `PosScreen`'s Escape cascade, which ran first (it registers
  // on `document` before the panel mounts) and closed the whole table view — `.tables-table`
  // 12 -> 0. `PosScreen` now stands down when a modal is open, and
  // `restaurant-tables-toolbar.spec.ts` pins that Escape closes the panel ALONE.
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.tables-detail-actions')).toHaveCount(0, { timeout: 5_000 });
  await arrange.click();

  // THE GUARD: in arrange mode the same tap must NOT open the table. Without it an
  // operator moving furniture opens a table on every drag they start.
  await tile.click();
  await expect(
    page.locator('.tables-detail-actions'),
    'arrange mode must stop the tap opening a table',
  ).toHaveCount(0, { timeout: 5_000 });
});

test('Escape closes the detail panel WITHOUT taking the floor plan with it', async ({ page }) => {
  await openTables(page);

  const tiles = page.locator('.tables-table');
  const before = await tiles.count();
  expect(before, 'the floor plan must be populated for this to mean anything').toBeGreaterThan(0);

  // Click the TILE, not its name span: the floor plan list intercepts a click on the
  // inner label, which is what the sibling case above guards against too.
  await tiles.first().click();
  await expect(page.locator('.tables-detail')).toBeVisible({ timeout: TIMEOUT });

  await page.keyboard.press('Escape');

  // The PANEL closes — that is the dismissal the operator asked for.
  await expect(page.locator('.tables-detail')).toHaveCount(0, { timeout: TIMEOUT });
  // And the FLOOR PLAN SURVIVES. Measured 2026-10-18 before the fix: Escape on this
  // screen closed the panel AND the whole table view behind it, 12 tiles -> 0, because
  // `PosScreen`'s Escape cascade is registered on `document` BEFORE the panel's focus
  // trap and acted on a key the panel had already handled. `PosScreen.tsx` now stands
  // down when an ARIA modal is open (`isAnyAriaModalOpen()`), which is the question the
  // old comment had argued was unnecessary because "a sub-screen is not a modal" — true
  // of the sub-screen, and false of a modal opened INSIDE it.
  await expect(
    tiles,
    'Escape closed the whole table view instead of just the panel',
  ).toHaveCount(before, { timeout: TIMEOUT });
  await expect(page.getByText(/^Table \d+$/).first()).toBeVisible({ timeout: TIMEOUT });
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
  // Same reason as the case above: the Close BUTTON, because Escape is the shell's.
  await page.getByRole('button', { name: 'Close' }).click();
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
