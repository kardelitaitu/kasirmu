import { test, expect, type Page } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

// WHY THIS FILE EXISTS
// Round 192 wrote this spec and could not make it pass: the seeded floor plan
// marks five tables occupied but carries NO bills, so the release CONFIRMATION
// at TableManagementScreen.tsx:1129 — the guard that stops a live tab being
// released on one click — was unreachable. A spec altered to pass would have
// asserted the one-click path while claiming to test the guarded one.
//
// Round 193 unblocked it with a fixture change: sales.ts seeds one open bill
// labelled `Table 1`. matchesTableBill binds a `Table N` label to the floor
// plan's bare table number, so the tile now carries a bill, the `--has-bill`
// modifier appears, and the guarded branch is reachable.

const TIMEOUT = 20_000;

/**
 * Install the bill BEFORE any page script runs.
 *
 * `addInitScript` is the mechanism, not `page.evaluate`: the dev-mock reads the
 * held-cart slice once at module init, and `loginAs` navigates itself — so a
 * write made after the first navigation is read by nobody. An init script runs
 * on every document before the bundle, which is what makes the seed visible to
 * the mock's first read.
 */
async function seedTableBill(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Only seed once per browser context, or a re-navigation would reset a bill
    // the test itself has since released.
    const key = 'oz-dev-mock:held-carts';
    if (localStorage.getItem(key) !== null) return;
    const bill = {
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
    localStorage.setItem(key, JSON.stringify([bill]));
  });
}

async function openTables(page: Page): Promise<void> {
  // Registered before loginAs navigates, so the init script runs on that very
  // first document load — see seedTableBill.
  await seedTableBill(page);
  await loginAs(page, 'owner', '1234');
  await selectWorkspace(page, WORKSPACES.RESTAURANT_POS);
  await expect(page.locator('.restaurant-card').first()).toBeVisible({ timeout: TIMEOUT });
  await page.keyboard.press('Shift+L');
  await expect(page.locator('[data-testid="tables-back-btn"]')).toBeVisible({
    timeout: TIMEOUT,
  });
  // Data-shaped wait, not the back button (round 186).
  await expect(page.getByText(/^Table \d+$/).first()).toBeVisible({ timeout: TIMEOUT });
}

/** The first occupied tile that carries an open bill. */
async function selectBilledTable(page: Page): Promise<void> {
  const tile = page.locator('.tables-table--occupied.tables-table--has-bill').first();
  await expect(tile, 'the seeded plan has an occupied table with an open bill').toBeVisible({
    timeout: TIMEOUT,
  });
  await tile.click();
}

/** The detail panel's status-changing button. */
function statusButton(page: Page) {
  return page
    .locator('.tables-detail-actions button')
    .filter({ hasText: /Release|Reserve|Available/ })
    .first();
}

test('releasing an occupied table requires a confirmation that names the tab', async ({
  page,
}) => {
  await openTables(page);
  await selectBilledTable(page);

  const primary = statusButton(page);
  await expect(primary).toBeVisible({ timeout: TIMEOUT });
  await expect(primary).toHaveText(/Release/i);

  await primary.click();

  // ONE CLICK IS NOT ENOUGH. The confirmation names the amount still open on the
  // tab, which is the number a host needs before releasing.
  const confirm = page.locator('.tables-warning-banner');
  await expect(confirm).toBeVisible({ timeout: 8_000 });
  await expect(confirm).toContainText(/Rp|\d/);
  await expect(page.getByRole('button', { name: /confirm release/i })).toBeVisible({
    timeout: 5_000,
  });

  // Cancelling leaves the table occupied, so the release stays undoable.
  await page.getByRole('button', { name: /^Cancel$/i }).click();
  await expect(confirm).toHaveCount(0, { timeout: 5_000 });
  await expect(primary).toHaveText(/Release/i);
});

test('confirming the release frees the table', async ({ page }) => {
  await openTables(page);
  await selectBilledTable(page);

  // ⚠️ THE TILE IS ADDRESSED BY INDEX. The first version of this assertion did not
  // bind (measured 2026-10-14, round 198): removing `releaseTableScoped` from
  // `statusAction` left all four cases PASSING, because
  //
  //   * the plan already carries several AVAILABLE tiles, so `.first()` could be one
  //     of those rather than the source;
  //   * `hasText: /Table 1/` also matches `Table 12` (rounds 195, 197);
  //   * and a release sets CLEANING, not available (`floorplan.ts:152-154`) — so the
  //     state asked for was wrong as well.
  const sourceIndex = await page
    .locator('.tables-table')
    .evaluateAll((els) =>
      els.findIndex((e) => e.className.includes('tables-table--occupied')
        && e.className.includes('tables-table--has-bill')),
    );
  expect(sourceIndex, 'the billed table must be locatable').toBeGreaterThanOrEqual(0);

  await statusButton(page).click();
  await page.getByRole('button', { name: /confirm release/i }).click();

  // The mutation patches the plan in place (statusAction :439-440) rather than
  // reloading, so the tile follows without a round trip — and it is THIS tile that
  // must change, not any available one on the plan.
  await expect
    .poll(
      async () =>
        (await page.locator('.tables-table').nth(sourceIndex).getAttribute('class')) ?? '',
      {
        timeout: TIMEOUT,
        message: `confirming the release must release tile ${sourceIndex}`,
      },
    )
    .toContain('tables-table--cleaning');
});
test('an occupied table cannot be deleted mid-service', async ({ page }) => {
  await openTables(page);
  await selectBilledTable(page);

  // SAFETY, not just a disabled button: deleting the table a guest is sitting at
  // would take the floor plan out from under an open service. The gate reads
  // `disabled={Boolean(activeBill || selected.status === 'occupied')}` (:1194).
  const del = page.locator('[data-testid="tables-delete-table-btn"]');
  await expect(del).toBeVisible({ timeout: TIMEOUT });
  await expect(del, 'an occupied table with a bill must not be deletable').toBeDisabled();

  // The confirmation is therefore not reachable either — the guard stops it upstream,
  // which is what makes it a rule rather than a prompt.
  await expect(page.locator('.tables-warning-banner')).toHaveCount(0);
});

test('an available table can be deleted, behind its confirmation', async ({ page }) => {
  await openTables(page);

  // The inverse half: the guard must not block a table that is safe to remove.
  const free = page.locator('.tables-table--available').first();
  await expect(free, 'the seeded plan has an available table').toBeVisible({
    timeout: TIMEOUT,
  });
  await free.click();

  const del = page.locator('[data-testid="tables-delete-table-btn"]');
  await expect(del).toBeEnabled({ timeout: TIMEOUT });

  await del.click();
  const confirm = page.locator('.tables-warning-banner');
  await expect(confirm, 'a delete must be confirmed').toBeVisible({ timeout: 8_000 });

  // And it stays undeleted until the confirmation is accepted.
  await expect(free).toBeVisible({ timeout: TIMEOUT });
});
