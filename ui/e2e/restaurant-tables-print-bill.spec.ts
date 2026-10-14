import { test, expect, type Page } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

// WHY THIS FILE EXISTS
//
// `tables-print-bill-btn` is the last reachable action on the tables screen. Round 220 closed
// the edit form; this is the other detail-panel button, and it is the one an operator presses
// with a guest standing there.
//
// `handlePrintBillForTable` (`:468-502`) is well-guarded — it needs an active bill and a
// session, builds a pre-checkout receipt, prints, and reports BOTH outcomes. The failure arm is
// the one worth pinning: a print that silently does nothing leaves the operator handing a guest
// a bill that was never produced.
//
// The failure is reachable because the dev-mock carries a documented injection seam
// (`mockDispatcher.ts:100-134`, `window.__MOCK_FAIL`), re-read on every invoke so a spec can set
// it at runtime. That is what makes the error arm testable rather than unit-only.

const TIMEOUT = 20_000;

const SEEDED_BILL = {
  id: 'held-e2e-table-1',
  label: 'Table 1',
  cart_data: JSON.stringify({
    lines: [
      {
        sku: 'LATTE',
        name: 'Caffè Latte',
        qty: 2,
        unit_price: { minor_units: 45000, currency: 'IDR' },
      },
    ],
  }),
  item_count: 2,
  total_minor: 90000,
  currency: 'IDR',
  created_at: '2026-01-01T10:00:00.000Z',
  bill_type: 'open_bill',
  customer_name: null,
  deduction_location_id: null,
};

// Open the tables screen with one billed table (round 193's mechanism).
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
  await expect(page.getByText(/^Table \d+$/).first()).toBeVisible({ timeout: TIMEOUT });
}

// Open the billed table's detail panel.
async function openBilledTable(page: Page): Promise<void> {
  const billed = page.locator('.tables-table--has-bill').first();
  await expect(billed, 'the seeded bill must attach to a table').toBeVisible({ timeout: TIMEOUT });
  await billed.click();
  await expect(page.locator('.tables-detail-actions')).toBeVisible({ timeout: TIMEOUT });
}

test('Print Bill offers itself only for a table with a bill', async ({ page }) => {
  await openTables(page);

  // A FREE table has nothing to print, and the button is gated on `activeBill` (`:1140`).
  const free = page.locator('.tables-table--available').first();
  await expect(free, 'the plan has a free table').toBeVisible({ timeout: TIMEOUT });
  await free.click();
  await expect(page.locator('.tables-detail-actions')).toBeVisible({ timeout: TIMEOUT });
  await expect(
    page.locator('[data-testid="tables-print-bill-btn"]'),
    'a free table has no bill to print',
  ).toHaveCount(0);

  // And a BILLED one does — the pair is what pins the gate rather than the button.
  await page.keyboard.press('Escape');
  await openBilledTable(page);
  await expect(page.locator('[data-testid="tables-print-bill-btn"]')).toBeVisible({
    timeout: TIMEOUT,
  });
});

test('a successful print reports itself', async ({ page }) => {
  await openTables(page);
  await openBilledTable(page);

  const print = page.locator('[data-testid="tables-print-bill-btn"]');
  await print.click();

  // The confirmation is what tells the operator the bill reached the printer. Polled rather
  // than slept on — round 214 lost a toast by looking after it had faded.
  await expect(
    page.getByText(/bill.*print|printed/i).first(),
    'a print must report its outcome',
  ).toBeVisible({ timeout: 10_000 });
});

test('a FAILED print says so instead of failing silently', async ({ page }) => {
  await openTables(page);
  await openBilledTable(page);

  // Arm the documented injection seam at RUNTIME — it is re-read on every invoke
  // (`mockDispatcher.ts:115`), so no reload is needed and the table list stays loaded.
  await page.evaluate(() => {
    // ⚠️ `print_sales_receipt_scoped`, not `print_sales_receipt`. The API layer calls the
    // SCOPED variant (`api/sales.ts:985`), and the seam matches on the exact command name
    // — arming the unscoped one injected nothing and the print SUCCEEDED, which is how the
    // first version of this case failed: it looked for an error that was never raised.
    (window as unknown as { __MOCK_FAIL?: string[] }).__MOCK_FAIL = ['print_sales_receipt_scoped'];
  });

  await page.locator('[data-testid="tables-print-bill-btn"]').click();

  // THE ARM THAT MATTERS. `handlePrintBillForTable` catches and toasts (`:496-500`); a
  // silent failure would leave the operator handing a guest a bill never produced.
  await expect(
    page.getByText(/could not|failed|error/i).first(),
    'a failed print must be reported',
  ).toBeVisible({ timeout: 10_000 });
});