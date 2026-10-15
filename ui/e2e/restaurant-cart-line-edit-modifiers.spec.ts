import { test, expect, type Page } from '@playwright/test';
import { loginAs, openRestaurantCart, openRestaurantSidebarRow } from './helpers';

// WHY THIS FILE EXISTS
//
// `cart-line-edit-modifiers-btn` is the last uncovered control on the cart line — 16 of 17. It
// is gated TWICE, and both gates are the reason nothing had reached it:
//
//   the line must ALREADY carry modifiers   `(line.modifiers?.length ?? 0) > 0` (`:328`)
//   the host must supply `onEditModifiers`   wired by `PosScreen.tsx:1760`
//
// So it is not reachable on a plain line. The route is round 210-212's, reused rather than
// re-derived: author a modifier group on a menu item, then sell that item so the customizer
// attaches a choice to the line.
//
// WHAT IT DOES is the interesting part. `:220` renders a DIFFERENT control for a line with NO
// modifiers — an `Add` — and `:328` renders this `Edit` once some exist. **A line that already
// has modifiers must be able to change them**, or the only way to correct a wrong choice is to
// remove the line and start again.

const TIMEOUT = 20_000;

const GROUP_NAME = 'Spice Level';
const OPTION_NAME = 'Extra Hot';

/** Author a modifier group on the first menu item and save. */
async function authorModifierGroup(page: Page): Promise<void> {
  await loginAs(page, 'owner', '1234');
  await openRestaurantSidebarRow(page, 'menu-editor');
  await expect(page.locator('[data-testid="restaurant-menu-editor-bulk-avail"]')).toBeVisible({
    timeout: TIMEOUT,
  });

  await page.locator('.restaurant-menu-editor-card-body').first().click();
  await expect(page.locator('.restaurant-menu-editor-form')).toBeVisible({ timeout: TIMEOUT });

  await page.locator('[data-testid="restaurant-menu-editor-add-group-btn"]').click();
  const groupName = page.locator('[data-testid="modifier-group-name-0"]');
  await expect(groupName).toBeVisible({ timeout: TIMEOUT });
  await groupName.fill(GROUP_NAME);
  await page.locator('[data-testid="modifier-option-name-0-0"]').fill(OPTION_NAME);
  await page.locator('[data-testid="modifier-option-price-0-0"]').fill('5000');
  await page.locator('[data-testid="restaurant-menu-editor-save-btn"]').click();
  await expect(page.locator('.restaurant-menu-editor-form')).toHaveCount(0, { timeout: TIMEOUT });
}

/** Add the first menu item to the cart, choosing a modifier in the customizer. */

test('a line with modifiers can edit them', async ({ page }) => {
  await authorModifierGroup(page);

  // Back to the till through the editor's OWN back control (`restaurant-menu-editor-back-btn`,
  // `:921`). Round 210's record warns the back is fragile WHILE A FORM IS OPEN — the authoring step
  // above closes it, so this is the case that works. No reload anywhere: `MOCK_PRODUCTS` is a
  // module literal and a reload would discard the group just authored.
  await page.locator('[data-testid="restaurant-menu-editor-back-btn"]').click();
  const card = page.locator('.restaurant-card').first();
  await expect(card, 'the back control returns to the till').toBeVisible({ timeout: TIMEOUT });

  await card.click();
  const modal = page.locator('.modifier-modal');
  await expect(modal, 'the item now offers its modifier groups').toBeVisible({ timeout: TIMEOUT });
  // ⚠️ The option, not the group. `[data-testid^="modifier-"]` matches `modifier-<groupId>` FIRST,
  // and clicking a group name selects nothing — which is why the line arrived without modifiers on
  // tablet. The option's own testid carries the option id, and its text is the authored name.
  await modal.getByText(/Extra Hot/).first().click();
  // Confirm is disabled until EVERY group is valid, so waiting for it is waiting for a real choice.
  const confirm = modal.locator('.modifier-confirm-btn');
  await expect(confirm).toBeEnabled({ timeout: 8_000 });
  await confirm.click();
  await expect(modal).toHaveCount(0, { timeout: TIMEOUT });

  // AND NOW THE CONTROL UNDER TEST. A line carrying modifiers offers Edit, not Add.
  // ⚠️ OPEN THE CART FIRST. Probed on the tablet profile 2026-10-15: after confirming the
  // customizer the cart is a FLOATING BAR (".restaurant-floating-cart-trigger", reading
  // "1 item Rp 50.000 View Order") and NOT an open sheet — so `.pos-cart-line` is not in the DOM
  // and the Edit control cannot be found. The item DID attach its modifier (Rp 50.000 includes the
  // `+5.000`), which is what made this look like a divergence.
  //
  // The established helper handles both profiles: it opens the sheet only when the lines are not
  // already on screen, which is why desktop kept passing unchanged.
  await openRestaurantCart(page);

  const edit = page.locator('[data-testid="cart-line-edit-modifiers-btn"]');
  // ⚠️ PROFILE-SENSITIVE, and the failure is recorded rather than papered over: this passes on
  // desktop and fails on tablet, while the CUSTOMIZER opens on both (probed: `.modifier-modal`
  // count 1 on tablet). So the divergence is in choosing or confirming an option, not in the
  // authored group reaching the till — which is why the choice below no longer relies on a testid
  // prefix that matched the GROUP element first.
  await expect(
    edit,
    'a line that already has modifiers must let them be changed',
  ).toBeVisible({ timeout: TIMEOUT });

  // The gate is real: pressing it reopens the customizer for that line, which is the behaviour
  // the button exists for — an Edit that opened nothing would pass `toBeVisible` alone.
  await edit.click();
  await expect(
    page.locator('.modifier-modal'),
    'editing a line reopens its customizer',
  ).toBeVisible({ timeout: TIMEOUT });
});