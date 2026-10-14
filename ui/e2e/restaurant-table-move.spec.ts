import { test, expect, type Page } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

// WHY THIS FILE EXISTS
// Move and Merge a table's tab are gated on `activeBill`
// (TableManagementScreen.tsx:1154) — they exist only for a table that HAS an open
// bill. Round 192 found the seeded plan carries no bills, so these actions were
// unreachable and round 164 could only verify their candidate filters by reading,
// never by driving them. Round 193's spec-level bill seed makes them reachable.
//
// The safety shape pinned here:
//   * the destination list is AVAILABLE tables only (:1373) — moving a tab onto
//     another occupied table would put two parties on one bill
//   * moving frees the source table

const TIMEOUT = 20_000;

// Install the bill BEFORE any page script runs; the dev-mock reads the held-cart
// slice once at module init. Same mechanism as restaurant-table-release.spec.ts.
// The dev-mock is left untouched by design — round 193's lesson was that a spec's
// need is not a licence to change shared state.
async function seedTableBill(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const key = 'oz-dev-mock:held-carts';
    if (localStorage.getItem(key) !== null) return;
    localStorage.setItem(key, JSON.stringify([{
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
    }]));
  });
}

async function openTables(page: Page): Promise<void> {
  await seedTableBill(page);
  await loginAs(page, 'owner', '1234');
  await selectWorkspace(page, WORKSPACES.RESTAURANT_POS);
  await expect(page.locator('.restaurant-card').first()).toBeVisible({ timeout: TIMEOUT });
  await page.keyboard.press('Shift+L');
  await expect(page.locator('[data-testid="tables-back-btn"]')).toBeVisible({
    timeout: TIMEOUT,
  });
  await expect(page.getByText(/^Table \d+$/).first()).toBeVisible({ timeout: TIMEOUT });
}

// Open the billed table's detail panel.
async function selectBilledTable(page: Page): Promise<void> {
  const tile = page.locator('.tables-table--occupied.tables-table--has-bill').first();
  await expect(tile, 'the seeded bill must attach to a table').toBeVisible({ timeout: TIMEOUT });
  await tile.click();
}

test('Move Table offers only available destinations', async ({ page }) => {
  await openTables(page);
  await selectBilledTable(page);

  const moveBtn = page.locator('[data-testid="tables-move-table-btn"]');
  await expect(moveBtn, 'Move exists only for a table with a bill').toBeVisible({
    timeout: TIMEOUT,
  });
  await moveBtn.click();

  const dialog = page.locator('.tables-modal-dialog');
  await expect(dialog).toBeVisible({ timeout: 8_000 });
  await expect(dialog).toContainText(/Move Table/i);

  const select = page.locator('#tables-move-dest-select');
  if ((await select.count()) > 0) {
    // The destination list is AVAILABLE tables only. Checked against the plan: no
    // listed option may name an occupied tile.
    const options = (await select.locator('option').allTextContents()).map((o) => o.trim());
    expect(options.length, 'the plan has available tables to move to').toBeGreaterThan(0);

    const occupied = (
      await page.locator('.tables-table--occupied .tables-table-name').allTextContents()
    ).map((o) => o.trim());

    // EXACT-NAME comparison, not a substring. `Table 12 (4 seats)` contains
    // `Table 1`, so `includes` reported a collision that does not exist — the
    // same false-positive class `matchesTableBill` avoids with a word boundary
    // (`tableLabel.ts:88-89`). Each option is read back to just its table name.
    const optionNames = options.map((o) => (o.match(/^Table \d+/)?.[0] ?? o).trim());
    for (const name of optionNames) {
      expect(
        occupied.includes(name),
        `destination ${name} must not be an occupied table`,
      ).toBe(false);
    }
    await expect(page.locator('[data-testid="tables-move-confirm-btn"]')).toBeVisible({
      timeout: 5_000,
    });
  } else {
    // A fully occupied plan is a legitimate outcome, and the modal must SAY so
    // rather than rendering blank.
    await expect(dialog).toContainText(/no available tables/i);
  }
});

test('moving the tab frees the source table', async ({ page }) => {
  await openTables(page);
  await selectBilledTable(page);

  const sourceName = (
    await page
      .locator('.tables-table--occupied.tables-table--has-bill .tables-table-name')
      .first()
      .innerText()
  ).trim();

  await page.locator('[data-testid="tables-move-table-btn"]').click();
  const select = page.locator('#tables-move-dest-select');
  if ((await select.count()) === 0) {
    test.skip(true, 'the seeded plan has no available destination');
    return;
  }

  const confirm = page.locator('[data-testid="tables-move-confirm-btn"]');
  await expect(confirm).toBeEnabled({ timeout: 5_000 });
  await confirm.click();

  // The move patches the plan in place, so the source tile follows immediately.
  await expect(
    page.locator('.tables-table--available').filter({ hasText: sourceName }).first(),
    `moving the tab should free ${sourceName}`,
  ).toBeVisible({ timeout: TIMEOUT });
});