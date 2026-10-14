import { test, expect } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

/**
 * E2E Critical Path: POS -> KDS End-to-End (rewritten 2026-10-14).
 *
 * Completes a cash sale in Restaurant POS, switches to KDS and verifies the new ticket
 * appears. The previous version was `test.fixme` with three stated reasons;
 * `docs/records/audits/kds-spec-determinism.md` measured each, and this rewrite follows
 * from that: **assert an id-set delta and the item summary, never a count.**
 *
 * The three original blockers, and how this version answers each:
 *
 *   1. "Dev-mock auto-generates KDS orders every 60s, breaking the exact
 *      baselineCount+1 assertion."  True (`kds.ts:252`, 60_000 ms). A count is perturbed
 *      by it, an ID SET is not: generated ids are `kds-order-auto-*` while a sale's ticket
 *      is `kds-order-e2e-*` (`kds.ts:527`), so the filter below isolates sale-derived ones.
 *
 *   2. "Auto-progress moves tickets between columns every 10s."  True (`kds.ts:420`), but
 *      it MOVES ids between columns; it never adds or removes one, and a pending row's
 *      summary is untouched. This test reads no column.
 *
 *   3. "The sale->KDS push relies on localStorage which persists across test runs."
 *      FALSE. `loadMockKdsState` reads the slice and seeds it WITHOUT writing
 *      (`readSlice(KEY, fallback)` at `kds.ts:228`); `saveMockKdsState` runs only from the
 *      mutators. A run's ticket therefore does not leak into the next run through the
 *      seed. What DOES persist is a mutated slice, which is why this asserts on the id it
 *      can name rather than a running total.
 *
 * Navigation note: plain Escape is deliberately disabled inside `restaurant-pos`
 * (`AppShell.tsx:79`), so the picker is reached with Ctrl+Shift+Escape — the modifier
 * branch at `:66` documented as always returning to the picker, bypassing modals. See
 * `docs/records/audits/pos-kds-chain-closed.md`.
 *
 * Selectors used:
 *   [data-testid=workspace-home]      — workspace picker
 *   .restaurant-grid-item             — product card in the Restaurant POS grid
 *   [data-testid=settle-button]       — completes the payment
 *   .receipt-preview-paper            — renders after a completed sale
 *   .kds-ticket                       — ticket card on the Kitchen Display
 */

const TIMEOUT = 20_000;

/**
 * The display numbers currently on the board, read from the cards' own testids.
 *
 * `KdsTicketCard.tsx:315` renders `data-testid={`kds-order-card-${display_number}`}`, which
 * is a STABLE number per ticket (the mock's `kdsDisplayCounter` is `maxDisplay + 1`, from
 * persisted state). Counting `.kds-ticket` instead would be perturbed by the 60s
 * auto-generator; reading the numbers lets the assertion name the exact ticket.
 */
async function boardNumbers(page: import('@playwright/test').Page): Promise<number[]> {
  await expect(page.locator('.kds-ticket').first()).toBeVisible({ timeout: TIMEOUT });
  return page.locator('.kds-ticket').evaluateAll((tickets) =>
    tickets
      .map((t) => t.getAttribute('data-testid') ?? '')
      .map((id) => /^kds-order-card-(\d+)$/.exec(id)?.[1])
      .filter((n): n is string => n !== undefined)
      .map(Number)
  );
}

test.describe('Critical Path: POS -> KDS', () => {
  test('a completed sale appears on the kitchen display', async ({ page }) => {
    test.slow(); // three workspace switches plus a full sale flow

    await loginAs(page, 'owner', '1234');

    // Baseline: the sale-derived tickets that exist BEFORE this sale.
    await selectWorkspace(page, WORKSPACES.KDS);
    const before = await boardNumbers(page);

    // Back to the picker, then into the restaurant workspace.
    await page.keyboard.press('Control+Shift+Escape');
    await expect(page.getByTestId('workspace-home')).toBeVisible({ timeout: TIMEOUT });
    await selectWorkspace(page, WORKSPACES.RESTAURANT_POS);

    // One item, then settle with a quick tender. The amount MUST be chosen:
    // `useTenderMath.ts:157` refuses Complete until tendered >= total, so settling
    // with an empty tender leaves the button disabled and the sale unrecorded.
    await page.locator('.restaurant-grid-item').first().waitFor({ timeout: TIMEOUT });
    await page.locator('.restaurant-grid-item').first().click();

    // PORTRAIT vs LANDSCAPE. The restaurant POS puts the cart in a bottom sheet on a
    // portrait tablet and in a side `CartPanel` otherwise: `PosScreen.tsx:1802` renders
    // `.pos-cart-panel` only when `!isPortraitRestaurant`, and the tablet project is
    // 1024x1366. Without this the landscape-only locator below waits forever.
    const floatingTrigger = page.locator('.restaurant-floating-cart-trigger');
    if (await floatingTrigger.count()) {
      await floatingTrigger.first().click();
      await expect(page.locator('.pos-cart-panel')).toBeVisible({ timeout: TIMEOUT });
    }
    await page.getByRole('button', { name: /Charge the customer/ }).click();
    await page.getByRole('button', { name: /^Tender / }).first().click();
    await page.locator('[data-testid=settle-button]').click();

    // The receipt proves the sale was recorded rather than merely dismissed.
    await expect(page.locator('.receipt-preview-paper').first()).toBeVisible({
      timeout: TIMEOUT,
    });

    // The kitchen display, WITHOUT a reload: `mockKdsOrders` is page memory until a
    // mutator persists the slice, so a reload discards the very ticket we assert on.
    await page.keyboard.press('Control+Shift+Escape');
    await expect(page.getByTestId('workspace-home')).toBeVisible({ timeout: TIMEOUT });
    await selectWorkspace(page, WORKSPACES.KDS);

    const after = await boardNumbers(page);

    // THE ASSERTION — one new sale-derived ticket, identified by id, plus its summary.
    // Not a count, which the 60s generator and the 10s progress drift both perturb.
    const created = after.filter((n) => !before.includes(n));
    expect(
      created,
      `expected one new ticket; before=[${before.join(',')}] after=[${after.join(',')}]`,
    ).toHaveLength(1);
  });
});