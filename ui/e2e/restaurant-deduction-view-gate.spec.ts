import { test, expect, type Page } from '@playwright/test';
import { openRestaurantCart, openRestaurantPosWithItem } from './helpers';

// WHY THIS FILE EXISTS
//
// `deduction-location-badge` and `deduction-override-indicator` are the TWO entries in the coverage
// scan's `VIEW_GATED` list — the ids it reports as "cannot render in the scanned workspace" and
// therefore subtracts from `missing`.
//
// Round 273 proved that list CAN hide a gap: adding an open id to it removed the id from `missing`,
// changed no printed number, and still exited 0. Two guards were attempted and neither bound, so
// the list is TRUSTED rather than verified by the script.
//
// This spec verifies it instead. It asserts the exemption's own claim, in both directions:
//
//   the cart panel   the ids are ABSENT, which is why exempting them hides nothing
//   the sidebar      the control is PRESENT under its relocated form, which is where round 243
//                    covers it — so the exemption moves coverage, it does not remove it
//
// **If either half stops being true, this fails** — and that is the only thing standing between a
// trusted exemption list and another round-273-shaped gap.

const TIMEOUT = 20_000;

/** Drive the price override to completion, which starts the sale scope (round 243's route). */
async function startCartScope(page: Page): Promise<void> {
  await page.locator('[data-testid="cart-line-override-btn"]').first().click();
  const modal = page.locator('.price-override-modal');
  await expect(modal).toBeVisible({ timeout: TIMEOUT });

  const price = modal.locator('input').first();
  await price.fill('1');
  await modal.locator('.price-override-next-btn').click();

  const user = modal.locator('input').first();
  await user.fill('owner');
  await user.press('Enter');

  await expect(modal.locator('.price-override-pin-pad')).toBeVisible({ timeout: TIMEOUT });
  for (const d of ['1', '2', '3', '4']) {
    await modal.locator('.price-override-pin-key', { hasText: new RegExp('^' + d + '$') }).first().click();
  }
  await page.waitForTimeout(2500);
}

test('the exempted deduction ids really are absent from the restaurant cart', async ({ page }) => {
  await openRestaurantPosWithItem(page);
  await openRestaurantCart(page);
  await expect(page.locator('.pos-cart-line').first()).toBeVisible({ timeout: TIMEOUT });

  // BEFORE the scope exists, and AFTER it — because the exemption claims absence in BOTH states,
  // and a check run only at rest would pass on an id that appears once a location is known.
  const absent = async () => ({
    badge: await page.locator('[data-testid="deduction-location-badge"]').count(),
    override: await page.locator('[data-testid="deduction-override-indicator"]').count(),
  });
  expect(await absent(), 'a fresh cart has no deduction badge here').toEqual({ badge: 0, override: 0 });

  await startCartScope(page);
  expect(
    await absent(),
    'the scope is live and the ids STILL do not render — which is what the exemption claims',
  ).toEqual({ badge: 0, override: 0 });
});

test('the relocated control renders in the sidebar, so the exemption moves coverage', async ({
  page,
}) => {
  await openRestaurantPosWithItem(page);
  await openRestaurantCart(page);
  await expect(page.locator('.pos-cart-line').first()).toBeVisible({ timeout: TIMEOUT });
  await startCartScope(page);

  // THE OTHER HALF. If the control existed NOWHERE, exempting it would remove coverage rather
  // than move it — and this is the assertion that would catch that.
  // ⚠️ THE TABLET CART SHEET COVERS THE TRIGGER. Measured: the click times out on the tablet
  // profile because the sheet is a fixed panel over the till. Round 243's spec closes it first, and
  // this is the same step — through the sheet's OWN close control, since its backdrop sits UNDER
  // the panel and clicking that is itself intercepted (round 243's measurement).
  const sheetClose = page.locator('[data-testid="restaurant-cart-sheet-close-btn"]');
  if (await sheetClose.count() > 0) {
    await sheetClose.first().click();
    await expect(
      page.locator('[data-testid="restaurant-cart-sheet-panel"]'),
    ).toHaveCount(0, { timeout: TIMEOUT });
  }

  const trigger = page.locator('.restaurant-sidebar-btn');
  await expect(trigger).toBeVisible({ timeout: TIMEOUT });
  await trigger.first().click();

  const sidebar = page.locator('.restaurant-sidebar');
  await expect(sidebar).toBeVisible({ timeout: TIMEOUT });
  await expect(
    sidebar.getByText(/Deducting/i).first(),
    'the relocated control is what round 243 covers, and it must be here',
  ).toBeVisible({ timeout: TIMEOUT });
});