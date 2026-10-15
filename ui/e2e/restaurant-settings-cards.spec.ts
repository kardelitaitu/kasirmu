import { test, expect, type Page } from '@playwright/test';
import { openRestaurantSidebarRow } from './helpers';

/**
 * E2E: the restaurant Settings screen's five cards and a real toggle change.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `restaurant-settings-toggles.spec.ts` (rounds 148 and 157) covers the COMBINED view: all
 * thirteen toggles render, Course Firing defaults off, and the F6 save round-trips through the
 * local-storage mirror. This file covers the other observable half — the card STRUCTURE an
 * operator navigates by, and the change flow on an individual toggle.
 *
 * WHY THE CARDS ARE WORTH PINNING: they are the screen's information architecture, and round
 * 149's history shows a row disappearing changes what an operator can reach. A card that stops
 * rendering takes its toggles with it, and this suite reports a missing CARD rather than a
 * missing toggle.
 */

const TIMEOUT = 20_000;

const CARDS = ['order-entry', 'workflow', 'dining-ops', 'kitchen', 'interaction'] as const;

async function openSettings(page: Page): Promise<void> {
  await openRestaurantSidebarRow(page, 'settings');
  // The header renders ungated, so wait on data instead — the load-error absence IS the
  // signal the read succeeded (round 186's rule, applied to this screen).
  await expect(page.locator('[data-testid="restaurant-settings-load-error"]')).toHaveCount(0, {
    timeout: TIMEOUT,
  });
  await expect(page.locator('[data-testid="settings-card-order-entry"]')).toBeVisible({
    timeout: TIMEOUT,
  });
}

test('all five settings cards render with at least one toggle each', async ({ page }) => {
  await openSettings(page);

  for (const card of CARDS) {
    const locator = page.locator(`[data-testid="settings-card-${card}"]`);
    await expect(locator, `settings card ${card} should render`).toBeVisible({ timeout: TIMEOUT });
  }

  // Not empty shells — each card carries switches, so a card that lost its toggles fails here.
  for (const card of CARDS) {
    const switches = page.locator(`[data-testid="settings-card-${card}"] [role="switch"]`);
    await expect
      .poll(() => switches.count(), {
        timeout: TIMEOUT,
        message: `settings card ${card} should carry at least one toggle`,
      })
      .toBeGreaterThan(0);
  }
});

test('a toggle flips, arms Save, and the save reaches the settings key', async ({ page }) => {
  await openSettings(page);

  const save = page.locator('[data-testid="restaurant-settings-save-btn"]');
  await expect(save, 'nothing has changed yet').toBeDisabled({ timeout: TIMEOUT });

  // Course Firing defaults OFF (round 105), so the change is observable in a known direction
  // rather than depending on seeded state.
  const toggle = page.locator('[data-testid="setting-toggle-course-firing"]');
  await expect(toggle).toBeAttached({ timeout: TIMEOUT });
  await expect(toggle).toHaveAttribute('aria-checked', 'false', { timeout: TIMEOUT });

  // Through the switch LABEL — the input is styled out (rounds 148, 170).
  await page.locator('label[for="resto-setting-course-firing"]').first().click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 8_000 });

  await expect(save, 'a settings change must arm Save').toBeEnabled({ timeout: 8_000 });
  await save.click();
  await expect(save).toBeDisabled({ timeout: TIMEOUT });

  // The save is only real if the DB-side key moved. `restaurant.course_firing` (NOT a
  // localStorage mirror — this screen writes none; the F6 mirror belongs to the interaction
  // pair, which round 157 pinned separately). It lands in the mock's settings slice.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const raw = localStorage.getItem('oz-dev-mock:settings');
          if (!raw) return null;
          return (JSON.parse(raw) as Record<string, string>)['restaurant.course_firing'] ?? null;
        }),
      { timeout: TIMEOUT, message: 'restaurant.course_firing should record the new value' },
    )
    .toBe('true');
});