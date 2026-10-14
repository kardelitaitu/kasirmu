import { test, expect, type Page } from '@playwright/test';
import { openRestaurantSidebarRow } from './helpers';

// WHY THIS FILE EXISTS
//
// The Midtrans and Stripe credential fields are the last substantial uncovered group on the
// payments screen. Round 225 recorded them as "the one group where a test's value is lower than
// the care it would need to write" — and then round 183 showed the care IS the point.
//
// `handleSave` builds TWO payloads from one screen (`:747-790`):
//
//   setLocalPaymentMethodsScoped   the MARKET surface — which rails exist, what they are
//                                  called, whether the site offers them
//   setPaymentGatewayConfigScoped  CREDENTIALS — encrypted at rest in `payment_gateways`
//
// A credential that lands in the rail list is a provider key in a table every terminal reads
// and syncs, WITHOUT that encryption. Round 183 extracted `sanitizeRailParams` to enforce the
// allow-list; this spec proves the boundary END TO END in the browser, which the unit test
// beside it cannot: that the screen's own field writes still route the key correctly.
//
// The field itself writes BOTH places (`:1318-1322`): local state for the form, and
// `updateRailParams('midtrans', { merchantId })` for the draft. So the rail draft deliberately
// holds the key, and the sanitiser is what stops it reaching the market row.

const TIMEOUT = 20_000;

export const SENTINEL = 'SENTINEL-DO-NOT-PERSIST';

async function openPayments(page: Page): Promise<void> {
  await openRestaurantSidebarRow(page, 'payments');
  await expect(page.locator('[data-testid="payment-card-toggle-cash"]')).toBeAttached({
    timeout: TIMEOUT,
  });
}

/** Read the mock's rail slice and report whether any parameter carries `needle`. */
async function marketRowsContain(page: Page, needle: string): Promise<boolean> {
  return page.evaluate((n) => {
    const raw = localStorage.getItem('oz-dev-mock:local-payment-methods');
    if (!raw) return false;
    for (const scope of Object.values(JSON.parse(raw) as Record<string, unknown>)) {
      if (!Array.isArray(scope)) continue;
      for (const row of scope) {
        const params = (row as { parameters?: string }).parameters ?? '';
        if (params.includes(n)) return true;
      }
    }
    return false;
  }, needle);
}

test('a gateway credential never reaches the market rail row', async ({ page }) => {
  await openPayments(page);

  // ⚠️ THE CARD MUST BE ENABLED FIRST. `PaymentMethodCard` mounts its body only when open, and
  // the midtrans card is closed on a fresh profile — unlike the `card` rail, which passes
  // `mountBodyWhenCollapsed` (`:1222`). Measured 2026-10-14: the fields resolve to nothing until
  // the toggle is switched on, which is also the state an operator must reach to configure a
  // gateway at all.
  const enable = page.locator('[data-testid="payment-card-toggle-midtrans"]');
  await expect(enable, 'the Midtrans card offers its toggle').toBeAttached({ timeout: TIMEOUT });
  // Through the LABEL — the raw `role=switch` input is styled out of the layout, the same
  // pattern rounds 148, 170 and 179 each hit. Its `id` is `rail-toggle-midtrans`.
  await page.locator('label[for="rail-toggle-midtrans"]').first().click();

  // Type into the SERVER KEY — the most sensitive of the three. A distinctive value so the
  // assertion cannot pass on an incidental match.
  const serverKey = page.locator('[data-testid="midtrans-server-key-input"]');
  await expect(serverKey, 'the Midtrans card offers its credentials').toBeVisible({
    timeout: TIMEOUT,
  });
  await serverKey.fill(SENTINEL);

  // It also lands in the draft, which is what the form renders from.
  await expect(await marketRowsContain(page, SENTINEL), 'nothing is saved yet').toBe(false);

  const save = page.locator('[data-testid="restaurant-payments-save-btn"]');
  await expect(save, 'typing a credential must arm Save').toBeEnabled({ timeout: 8_000 });
  await save.click();
  await expect(save).toBeDisabled({ timeout: TIMEOUT });

  // THE BOUNDARY. `sanitizeRailParams` keeps only `channels` for midtrans, so the key must
  // be absent from the market row — while having been SENT, to the encrypted gateway table.
  // Absence alone would pass on a screen that dropped the field entirely, which is why the
  // arm-then-save above is part of the same case.
  await page.waitForTimeout(500);
  expect(
    await marketRowsContain(page, SENTINEL),
    'a provider key must never appear in a market rail row — that table is unencrypted and synced',
  ).toBe(false);
});