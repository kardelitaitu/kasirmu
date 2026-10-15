import { test, expect, type Page } from '@playwright/test';
import { openRestaurantPosWithItem } from './helpers';

// WHY THIS FILE EXISTS
//
// Round 242 traced `deduction-location-badge` to the sidebar popover and found the one action
// that reveals it: `ensureCart` has exactly ONE caller (`CartPanel.tsx:1000`), the line-level
// price override. This round drives that action to completion.
//
// The override is a THREE-STEP flow (`PriceOverrideModal.tsx:52`):
//
//   price     a new amount, validated against 10x the current price (`:104-117`)
//   username  who is authorising it (`:119-125`)
//   pin       their PIN, via an on-screen pad or the keyboard (`:127-162`)
//
// Round 242's attempt clicked the override and then the sidebar, and the sidebar trigger was
// unclickable — the MODAL was on top. That is the sequencing this file resolves: finish the
// override, then open the popover.
//
// Note there are no testids in this modal; the handles are its class names, which are stable and
// were read from the source rather than guessed.

const TIMEOUT = 20_000;

/** Drive the price override to completion. Returns once the modal is gone. */
async function completeOverride(page: Page): Promise<void> {
  await page.locator('[data-testid="cart-line-override-btn"]').first().click();

  const modal = page.locator('.price-override-modal');
  await expect(modal, 'the line offers a price override').toBeVisible({ timeout: TIMEOUT });

  // Step 1 — price. Type into the field the step renders, then confirm.
  const priceInput = modal.locator('input').first();
  await expect(priceInput).toBeVisible({ timeout: TIMEOUT });
  await priceInput.fill('1');
  // The price step's Next is an `onClick` on a button (`:274`), NOT a form submit. On the
  // narrower tablet viewport the modal's close button overlays it, so address the NAMED class
  // rather than a role query — and force nothing: `force: true` would hide a real overlap.
  await modal.locator('.price-override-next-btn').click();

  // Step 2 — username.
  const userInput = modal.locator('input').first();
  await expect(userInput, 'the second step asks who authorises it').toBeVisible({ timeout: TIMEOUT });
  await userInput.fill('owner');
  // This step IS a form (`:284`), so Enter submits it through the form's own mechanism.
  await userInput.press('Enter');

  // Step 3 — PIN. The pad is present, so a digit key exists; the keyboard handler is wired to
  // the same state (`:146-162`).
  await expect(modal.locator('.price-override-pin-pad')).toBeVisible({ timeout: TIMEOUT });
  for (const d of ['1', '2', '3', '4']) {
    await modal.locator('.price-override-pin-key', { hasText: new RegExp('^' + d + '$') }).first().click();
  }
}

test('the deduction badge names the location once an override starts the cart', async ({ page }) => {
  await openRestaurantPosWithItem(page);
  await completeOverride(page);

  // Dismiss the tablet cart sheet before reaching for the sidebar: the sheet is a fixed panel
  // covering the till, and its backdrop is what the trigger sits behind. Desktop has no sheet,
  // so this is a no-op there — `count()` guards it rather than a viewport branch.
  const sheetClose = page.locator('[data-testid="restaurant-cart-sheet-close-btn"]');
  if (await sheetClose.count() > 0) {
    // The sheet's OWN close control, not its backdrop: the backdrop is <button tabindex="-1">
    // and sits UNDER the panel — correctly, since a backdrop belongs below the thing it dims —
    // so clicking it is itself intercepted. Round 242's failing attempt reached for the backdrop.
    await sheetClose.first().click();
    await expect(
      page.locator('[data-testid="restaurant-cart-sheet-panel"]'),
    ).toHaveCount(0, { timeout: TIMEOUT });
  }

  // Let the sale-scope round trip land BEFORE opening the popover — `ensureCart` sets the
  // deduction name asynchronously (`usePosCartActions.ts:96-123`).
  await page.waitForTimeout(2500);

  const trigger = page.locator('.restaurant-sidebar-btn');
  await expect(trigger).toBeVisible({ timeout: TIMEOUT });
  await trigger.first().click();

  const sidebar = page.locator('.restaurant-sidebar');
  await expect(sidebar).toBeVisible({ timeout: TIMEOUT });

  // THE BADGE. It names the location the deduction is scoped to, which is what an operator
  // needs BEFORE stock moves — which store's inventory is about to be consumed.
  await expect(
    sidebar.getByText(/Deducting/i).first(),
    'the badge must name the deduction location',
  ).toBeVisible({ timeout: TIMEOUT });
});