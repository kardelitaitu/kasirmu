import { test, expect, type Page } from '@playwright/test';
import { openRestaurantSidebarRow } from './helpers';

// WHY THIS FILE EXISTS
//
// The Midtrans credential fields were deferred TWICE (rounds 225, 257) as *"the one group where a
// test's value is lower than the care it would need to write"*. Round 262 applied the session's
// standing question to that deferral — are these gated by an entitlement rather than by a missing
// test? — and measured all six ids present after opening the card:
//
//```
// REST    all six counts 0
// AFTER   all six counts 1    ← reachable, merely unexplored
//```
//
// So the deferral was wrong in its reason. This covers the part that IS behaviour and not secret
// handling: the environment selector, and the credential check that reports on PRESENCE only.
//
// Test API Keys (`:1411-1424`) mirrors Stripe's Verify Keys (round 229), and for the same reason:
// `isConfigured` picks success or warning. A case asserting only one arm passes on a control
// hard-coded either way — the round-229/230 pairing rule, applied for a THIRD provider.

const TIMEOUT = 20_000;

async function openMidtrans(page: Page): Promise<void> {
  await openRestaurantSidebarRow(page, 'payments');
  await expect(page.locator('[data-testid="payment-card-toggle-cash"]')).toBeAttached({
    timeout: TIMEOUT,
  });

  // The card mounts its body only while open — the same gate as the EDC card. Round 257 measured
  // that a rail toggle is NOT needed for the EDC select; Midtrans's card IS collapsed on a fresh
  // profile, so its label click is what reveals the fields. Toggles are `role=switch` inputs styled
  // out of the layout, hence the LABEL (rounds 148, 170, 179, 228, 242).
  await page.locator('label[for="rail-toggle-midtrans"]').first().click();
  await expect(
    page.locator('[data-testid="midtrans-merchant-id-input"]'),
    'the card opens with its credential fields',
  ).toBeVisible({ timeout: TIMEOUT });
}

test('the environment selector names the gateway it is configuring', async ({ page }) => {
  await openMidtrans(page);

  // Two arms, and they are mutually exclusive SELECTED state: only one can be active, so a control
  // that ignored the click would keep the default and fail the second half.
  const sandbox = page.locator('[data-testid="midtrans-env-sandbox"]');
  const production = page.locator('[data-testid="midtrans-env-production"]');
  await expect(sandbox).toBeVisible({ timeout: TIMEOUT });

  const activeClass = 'resto-segmented-btn--active';
  await expect(sandbox, "sandbox is the default a fresh profile starts on").toHaveClass(
    new RegExp(activeClass),
  );

  await production.click();
  await expect(production, "picking production moves the active marker").toHaveClass(
    new RegExp(activeClass),
  );
  await expect(sandbox, "and takes it off the previous option").not.toHaveClass(
    new RegExp(activeClass),
  );
});

test('Test API Keys reports on presence, not on a hard-coded answer', async ({ page }) => {
  await openMidtrans(page);

  const test = page.locator('[data-testid="midtrans-test-api-btn"]');
  await expect(test, 'the card offers a credential check').toBeVisible({ timeout: TIMEOUT });

  // ARM 1: nothing filled in, so it must NOT claim the keys are valid. A control that always
  // reported success would tell an operator their gateway was configured when it was not.
  await test.click();
  await expect(
    page.getByText(/missing|enter/i).first(),
    'an empty configuration must be reported as missing',
  ).toBeVisible({ timeout: TIMEOUT });

  // ARM 2: fill both key fields and the SAME click must now report valid. The presence pair is
  // what makes arm 1 a check rather than a constant — and it is why the secret's value is never
  // read here: only whether the fields are non-empty (`:1412`).
  await page.locator('[data-testid="midtrans-client-key-input"]').fill('SB-Mid-client-x');
  await page.locator('[data-testid="midtrans-server-key-input"]').fill('SB-Mid-server-y');
  await test.click();
  await expect(
    page.getByText(/valid/i).first(),
    'a filled configuration must be reported as valid',
  ).toBeVisible({ timeout: TIMEOUT });
});