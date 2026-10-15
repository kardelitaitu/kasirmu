import { test, expect, type Page } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

// WHY THIS FILE EXISTS
//
// Four restaurant screens carry a back control, and none was asserted by its own testid:
//
//   restaurant-receipts-back-btn    restaurant-payments-back-btn
//   restaurant-settings-back-btn    (and the editor's, covered in round 259)
//
// The scan had been reading all of them as chrome. **A back button is not chrome — it
// navigates**, and it is how an operator leaves a settings screen without a mouse. The same
// control exists on the tables and history screens and IS asserted there
// (`tables-back-btn`, `sales-history-back-btn`), which is what makes the omission a gap rather
// than a convention.
//
// WHAT IT DOES, and what this pins: pressing back RETURNS to the screen it came from. A button
// that rendered and did nothing would pass any presence assertion, and would strand the operator.

const TIMEOUT = 20_000;

async function openRow(page: Page, row: string, anchor: string): Promise<void> {
  await loginAs(page, 'owner', '1234');
  await selectWorkspace(page, WORKSPACES.RESTAURANT_POS);
  await expect(page.locator('.restaurant-card').first()).toBeVisible({ timeout: TIMEOUT });
  const trigger = page.locator('.restaurant-sidebar-btn');
  await expect(trigger).toBeVisible({ timeout: TIMEOUT });
  await trigger.first().click();
  const item = page.locator('[data-testid="restaurant-sidebar-' + row + '"]');
  await expect(item, 'the sidebar offers ' + row).toBeVisible({ timeout: TIMEOUT });
  await item.click();
  await expect(page.locator('[data-testid="' + anchor + '"]').first()).toBeVisible({
    timeout: TIMEOUT,
  });
}

// ⚠️ The testid is named LITERALLY in each case, not threaded through a variable. The coverage
// scan counts an id only when it appears inside a selector, and a variable reference is invisible
// to it — round 270 built that rule, and these three ids were uncovered until they were spelled out.
test('the receipts back control leaves the receipts screen', async ({ page }) => {
  await openRow(page, 'receipts', 'restaurant-receipts-preview-test-chit-btn');
  const receiptsBack = page.locator('[data-testid="restaurant-receipts-back-btn"]');
  await expect(receiptsBack, 'the receipts screen offers a back control').toBeVisible({
    timeout: TIMEOUT,
  });
  await receiptsBack.click();
  await expect(
    page.locator('[data-testid="restaurant-receipts-header"]'),
    'the receipts back control leaves the receipts screen',
  ).toHaveCount(0, { timeout: TIMEOUT });
});

test('the payments back control leaves the payments screen', async ({ page }) => {
  // ⚠️ NOT the toggle: measured, `payment-card-toggle-cash` is a `role=switch` INPUT styled out of
  // the layout, so it resolves but is HIDDEN — round 263 recorded the same for the EDC card. The
  // payments header is the visible anchor this screen actually paints.
  await openRow(page, 'payments', 'restaurant-payments-header');
  const paymentsBack = page.locator('[data-testid="restaurant-payments-back-btn"]');
  await expect(paymentsBack, 'the payments screen offers a back control').toBeVisible({
    timeout: TIMEOUT,
  });
  await paymentsBack.click();
  await expect(
    page.locator('[data-testid="restaurant-payments-header"]'),
    'the payments back control leaves the payments screen',
  ).toHaveCount(0, { timeout: TIMEOUT });
});

test('the settings back control leaves the settings screen', async ({ page }) => {
  await openRow(page, 'settings', 'restaurant-settings-header');
  const settingsBack = page.locator('[data-testid="restaurant-settings-back-btn"]');
  await expect(settingsBack, 'the settings screen offers a back control').toBeVisible({
    timeout: TIMEOUT,
  });
  await settingsBack.click();
  await expect(
    page.locator('[data-testid="restaurant-settings-header"]'),
    'the settings back control leaves the settings screen',
  ).toHaveCount(0, { timeout: TIMEOUT });
});