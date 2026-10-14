import { test, expect, type Page } from '@playwright/test';
import { openRestaurantSidebarRow } from './helpers';

/**
 * E2E: the dev mock's payment rails survive a reload (round 156).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The mock's rail store was a bare `new Map()` in module memory, justified by a comment
 * saying `the mock has no multi-row table`. That had been false since
 * `crates/kasirmu-core/migrations/20260924_local_payment_methods.sql` — a real multi-row
 * table whose own header records `No seed rows: an entity/location with no rows means
 * "no market data recorded"`. So rails genuinely persist for the real backend.
 *
 * The cost in the browser preview was a save that SUCCEEDED and vanished: the IPC write
 * landed, the toggle flipped, and a reload returned the seeded defaults. An operator testing
 * the Payments screen in the preview could not have believed any change they made. Rails are
 * now persisted to `oz-dev-mock:local-payment-methods` on every write, mirroring
 * `handlers/topology.ts` and `handlers/staff.ts`.
 *
 * Round 155's spec drives the screen's write path within one session; this one extends it
 * across a reload, which is exactly the boundary the old mock could not cross, and is the
 * assertion that would have caught it.
 *
 * Selectors: the rail `input` is styled out, so state is read through `aria-checked` and the
 * click goes through its label — the same pattern as the settings toggles.
 */

const TIMEOUT = 20_000;

// The login → workspace → sidebar → row route is shared — `openRestaurantSidebarRow` in
// `helpers.ts`. What stays here is this spec's own arrival assertion: the route is shared,
// the thing being waited FOR is not.
async function openPayments(page: Page): Promise<void> {
  await openRestaurantSidebarRow(page, 'payments');
  await expect(page.locator('[data-testid="restaurant-payments-save-btn"]')).toBeVisible({
    timeout: TIMEOUT,
  });
}

test('a rail toggle survives a reload through the mock slice', async ({ page }) => {
  await openPayments(page);

  // Scope by the rail testid prefix, NOT `[role=switch]`: the page also renders switches
  // for "Automatic Cash Drawer" and "Cash Suggestion Presets", so an unscoped `.first()` can
  // resolve to one of those and produce a rail id that matches nothing.
  const railToggles = page.locator('[data-testid^="payment-card-toggle-"]');
  await expect.poll(() => railToggles.count(), { timeout: TIMEOUT }).toBeGreaterThan(3);

  const first = railToggles.first();
  const rail = (await first.getAttribute('data-testid')) ?? '';
  const railId = rail.replace(/^payment-card-toggle-/, '');
  expect(railId, 'the first switch should carry a rail testid').not.toBe('');
  // Poll the state instead of reading it once: `getAttribute` can answer before the
  // switch hydrates, and a single read of null would make `after` the opposite of what the
  // control actually reports, so the click assertion would compare against the pre-click value.
  await expect
    .poll(() => first.getAttribute('aria-checked'), { timeout: 8_000 })
    .toMatch(/true|false/);
  const before = (await first.getAttribute('aria-checked')) ?? 'true';
  const after = before === 'true' ? 'false' : 'true';

  await page.locator(`label[for="rail-toggle-${railId}"]`).first().click();
  await expect(first).toHaveAttribute('aria-checked', after, { timeout: 8_000 });

  const save = page.locator('[data-testid="restaurant-payments-save-btn"]');
  await expect(save).toBeEnabled({ timeout: 8_000 });
  await save.click();
  await expect(save).toBeDisabled({ timeout: TIMEOUT });

  // THE POINT: reload the page, re-open the screen, and read the SAME rail.
  //
  // Wait for the slice to be on disk BEFORE reloading. `handleSave` guards on
  // `!locationId` and RETURNS SILENTLY (`RestaurantPaymentsScreen.tsx:740`) — the location
  // is fetched by an async effect, so a save issued before it resolves does nothing and
  // leaves the UI looking saved. The poll makes that race observable here rather than
  // silently passing.
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          localStorage.getItem('oz-dev-mock:local-payment-methods'),
        ),
      { timeout: TIMEOUT, message: 'the save should reach the mock slice' },
    )
    .toContain(railId);

  await page.reload();
  await openRestaurantSidebarRow(page, 'payments');

  const same = page.locator(`[data-testid="payment-card-toggle-${railId}"]`);
  await expect(same).toBeAttached({ timeout: TIMEOUT });
  await expect(same).toHaveAttribute('aria-checked', after, {
    timeout: 8_000,
    message: `rail ${railId} should still read ${after} after the reload`,
  });
});