import { test, expect, type Page } from '@playwright/test';
import { openRestaurantSidebarRow } from './helpers';

/**
 * E2E: the restaurant Payments screen's cash-drawer-kick toggle.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Round 179's re-check of the testid sweep found `RestaurantPaymentsScreen` at 31 testids with
 * no e2e reference — the largest remaining block, on a screen where two real defects were found
 * by hand (round 156's rails losing every save; round 164's token guard). Round 142 proved
 * `updateRailParams` is LOCAL STATE only, so every toggle on this screen writes to `drafts` and
 * nothing else.
 *
 * That makes this the interesting question: does anything ever carry a rail parameter to the
 * backend? Reading the chain says yes — `handleSave`'s payload maps every draft's `parameters`
 * through, and `cash` falls into the default branch (`:779-784`), so `autoKick` persists *once
 * the operator presses Save*. `dirty` derives from `drafts` vs `originalsRef` (`:551-562`), so a
 * toggle arms it.
 *
 * This pins that end to end, in the browser: toggle → Save arms → save → the mock's rail slice
 * carries the value. Round 156 fixed the store and added `mock-payment-rails-persist.spec.ts`
 * for the STORE; this covers the SCREEN's route into it.
 */

const TIMEOUT = 20_000;

async function openPayments(page: Page): Promise<void> {
  await openRestaurantSidebarRow(page, 'payments');
  await expect(page.locator('[data-testid="restaurant-payments-save-btn"]')).toBeVisible({
    timeout: TIMEOUT,
  });
}
test('the cash drawer kick toggle reaches the persisted rail params', async ({ page }) => {
  await openPayments(page);

  // ATTACHED, not visible: the rail `input` is styled out by `.settings-toggle` and the
  // visible control is an aria-hidden sibling slider — the same pattern the settings toggles
  // and the rail switches both hit (rounds 148 and 170).
  const kick = page.locator('[data-testid="cash-drawer-kick-toggle"]');
  await expect(kick).toBeAttached({ timeout: TIMEOUT });

  // The switch sits inside a card that must be expanded — an E2E click on a collapsed
  // control would pass on a screen the operator cannot use, so the branch is explicit.
  // Polled, not read once: `getAttribute` can answer before the switch hydrates, and a null
  // there makes `after` the opposite of what the control reports (round 157's trap).
  await expect
    .poll(() => kick.getAttribute('aria-checked'), { timeout: 8_000 })
    .toMatch(/true|false/);
  const before = (await kick.getAttribute('aria-checked')) ?? 'false';

  const save = page.locator('[data-testid="restaurant-payments-save-btn"]');
  await expect(save, 'a freshly loaded screen has nothing to save').toBeDisabled();

  await page.locator('label[for="cash-drawer-kick"]').first().click();
  const after = before === 'true' ? 'false' : 'true';
  await expect(kick).toHaveAttribute('aria-checked', after, { timeout: 8_000 });

  // Round 142's warning: `updateRailParams` writes LOCAL state. The gate that must open is
  // the one that carves those params into the save payload — `disabled={!dirty || …}`.
  await expect(save, 'a rail edit must arm Save').toBeEnabled({ timeout: 8_000 });

  await save.click();
  await expect(save).toBeDisabled({ timeout: TIMEOUT });

  // And the value the mock now holds is the one the operator set. This is the half that
  // distinguishes "looks saved" (round 156's defect) from saved.
  // Polled: `handleSave` awaits `Promise.all(tasks)`, and Save going disabled is not the same
  // moment as the store write landing. A single read races it.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const raw = localStorage.getItem('oz-dev-mock:local-payment-methods');
          if (!raw) return null;
          const scopes = Object.values(JSON.parse(raw) as Record<string, unknown>);
          for (const scope of scopes) {
            if (!Array.isArray(scope)) continue;
            const cash = scope.find((r) => (r as { rail_code?: string }).rail_code === 'cash');
            if (!cash) continue;
            const params = JSON.parse((cash as { parameters?: string }).parameters ?? '{}');
            return (params as { autoKick?: boolean }).autoKick ?? null;
          }
          return null;
        }),
      { timeout: TIMEOUT, message: 'the cash rail params must hold autoKick after the save' },
    )
    .toBe(after === 'true');
});
