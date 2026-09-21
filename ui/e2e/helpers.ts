import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Workspace type_key values used in the mock fallback workspaces
 * (see WorkspaceContext.tsx FALLBACK_WORKSPACES).
 */
export const WORKSPACES = {
  STORE_POS: 'store-pos',
  RESTAURANT_POS: 'restaurant-pos',
  KDS: 'kds',
  INVENTORY: 'warehouse',
  ADMIN: 'admin',
} as const;

/**
 * Log in as a staff member.
 *
 * Uses the dev-mock Tauri IPC which accepts:
 *   - owner   / 1234  (role: owner)
 *   - admin   / 9999  (role: admin)
 *   - manager / 1234  (role: manager)
 *   - staff   / 1234  (role: staff — checkout operations)
 *   - auditor / 1234  (role: auditor — read-only)
 */
export async function loginAs(
  page: Page,
  username: string,
  pin: string,
): Promise<void> {
  // Emulate reduced motion explicitly. The config's `use.reducedMotion` is
  // not applied to the merged per-project context (verified via diag:
  // matchMedia reports false without this call), so the workspace-card's
  // infinite descendant animations (icon pulse, active dot pulse, hover
  // sway) keep Playwright's click actionability check retrying "element is
  // not stable". This guarantees every spec runs with CSS animations
  // disabled — the standard fix for animation-induced E2E flakiness.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');

  // Wait for the login screen using data-testid. 30s, not 15s: on a cold
  // Vite dev server the first navigation triggers on-demand transform of
  // the whole module graph, and with 4 parallel workers that first paint
  // is what expired here (condition-based wait, so this is budget, not a
  // sleep). The waits below stay as-is — once the app has painted they
  // are local state transitions, not cold-start work.
  await page.getByTestId('staff-login-screen').waitFor({ timeout: 30_000 });

  // Enter username into the input with class `staff-login-input`.
  const usernameInput = page.locator('.staff-login-input').first();
  await expect(usernameInput).toBeVisible({ timeout: 5_000 });
  await usernameInput.fill(username);

  // Click the submit button to proceed to PIN step.
  const submitBtn = page.locator('.staff-login-submit-btn');
  await submitBtn.click();

  // Wait for PIN pad to appear — the `.staff-login-pad` element becomes visible.
  const pinPad = page.locator('.staff-login-pad');
  await pinPad.waitFor({ state: 'visible', timeout: 10_000 });

  // Enter PIN digits using the keypad buttons (`.staff-login-pad-key`).
  for (const digit of pin.split('')) {
    const key = page.locator('.staff-login-pad-key').filter({ hasText: digit });
    await key.click();
    // Small delay so the visual dot updates before the next digit.
    await page.waitForTimeout(100);
  }

  // After PIN entry, login processes automatically when PIN reaches max length.
  // Wait for the workspace home screen (`.workspace-home`) to appear.
  await page.waitForSelector('.workspace-home', { timeout: 15_000 });
}

/**
 * Select a workspace from the workspace picker (WorkspaceHome).
 *
 * Uses `data-testid="workspace-card"` for selector robustness.
 * Matches by the workspace display name via `.filter({ hasText })`.
 *
 * `opts.force` bypasses Playwright's actionability stability check
 * (workspace cards carry an infinite `ws-bg-shift` animation, which can
 * keep a default click retrying "element is not stable" on slower
 * targets). Use it when the test cares about the navigation result, not
 * card-interaction mechanics (e.g. the perf smoke suite).
 */
export async function selectWorkspace(
  page: Page,
  typeKey: string,
  opts?: { force?: boolean },
): Promise<void> {
  // If already inside a workspace (workspace-home is not visible), navigate
  // back to the workspace picker first by clicking the "Back to workspaces"
  // button or pressing Escape.
  const workspaceHome = page.getByTestId('workspace-home');
  const isOnPicker = await workspaceHome.isVisible({ timeout: 1_000 }).catch(() => false);
  if (!isOnPicker) {
    // Try clicking the "Back to workspaces" button first.
    const backBtn = page.locator('button[aria-label*="Back to workspaces"], button:has-text("Back to workspaces")').first();
    const backVisible = await backBtn.isVisible({ timeout: 1_000 }).catch(() => false);
    if (backVisible) {
      await backBtn.click();
    } else {
      // Press Escape as fallback to return to workspace picker.
      await page.keyboard.press('Escape');
    }
    await workspaceHome.waitFor({ timeout: 10_000 });
  }

  // The Admin workspace is intentionally excluded from the card grid
  // (WorkspaceHome.tsx filters type_key !== 'admin') and is instead
  // accessible via the Tools section at the bottom of the picker.
  // Each tool card calls handleShortcutNav(route) which sets
  // setActiveWorkspace('admin') and navigates to a hash route.
  if (typeKey === 'admin') {
    // Click the Settings tool card — it activates the admin workspace
    // and navigates to #/settings. Tests that need a different route
    // will re-navigate after selectWorkspace returns.
    const toolCard = page.getByTestId('workspace-tool-card')
      .filter({ hasText: /settings|pengaturan/i });
    await expect(toolCard).toBeVisible({ timeout: 8_000 });
    if (opts?.force) {
      await toolCard.click({ force: true });
    } else {
      await toolCard.click();
    }
    // Wait for the admin workspace to activate — the settings sidebar
    // confirms the admin workspace and route are resolved.
    await page.waitForSelector('[data-testid="settings-sidebar"], [class*="admin"]', { timeout: 10_000 }).catch(() => {});
    return;
  }

  // Map type_key to the display name used in FALLBACK_WORKSPACES.
  const workspaceNames: Record<string, string> = {
    'store-pos': 'Store POS',
    'restaurant-pos': 'Restaurant POS',
    kds: 'Kitchen Display',
    warehouse: 'Warehouse',
  };

  const name = workspaceNames[typeKey];
  if (!name) throw new Error(`Unknown workspace type_key: ${typeKey}`);

  // Find the workspace card with matching name (prefer testid).
  const card = page.getByTestId('workspace-card').filter({ hasText: name });
  await expect(card).toBeVisible({ timeout: 5_000 });

  // The card is a <button> — click it to activate the workspace.
  if (opts?.force) {
    await card.click({ force: true });
  } else {
    await card.click();
  }

  // Wait for the workspace-specific content to appear instead of a hard sleep.
  const workspaceIndicators: Record<string, string> = {
    'store-pos': '.retail-product-btn',
    'restaurant-pos': '.restaurant-card',
    kds: '.kds',
    warehouse: '.warehouse',
  };
  const indicator = workspaceIndicators[typeKey];
  if (indicator) {
    await page.waitForSelector(indicator, { timeout: 10_000 }).catch(() => {});
  } else {
    await page.waitForTimeout(1_000);
  }
}

/**
 * Navigate to a hash route.
 *
 * Pass just the route name (e.g. "dashboard", "settings") — the "#/"
 * prefix is prepended automatically. The page.evaluate sets
 * window.location.hash, and each test's toBeVisible() provides
 * its own auto-wait for DOM + visibility.
 */
export async function navigateTo(page: Page, route: string): Promise<void> {
  await page.evaluate((hash) => {
    window.location.hash = hash;
    // Re-assigning the same hash (e.g. navigating to a route twice) fires
    // no hashchange, so dispatch manually to keep AppShell's route in sync.
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }, `#/${route}`);
}

/**
 * Wait for the app to be fully loaded and ready.
 */
export async function waitForApp(page: Page): Promise<void> {
  await page.waitForSelector('#root', { timeout: 15_000 });
  await page.waitForTimeout(1_000);
}
