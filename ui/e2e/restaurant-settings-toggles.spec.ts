import { test, expect, type Page } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

/**
 * E2E: Restaurant POS — the Settings screen reached from the POS sidebar.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Round 136 drove this screen by hand and found all thirteen toggles rendering with the
 * right state, plus the F6 write-through working in both directions. None of it was
 * pinned. The screen is the one place an operator configures what the till DOES —
 * `restaurant.course_firing`, `restaurant.dispatch_on_tab_save`, the interaction pair —
 * so a toggle that stops hydrating is a silent configuration loss.
 *
 * WHAT IS ASSERTED, AND WHY EACH
 * ------------------------------
 *   * every toggle is present and reports its state. A missing one means the card that
 *     holds it stopped rendering; `restaurant-settings-load-error` is checked absent so a
 *     failed load cannot look like a pass.
 *   * Course Firing defaults OFF. `restaurantSettingsModel.ts` resolves an unset key to
 *     `false` (round 105 measured this), so a change to the default is visible here.
 *   * Save persists, and `pos.interaction_sound` FOLLOWS the toggle. That pair is F6:
 *     the DB key syncs across devices while the runtime reads localStorage, so the screen
 *     mirrors one to the other on BOTH the load and save paths. The mirror is the only
 *     thing standing between a saved preference and a device that ignores it.
 *
 * HOW IT ENTERS
 * -------------
 * The restaurant sidebar's Settings row, not a route: `restaurant-sidebar-settings`.
 * Round 141 established that plain Escape is disabled inside `restaurant-pos`
 * (`AppShell.tsx:79`), so nothing here navigates away by keyboard.
 *
 * Selectors:
 *   `.restaurant-sidebar-btn`              — opens the sidebar popover
 *   [data-testid=restaurant-sidebar-settings]
 *   [data-testid=restaurant-settings-save-btn]
 *   [data-testid=setting-toggle-*]         — one per setting, 13 in total
 */

const TIMEOUT = 15_000;

/** All thirteen toggle testids the screen renders. */
const TOGGLES = [
  'customer-name',
  'guest-count',
  'order-type',
  'save-tab',
  'course-firing',
  'print-bill-action',
  'table-transfer',
  'dispatch-on-tab-save',
  'split-bill-by-item',
  'auto-print-kitchen',
  'sound-chime',
  'interaction-sound',
  'interaction-vibration',
] as const;


/** Log in, open the restaurant POS, and enter Settings from its sidebar. */
async function openRestaurantSettings(page: Page) {
  // OWNER, not staff. Round 148: `staff` holds only
  // `sales:process, sales:void, reports:view`, and the Settings row gates on
  // `settings:edit` — so for that role the row renders DISABLED and this
  // navigation could never complete. `loginAs` leaves the browser on the workspace
  // picker, so ONE selectWorkspace is all that is needed; a second call after the
  // POS is open tries to leave and come back.
  await loginAs(page, 'owner', '1234');
  await selectWorkspace(page, WORKSPACES.RESTAURANT_POS);

  const sidebarBtn = page.locator('.restaurant-sidebar-btn');
  await expect(sidebarBtn).toBeVisible({ timeout: TIMEOUT });
  await sidebarBtn.click();

  const settingsRow = page.locator('[data-testid="restaurant-sidebar-settings"]');
  await expect(settingsRow).toBeVisible({ timeout: 5_000 });
  await settingsRow.click();
}

test.describe('Restaurant POS — settings toggles', () => {
  test('every toggle renders and no load error is shown', async ({ page }) => {
    await openRestaurantSettings(page);

    // The header confirms the screen mounted, and the load-error card must be ABSENT:
    // `RestaurantSettingsScreen.tsx:540` renders it when the settings read fails, which
    // would otherwise leave every toggle at its default and look like a healthy screen.
    await expect(page.locator('[data-testid="restaurant-settings-header"]')).toBeVisible({
      timeout: TIMEOUT,
    });
    await expect(page.locator('[data-testid="restaurant-settings-load-error"]')).toHaveCount(0);

    for (const name of TOGGLES) {
      const toggle = page.locator(`[data-testid="setting-toggle-${name}"]`);
      // The testid sits on the RAW `input`, which `.settings-toggle` styles out (the
      // visible control is `settings-toggle-slider`, an aria-hidden span). So `visible`
      // is the wrong predicate: `toBeAttached` IS the right one, and `aria-checked` is
      // what carries the state — `role=switch` (`RestaurantSettingsScreen.tsx:103-116`).
      await expect(toggle, `toggle ${name} should attach`).toBeAttached();
      await expect(toggle).toHaveAttribute('aria-checked', /true|false/);
    }
  });

  test('Course Firing is off by default, because an unset key resolves to false', async ({
    page,
  }) => {
    await openRestaurantSettings(page);

    // `restaurantSettingsModel.ts` gives every toggle an explicit fallback; measured in
    // round 105, Course Firing's is `false` (the feature gates kitchen coursing, which a
    // store must opt into). A drift here turns coursing ON for every new store.
    await expect(page.locator('[data-testid="setting-toggle-course-firing"]')).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  test('saving mirrors the interaction sound preference to the runtime key', async ({ page }) => {
    await openRestaurantSettings(page);
    await expect(page.locator('[data-testid="restaurant-settings-header"]')).toBeVisible({
      timeout: TIMEOUT,
    });

    const toggle = page.locator('[data-testid="setting-toggle-interaction-sound"]');
    const before = await toggle.getAttribute('aria-checked');
    const expected = before === 'true' ? 'false' : 'true';
    // Click the switch LABEL, not the styled-out input. TWO labels point at this
    // input's id — the row's text label and `.settings-toggle-switch`
    // (`RestaurantSettingsScreen.tsx:79` and `:104`) — so the class is what
    // disambiguates.
    await page
      .locator('label.settings-toggle-switch[for="resto-setting-interaction-sound"]')
      .click();
    await expect(toggle).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true');

    await page.locator('[data-testid="restaurant-settings-save-btn"]').click();

    // F6: the runtime reads `pos.interaction_sound`, not the DB key, so the mirror is the
    // only thing that makes the saved preference audible. `utils/interaction.ts:35` owns
    // the name.
    //
    // THE ASSERTION DEMANDS BOTH HALVES. The first draft accepted
    // `db !== null || runtime !== null` — and a kill-test that removed the save-path
    // mirror (`RestaurantSettingsScreen.tsx:358`) still passed, because the DB write
    // alone satisfied it. That is the same shape as rounds 114 and 115: a surviving
    // mutation means the assertion is too weak, not that the behaviour is fine. So:
    // the DB key must hold the new value AND the mirror must agree with it.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const raw = localStorage.getItem('oz-dev-mock:settings');
            const saved = raw ? (JSON.parse(raw) as Record<string, string>) : {};
            return {
              db: saved['restaurant.interaction_sound'] ?? null,
              runtime: localStorage.getItem('pos.interaction_sound'),
            };
          }),
        { timeout: 10_000, message: 'the save should write the DB key AND its mirror' },
      )
      .toEqual({ db: expected, runtime: expected });
});
  });
