import { test, expect, type Page } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

// WHY THIS FILE EXISTS
//
// `WorkspaceSettingsModal.renderWorkspaceCard` built its `cardProps` WITHOUT `sessionToken`
// (`:54`), so every workspace card received `undefined`. Each card's once-per-session guard
// compares a ref seeded to `undefined` against that token:
//
//   WorkspaceKdsSettings.tsx:93        if (reloadNonce === 0 && ref.current === sessionToken) return;
//   WorkspaceInventorySettings.tsx:71  …same shape…
//
// so the guard was TRUE on the FIRST run and the effect returned before reading. Measured
// 2026-10-14 (round 237): the KDS card issued ZERO `get_setting_scoped` calls — before or after
// the modal opened. Its settings never loaded and its F4 guard could never fire.
//
// `WorkspaceRestaurantPosSettings` escaped the never-firing half only because its deps include
// `settings.receipt`, which changes as the modal mounts — and that later run is precisely the
// one whose result the StrictMode cleanup discarded (found round 234, fixed round 235). So the
// two defects were stacked: one card's read was discarded, the other's never happened.
//
// The fix threads the token through the helper. `exactOptionalPropertyTypes` forbids assigning
// `undefined` to an optional prop, so it is spread conditionally.

const TIMEOUT = 20_000;

async function openCardWithFailedRead(
  page: Page,
  ws: string,
  bannerId: string,
): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __MOCK_FAIL?: string[] }).__MOCK_FAIL = ['get_setting_scoped'];
  });
  await loginAs(page, 'owner', '1234');
  await selectWorkspace(page, ws);
  await page.waitForTimeout(2000);
  await page.keyboard.press('F10');
  await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: TIMEOUT });
  await expect(
    page.locator(`[data-testid="${bannerId}"]`),
    'the card must READ before it can report that the read failed',
  ).toBeVisible({ timeout: TIMEOUT });
}

test('the KDS card reads and reports a failed load', async ({ page }) => {
  await openCardWithFailedRead(page, WORKSPACES.KDS, 'kds-settings-load-error');

  const banner = page.locator('[data-testid="kds-settings-load-error"]');
  await expect(banner).toHaveAttribute('role', 'alert');

  // The retry exists, so the latch is escapable rather than one-way — its own comment warns
  // of exactly that failure mode.
  await expect(page.locator('[data-testid="kds-settings-load-retry-btn"]')).toBeVisible({
    timeout: TIMEOUT,
  });
});

test('the inventory card reads and reports a failed load', async ({ page }) => {
  await openCardWithFailedRead(page, WORKSPACES.INVENTORY, 'inv-settings-load-error');

  const banner = page.locator('[data-testid="inv-settings-load-error"]');
  await expect(banner).toHaveAttribute('role', 'alert');
  await expect(page.locator('[data-testid="inv-settings-load-retry-btn"]')).toBeVisible({
    timeout: TIMEOUT,
  });
});