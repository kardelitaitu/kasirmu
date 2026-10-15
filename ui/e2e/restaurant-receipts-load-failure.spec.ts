import { test, expect, type Page } from '@playwright/test';
import { openRestaurantSidebarRow } from './helpers';

// WHY THIS FILE EXISTS
//
// Round 222 covered the receipts hardware diagnostics and named this as the next coherent
// step: `restaurant-receipts-load-error` and its retry, the last reachable pair on the
// screen. The retry ONLY renders inside the error state, so nothing could reach it without
// first forcing a failed read.
//
// The failure is reachable through `window.__MOCK_FAIL` (`mockDispatcher.ts:100-134`), the
// seam round 221 used — re-read on every invoke, so a spec can arm it before navigating.
// The command to fail is `get_user_preferences_scoped` (`api/settings.ts:297`), the read
// that `setLoadFailed(true)` answers (`:514-519`).
//
// THE PROPERTY WORTH PINNING is what the screen does NOT claim. The comment above
// `setLoadFailed(true)` states it: a failed read is not an answer, and leaving the screen
// looking saved over values that were never confirmed means the operator's next Save writes
// them over the real ones. The dirty indicator suppresses 'All changes saved' for exactly
// that reason (`:1470`).

const TIMEOUT = 20_000;

const PREF_CMD = 'get_user_preferences_scoped';

/** Navigate to the receipts screen with the preferences read forced to reject. */
async function openReceiptsWithFailedLoad(page: Page): Promise<void> {
  await page.addInitScript((cmd) => {
    (window as unknown as { __MOCK_FAIL?: string[] }).__MOCK_FAIL = [cmd];
  }, PREF_CMD);
  await openRestaurantSidebarRow(page, 'receipts');
  await expect(page.locator('[data-testid="restaurant-receipts-title"]')).toBeVisible({
    timeout: TIMEOUT,
  });
}

test('a failed read says so and suppresses the saved claim', async ({ page }) => {
  await openReceiptsWithFailedLoad(page);

  // The banner, announced — it is `role="alert"`, so a screen reader hears it too.
  const banner = page.locator('[data-testid="restaurant-receipts-load-error"]');
  await expect(banner, 'a failed read must be visible').toBeVisible({ timeout: TIMEOUT });
  await expect(banner).toHaveAttribute('role', 'alert');

  // ⚠️ AND IT MUST NOT SAY SAVED. The header's status indicator suppresses the saved
  // claim while `loadFailed` is set (`:1470`) — the whole point of the F4 guard. A screen
  // claiming 'All changes saved' over values it never read is the defect this prevents.
  await expect(
    page.getByText(/all changes saved/i),
    'a failed load must not claim the screen is saved',
  ).toHaveCount(0);

  // The retry is offered — without it the operator is stuck on a screen that never loaded.
  await expect(
    page.locator('[data-testid="restaurant-receipts-retry-btn"]'),
    'the operator needs a way to try again',
  ).toBeVisible({ timeout: TIMEOUT });
});

test('Retry clears the failure once the read succeeds', async ({ page }) => {
  await openReceiptsWithFailedLoad(page);

  const banner = page.locator('[data-testid="restaurant-receipts-load-error"]');
  await expect(banner).toBeVisible({ timeout: TIMEOUT });

  // Clear the injection BEFORE pressing Retry. The seam is re-read on every invoke
  // (`mockDispatcher.ts:115`), so this is all it takes — no reload, and the screen keeps
  // the state the retry is about to re-derive.
  await page.evaluate((cmd) => {
    (window as unknown as { __MOCK_FAIL?: string[] }).__MOCK_FAIL = [];
    void cmd;
  }, PREF_CMD);

  await page.locator('[data-testid="restaurant-receipts-retry-btn"]').click();

  // THE RECOVERY IS THE CLAIM. The retry clears the init guard and bumps `reloadNonce`
  // (`:1454-1457`), so the effect re-runs — and a second failure would mean the guard was
  // not cleared and the button does nothing.
  await expect(banner, 'a successful retry must clear the banner').toHaveCount(0, {
    timeout: TIMEOUT,
  });
});