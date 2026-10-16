import { test, expect } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

/**
 * E2E: New Flows — Hard Assertions (E2E-26 through E2E-29)
 *
 * Covers flows not previously tested:
 *   E2E-26: Workspace picker (all cards visible)
 *   E2E-27: Session lock / unlock
 *   E2E-28: KDS ticket board
 *   E2E-29: Audit log screen
 *
 * CSS contract:
 *   .workspace-card         — workspace card button
 *   .workspace-card-name    — card name heading
 *   .workspace-card--disabled — disabled card
 *   .session-lock-card      — session lock card
 *   #session-lock-pin-pad   — PIN keypad inside the card
 *   .session-lock-pad-key   — PIN keypad key
 *   .kds                    — KDS screen container
 *   [role="region"][aria-label="Kitchen Display System"] — KDS region
 *   .kds-tabs               — Open/Completed tablist
 *   .kds-column-header      — per-column title + order count
 *   [data-testid="audit-log-table"] — audit log container
 */

// ── E2E-26: Workspace picker ───────────────────────────────────

test.describe('Workspace Picker', () => {
  test('all workspace cards are visible after login', async ({ page }) => {
    await loginAs(page, 'owner', '1234');

    // Workspace cards: 4 workspace cards + 1 'Add Workspace' card (admin is
    // in the Tools section, not the card grid).
    const cards = page.locator('.workspace-card');
    await expect(cards.first()).toBeVisible({ timeout: 5_000 });
    expect(await cards.count()).toBeGreaterThanOrEqual(4);

    // Verify specific workspace names are present.
    const cardNames = page.locator('.workspace-card-name');
    const allNames = await cardNames.allTextContents();
    expect(allNames.some((n) => n.includes('Store POS'))).toBe(true);
    expect(allNames.some((n) => n.includes('Kitchen Display'))).toBe(true);
    expect(allNames.some((n) => n.includes('Warehouse'))).toBe(true);

    // Admin workspace is accessed via the Tools section, not the card grid.
    const toolCards = page.locator('[data-testid="workspace-tool-card"]');
    await expect(toolCards.first()).toBeVisible({ timeout: 5_000 });

    // Click "Warehouse" and verify it navigates.
    const inventoryCard = cards.filter({ hasText: 'Warehouse' });
    await inventoryCard.click();
    await page.waitForTimeout(2_000);

    // Should navigate away from workspace picker.
    const home = page.locator('.workspace-home');
    await expect(home).not.toBeVisible({ timeout: 5_000 });
  });

  test('workspace card active-dot indicator is visible', async ({ page }) => {
    await loginAs(page, 'owner', '1234');

    // Click Store POS to activate it.
    const storeCard = page.locator('.workspace-card').filter({ hasText: 'Store POS' });
    await storeCard.click();
    await page.waitForTimeout(2_000);

    // Navigate back to workspace picker (Escape key).
    await page.keyboard.press('Escape');
    await page.waitForSelector('.workspace-home', { timeout: 10_000 });

    // The last-used workspace card should have an active dot.
    const activeCard = page.locator('.workspace-card--active');
    await expect(activeCard).toBeVisible({ timeout: 5_000 });

    const activeDot = activeCard.locator('.workspace-card-active-dot');
    await expect(activeDot).toBeVisible();
  });
});

// ── E2E-27: Session lock / unlock ─────────────────────────────

test.describe('Session Lock', () => {
  test('session lock card renders with time display', async ({ page }) => {
    // Set a 15-second idle timeout (0.25 min) before login so the
    // timer fires shortly after landing on the workspace picker.
    // Use page.addInitScript to set localStorage before the page loads,
    // avoiding SecurityError (Access is denied for this document) when
    // the page is served from a data: or file: origin during E2E.
    await page.addInitScript(() => {
      localStorage.setItem('auto-lock-minutes', '0.25');
    });

    // Login using the helper (addInitScript runs before page.goto).
    await loginAs(page, 'owner', '1234');

    // Wait for the idle timer to fire — session lock card must appear.
    const lockCard = page.locator('.session-lock-card');
    await expect(lockCard).toBeVisible({ timeout: 20_000 });

    // Verify lock card content.
    await expect(page.locator('.session-lock-time')).toBeVisible();
    await expect(page.locator('.session-lock-date')).toBeVisible();

    // The card must host the PIN pad, so it can actually be unlocked from
    // here (the pad is the card's main area — SessionLockScreen.tsx:260-270).
    const pinPad = page.locator('.session-lock-card #session-lock-pin-pad');
    await expect(pinPad).toBeVisible();
    await expect(pinPad).toHaveAttribute('aria-label', 'PIN pad');

    // Enter PIN to unlock.
    for (const digit of '1234') {
      const key = page.locator('.session-lock-pad-key').filter({ hasText: digit });
      await key.click();
      await page.waitForTimeout(80);
    }

    // Workspace home should reappear after unlock.
    await expect(page.locator('.workspace-home')).toBeVisible({ timeout: 10_000 });
  });

  // ── E2E-27b: a rejected unlock marks the PIN row ────────────────
  //
  // The test above covers the SUCCESS path only. This exercises the failure,
  // which is where the field-marking fix landed: the screen already announced
  // the error (the notice carries role=alert), but nothing marked the row the
  // user has to retry, and the shake is a CSS class a screen reader cannot
  // perceive. Runs in a real browser so the mark is proven to survive the
  // actual React commit and the transition, not just jsdom.

  test('a rejected unlock marks the PIN row invalid until the user retries', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('auto-lock-minutes', '0.25');
    });
    await loginAs(page, 'owner', '1234');

    const lockCard = page.locator('.session-lock-card');
    await expect(lockCard).toBeVisible({ timeout: 20_000 });

    const pinDots = page.locator('.session-lock-pin-dots');
    await expect(pinDots).not.toHaveAttribute('aria-invalid', 'true');

    // A wrong PIN of the same length, so the screen attempts rather than waits.
    for (const digit of '9999') {
      await page.locator('.session-lock-pad-key').filter({ hasText: digit }).click();
      await page.waitForTimeout(80);
    }

    await expect(pinDots).toHaveAttribute('aria-invalid', 'true', { timeout: 10_000 });

    // Clears as soon as the user starts retrying, so a fresh attempt is not
    // announced as already wrong.
    await page.locator('.session-lock-pad-key').filter({ hasText: '1' }).click();
    await expect(pinDots).not.toHaveAttribute('aria-invalid', 'true');
  });

});

