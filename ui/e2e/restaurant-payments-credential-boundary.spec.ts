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

/**
 * Enable a gateway card so its body mounts.
 *
 * Two measured facts, both in the comments of the Midtrans case: `PaymentMethodCard` mounts its
 * children only while OPEN, and the raw `role=switch` input is styled out of the layout — so the
 * click has to go through the LABEL (`label[for="rail-toggle-<code>"]`). Rounds 148, 170, 179
 * and 228 each met the second, which is why it is a helper now.
 */
async function enableRailCard(page: Page, code: string): Promise<void> {
  const toggle = page.locator(`[data-testid="payment-card-toggle-${code}"]`);
  await expect(toggle, `the ${code} card offers its toggle`).toBeAttached({ timeout: TIMEOUT });
  await page.locator(`label[for="rail-toggle-${code}"]`).first().click();
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

  // The card must be ENABLED first — see `enableRailCard` for both measured reasons.
  await enableRailCard(page, 'midtrans');

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

test('a Stripe secret never reaches the market rail row either', async ({ page }) => {
  await openPayments(page);
  await enableRailCard(page, 'stripe');

  // The same boundary as the Midtrans case, on the other gateway. Asserted rather than assumed
  // because the allow-list is per-rail-code (`paymentRailsLogic.ts`): `stripe: ['reader',
  // 'currency']`, and a code that is NOT listed passes its parameters through UNCHANGED. So the
  // Stripe entry existing is what protects this rail, and a typo in the key name would be silent.
  const secret = page.locator('[data-testid="stripe-sec-key-input"]');
  await expect(secret, 'the Stripe card offers its keys').toBeVisible({ timeout: TIMEOUT });
  await secret.fill(SENTINEL);

  const save = page.locator('[data-testid="restaurant-payments-save-btn"]');
  await expect(save, 'typing a key must arm Save').toBeEnabled({ timeout: 8_000 });
  await save.click();
  await expect(save).toBeDisabled({ timeout: TIMEOUT });

  await page.waitForTimeout(500);
  expect(
    await marketRowsContain(page, SENTINEL),
    'a Stripe secret must never appear in a market rail row',
  ).toBe(false);
});

test('Verify Keys reports which half of the configuration is missing', async ({ page }) => {
  await openPayments(page);
  await enableRailCard(page, 'stripe');

  const verify = page.locator('[data-testid="stripe-verify-keys-btn"]');
  await expect(verify, 'the card offers a key check').toBeVisible({ timeout: TIMEOUT });

  // WITH NEITHER KEY: the check must say so. A button that reports success on an empty form is
  // worse than none — the operator would believe a gateway is configured when it is not.
  await verify.click();
  await expect(
    // The exact FTL string (`products.ftl`): 'Please enter Publishable Key and Secret Key'.
    page.getByText(/Please enter Publishable Key and Secret Key/i).first(),
    'an unconfigured gateway must be reported as missing, not as valid',
  ).toBeVisible({ timeout: 8_000 });

  // WITH BOTH KEYS: the other arm. Filling them and re-checking is what makes the first
  // assertion a CHECK rather than a constant.
  await page.locator('[data-testid="stripe-pub-key-input"]').fill('pk_test_abc');
  await page.locator('[data-testid="stripe-sec-key-input"]').fill('sk_test_abc');
  await verify.click();
  await expect(
    // The exact FTL string: 'Stripe keys format valid ({mode})'.
    page.getByText(/Stripe keys format valid/i).first(),
    'a fully configured gateway must be reported as valid',
  ).toBeVisible({ timeout: 8_000 });
});
