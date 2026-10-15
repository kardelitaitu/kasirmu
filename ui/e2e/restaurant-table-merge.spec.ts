import { test, expect, type Page } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

// WHY THIS FILE EXISTS
// Merge is the last of the table screen's tab actions, and the most demanding: it
// needs TWO tables with bills (TableManagementScreen.tsx:589 — `if (!srcBill ||
// !destBill) return`), and its candidate list is bills-only too (:572). Round 193's
// single-bill seed made Move reachable but left Merge unreachable; this file seeds a
// second bill and drives it.
//
// Why it is worth driving rather than reading:
//   * the destination list is BILLED tables only (:572) — merging onto a free table
//     would lose the bill, and merging onto an occupied-but-unbilled table would
//     silently drop the source party
//   * the handler is a three-step transaction (:616-632): delete BOTH bills, hold ONE
//     combined bill, then release the source table. A failure between the steps is
//     exactly the class the release-confirmation once was.

const TIMEOUT = 20_000;

// Two open bills, so the merge candidate list is non-empty. Registered before any
// page script runs — the dev-mock reads the held-cart slice once at module init, and
// `loginAs` navigates itself, so a later write is read by nobody (round 193).
async function seedTwoBills(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const key = 'oz-dev-mock:held-carts';
    if (localStorage.getItem(key) !== null) return;
    const bill = (n: number, total: number) => ({
      id: `held-e2e-table-${n}`,
      label: `Table ${n}`,
      cart_data: JSON.stringify({ lines: [] }),
      item_count: 1,
      total_minor: total,
      currency: 'IDR',
      created_at: '2026-01-01T10:00:00.000Z',
      bill_type: 'open_bill',
      customer_name: null,
      deduction_location_id: null,
    });
    localStorage.setItem(key, JSON.stringify([bill(1, 250000), bill(2, 150000)]));
  });
}

async function openTables(page: Page): Promise<void> {
  await seedTwoBills(page);
  await loginAs(page, 'owner', '1234');
  await selectWorkspace(page, WORKSPACES.RESTAURANT_POS);
  await expect(page.locator('.restaurant-card').first()).toBeVisible({ timeout: TIMEOUT });
  await page.keyboard.press('Shift+L');
  await expect(page.locator('[data-testid="tables-back-btn"]')).toBeVisible({
    timeout: TIMEOUT,
  });
  await expect(page.getByText(/^Table \d+$/).first()).toBeVisible({ timeout: TIMEOUT });
}

test('Merge Table offers only billed destinations', async ({ page }) => {
  await openTables(page);

  // Two tiles carry bills, so the first is a valid SOURCE and there is at least one
  // candidate destination.
  const billed = page.locator('.tables-table--has-bill');
  await expect
    .poll(() => billed.count(), {
      timeout: TIMEOUT,
      message: 'the two seeded bills must attach to tables',
    })
    .toBeGreaterThan(1);

  await billed.first().click();
  const mergeBtn = page.locator('[data-testid="tables-merge-table-btn"]');
  await expect(mergeBtn, 'Merge exists only for a table with a bill').toBeVisible({
    timeout: TIMEOUT,
  });
  await mergeBtn.click();

  const dialog = page.locator('.tables-modal-dialog');
  await expect(dialog).toBeVisible({ timeout: 8_000 });
  await expect(dialog).toContainText(/Merge Table/i);

  const select = page.locator('#tables-merge-dest-select');
  await expect(select, 'a second billed table must be offered').toBeVisible({ timeout: 5_000 });

  // Every offered destination must BE a billed table — that is what :572 filters on.
  //
  // The first draft asserted only that the option COUNT was at most the billed-tile
  // count. That SURVIVED dropping the filter, because the seeded plan offers roughly
  // as many tables as it has bills — a count check cannot see identity. Comparing the
  // option names against the billed tile names is what actually binds the rule.
  const options = (await select.locator('option').allTextContents()).map((o) => o.trim());
  expect(options.length).toBeGreaterThan(0);

  const billedNames = (
    await page.locator('.tables-table--has-bill .tables-table-name').allTextContents()
  ).map((n) => n.trim());
  expect(billedNames.length, 'the seeded plan needs billed tables').toBeGreaterThan(0);

  // ⚠️ WHAT THIS ASSERTION CANNOT PROVE, measured 2026-10-14 (round 196).
  //
  // Dropping the `Boolean(getTableBill(tbl.name))` half of the candidate filter
  // SURVIVES this case. Probing with the filter removed showed the select still
  // offering exactly ONE option (`Table 2`): the other ten tables are in different
  // SECTIONS, and `activeTableList` is section-scoped, so no unbilled table is in
  // scope to leak in. The filter and the section scope produce the same list on this
  // fixture, and no assertion can tell them apart from here.
  //
  // The billed-only rule is therefore covered by READING `:572`, not by this spec.
  // Making it observable needs a section containing BOTH a billed and an unbilled
  // table — a fixture change, recorded rather than assumed.
  //
  // Compare `Table N` tokens, never raw substrings: `Table 12` contains `Table 1`
  // (round 195's collision, and the class `matchesTableBill` guards with a boundary).
  const nameOf = (s: string) => (s.match(/^Table \d+/)?.[0] ?? s).trim();
  for (const option of options) {
    expect(
      billedNames.includes(nameOf(option)),
      `merge destination ${option} must be a BILLED table`,
    ).toBe(true);
  }

  await expect(page.locator('[data-testid="tables-merge-confirm-btn"]')).toBeEnabled({
    timeout: 5_000,
  });
});

