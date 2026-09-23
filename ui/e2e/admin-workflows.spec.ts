import { test, expect, type Page } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

/**
 * E2E: Admin Workflows — Settings Sidebar Screens
 *
 * Tests the settings sidebar screens accessible from the Admin workspace.
 *
 * RETARGETED (settings IA flatten): the hub is now a flat 14-page list
 * (SettingsNavTree.NAV_ITEMS). The old categories — Appearance, Receipt,
 * About, Cloud Sync, Email, Store POS, Restaurant POS, Inventory,
 * Diagnostics, Topology, Local API — no longer exist. The real labels are:
 *   General, License & Subscription, Devices & Connectivity,
 *   Business Defaults, Features & Modules, Security & Account, Data Sync,
 *   Data Management, Sync Status, Sync Conflicts, Offline Queue,
 *   Tax Configuration, Exchange Rates, System Diagnostics.
 *
 * CSS contract per screen (verified against the live DOM):
 *   .settings-screen-placeholder-title — the screen <h1> (every screen)
 *   .settings-section-title            — a card heading inside a screen
 *   [data-testid="diagnostics-version"] — deployment version row
 *   .settings-footer-theme-toggle      — the surviving appearance control
 *
 * Navigation: every nav item is always visible — click `.settings-nav-item`
 * with its label directly, no category expansion step.
 */

const SIDEBAR_TIMEOUT = 10_000;
const SCREEN_TIMEOUT = 8_000;

/** The screen <h1> every settings screen renders. */
function screenTitle(page: Page) {
  return page.locator('.settings-screen-placeholder-title');
}

async function navigateToSettings(page: Page) {
  // If already on settings (from selectWorkspace's tool card click), skip.
  const alreadyOnSettings = await page.locator('[data-testid="settings-sidebar"]').isVisible({ timeout: 1_000 }).catch(() => false);
  if (alreadyOnSettings) return;

  await page.evaluate(() => {
    window.location.hash = '#/settings';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  await page.waitForSelector('[data-testid="settings-sidebar"]', { timeout: SIDEBAR_TIMEOUT });
}

/**
 * Click a sidebar page and wait for its screen heading.
 *
 * Condition-based on the heading the click must produce — the old helper
 * slept 500ms after the click, which both violated the "no magic sleeps"
 * rule and raced the lazy screen chunk on a cold Vite server.
 */
async function clickSidebarNav(page: Page, sectionName: string) {
  const nav = page.locator('.settings-nav-item').filter({ hasText: sectionName });
  await expect(nav).toBeVisible({ timeout: 5_000 });
  await nav.click();
  await expect(screenTitle(page).filter({ hasText: sectionName })).toBeVisible({ timeout: SCREEN_TIMEOUT });
  await expect(nav).toHaveClass(/settings-nav-item--active/);
}

test.describe('Admin Settings Screens', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'admin', '9999');
    await selectWorkspace(page, WORKSPACES.ADMIN);
    await navigateToSettings(page);
  });

  // ── Settings sidebar renders the flat nav list ────────────

  test('settings sidebar has multiple nav items', async ({ page }) => {
    const navItems = page.locator('.settings-nav-item');
    const count = await navItems.count();
    // All 14 flat items render without any category expansion step.
    expect(count).toBeGreaterThanOrEqual(14);
  });

  // ── License ───────────────────────────────────────────────

  test('License section renders after loading', async ({ page }) => {
    await clickSidebarNav(page, 'License & Subscription');

    // The LicenseSettings body renders its own "License" card heading.
    const licenseCard = page.locator('.settings-section-title').filter({ hasText: 'License' });
    await expect(licenseCard.first()).toBeVisible({ timeout: SCREEN_TIMEOUT });
  });

  // ── System Diagnostics (the old "About" screen) ───────────
  //
  // The About page ("System & License Ownership") was removed with the flat
  // IA; deployment/version information now lives on System Diagnostics,
  // which renders the real DiagnosticsSection body.

  test('System Diagnostics section renders version info', async ({ page }) => {
    await clickSidebarNav(page, 'System Diagnostics');

    // The deployment version row is the version surface that survived.
    const versionRow = page.locator('[data-testid="diagnostics-version"]');
    await expect(versionRow).toBeVisible({ timeout: SCREEN_TIMEOUT });
    await expect(versionRow).toContainText(/app version/i);
  });

  // ── General ───────────────────────────────────────────────

  test('General section renders store settings', async ({ page }) => {
    await clickSidebarNav(page, 'General');
    // clickSidebarNav already asserted the "General" screen heading.
    await expect(screenTitle(page)).toHaveText(/General/);
  });

  // ── Appearance / display ──────────────────────────────────
  //
  // The Appearance page is GONE: no key in SETTINGS_SCREENS mounts it, and
  // both AppearanceSection.tsx and AppearanceSettings.tsx are unreachable
  // (see the DEAD note at the head of sections/AppearanceSection.tsx). The
  // only appearance control still reachable inside the settings hub is the
  // footer theme toggle, which this test now exercises.

  test('appearance control (theme toggle) renders in the hub', async ({ page }) => {
    // The Appearance page is GONE (see the block comment above). The one
    // appearance control still reachable inside the hub is the footer theme
    // toggle, which carries a theme-derived accessible name.
    //
    // Deliberately NOT clicking it: on the tablet project a stacked
    // .memo-banner (position: fixed, z-index 300 — MemoBanner.css:55-58)
    // genuinely overlaps the footer toggle's box (measured: 37x23px
    // overlap, banner y=1338 vs toggle y=1322) and Playwright refuses the
    // click as intercepted. That is an app-level overlay collision, out of
    // this spec's fence — reported rather than papered over. The original
    // test only asserted the appearance surface RENDERS, so that is what
    // this asserts.
    const toggle = page.locator('.settings-footer-theme-toggle');
    await expect(toggle).toBeVisible({ timeout: SCREEN_TIMEOUT });
    await expect(toggle).toHaveAttribute('aria-label', /switch to (light|dark) mode/i);
  });

  // ── Receipt ───────────────────────────────────────────────
  //
  // There is no Receipt page any more: receipt settings moved to the
  // "Receipt format" card on Business Defaults.

  test('Receipt settings render on Business Defaults', async ({ page }) => {
    await clickSidebarNav(page, 'Business Defaults');

    // The Receipt format card and its paper-width control are the receipt
    // settings surface now.
    const receiptCard = page.locator('.settings-section-title').filter({ hasText: 'Receipt format' });
    await expect(receiptCard).toBeVisible({ timeout: SCREEN_TIMEOUT });
    await expect(page.locator('input[aria-labelledby="rcptfmt-paper-width-label"]')).toBeVisible({ timeout: 10_000 });
  });
});
