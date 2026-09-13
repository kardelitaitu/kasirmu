import { test, expect, type Page } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

/**
 * E2E: Admin Workflows — Settings Sidebar Screens
 *
 * Tests the settings sidebar screens accessible from the Admin workspace.
 * The sidebar is a flat nav list (the category accordion was removed):
 *   General, Appearance, Receipt, Cloud Sync, Email, Store POS,
 *   Restaurant POS, Inventory, About, License, Diagnostics, Topology, Local API
 *
 * CSS contract per screen:
 *   License:  .settings-section-title (contains "License")
 *   About:    .settings-section-title (contains "System")
 *   Topology: .node-topology-editor (tested in adr22-workspace-settings.spec.ts)
 *
 * Navigation: every nav item is always visible — click `.settings-nav-item`
 * with its label directly, no category expansion step.
 */

const SIDEBAR_TIMEOUT = 10_000;
const SCREEN_TIMEOUT = 8_000;

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

async function clickSidebarNav(page: Page, sectionName: string) {
  const nav = page.locator('.settings-nav-item').filter({ hasText: sectionName });
  await expect(nav).toBeVisible({ timeout: 5_000 });
  await nav.click();
  await page.waitForTimeout(500);
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
    // All 13 flat items render without any category expansion step.
    expect(count).toBeGreaterThanOrEqual(13);
  });

  // ── License ───────────────────────────────────────────────

  test('License section renders after loading', async ({ page }) => {
    await clickSidebarNav(page, 'License');

    // License section heading must be visible (post-load, not skeleton).
    const licenseHeading = page.locator('.settings-section-header-title, .settings-section-title').filter({ hasText: 'License' });
    await expect(licenseHeading.first()).toBeVisible({ timeout: SCREEN_TIMEOUT });

    // License status/type should render (mock returns valid Pro license).
    await expect(page.locator('.settings-section-header-title, .settings-section-title').first()).toBeVisible();
  });

  // ── About ─────────────────────────────────────────────────

  test('About section renders version info', async ({ page }) => {
    await clickSidebarNav(page, 'About');

    // About section heading must be visible ("System & License Ownership").
    const aboutHeading = page.locator('.settings-section-header-title, .settings-section-title').filter({ hasText: 'System' });
    await expect(aboutHeading.first()).toBeVisible({ timeout: SCREEN_TIMEOUT });
  });

  // ── General ───────────────────────────────────────────────

  test('General section renders store settings', async ({ page }) => {
    await clickSidebarNav(page, 'General');

    // General section must render with a heading.
    const heading = page.locator('.settings-section-header-title, .settings-section-title').filter({ hasText: 'General' });
    await expect(heading.first()).toBeVisible({ timeout: SCREEN_TIMEOUT });
  });

  // ── Appearance ────────────────────────────────────────────

  test('Appearance section renders display settings', async ({ page }) => {
    await clickSidebarNav(page, 'Appearance');

    // Appearance section must render.
    const appearanceHeading = page.locator('.settings-section-header-title, .settings-section-title').filter({ hasText: 'Appearance' });
    await expect(appearanceHeading.first()).toBeVisible({ timeout: SCREEN_TIMEOUT });
  });

  // ── Receipt ───────────────────────────────────────────────

  test('Receipt section renders receipt settings', async ({ page }) => {
    await clickSidebarNav(page, 'Receipt');

    // Receipt section heading must be visible.
    const receiptHeading = page.locator('.settings-section-header-title, .settings-section-title').filter({ hasText: 'Receipt' });
    await expect(receiptHeading.first()).toBeVisible({ timeout: SCREEN_TIMEOUT });
  });
});
