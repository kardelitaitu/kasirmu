import { test, expect, type Page } from '@playwright/test';
import { openRestaurantSidebarRow } from './helpers';

// WHY THIS FILE EXISTS
//
// `restaurant-kitchen-test-chit-btn` is the last behavioural id on the receipts screen. Round 264
// established WHY it is absent, and the answer was neither an entitlement nor a view:
//
//   CHIT_SETTINGS   0        the control is absent
//   PLAN_BADGE      0        ... but NO "Pro Plan required" badge — so `hasKdsFeature` is TRUE
//   KITCHEN_CONN    disabled the reason, straight from the select's own value
//
// The gate is `hasKdsFeature && kitchenConnection !== 'disabled'` (`:2853`), and the connection is
// a setting this screen owns. So the control is REACHABLE — it needs the form driven first.
//
// WHERE THE CONTROL IS, measured: `#resto-hw-kitchen-conn` resolves at `y=1242` with a 1x1 box,
// far below the 768px viewport. `SettingsSelect` (`:267-277`) renders a styled `<button>` trigger
// plus an offscreen native select, and the trigger is what an operator presses. It carries no
// testid, so it is addressed the same way the `role=switch` inputs are: through the LABEL's
// `htmlFor` — a pattern this session has now met on seven surfaces.

const TIMEOUT = 20_000;

/** Scroll a control clear of the sticky preview column and the memo stack (round 248). */
async function bringIntoReach(page: Page, locator: ReturnType<Page['locator']>): Promise<void> {
  await locator.evaluate((el) => {
    let n: HTMLElement | null = el.parentElement;
    while (n && getComputedStyle(n).overflowY !== 'auto') n = n.parentElement;
    if (n) n.scrollTop = n.scrollHeight;
  });
  await page.waitForTimeout(300);
}

/** Set the kitchen printer to Network, which is what reveals the chit button. */
async function enableKitchenPrinter(page: Page): Promise<void> {
  await openRestaurantSidebarRow(page, 'receipts');
  await expect(page.locator('[data-testid="restaurant-receipts-test-print-btn"]')).toBeVisible({
    timeout: TIMEOUT,
  });
  // ⚠️ THE TRIGGER, not the label. Measured: the label click does NOT open the dropdown, because
  // the `<label htmlFor>` points at the 1x1 OFFSCREEN native select that `SettingsSelect` keeps for
  // form semantics — not at the styled `<button aria-haspopup="listbox">` an operator presses.
  //
  // The button carries no testid, so it is addressed by its ARIA contract and by the value it is
  // currently showing: measured, the three listbox triggers on this screen read "USB", "80 mm" and
  // "Disabled" — the last being the kitchen connection.
  const trigger = page
    .locator('button[aria-haspopup="listbox"]')
    .filter({ hasText: /Disabled/i })
    .first();
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  const option = page.locator('[role="option"]').filter({ hasText: /Network/i }).first();
  await expect(option, 'the connection options are offered').toBeVisible({ timeout: 8_000 });
  await option.click();
}

test('the chit button appears once the kitchen printer is configured', async ({ page }) => {
  await openRestaurantSidebarRow(page, 'receipts');
  await expect(page.locator('[data-testid="restaurant-receipts-test-print-btn"]')).toBeVisible({
    timeout: TIMEOUT,
  });

  // THE GATE, asserted from both sides. A disabled kitchen printer is the seeded state, and the
  // button must be absent — a control that always rendered would satisfy the second half alone.
  await expect(
    page.locator('[data-testid="restaurant-kitchen-test-chit-btn"]'),
    'a disabled kitchen printer offers no chit test',
  ).toHaveCount(0);

  await enableKitchenPrinter(page);

  // AND NOW IT IS THERE. This is the half that makes the absence above a check rather than a
  // constant: the same assertion, after the one setting that changes it.
  const chit = page.locator('[data-testid="restaurant-kitchen-test-chit-btn"]');
  await expect(
    chit,
    'configuring the kitchen printer reveals its test',
  ).toBeVisible({ timeout: TIMEOUT });
});

test('the chit reports its own pre-flight result', async ({ page }) => {
  await enableKitchenPrinter(page);

  const chit = page.locator('[data-testid="restaurant-kitchen-test-chit-btn"]');
  await expect(chit).toBeVisible({ timeout: TIMEOUT });
  await bringIntoReach(page, chit);
  await chit.click();

  // The connection is Network with NO host set, so the ladder stops at `ERR_MISSING_HOST` and
  // reports a CODE — the same contract rounds 222 and 248 pinned for the other two printers. A
  // diagnostic that says nothing leaves the operator unable to tell a working chit from an
  // unresponsive printer.
  const toast = page.locator('[class*="toast"]').first();
  await expect(toast, 'the chit test must report itself').toBeVisible({ timeout: TIMEOUT });
  const text = ((await toast.innerText()) ?? '').replace(/\n+/g, ' ');
  expect(text, 'the report carries a code an operator can quote').toMatch(/PRN_|ERR_|chit|print|host/i);
});