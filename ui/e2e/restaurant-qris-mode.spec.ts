import { test, expect, type Page } from '@playwright/test';
import { openRestaurantSidebarRow } from './helpers';

// WHY THIS FILE EXISTS
// Round 190 covered the custom-rail form on the least-covered restaurant
// screen. The QRIS mode segmented control is the other operator-facing
// setting there that is neither a credential nor a plain toggle.
//
// Static vs dynamic QRIS changes how a sale settles: static shows a fixed
// EMVCo payload, dynamic issues a per-sale charge. A till left on the wrong
// one either asks every guest to scan a code that cannot carry the total, or
// issues a charge the operator did not intend.
//
// ROUND 183's sanitiser decides whether this persists: sanitizeRailParams
// allow-lists only midtrans and stripe, and a rail NOT on that list keeps its
// parameters. qris is not listed, so `mode` survives. Were qris added to the
// allow-list without `mode`, this control would silently stop persisting
// and nothing would say so. The persistence assertion below is what says so.

const TIMEOUT = 20_000;

async function openPayments(page: Page): Promise<void> {
  await openRestaurantSidebarRow(page, 'payments');
  await expect(page.locator('[data-testid="payment-card-toggle-cash"]')).toBeAttached({
    timeout: TIMEOUT,
  });
}

function qrisMode(page: Page, mode: 'static' | 'dynamic') {
  return page.locator(`[data-testid="qris-mode-${mode}"]`);
}

test('the QRIS mode control switches between static and dynamic', async ({ page }) => {
  await openPayments(page);

  const stat = qrisMode(page, 'static');
  const dyn = qrisMode(page, 'dynamic');
  await expect(stat).toBeVisible({ timeout: TIMEOUT });
  await expect(dyn).toBeVisible({ timeout: TIMEOUT });

  const isActive = async (loc: typeof stat) =>
    /active/.test((await loc.getAttribute('class')) ?? '');

  const statOn = await isActive(stat);
  const dynOn = await isActive(dyn);
  expect(statOn || dynOn, 'one QRIS mode must be selected').toBe(true);
  expect(statOn && dynOn, 'the two modes are mutually exclusive').toBe(false);

  const target = statOn ? dyn : stat;
  const other = statOn ? stat : dyn;
  await target.click();

  await expect
    .poll(() => isActive(target), {
      timeout: 8_000,
      message: 'the clicked mode should become active',
    })
    .toBe(true);
  expect(await isActive(other)).toBe(false);
});

test('the chosen QRIS mode reaches the persisted rail params', async ({ page }) => {
  await openPayments(page);

  const dyn = qrisMode(page, 'dynamic');
  await expect(dyn).toBeVisible({ timeout: TIMEOUT });
  await dyn.click();

  const save = page.locator('[data-testid="restaurant-payments-save-btn"]');
  await expect(save, 'a mode change must arm Save').toBeEnabled({ timeout: 8_000 });
  await save.click();
  await expect(save).toBeDisabled({ timeout: TIMEOUT });

  // Searched across EVERY scope, taking the first hit that carries `mode` — NOT the first
  // scope that has a qris rail. The mock keys rails by scope, the LEGAL ENTITY default also
  // holds a qris rail without a `mode` (it is the market default), and it happens to be
  // enumerated first. Returning the first qris's params reads `null` and reports a save
  // failure that did not happen — round 179's scope-order bug again.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const raw = localStorage.getItem('oz-dev-mock:local-payment-methods');
          if (!raw) return null;
          for (const scope of Object.values(JSON.parse(raw) as Record<string, unknown>)) {
            if (!Array.isArray(scope)) continue;
            const qris = scope.find((r) => (r as { rail_code?: string }).rail_code === 'qris');
            if (!qris) continue;
            const params = JSON.parse((qris as { parameters?: string }).parameters ?? '{}');
            const mode = (params as { mode?: string }).mode;
            if (mode !== undefined) return mode;
          }
          return null;
        }),
      { timeout: TIMEOUT, message: 'the qris rail params should carry the chosen mode' },
    )
    .toBe('dynamic');
});