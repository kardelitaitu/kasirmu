import { test, expect, type Page } from '@playwright/test';
import { loginAs, openRestaurantCart, selectWorkspace, WORKSPACES } from './helpers';

// WHY THIS FILE EXISTS
//
// `tables-tab-conflict-banner` and `tables-tab-takeover-btn` were carried as "needs a second
// terminal" for four rounds. Round 278 disproved that for the cart-panel twins, round 279 confirmed
// the tables screen reads the SAME `getConflict` (`:1205`), and rounds 279-280 each failed on the
// TILE FILTER rather than on the screen.
//
// THE FILTER WAS THE WHOLE PROBLEM, and it is worth naming because two rounds lost to it:
//
//   `.filter({ hasText: /Table 6(?!\d)/ })`   -> 0 matches
//   `.filter({ hasText: 'Table 6' })`          -> 1 match   (measured, same page, same moment)
//
// A tile's text is MULTI-LINE — "4p\nTable 6\n1 item\nRp ..." — and Playwright matches a `hasText`
// REGEX against that raw inner text, where `Table 6` sits between newlines. The anchored and
// lookahead forms both fail for that reason, not because the tile is missing. A plain STRING does a
// substring match and works.
//
// WHAT IT DOES: the floor plan tells staff another terminal is editing a table's tab and offers to
// take it over. Same control as the cart panel's, on the screen a host actually uses.

const TIMEOUT = 20_000;
const TABLE = '6';

async function openPosWithItem(page: Page): Promise<void> {
  await loginAs(page, 'owner', '1234');
  await selectWorkspace(page, WORKSPACES.RESTAURANT_POS);
  await expect(page.locator('.restaurant-card').first()).toBeVisible({ timeout: TIMEOUT });
  await page.locator('.restaurant-card').first().click();
  await openRestaurantCart(page);
  await expect(page.locator('[data-testid="cart-panel-line-item"]').first()).toBeVisible({
    timeout: TIMEOUT,
  });
}

/** The id of the held cart labelled `Table <no>`, read back rather than assumed. */
async function heldBillId(page: Page, no: string): Promise<string | null> {
  return page.evaluate((tableNo: string) => {
    try {
      const raw = localStorage.getItem('oz-dev-mock:held-carts');
      if (!raw) return null;
      const rows = JSON.parse(raw);
      const list: Array<{ id?: string; label?: string }> = Array.isArray(rows)
        ? rows
        : Object.values(rows ?? {});
      return list.find((r) => String(r.label ?? '') === 'Table ' + tableNo)?.id ?? null;
    } catch {
      return null;
    }
  }, no);
}

test('the floor plan warns when another terminal is editing a table tab', async ({ page }) => {
  await openPosWithItem(page);

  const table = page.locator('.pos-cart-table-input').first();
  await expect(table).toBeVisible({ timeout: TIMEOUT });
  await table.fill(TABLE);
  await page.waitForTimeout(400);

  const send = page.locator('[data-testid="pos-cart-send-kitchen-btn"]').first();
  await expect(send).toBeVisible({ timeout: TIMEOUT });
  await send.click();
  await page.waitForTimeout(3000);

  // Read the join key back: `getTableBill` matches a bill to a tile through `matchesTableBill` on
  // the LABEL, so a spec that invented an id would dispatch a lease nothing could match.
  const billId = await heldBillId(page, TABLE);
  expect(billId, 'the till must hold a bill labelled Table ' + TABLE).toBeTruthy();

  // ⚠️ RELOAD BEFORE THE FLOOR PLAN. Measured: the dispatch is asynchronous and the tiles do NOT
  // appear in the same page state (TILES_BEFORE=0 while the held cart is already stored). After a
  // reload the same session reads them — TILES_AFTER_RELOAD=12, with Table 6 showing `1 item`.
  //
  // This is the mid-transition read round 251 recorded, and the reload is what makes the case test
  // the CONFLICT rather than the store's write timing.
  await page.reload();
  await page.waitForTimeout(3000);
  await loginAs(page, 'owner', '1234');
  await selectWorkspace(page, WORKSPACES.RESTAURANT_POS);
  await page.waitForTimeout(1500);

  await page.keyboard.press('Shift+L');
  await expect(page.locator('.tables-table').first()).toBeVisible({ timeout: TIMEOUT });

  // A plain STRING, not a regex — see the header. The tile renders "6p / Table 6 / 1 item / Rp …".
  const tile = page.locator('.tables-table').filter({ hasText: 'Table ' + TABLE }).first();
  await expect(tile, 'the tile that owns the bill').toBeVisible({ timeout: TIMEOUT });
  await tile.click();

  await expect(
    page.getByText(/Active Tab/),
    'the tile owning the bill shows its tab',
  ).toBeVisible({ timeout: TIMEOUT });

  // THE LEASE, from a terminal that is not ours.
  await page.evaluate((tabId: string) => {
    window.dispatchEvent(
      new CustomEvent('kasirmu:tabs:lease-acquired', {
        detail: {
          tabId,
          terminalId: 'other-terminal',
          terminalName: 'Terminal Baru 2',
          timestamp: Date.now(),
          expiresAt: Date.now() + 60_000,
        },
      }),
    );
  }, billId!);

  const banner = page.locator('[data-testid="tables-tab-conflict-banner"]');
  await expect(
    banner,
    'another terminal editing this tab must warn the floor staff',
  ).toBeVisible({ timeout: TIMEOUT });
  await expect(banner).toContainText('Terminal Baru 2', { timeout: TIMEOUT });

  // AND THE WAY OUT.
  const takeover = page.locator('[data-testid="tables-tab-takeover-btn"]');
  await expect(takeover).toBeVisible({ timeout: TIMEOUT });
  await takeover.click();
  await expect(
    banner,
    'taking over replaces the lease, so the warning clears',
  ).toHaveCount(0, { timeout: TIMEOUT });
});