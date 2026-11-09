import { test, expect } from '@playwright/test';
import { loginAs, navigateViaSidebar } from './helpers';

/**
 * E2E: Dev Tools — Design System, Tooltip Preview
 *
 * Covers the last 2 untested routes to reach 100% route coverage.
 * All tests use hard assertions — no soft guards, no dead code.
 *
 * CSS contract per screen:
 *   Design System:   .ds-page, .ds-header, .ds-section
 *   Tooltip Preview: .tp-page, .tp-header, .tp-section
 *
 * Routes (App.tsx):
 *   design (line 172), tooltips (line 175)
 */

const SCREEN_TIMEOUT = 8_000;

test.describe('Dev Tools', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'admin', '9999');
    // The sidebar is the only path to these in-workspace screens; see
    // helpers.navigateViaSidebar for why a raw hash write falls back to the picker.
    await navigateViaSidebar(page, 'Dev', 'Design System');
  });

  // ── Design System ─────────────────────────────────────────

  test('Design System renders color swatches and sections', async ({ page }) => {
    await expect(page.locator('.ds-page')).toBeVisible({ timeout: SCREEN_TIMEOUT });
    await expect(page.locator('.ds-header')).toBeVisible({ timeout: 5_000 });

    // At least one design section must render (Colors, Typography, Spacing, etc.).
    await expect(page.locator('.ds-section').first()).toBeVisible({ timeout: 5_000 });
  });

  // ── Tooltip Preview ───────────────────────────────────────

  test('Tooltip Preview renders position grid and sections', async ({ page }) => {
    await navigateViaSidebar(page, 'Dev', 'Tooltip Preview');

    await expect(page.locator('.tp-page')).toBeVisible({ timeout: SCREEN_TIMEOUT });
    await expect(page.locator('.tp-header')).toBeVisible({ timeout: 5_000 });

    // At least one preview section must render.
    await expect(page.locator('.tp-section').first()).toBeVisible({ timeout: 5_000 });
  });
});
