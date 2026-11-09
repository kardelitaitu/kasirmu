import { test, expect, type Page } from '@playwright/test';
import { loginAs, openRestaurantCart, selectWorkspace, WORKSPACES } from './helpers';

// WHY THIS FILE EXISTS
//
// `pos-cart-conflict-alert` and `pos-cart-conflict-takeover-btn` were recorded as blocked in four
// consecutive rounds (256, 258, 262, 263) as "needs a second terminal".
//
// THE BLOCKER WAS SOFT. The lease is not hardware state — it is a module-level object
// (`useTabLeases.ts:26`) whose only external write path is a documented DOM event (`:141`):
// `kasirmu:tabs:lease-acquired`. Round 277 measured that one dispatch of that event takes effect in
// a SINGLE browser (LISTENER_HITS=1), so a spec can stand in for the second terminal exactly.
//
// `getConflict`'s `lease.terminalId !== currentTerminalId` guard (`:199`) is therefore satisfied BY
// CONSTRUCTION: the spec chooses a terminalId that is not ours.
//
// WHAT IT DOES: stops an operator overwriting a tab another terminal is mid-way through. That is
// the whole point of a lease, and a warning nobody could reach is a warning nobody could verify.

const TIMEOUT = 20_000;

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

/** Claim a lease for `tabId` from a terminal that is not this one. */
async function leaseFromOtherTerminal(page: Page, tabId: string): Promise<void> {
  await page.evaluate((id: string) => {
    window.dispatchEvent(
      new CustomEvent('kasirmu:tabs:lease-acquired', {
        detail: {
          tabId: id,
          terminalId: 'other-terminal',
          terminalName: 'Terminal Baru 2',
          timestamp: Date.now(),
          expiresAt: Date.now() + 60_000,
        },
      }),
    );
  }, tabId);
}

test('a lease from another terminal warns before the tab is taken over', async ({ page }) => {
  await openPosWithItem(page);

  // STAGE 1: a table number, because the kitchen-dispatch button is gated on it
  // (`CartActionBar.tsx:210`) and the dispatch is what sets `activeOpenBillId`.
  const table = page.locator('.pos-cart-table-input').first();
  await expect(table).toBeVisible({ timeout: TIMEOUT });
  await table.fill('7');

  // STAGE 2: send to kitchen, which holds the cart and sets `activeOpenBillId` (`PosScreen.tsx:1160`).
  const send = page.locator('[data-testid="pos-cart-send-kitchen-btn"]').first();
  await expect(
    send,
    'a table number is what reveals the dispatch control',
  ).toBeVisible({ timeout: TIMEOUT });
  await send.click();
  await page.waitForTimeout(2500);

  // The held cart's id is the join key the lease must match — read it rather than inventing one,
  // since a lease against an id nothing uses would fire the event while exercising no branch.
  const heldId = await page.evaluate(() => {
    try {
      const raw = localStorage.getItem('oz-dev-mock:held-carts');
      if (!raw) return null;
      const rows = JSON.parse(raw);
      const list: Array<{ id?: string }> = Array.isArray(rows) ? rows : Object.values(rows ?? {});
      return list.length ? (list[list.length - 1]?.id ?? null) : null;
    } catch {
      return null;
    }
  });
  expect(heldId, 'the dispatch must have held a cart to lease').toBeTruthy();

  await leaseFromOtherTerminal(page, heldId!);

  // AND THE WARNING APPEARS, naming the other terminal — which is the information the operator
  // needs in order to act on it.
  const alert = page.locator('[data-testid="pos-cart-conflict-alert"]');
  await expect(
    alert,
    'another terminal holding this tab must warn the operator',
  ).toBeVisible({ timeout: TIMEOUT });
  await expect(alert).toContainText('Terminal Baru 2', { timeout: TIMEOUT });

  // AND THE WAY OUT. Take Over calls `forceTakeover` -> `claimLease`, and the spec's lease is then
  // held by THIS terminal, so `getConflict` returns null and the alert clears.
  const takeover = page.locator('[data-testid="pos-cart-conflict-takeover-btn"]');
  await expect(takeover).toBeVisible({ timeout: TIMEOUT });
  await takeover.click();
  await expect(
    alert,
    'taking over replaces the other terminal lease, so the warning clears',
  ).toHaveCount(0, { timeout: TIMEOUT });
});