import { test, expect, type Page } from '@playwright/test';
import { dismissRestaurantCartSheet, openRestaurantPosWithItem } from './helpers';

// WHY THIS FILE EXISTS
//
// CartLineItem carries the line-level badges and the special-request note — the two
// things the KITCHEN reads off the chit and the waiter reads off the cart. Nothing in
// e2e touched them: 15 of the component's 17 testids had no spec.
//
// The status pair is the operator's mental model for a line:
//
//   'New'  (cart-line-draft-badge)      — on the cart, NOT yet sent to the kitchen
//   'Sent' (cart-line-dispatched-badge) — the kitchen has it
//
// Shown by dispatchedQty against qty (CartLineItem.tsx:192-205), so both are exercised
// here in sequence: a fresh line is New, Send flips it to Sent, raising the quantity
// flips it BACK to New. That last transition is the one that matters — it is how the
// waiter knows there is a portion not yet cooked.

const TIMEOUT = 20_000;

// Open the POS with one line, sheet dismissed so the grid stays reachable (round 201).
async function openWithLine(page: Page): Promise<void> {
  await openRestaurantPosWithItem(page);
  await dismissRestaurantCartSheet(page);
}

test('Send makes a line Sent, and a raised qty makes it carry a remainder', async ({
  page,
}, testInfo) => {
  // Desktop only: the transitions need the grid and the cart visible at once, which the
  // portrait sheet layout does not allow (restaurant-kitchen-dispatch-race.spec.ts).
  test.skip(testInfo.project.name !== 'desktop', 'needs grid and cart visible at once');

  await openWithLine(page);

  const line = page.locator('[data-testid="cart-panel-line-item"]').first();
  const draft = line.locator('[data-testid="cart-line-draft-badge"]');
  const sent = line.locator('[data-testid="cart-line-dispatched-badge"]');

  // 1. NEVER DISPATCHED => NEITHER BADGE, and that is the code's actual rule.
  //
  // Both badges are gated on `line.dispatchedQty !== undefined`
  // (`CartLineItem.tsx:192`, `:199`), and `dispatchedQty` is only ever written by a
  // dispatch (`PosScreen.tsx:1132`) — never initialised when a line is added. So the
  // first version of this assertion ('a line that has not been sent is New') was WRONG
  // about the product, and failed for 20s against a line with no badge at all.
  //
  // Measured rather than assumed; `undefined` means 'never through a send cycle', and
  // the New badge appears only after a first send has left a remainder.
  await expect(draft, 'a never-sent line carries no status badge').toHaveCount(0);
  await expect(sent, 'a never-sent line is not Sent').toHaveCount(0);

  // 2. Send => Sent, and New is gone.
  await page.keyboard.press('Shift+K');
  await expect(sent, 'the kitchen has it now').toBeVisible({ timeout: TIMEOUT });
  await expect(draft, 'a fully sent line is not New').toHaveCount(0);

  // 3. Add one more of the same dish => that portion is NOT sent, so the line reads New
  //    again even though part of it was.
  const plus = line.locator('.pos-cart-qty-btn').last();
  await plus.click();
  await expect(draft, 'a portion not yet sent makes the line New').toBeVisible({
    timeout: TIMEOUT,
  });
  await expect(sent, 'and it is no longer fully Sent').toHaveCount(0);
});

test('a special-request note round-trips onto the line', async ({ page }, testInfo) => {
  // Desktop only, and for the same measured reason as the race spec: in portrait the
  // cart is a bottom sheet whose backdrop covers the grid, and dismissing it unmounts
  // the cart panel — so the line and its note affordance are not reachable together
  // with the grid. `openWithLine` is what dismisses the sheet.
  test.skip(testInfo.project.name !== 'desktop', 'needs grid and cart visible at once');
  await openWithLine(page);

  const line = page.locator('[data-testid="cart-panel-line-item"]').first();
  const noteBtn = line.locator('[data-testid="cart-line-note-btn"]');
  await expect(noteBtn, 'the note affordance is on every line').toBeVisible({ timeout: TIMEOUT });

  // No note yet, so nothing rendered on the line.
  await expect(line.locator('[data-testid="cart-line-note"]')).toHaveCount(0);

  await noteBtn.click();
  const input = page.locator('[data-testid="cart-line-note-input"]');
  await expect(input, 'the note editor opens').toBeVisible({ timeout: 8_000 });

  // The note the KITCHEN must read. Bahasa is the point: it is what a waiter types.
  const note = 'tidak pedas, tanpa bawang';
  await input.fill(note);
  await page.locator('[data-testid="cart-line-note-save-btn"]').click();

  // The editor closes and the note is ON the line — the round trip, not just the input.
  await expect(input).toHaveCount(0, { timeout: 8_000 });
  await expect(
    line.locator('[data-testid="cart-line-note"]'),
    'the note must render on the line the kitchen reads',
  ).toContainText(note, { timeout: TIMEOUT });
});

test('a saved note can be cleared', async ({ page }, testInfo) => {
  // Desktop only, and for the same measured reason as the race spec: in portrait the
  // cart is a bottom sheet whose backdrop covers the grid, and dismissing it unmounts
  // the cart panel — so the line and its note affordance are not reachable together
  // with the grid. `openWithLine` is what dismisses the sheet.
  test.skip(testInfo.project.name !== 'desktop', 'needs grid and cart visible at once');
  await openWithLine(page);

  const line = page.locator('[data-testid="cart-panel-line-item"]').first();
  const noteBtn = line.locator('[data-testid="cart-line-note-btn"]');
  await noteBtn.click();

  const input = page.locator('[data-testid="cart-line-note-input"]');
  await expect(input).toBeVisible({ timeout: 8_000 });
  await input.fill('pedas');
  await page.locator('[data-testid="cart-line-note-save-btn"]').click();
  await expect(line.locator('[data-testid="cart-line-note"]')).toContainText('pedas', {
    timeout: TIMEOUT,
  });

  // Clearing must remove it from the LINE, not merely from the editor.
  await noteBtn.click();
  const clear = page.locator('[data-testid="cart-line-note-clear-btn"]');
  await expect(clear, 'a note can be removed').toBeVisible({ timeout: 8_000 });
  await clear.click();

  await expect(
    line.locator('[data-testid="cart-line-note"]'),
    'clearing the note must remove it from the line',
  ).toHaveCount(0, { timeout: TIMEOUT });
});