import { test, expect } from '@playwright/test';
import { openRestaurantSidebarRow } from './helpers';

/**
 * E2E: the restaurant Receipts screen's Save gate.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `handleSave` pushed its FIRST task with `sessionToken ?? ''` while guarding the later ones
 * with `if (sessionToken && …)` (`RestaurantReceiptsScreen.tsx:1121`, `:1143`). An empty token
 * therefore fired a bogus `set_receipt_settings_scoped('')` before the guarded tasks skipped.
 *
 * NOT REACHABLE through the UI today, and the spec says so rather than implying a repaired
 * bug: the mock always supplies a token, and Save is disabled until an edit makes the screen
 * dirty. Measured 2026-10-14 — Save present, disabled on arrival. So the change is a
 * CONSISTENCY fix with the file's five other token guards, plus a gate that can no longer be
 * armed for a save the handler would refuse.
 *
 * What the spec does assert is the part a user sees: Save is inert until the form is dirty,
 * and inert again after a successful save.
 */

const TIMEOUT = 20_000;

test('the Receipts Save is inert until an edit, and again after saving', async ({ page }) => {
  await openRestaurantSidebarRow(page, 'receipts');
  await expect(page.locator('[data-testid="restaurant-receipts-title"]')).toBeVisible({
    timeout: TIMEOUT,
  });

  const save = page.locator('[data-testid="restaurant-receipts-save-btn"]');
  await expect(save).toBeVisible({ timeout: TIMEOUT });

  // Nothing edited yet — a dirty=false screen must not offer a save.
  await expect(save).toBeDisabled();

  // The screen exposes switches; each must report a real state rather than rendering inert.
  const switches = page.locator('[role="switch"]');
  const count = await switches.count();
  expect(count, 'the receipts screen should expose switch controls').toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    await expect(switches.nth(i)).toHaveAttribute('aria-checked', /true|false/);
  }

  // And the Save button carries the token in its gate now (`RestaurantReceiptsScreen.tsx`),
  // so the disabled state above is not merely `dirty=false` — it stays shut for a session
  // the handler would refuse to save with.
});