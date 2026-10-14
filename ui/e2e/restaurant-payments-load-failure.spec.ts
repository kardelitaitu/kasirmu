import { test, expect, type Page } from '@playwright/test';
import { openRestaurantSidebarRow } from './helpers';

// WHY THIS FILE EXISTS
//
// The payments screen is the weakest restaurant surface (round 226's self-checking scan:
// 8 of 32). Its uncovered set is mostly credential forms, but `restaurant-payments-load-error`
// and its retry are NOT — they are the F4 guard, and the same shape round 223 proved valuable
// on the receipts screen.
//
// The comment above the banner states the defect it prevents (`:470-474`):
//
//   these two used to `.catch(() => null)` INDEPENDENTLY, which swallowed a failed read.
//   Combined with the `if (midtransGw)` / `if (stripeGw)` guards and the baseline seeded
//   before this point, a failure left the screen looking CLEAN while showing empty fields —
//   so saving wrote the BLANKS over the stored credentials.
//
// And the latch (`:987-988`):
//
//   F4: the read failed, so the values shown are defaults. Without Retry the flag is a
//   one-way latch and Save could never return this session.
//
// The failing command is `get_payment_gateway_config_scoped` (`api/payment-gateways.ts:31`);
// either gateway's catch sets the flag. Forced through `window.__MOCK_FAIL`, the seam round
// 221 established and rounds 223 and 225 reused.

const TIMEOUT = 20_000;

const GATEWAY_CMD = 'get_payment_gateway_config_scoped';

async function openPaymentsWithFailedGatewayRead(page: Page): Promise<void> {
  await page.addInitScript((cmd) => {
    (window as unknown as { __MOCK_FAIL?: string[] }).__MOCK_FAIL = [cmd];
  }, GATEWAY_CMD);
  await openRestaurantSidebarRow(page, 'payments');
  await expect(page.locator('[data-testid="restaurant-payments-title"]')).toBeVisible({
    timeout: TIMEOUT,
  });
}

test('a failed gateway read is reported instead of looking clean', async ({ page }) => {
  await openPaymentsWithFailedGatewayRead(page);

  // THE BANNER. Announced (`role="alert`), so it reaches a screen reader as well as the eye.
  const banner = page.locator('[data-testid="restaurant-payments-load-error"]');
  await expect(banner, 'a swallowed gateway read must be visible').toBeVisible({
    timeout: TIMEOUT,
  });
  await expect(banner).toHaveAttribute('role', 'alert');

  // AND SAVE MUST NOT OFFER ITSELF. The whole point of the flag: with empty credential fields
  // on screen and a clean-looking form, pressing Save writes those blanks over the stored
  // keys. The baseline is seeded so `dirty` is false, which is what makes Save disabled here
  // — a screen that looked clean would have enabled it.
  const save = page.locator('[data-testid="restaurant-payments-save-btn"]');
  await expect(save, 'a failed credential read must not leave Save armed').toBeDisabled();

  await expect(
    page.locator('[data-testid="restaurant-payments-load-retry-btn"]'),
    'the retry is the only way out of the latch',
  ).toBeVisible({ timeout: TIMEOUT });
});

test('Retry clears the failure once the gateway read succeeds', async ({ page }) => {
  await openPaymentsWithFailedGatewayRead(page);

  const banner = page.locator('[data-testid="restaurant-payments-load-error"]');
  await expect(banner).toBeVisible({ timeout: TIMEOUT });

  // Clear the injection BEFORE pressing Retry. The seam is re-read on every invoke
  // (`mockDispatcher.ts:115`), so this needs no reload and keeps the screen's state.
  await page.evaluate((cmd) => {
    (window as unknown as { __MOCK_FAIL?: string[] }).__MOCK_FAIL = [];
    void cmd;
  }, GATEWAY_CMD);

  await page.locator('[data-testid="restaurant-payments-load-retry-btn"]').click();

  // THE RECOVERY IS THE CLAIM. The retry bumps `reloadNonce` (`:1000`) and the effect re-runs;
  // a second failure would mean the nonce did not reach the deps and the button does nothing —
  // which is exactly the one-way latch the comment warns about.
  await expect(banner, 'a successful retry must clear the banner').toHaveCount(0, {
    timeout: TIMEOUT,
  });
});