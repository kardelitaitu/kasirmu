import { test, expect, type Page } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

/**
 * E2E: the Table Management screen, driven live.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `TableManagementScreen` carries 17 testids and E2E touched exactly one — the back button,
 * round 149 added to prove the sidebar route. Round 165 pinned the item form's Save gate on a
 * sibling; this file drives the floor plan itself, the part an operator or host uses to see
 * who is seated where.
 *
 * Measured 2026-10-14 before writing it: the mock seeds 12 tables across two sections
 * (Indoor 5/6, Patio 6) with both statuses on screen, so the load path, the section
 * headers, and the status chips are all observable without a fixture.
 *
 * HOW IT ENTERS. The sidebar ROW is feature-gated on FEATURES.TABLE_MANAGEMENT, which the
 * dev mock omits, so `openRestaurantSidebarRow(page, 'tables')` cannot reach this screen. The
 * SCREEN is not gated — PosScreen renders it for `showTables`, which `Shift+L` sets. So this
 * file's setup also covers that the shortcut added in rounds 158-160 lands somewhere real.
 */

const TIMEOUT = 20_000;

async function openTables(page: Page): Promise<void> {
  await loginAs(page, 'owner', '1234');
  await selectWorkspace(page, WORKSPACES.RESTAURANT_POS);
  await expect(page.locator('.restaurant-card').first()).toBeVisible({ timeout: TIMEOUT });
  await page.keyboard.press('Shift+L');
  await expect(page.locator('[data-testid="tables-back-btn"]')).toBeVisible({
    timeout: TIMEOUT,
  });
}

test('the floor plan loads with tables, sections and both statuses', async ({ page }) => {
  await openTables(page);

  // Wait for a table tile rather than asserting immediately: the body still reads
  // "Loading…" for a moment, and reading it too early is what made round 144's board look
  // frozen.
  const firstTable = page.getByText(/^Table \d+$/).first();
  await expect(firstTable).toBeVisible({ timeout: TIMEOUT });
  await expect(page.getByText(/Loading/i)).toHaveCount(0);

  // Section headers carry occupancy counts, so the seeded plan really was read.
  await expect(page.getByText(/Indoor/).first()).toBeVisible({ timeout: TIMEOUT });
  await expect(page.getByText(/Patio/).first()).toBeVisible({ timeout: TIMEOUT });

  // Both statuses render. The screen lowercases them (statusLabel), so the match is
  // case-insensitive — a plan with only one visible would suggest the other branch is dead.
  await expect(page.getByText(/occupied/i).first()).toBeVisible({ timeout: TIMEOUT });
  await expect(page.getByText(/available/i).first()).toBeVisible({ timeout: TIMEOUT });
});

test('adding a table creates it and it appears in the plan', async ({ page }) => {
  await openTables(page);
  await expect(page.getByText(/^Table \d+$/).first()).toBeVisible({ timeout: TIMEOUT });

  await page.locator('[data-testid="tables-add-table-btn"]').click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible({ timeout: 8_000 });

  const nameField = dialog.locator('input').first();
  await nameField.fill('Teras E2E');
  const save = page.getByRole('button', { name: /save table/i });
  await expect(save).toBeEnabled({ timeout: 8_000 });
  await save.click();

  // The dialog closes and the new tile is in the plan. Counted by name rather than by a
  // `/Table/` regex: the Add Table button and the section badges also contain the word.
  await expect(dialog).toHaveCount(0, { timeout: TIMEOUT });
  await expect(page.getByText('Teras E2E')).toBeVisible({ timeout: TIMEOUT });
});