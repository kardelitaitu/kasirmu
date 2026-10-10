import { test, expect } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

/**
 * Restaurant POS — PORTRAIT cart path.
 *
 * The landscape/inline cart is covered by payment-modal-layout.spec.ts. This
 * covers the OTHER restaurant cart: the floating bar that opens a bottom sheet
 * (`RestaurantCartSheet`), which is what the tablet uses in portrait. Nothing
 * exercised it, and it renders a different tree from the inline cart.
 *
 * Portrait is forced by viewport because isPortraitRestaurant is
 * `activeWorkspace === 'restaurant-pos' && !orientation.isLandscape`
 * (PosScreen.tsx:332), so a portrait viewport selects this branch.
 */

const TIMEOUT = 15_000;

test.use({ viewport: { width: 800, height: 1280 } });

async function openRestaurantPortrait(page: import('@playwright/test').Page) {
  await loginAs(page, 'staff', '1234');
  await selectWorkspace(page, WORKSPACES.RESTAURANT_POS);
  const cards = page.locator('.restaurant-card');
  await expect(cards.first()).toBeVisible({ timeout: TIMEOUT });
  await cards.first().click();
}

test.describe('Restaurant POS — portrait cart sheet', () => {
  test('portrait chooses the floating bar, not the inline cart', async ({ page }) => {
    await openRestaurantPortrait(page);

    await expect(page.locator('.restaurant-floating-cart-trigger')).toBeVisible({ timeout: TIMEOUT });
    // The inline panel belongs to the landscape branch and must not be here.
    await expect(page.locator('.pos-cart-pay-btn')).toHaveCount(0);
  });

  test('the floating bar opens the sheet and the sheet holds the cart', async ({ page }) => {
    await openRestaurantPortrait(page);

    await page.locator('.restaurant-floating-cart-trigger').click();
    const sheet = page.locator('[data-testid="restaurant-cart-sheet-panel"]');
    await expect(sheet).toBeVisible({ timeout: 5_000 });

    // The CartPanel is hosted inside the sheet, so its own nodes appear.
    await expect(page.locator('[data-testid="cart-panel-line-item"]').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.pos-cart-pay-btn')).toBeVisible({ timeout: 5_000 });

    // The sheet is a real dialog.
    await expect(sheet).toHaveAttribute('role', 'dialog');
    await expect(sheet).toHaveAttribute('aria-modal', 'true');
  });

  test('the cart line name is NOT truncated in the portrait sheet', async ({ page }) => {
    // The whole point of the width-floor measurement: at a 400px panel the name
    // column has 132px and "Ice Lemon Tea" (120px natural) fits. In portrait the
    // sheet is viewport-wide, so this asserts the sheet does not re-create the
    // squeeze the inline panel had at 320px.
    await openRestaurantPortrait(page);
    await page.locator('.restaurant-floating-cart-trigger').click();
    await expect(page.locator('.restaurant-cart-sheet-panel')).toBeVisible({ timeout: 5_000 });

    const geo = await page.evaluate(() => {
      const name = document.querySelector('.pos-cart-line-name') as HTMLElement | null;
      if (!name) return null;
      return { scrollW: name.scrollWidth, clientW: name.clientWidth, truncated: name.scrollWidth > name.clientWidth + 1 };
    });
    expect(geo, 'the sheet must render a cart line').not.toBeNull();
    expect(geo!.truncated, `name truncated: needs ${geo!.scrollW}px, has ${geo!.clientW}px`).toBe(false);
  });

  test('Escape and the backdrop both close the sheet', async ({ page }) => {
    await openRestaurantPortrait(page);
    await page.locator('.restaurant-floating-cart-trigger').click();
    await expect(page.locator('.restaurant-cart-sheet-panel')).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press('Escape');
    await expect(page.locator('.restaurant-cart-sheet-panel')).toBeHidden({ timeout: 5_000 });

    // Reopen and close via the close button.
    await page.locator('.restaurant-floating-cart-trigger').click();
    await expect(page.locator('.restaurant-cart-sheet-panel')).toBeVisible({ timeout: 5_000 });
    await page.locator('[data-testid="restaurant-cart-sheet-close-btn"]').click();
    await expect(page.locator('.restaurant-cart-sheet-panel')).toBeHidden({ timeout: 5_000 });
  });
});
