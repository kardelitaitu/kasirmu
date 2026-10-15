import { test, expect, type Page } from '@playwright/test';
import { loginAs, openRestaurantSidebarRow } from './helpers';

// WHY THIS FILE EXISTS
//
// Round 210 found that the dev-mock's `updateMockProduct` silently dropped `notes` — and
// that modifier GROUPS live in `notes` as JSON (`serializeDraftModifierGroups`,
// `menuEditorLogic.ts:257`), so the editor's whole Modifier Groups builder was a no-op.
// It fixed the mock and pinned it with a unit test, but could not land the end-to-end
// spec: its two halves needed one page load, and getting from the menu editor back to
// the till without a reload proved fragile.

// This is that spec, and round 211 measured the navigation question instead of guessing.
// The editor's back button DOES return to the till in one click (`RESTAURANT_CARD=27`,
// `WORKSPACE_HOME=0`), but only when no item form is open — the form swallows the first
// click. A spec that edits an item therefore cannot rely on it.

// The round-trip that matters here needs no navigation at all: save closes the form, and
// reopening the SAME item in the SAME page load is enough to prove the write survived.
// That is the whole claim — `MOCK_PRODUCTS` is in-memory, so what a reload would test is
// persistence the mock never had, not the bug that was fixed.

const TIMEOUT = 20_000;

const GROUP_NAME = 'Spice Level';
const OPTION_NAME = 'Extra Hot';

/** Author a modifier group on the first menu item, save, and reopen it. */
async function authorAndReopen(page: Page): Promise<void> {
  await loginAs(page, 'owner', '1234');
  await openRestaurantSidebarRow(page, 'menu-editor');
  await expect(page.locator('[data-testid="restaurant-menu-editor-bulk-avail"]')).toBeVisible({
    timeout: TIMEOUT,
  });

  await page.locator('.restaurant-menu-editor-card-body').first().click();
  await expect(page.locator('.restaurant-menu-editor-form')).toBeVisible({ timeout: 8_000 });

  await page.locator('[data-testid="restaurant-menu-editor-add-group-btn"]').click();
  const groupName = page.locator('[data-testid="modifier-group-name-0"]');
  await expect(groupName).toBeVisible({ timeout: 8_000 });
  await groupName.fill(GROUP_NAME);
  await page.locator('[data-testid="modifier-option-name-0-0"]').fill(OPTION_NAME);
  await page.locator('[data-testid="modifier-option-price-0-0"]').fill('5000');

  // Save closes the form; the write goes to the in-memory mock.
  const save = page.locator('[data-testid="restaurant-menu-editor-save-btn"]');
  await expect(save, 'defining a group must arm Save').toBeEnabled({ timeout: 8_000 });
  await save.click();

  // ⚠️ WAIT FOR THE FORM TO CLOSE, not for Save to go disabled. `handleSaveDraft` awaits
  // `reloadData()` and only THEN calls `setDraft(null)` (`:688-690`), so the button is
  // disabled while the form is still up — and clicking a card at that moment lands on the
  // open form instead of opening the item. Measured 2026-10-14: an 1800ms sleep passed
  // where `toBeDisabled()` failed, which is the tell for a race rather than a missing
  // element.
  await expect(page.locator('.restaurant-menu-editor-form')).toHaveCount(0, {
    timeout: TIMEOUT,
  });

  // Reopen the SAME item, still in this page load — no reload, no navigation.
  await page.locator('.restaurant-menu-editor-card-body').first().click();
  await expect(page.locator('.restaurant-menu-editor-form')).toBeVisible({ timeout: 8_000 });
}

test('a modifier group authored in the editor survives its own save', async ({ page }) => {
  await authorAndReopen(page);

  // THE REGRESSION. Before round 210's fix this was 0: the mock accepted the payload,
  // reported success, and discarded `notes` — so the group and its option were gone.
  const groupName = page.locator('[data-testid="modifier-group-name-0"]');
  await expect(groupName, 'the saved group must come back').toBeVisible({ timeout: TIMEOUT });
  await expect(groupName).toHaveValue(GROUP_NAME);

  // And its OPTION, with the price — the group alone would pass on a half-written payload.
  await expect(page.locator('[data-testid="modifier-option-name-0-0"]')).toHaveValue(
    OPTION_NAME,
  );
  await expect(page.locator('[data-testid="modifier-option-price-0-0"]')).toHaveValue('5000');
});

