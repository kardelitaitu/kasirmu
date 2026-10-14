import { test, expect, type Page } from '@playwright/test';
import { openRestaurantSidebarRow } from './helpers';

// WHY THIS FILE EXISTS
//
// The THIRD F4 load-failure guard in the restaurant feature, after receipts (round 223) and
// payments (round 227). Each screen grew one independently; this is the settings screen's,
// and its comment states the property more precisely than the other two:
//
//   Shown INSTEAD of trusting the controls. The values below are the model's defaults, not
//   the merchant's, so the banner says the read failed and Retry re-runs it. Save is
//   disabled above.
//
// And the guard behind it (`:205-208`):
//
//   Refuse to present a loaded state we cannot vouch for: no values are seeded, so
//   `originalsRef` keeps its previous contents, `dirty` cannot read a false "clean", and
//   the Save button stays disabled. Seeding defaults here is precisely the F4 bug.
//
// That is three claims to check together: the banner, the DISABLED Save, and the retry that
// clears both. A screen that warned and left Save armed would write model defaults over the
// merchant's real settings — the data loss the whole pattern exists to prevent.
//
// The failing read is `get_setting_scoped` (`api/settings.ts:361`), every read of the screen
// going through it. Forced through `window.__MOCK_FAIL`, the seam rounds 221, 223, 225 and 227
// have each used.

const TIMEOUT = 20_000;

const SETTING_CMD = 'get_setting_scoped';

async function openSettingsWithFailedRead(page: Page): Promise<void> {
  await page.addInitScript((cmd) => {
    (window as unknown as { __MOCK_FAIL?: string[] }).__MOCK_FAIL = [cmd];
  }, SETTING_CMD);
  await openRestaurantSidebarRow(page, 'settings');
  await expect(page.locator('[data-testid="restaurant-settings-title"]')).toBeVisible({
    timeout: TIMEOUT,
  });
}

test('a failed settings read is shown instead of the controls being trusted', async ({
  page,
}) => {
  await openSettingsWithFailedRead(page);

  const banner = page.locator('[data-testid="restaurant-settings-load-error"]');
  await expect(banner, 'a failed read must say so').toBeVisible({ timeout: TIMEOUT });
  await expect(banner).toHaveAttribute('role', 'alert');

  // ⚠️ SAVE MUST STAY DISABLED. This is the whole point, and it is the strongest of the three
  // F4 arms: the controls below the banner render the MODEL'S DEFAULTS, so an armed Save
  // writes those defaults over the merchant's real settings. The guard at `:205-208` is what
  // keeps `dirty` from reading a false clean.
  const save = page.locator('[data-testid="restaurant-settings-save-btn"]');
  await expect(save, 'a failed read must not leave Save armed').toBeDisabled({
    timeout: TIMEOUT,
  });

  await expect(
    page.locator('[data-testid="restaurant-settings-retry-btn"]'),
    'the retry is the operator\'s way out',
  ).toBeVisible({ timeout: TIMEOUT });
});

test('Retry clears the failure once the read succeeds', async ({ page }) => {
  await openSettingsWithFailedRead(page);

  const banner = page.locator('[data-testid="restaurant-settings-load-error"]');
  await expect(banner).toBeVisible({ timeout: TIMEOUT });

  // Clear the injection BEFORE pressing Retry — the seam is re-read on every invoke
  // (`mockDispatcher.ts:115`), so no reload is needed and the screen keeps its state.
  await page.evaluate((cmd) => {
    (window as unknown as { __MOCK_FAIL?: string[] }).__MOCK_FAIL = [];
    void cmd;
  }, SETTING_CMD);

  await page.locator('[data-testid="restaurant-settings-retry-btn"]').click();

  // THE RECOVERY. `reloadNonce` reaching the effect's deps is what makes Retry work; a
  // second failure would mean the button re-runs nothing and the latch is one-way.
  await expect(banner, 'a successful retry must clear the banner').toHaveCount(0, {
    timeout: TIMEOUT,
  });

  // And the controls become usable again — the other half of the recovery. A banner that
  // cleared while Save stayed disabled would leave the screen read-only for the session.
  const save = page.locator('[data-testid="restaurant-settings-save-btn"]');
  await expect(save, 'a recovered screen still has nothing to save').toBeDisabled();
  // Through the LABEL — the raw `role=switch` input is styled out of the layout. Fifth
  // occurrence this session (rounds 148, 170, 179, 228 and here); its `id` is
  // `resto-setting-course-firing`.
  await page.locator('label[for="resto-setting-course-firing"]').first().click();
  await expect(save, 'but an edit must arm it again').toBeEnabled({ timeout: 8_000 });
});