// ── E2E-28: KDS ticket board ─────────────────────────────────

test.describe('KDS Ticket Board', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'owner', '1234');
    await selectWorkspace(page, WORKSPACES.KDS);
  });

  test('KDS screen renders with its region, tabs and order counts', async ({ page }) => {
    // Wait for KDS container.
    await page.waitForSelector('.kds', { timeout: 10_000 });

    // The board is a landmark region named after the screen
    // (Localized id="kds-screen-aria" → "Kitchen Display System").
    const region = page.getByRole('region', { name: 'Kitchen Display System' });
    await expect(region).toBeVisible();

    // The Open/Completed switcher is a tablist (id="kds-tablist-aria" →
    // "View orders"), with both tabs rendered.
    const tabs = region.getByRole('tablist', { name: 'View orders' });
    await expect(tabs).toBeVisible();
    await expect(tabs.getByRole('tab', { name: /^Open/ })).toBeVisible();
    await expect(tabs.getByRole('tab', { name: 'Completed' })).toBeVisible();

    // The board prints one column per kitchen stage; the first column is
    // Pending and carries the seeded order count ("Pending N orders" —
    // column title + kds-column-count).
    const pendingColumn = page.locator('.kds-column-header').filter({ hasText: 'Pending' });
    await expect(pendingColumn).toBeVisible({ timeout: 5_000 });
    await expect(pendingColumn).toContainText(/\d+ orders?/);

    // KDS layout controls should be present.
    await expect(page.locator('.kds-header-right')).toBeVisible();

    // No error banner (it is only rendered on a failed KDS operation).
    await expect(page.locator('.kds-error-banner')).toHaveCount(0);
  });
});

// ── E2E-29: Audit log screen ──────────────────────────────────

test.describe('Audit Log', () => {
  test.beforeEach(async ({ page }) => {
    // Stay ON THE PICKER: the tool card is the navigation, so selecting a workspace
    // here would consume the very surface this test needs. `loginAs` lands on
    // `.workspace-home`, which IS the picker.
    await loginAs(page, 'admin', '9999');
    await expect(page.getByTestId('workspace-tool-card').first()).toBeVisible({ timeout: 10_000 });
  });

  test('audit log screen renders with header and filters', async ({ page }) => {
    // Navigate to audit log THROUGH ITS TOOL CARD.
    //
    // A raw hash write cannot reach it. `audit-log` is one of the eleven TOOLS entries in
    // workspaces/tools.tsx that resolve to a `fullscreen: true` page, and
    // WorkspaceHome.handleShortcutNav (WorkspaceHome.tsx:553-565) deliberately sets a
    // workspace for fullscreen destinations ONLY -- the shell's workspace-rebind effect
    // would otherwise overwrite the route (the 2026-10-05 Staff-card defect recorded at
    // WorkspaceHome.tsx:530-552). `selectWorkspace(ADMIN)` activates the workspace via the
    // Settings card and leaves the route at `settings`, so the hash write below then landed
    // with no workspace for a non-fullscreen page and AppShell.tsx:708 returned the picker.
    //
    // Measured 2026-10-17 on the desktop project:
    //   selectWorkspace(ADMIN) + hash '#/audit-log' -> picker 1, audit-log-table 0  (WRONG)
    //   click the "Audit Log" tool card             -> audit-log-table present     (ok)
    //
    // The registered route really is 'audit-log' (features/audit/register.tsx) — that part
    // of the original comment was right; only the navigation was wrong.
    const auditCard = page.locator('[data-testid="workspace-tool-card"]').filter({ hasText: /audit/i }).first();
    await expect(auditCard, 'the picker must offer an Audit Log tool card').toBeVisible({ timeout: 10_000 });
    await auditCard.click();

    // Audit log container must be visible.
    const auditContainer = page.locator('[data-testid="audit-log-table"]');
    await expect(auditContainer).toBeVisible({ timeout: 10_000 });

    // Header must have title.
    await expect(page.locator('.audit-log-title')).toBeVisible();
    await expect(page.locator('.audit-log-title')).toContainText('Audit Log');

    // Search/filter bar must be present.
    await expect(page.locator('.audit-log-filters')).toBeVisible({ timeout: 5_000 });

    // Verify no error boundary.
    const errorBoundary = page.locator('[class*="error-boundary"]');
    const hasError = await errorBoundary.isVisible().catch(() => false);
    expect(hasError).toBe(false);
  });
});