test('a saved group can be removed again', async ({ page }) => {
  await authorAndReopen(page);

  const group = page.locator('[data-testid="modifier-group-0"]');
  await expect(group, 'the group must be there to remove').toBeVisible({ timeout: TIMEOUT });

  await page.locator('[data-testid="modifier-group-remove-0"]').click();
  await expect(group, 'removing a group takes it off the form').toHaveCount(0, {
    timeout: 8_000,
  });

  // And the removal survives a save — otherwise the way back is cosmetic.
  const save = page.locator('[data-testid="restaurant-menu-editor-save-btn"]');
  await expect(save).toBeEnabled({ timeout: 8_000 });
  await save.click();
  // Form closes only after the reload — see the note in the first case.
  await expect(page.locator('.restaurant-menu-editor-form')).toHaveCount(0, {
    timeout: TIMEOUT,
  });

  await page.locator('.restaurant-menu-editor-card-body').first().click();
  await expect(page.locator('.restaurant-menu-editor-form')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('[data-testid="modifier-group-0"]')).toHaveCount(0, {
    timeout: 8_000,
  });
});

test('the till offers the authored group when the item is sold', async ({ page }, testInfo) => {
  // Desktop only: the cart line lands in the portrait SHEET, whose backdrop covers the
  // till tile this case taps next — round 201's constraint, recorded in five specs now.
  test.skip(testInfo.project.name !== 'desktop', 'needs the till tile and cart visible at once');
  await authorAndReopen(page);

  // ⚠️ CLOSE THE FORM FIRST. `authorAndReopen` ends with the item form OPEN, and round 211
  // measured that an open form swallows the back button's click — the first press exits the
  // form, the second leaves the screen. Reopening then closing is the cheapest way to get to
  // the state the one-click back button needs.
  await page.locator('.restaurant-menu-editor-form-actions button').filter({ hasText: /cancel/i })
    .first()
    .click();
  await expect(page.locator('.restaurant-menu-editor-form')).toHaveCount(0, { timeout: 8_000 });

  // Leave the editor WITHOUT a reload. With no form open the back button returns to the till
  // in one click — measured (`RESTAURANT_CARD=27`).
  await page.locator('[data-testid="restaurant-menu-editor-back-btn"]').click();
  await expect(page.locator('.restaurant-card').first()).toBeVisible({ timeout: TIMEOUT });

  // THE LINK THIS CASE ADDS: a product WITH groups must open the customizer instead of
  // adding straight to the cart (`RestaurantMenu.tsx:255-262`). Tapping the first tile and
  // getting a line in the cart would mean the group the operator just authored was ignored.
  await page.locator('.restaurant-card').first().click();

  const modal = page.locator('.modifier-modal');
  await expect(
    modal,
    'an item with modifiers must ask for them rather than adding directly',
  ).toBeVisible({ timeout: TIMEOUT });

  // And it names the group the operator authored — the round trip closes here.
  await expect(modal.locator('.modifier-group-name').first()).toHaveText(GROUP_NAME);

  // Pick the option, then confirm. The confirm is DISABLED until the group is satisfied,
  // so its arming is the proof the tap registered.
  const option = modal.locator('[data-testid^="modifier-"]').first();
  await expect(option).toBeVisible({ timeout: 8_000 });
  await option.click();

  const confirm = modal.locator('.modifier-confirm-btn');
  await expect(confirm, 'choosing an option arms Add to Order').toBeEnabled({ timeout: 8_000 });
  await confirm.click();

  // The item lands in the cart WITH the modifier — the modals close and the line carries
  // the group. A cart line without it would mean the selection was dropped on the way.
  await expect(modal).toHaveCount(0, { timeout: TIMEOUT });
  await expect(
    page.locator('[data-testid="cart-line-modifiers"]').first(),
    'the sold line must carry the modifier that was chosen',
  ).toBeVisible({ timeout: TIMEOUT });
});
