import { test, expect } from '@playwright/test';
import { openRestaurantPosWithItem } from './helpers';

// WHY THIS FILE EXISTS
//
// The modifiers region is the last slice of `CartLineItem`. Rounds 204, 205 and 208
// covered the status badges, the note and the course chip; what was left is the row of
// modifier chips, the button that opens the modifier editor, and the price-override
// affordance.
//
// The override gate is the interesting one because it is a PERMISSION, not a role:
//
//   canOverridePrice: hasPermission('sales:override_price', isManager)
//                                                    (`PosScreen.tsx:1765`)
//
// `CartPanel.tsx:258-269` explains why the distinction matters: the backend refuses
// `override_cart_line_price` without that permission, NOT without a manager ROLE — and
// custom roles ship, so the two can disagree in either direction. Deliberately clearing
// that permission removes the affordance whatever the role says.
//
// PROBED BEFORE WRITING ANY OF THIS (2026-10-14): all three testids are present on a
// seeded line — `ADD_MOD=1 MOD_REGION=1 OVERRIDE=1` — and pressing the modifier button
// on a product with no modifier groups reports it rather than opening an empty editor
// (`MODAL_OPEN=0`). The seeded menu carries no modifier groups, so the reporting path is
// what an operator actually meets here.

const TIMEOUT = 20_000;

test('a line offers its modifier and override affordances', async ({ page }) => {
  await openRestaurantPosWithItem(page);

  const line = page.locator('[data-testid="cart-panel-line-item"]').first();

  // The region wraps the chips AND the buttons, so it is present even with no modifiers.
  await expect(line.locator('[data-testid="cart-line-modifiers"]')).toBeVisible({
    timeout: TIMEOUT,
  });
  await expect(
    line.locator('[data-testid="cart-line-add-modifier-btn"]'),
    'a line with no modifiers offers to add them',
  ).toBeVisible({ timeout: TIMEOUT });
  await expect(
    line.locator('[data-testid="cart-line-override-btn"]'),
    'an owner holds sales:override_price, so the affordance is present',
  ).toBeVisible({ timeout: TIMEOUT });
});

test('the modifier button reports a product that has none', async ({ page }) => {
  await openRestaurantPosWithItem(page);

  const add = page.locator('[data-testid="cart-line-add-modifier-btn"]');
  await expect(add).toBeVisible({ timeout: TIMEOUT });
  await add.click();

  // The seeded menu has no modifier groups, and `handleEditModifiers` reports that
  // (`PosScreen.tsx:1483-1486`) instead of opening an editor with nothing in it. A
  // silent no-op would leave the operator tapping a dead control.
  await expect(
    page.getByText(/modifier/i).first(),
    'a product with no modifiers must say so, not open an empty editor',
  ).toBeVisible({ timeout: 8_000 });
});