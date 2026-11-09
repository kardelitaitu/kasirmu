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
 * Navigate to a TOOL route the way the picker tool card does.
 *
 * WHY THIS EXISTS SEPARATELY FROM navigateTo. A raw hash write changes the ROUTE but
 * establishes no WORKSPACE. For a fullscreen page that is fine — AppShell renders those
 * before the workspace gate (AppShell.tsx:669, whose comment says so: "Fullscreen pages
 * render ... without requiring an active workspace").
 *
 * A NON-fullscreen tool route is gated on an active workspace at AppShell.tsx:708 and
 * falls through to the workspace PICKER when there is none. Measured 2026-10-18:
 *
 *   admin workspace + navigateTo("settings")  -> .workspace-fullscreen 1, picker 0  (ok)
 *   admin workspace + navigateTo("shifts")    -> .workspace-home-wrapper 1, picker 1 (WRONG)
 *   admin workspace + navigateTo("terminals") -> same                             (WRONG)
 *
 * settings passes only because it is registered fullscreen: true. Every other admin tool
 * — shifts, terminals, audit, memo — cannot be reached by hash navigation at all, which is
 * why shift.spec.ts waited for .shift-mgmt on a screen that never mounted.
 *
 * Clicking the actual tool card is the path a user takes AND the one that works, because
 * WorkspaceHome sets the workspace as part of the navigation. Prefer this for any tool
 * route; navigateTo stays correct for fullscreen pages and for same-workspace moves.
 */
export async function openToolCard(page: Page, label: string | RegExp): Promise<void> {
  const card = page.getByTestId('workspace-tool-card').filter({ hasText: label });
  await expect(card, `no tool card matching ${String(label)}`).toBeVisible({ timeout: 8_000 });
  await card.first().click();
}

/**
 * Navigate to an IN-WORKSPACE screen the way a user does: through the sidebar.
 *
 * WHY THIS EXISTS ALONGSIDE openToolCard. The two cover the two different kinds of
 * destination the admin surface has, and confusing them is what left 13 specs red:
 *
 *   - The picker's TOOL CARDS (openToolCard) go to standalone FULLSCREEN pages --
 *     staff, locations, terminals, shifts, memos, promotions, analytics, dashboard,
 *     audit-log, settings, topology. Every one of the eleven TOOLS entries carries a
 *     `fullscreen: true` registration, which is exactly why WorkspaceHome's
 *     handleShortcutNav deliberately does NOT set a workspace for them (see its comment
 *     at WorkspaceHome.tsx:530-552): they render before the workspace gate at
 *     AppShell.tsx:669, and forcing a workspace there would rebind the shell and
 *     overwrite the route. So the picker CANNOT be used to reach an in-workspace screen;
 *     there is no tool card for one.
 *
 *   - The SIDEBAR items (.app-nav-item) are the in-workspace navigation. They render
 *     only inside AppLayout (AppShell.tsx:806), which is reached only when an active
 *     workspace holds a NON-fullscreen page -- the warehouse (and the Settings hub),
 *     never the POS workspaces, which are fullscreen and hide the sidebar.
 *
 * The sidebar sections start COLLAPSED (`aria-expanded="false"`), so the item buttons are
 * not in the DOM until the section header is clicked. That is why a naive
 * `.app-nav-item` probe returns 0 on every path and reads as "no sidebar at all".
 * Measured 2026-10-18 on the desktop project:
 *
 *   picker -> warehouse card        -> .app-nav-item 0   (sections collapsed)
 *   ... -> click "Reports" header   -> .app-nav-item 3+  (Dashboard, Sales Report, ...)
 *   ... -> click "Tools" header     -> .app-nav-item 5   (Terminals, Audit Log, Shifts...)
 *   click .app-nav-item[aria-label="Sales Report"]  -> content .sales-report, picker 0
 *
 * Establishes the workspace first (via establishWorkspace) so the sidebar exists, then
 * expands the section that holds the item and clicks it.
 *
 * @param section Visible section header label, e.g. "Reports" or "Tools".
 * @param item    The item's aria-label, e.g. "Sales Report" or "Terminals".
 */
export async function navigateViaSidebar(
  page: Page,
  section: string,
  item: string,
): Promise<void> {
  await establishWorkspace(page);

  const header = page
    .locator('.app-sidebar-section-header')
    .filter({ hasText: section })
    .first();
  await expect(header, `no sidebar section named "${section}"`).toBeVisible({ timeout: 10_000 });

  // Sections are accordions; clicking an already-open one would close it, so only click
  // when the item we want is not already rendered.
  const itemButton = page.locator(`.app-nav-item[aria-label="${item}"]`).first();
  if ((await itemButton.count()) === 0) {
    await header.click();
  }

  await expect(itemButton, `no sidebar item labelled "${item}" in "${section}"`).toBeVisible({
    timeout: 8_000,
  });
  await itemButton.click();
}

/**
 * Put the shell into a state that renders the sidebar: an ACTIVE WORKSPACE on a
 * non-fullscreen page.
 *
 * The warehouse is the only workspace whose landing screen is not fullscreen, so it is
 * the one that reaches AppLayout (AppShell.tsx:806) on the desktop shell. No-op when a
 * sidebar is already up.
 */
export async function establishWorkspace(page: Page): Promise<void> {
  if ((await page.locator('.app-layout').count()) > 0) return;

  const card = page.locator('.workspace-card').filter({ hasText: /warehouse|gudang/i }).first();
  await expect(card, 'no warehouse workspace card on the picker').toBeVisible({ timeout: 10_000 });
  await card.click();
  await expect(page.locator('.app-layout')).toBeVisible({ timeout: 10_000 });
}

/**
 * Wait for the app to be fully loaded and ready.
 */
export async function waitForApp(page: Page): Promise<void> {
  await page.waitForSelector('#root', { timeout: 15_000 });
  await page.waitForTimeout(1_000);
}

/**
 * Ensure the restaurant cart's contents are on screen, whichever shell is rendering.
 *
 * WHY THIS IS SHARED. The restaurant POS renders the cart differently per shell:
 * desktop (landscape) puts it inline, so `[data-testid="cart-panel-line-item"]` is already
 * present; the portrait tablet puts it in a bottom SHEET behind
 * `.restaurant-floating-cart-trigger`, where the line item is not in the DOM until the
 * bar is tapped. Four specs carried their own copy of this helper and each of them hit the
 * trap on its first run — `restaurant-cart-capabilities`, `restaurant-order-lifecycle`,
 * `restaurant-payment-modal` and `restaurant-shortcuts-e2e` (2026-10-14). Consolidating it
 * means the next spec cannot rediscover it.
 *
 * Returns nothing: callers assert against the line items afterwards. Safe to call when the
 * cart is already open, and a no-op on the desktop shell.
 */
export async function openRestaurantCart(page: Page): Promise<void> {
  const lineItem = page.locator('[data-testid="cart-panel-line-item"]');
  if (await lineItem.first().isVisible().catch(() => false)) return;

  const trigger = page.locator('.restaurant-floating-cart-trigger');
  if (await trigger.isVisible().catch(() => false)) {
    await trigger.click();
    await expect(page.locator('.restaurant-cart-sheet-panel')).toBeVisible({ timeout: 5_000 });
  }
}

/**
 * Open the restaurant POS, add one product, and reveal the cart.
 *
 * The companion to `openRestaurantCart`, covering the whole setup four specs repeated:
 * login as owner, select the workspace, click the first menu tile and expose the cart.
 * `.restaurant-card` is the menu tile — NOT `.restaurant-grid-item`, which is the desktop
 * grid's own class, and the tile's accessible name ends in "Add".
 */
export async function openRestaurantPosWithItem(
  page: Page,
  role: 'owner' | 'staff' = 'owner',
): Promise<void> {
  await loginAs(page, role, '1234');
  await selectWorkspace(page, WORKSPACES.RESTAURANT_POS);

  const productCards = page.locator('.restaurant-card');
  await expect(productCards.first()).toBeVisible({ timeout: 15_000 });
  await productCards.first().click();

  await openRestaurantCart(page);
  await expect(page.locator('[data-testid="cart-panel-line-item"]').first()).toBeVisible({
    timeout: 5_000,
  });
}
/**
 * Open the restaurant POS and click ONE row in its sidebar popover.
 *
 * WHY THIS IS SHARED. Four specs walk the same route — login, select the workspace, wait for
 * the menu grid, open `.restaurant-sidebar-btn`, then click a row — and each carried its own
 * copy: `restaurant-settings-toggles` and `restaurant-cart-capabilities` (settings),
 * `restaurant-payment-rails-persist` and `mock-payment-rails-persist` (payments). The route is
 * stable, and the failure it produces when it drifts (a row that never fires) is the one
 * `restaurant-sidebar-entries.spec.ts` grades — so a single definition keeps a drift in one
 * place rather than four.
 *
 * `row` is the testid suffix: `openRestaurantSidebarRow(page, 'payments')` clicks
 * `[data-testid="restaurant-sidebar-payments"]`.
 *
 * The role is parameterised for the same reason `openRestaurantPosWithItem`'s is: these rows
 * gate on `settings:edit` (`RestaurantSidebar.tsx`, round 128), so a spec that needs one must
 * log in as a role that holds it — but a spec exercising a permission-free row should NOT be
 * silently promoted by a helper's default.
 */
export async function openRestaurantSidebarRow(
  page: Page,
  row: string,
  role: 'owner' | 'staff' = 'owner',
): Promise<void> {
  await loginAs(page, role, '1234');
  await selectWorkspace(page, WORKSPACES.RESTAURANT_POS);
  await expect(page.locator('.restaurant-card').first()).toBeVisible({ timeout: 15_000 });

  const sidebarBtn = page.locator('.restaurant-sidebar-btn');
  await expect(sidebarBtn).toBeVisible({ timeout: 15_000 });
  await sidebarBtn.click();

  const target = page.locator(`[data-testid="restaurant-sidebar-${row}"]`);
  await expect(target).toBeVisible({ timeout: 5_000 });
  await target.click();
}
/**
 * Put the portrait cart SHEET away so the product grid is clickable again.
 *
 * WHY THIS IS SHARED. In landscape the cart is inline and the grid never moves. In portrait
 * it is a bottom sheet whose backdrop is `position: fixed; inset: 0; z-index: 100`
 * (`RestaurantCartSheet.css:6-16`) — correct while open, and it intercepts every click on
 * the grid behind it. Four specs needed this and each wrote its own copy:
 * `restaurant-kitchen-dispatch-race`, `restaurant-cart-line-badges`,
 * `restaurant-cart-line-course` and `restaurant-course-firing` (2026-10-14).
 *
 * A no-op when the sheet is not present, so the desktop shell can call it unconditionally.
 *
 * NOTE the constraint it does NOT solve: dismissing the sheet UNMOUNTS the cart panel in
 * portrait, so a spec needing the grid and the cart visible at once cannot run there at all.
 * Those cases skip on tablet by design — see the specs named above.
 */
export async function dismissRestaurantCartSheet(page: Page): Promise<void> {
  const backdrop = page.locator('[data-testid="restaurant-cart-sheet-backdrop"]');
  if (await backdrop.isVisible().catch(() => false)) {
    await backdrop.click({ position: { x: 5, y: 5 } });
    await expect(backdrop).toHaveCount(0, { timeout: 8_000 });
  }
}

/**
 * Enable restaurant COURSE FIRING before the app loads.
 *
 * WHY THIS IS SHARED. The default is `false` (`restaurantSettingsModel.ts:60`) and both the
 * per-line course chip and the firing bar gate on `courseFiringEnabled !== false`
 * (`CartPanel.tsx:961`, `:1003`). Three specs must seed it: `restaurant-cart-line-course`,
 * `restaurant-course-firing` and `restaurant-settings-cards` (2026-10-14).
 *
 * `addInitScript` rather than `page.evaluate` is the mechanism, not a preference: the
 * dev-mock reads the settings slice ONCE at module init, and `loginAs` navigates itself, so
 * a write made after the first navigation is read by nobody. The init script runs on every
 * document before the bundle, which is what makes the seed visible to that first read.
 *
 * The `!== null` guard keeps a value the spec itself later changed: the seed is for a FRESH
 * profile, and a re-navigation must not undo the test's own work.
 */
export async function seedCourseFiring(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const key = 'oz-dev-mock:settings';
    if (localStorage.getItem(key) !== null) return;
    localStorage.setItem(key, JSON.stringify({ 'restaurant.course_firing': 'true' }));
  });
}