test('merging frees the source table and leaves one combined bill', async ({ page }) => {
  await openTables(page);

  const billed = page.locator('.tables-table--has-bill');
  await expect.poll(() => billed.count(), { timeout: TIMEOUT }).toBeGreaterThan(1);
  const before = await billed.count();

  await billed.first().click();
  const sourceName = 'Table 1';
  // The tile's POSITION, captured before the merge, so the assertion cannot be
  // satisfied by a different tile that happens to match some text.
  const sourceIndex = await page
    .locator('.tables-table')
    .evaluateAll((els) => els.findIndex((e) => e.className.includes('tables-table--has-bill')));
  await page.locator('[data-testid="tables-merge-table-btn"]').click();
  await expect(page.locator('#tables-merge-dest-select')).toBeVisible({ timeout: 8_000 });
  await page.locator('[data-testid="tables-merge-confirm-btn"]').click();

  // ⚠️ THE SOURCE TILE IS ADDRESSED BY INDEX, and it has to be.
  //
  // Two earlier versions of this assertion SURVIVED the mutation of removing the
  // source release entirely (round 196):
  //   * `--available`      — wrong end state; a release sets CLEANING (`floorplan.ts:152-154`)
  //   * `--cleaning` + hasText — the seeded plan ALREADY HAS a cleaning tile and a
  //     `Table 2` whose text the filter also matched, so a DIFFERENT table satisfied it
  // The two tiles the merge touches are the billed ones, so the source is the first
  // billed tile's index, captured before the click.
  await expect
    .poll(
      async () => {
        const cls = await page.locator('.tables-table').nth(sourceIndex).getAttribute('class');
        return cls ?? '';
      },
      {
        timeout: TIMEOUT,
        message: `merging must release the source tile to cleaning (was ${sourceName})`,
      },
    )
    .toContain('tables-table--cleaning');

  // And the tile that was the source no longer carries a bill.
  expect(
    (await page.locator('.tables-table').nth(sourceIndex).getAttribute('class')) ?? '',
  ).not.toContain('tables-table--has-bill');

  await expect
    .poll(() => page.locator('.tables-table--has-bill').count(), {
      timeout: TIMEOUT,
      message: 'two bills must become one after a merge',
    })
    .toBe(before - 1);

  // The COMBINED bill carries the sum of both. This is the half that proves the merge
  // actually merged rather than deleting one bill and dropping the other: the mock's
  // slice must hold one open bill totalling 250000 + 150000.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const raw = localStorage.getItem('oz-dev-mock:held-carts');
          if (!raw) return null;
          const bills = JSON.parse(raw) as Array<{ bill_type?: string; total_minor?: number }>;
          const open = bills.filter((b) => b.bill_type === 'open_bill');
          return `${open.length}:${open.reduce((sum, b) => sum + (b.total_minor ?? 0), 0)}`;
        }),
      { timeout: TIMEOUT, message: 'one open bill holding both totals' },
    )
    .toBe('1:400000');
});