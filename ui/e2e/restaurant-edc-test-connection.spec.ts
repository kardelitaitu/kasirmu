import { test, expect, type Page } from '@playwright/test';
import { openRestaurantSidebarRow } from './helpers';

// WHY THIS FILE EXISTS
//
// `edc-test-connection-btn` is the LAST operator diagnostic on the payments screen and the third
// of its family, after the receipts test print (round 222) and the cash-drawer/chit pair (round
// 248). It answers the question an operator asks when a card will not go through.
//
// IT IS GATED ON A SELECTION: `{defaultEdcTerminalId && (…)}` (`:1246`), so it appears only once
// a terminal is chosen. Round 225's spec already drives that picker, so this reuses the same
// route rather than inventing one.
//
// `handleTestEdc` (`:715-738`) has TWO arms:
//
//   res.status === 'ready'   success
//   anything else / threw    error
//
// and the mock answers `{ status: 'ready' }` (`dev-mock/handlers/payment.ts:194-200`), so BOTH are
// reachable — the success arm from the seed, the failure arm through `window.__MOCK_FAIL`.

const TIMEOUT = 20_000;

const STATUS_CMD = 'edc_terminal_status_scoped';

/** Open payments, enable the card rail, and pick the seeded terminal. */
async function armEdcTest(page: Page): Promise<void> {
  await openRestaurantSidebarRow(page, 'payments');
  await expect(page.locator('[data-testid="payment-card-toggle-cash"]')).toBeAttached({
    timeout: TIMEOUT,
  });

  // NO TOGGLE NEEDED. Round 225's spec reaches this select WITHOUT opening the card rail:
  // `edc-default-select` is already visible on the default profile. Adding a rail-toggle click
  // here COLLAPSED it — measured, the select resolved `hidden` while round 225's route passes.
  // The `role=switch` label pattern is real (rounds 148, 170, 179, 228, 242) but does not apply.
  const select = page.locator('[data-testid="edc-default-select"]');
  await expect(select).toBeVisible({ timeout: TIMEOUT });
  await select.click();
  const option = page.locator('[role="option"]').filter({ hasText: /BCA EDC/ }).first();
  await expect(option).toBeVisible({ timeout: 8_000 });
  await option.click();

  // THE GATE: the button exists only after a terminal is chosen (`:1246`).
  await expect(
    page.locator('[data-testid="edc-test-connection-btn"]'),
    'the test is offered once a terminal is selected',
  ).toBeVisible({ timeout: TIMEOUT });
}

test('Test Connection reports the terminal status when it answers', async ({ page }) => {
  await armEdcTest(page);

  await page.locator('[data-testid="edc-test-connection-btn"]').click();

  // THE REPORT. A diagnostic that says nothing leaves the operator unable to tell a working
  // terminal from an unresponsive one, which is the whole reason the button exists.
  await expect(
    page.getByText(/READY|ERROR/i).first(),
    'the test must report the terminal status',
  ).toBeVisible({ timeout: TIMEOUT });
});

test('a failed status check is reported as an error, not swallowed', async ({ page }) => {
  // THE FAILURE ARM, through the documented seam (`dev-mock/core/mockDispatcher.ts:100-134`),
  // armed before the screen reads so the gate and the button are unaffected.
  await page.addInitScript((cmd) => {
    (window as unknown as { __MOCK_FAIL?: string[] }).__MOCK_FAIL = [cmd];
  }, STATUS_CMD);

  await armEdcTest(page);
  await page.locator('[data-testid="edc-test-connection-btn"]').click();

  // The catch toasts `… : ERROR` (`:730-734`). Asserting the failure arm separately is what makes
  // the success assertion above a check rather than a constant: a control hard-coded to say
  // READY would pass that one and fail this.
  await expect(
    page.getByText(/ERROR/i).first(),
    'a failed check must say so',
  ).toBeVisible({ timeout: TIMEOUT });
});