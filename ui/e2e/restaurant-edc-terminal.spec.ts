import { test, expect, type Page } from '@playwright/test';
import { openRestaurantSidebarRow } from './helpers';

// WHY THIS FILE EXISTS
//
// The payments screen is the weakest restaurant surface at 7 of 32, and `edc-default-select`
// with `edc-test-connection-btn` is the reachable pair there that is NOT a credential form.
//
// ROUND 224 REPORTED THIS BLOCK UNREACHABLE, and that was wrong. It probed with
// `sel.locator('option')` and got `[]` twice — but `SettingsSelect` is a CUSTOM dropdown, not a
// native `<select>` (features/settings/SettingsSelect.tsx:31-39). It renders a trigger button
// plus a PORTAL containing `role=option` elements, only while `open` (:296, :307).
//
// So there are no `<option>` elements at any time, and the empty reading measured nothing. The
// same instrument error as round 224's templated testid: a probe that returns empty is evidence
// about the probe until it is shown to be evidence about the subject.
//
// Confirmed reachable by calling the app's OWN api from the page:
//   listEdcTerminalsScoped('mock-session-token') -> 2 rows, both isActive.

const TIMEOUT = 20_000;

async function openPayments(page: Page): Promise<void> {
  await openRestaurantSidebarRow(page, 'payments');
  await expect(page.locator('[data-testid="payment-card-toggle-cash"]')).toBeAttached({
    timeout: TIMEOUT,
  });
}

test('the EDC dropdown offers the configured terminals', async ({ page }) => {
  await openPayments(page);

  const select = page.locator('[data-testid="edc-default-select"]');
  await expect(select, 'the card rail offers a default-terminal control').toBeVisible({
    timeout: TIMEOUT,
  });

  // The control is a BUTTON. Its options live in a portal that only exists while open,
  // which is what round 224's `locator('option')` probe could never see.
  await select.click();
  const options = page.locator('[role="option"]');
  await expect.poll(() => options.count(), { timeout: 8_000 }).toBeGreaterThan(0);

  // The seeded terminals are named in the list — 'Counter 1 - BCA EDC' and 'Mobile Mandiri
  // PAX' (dev-mock/handlers/payment.ts:155-175) — so the operator picks a real device
  // rather than an opaque id.
  await expect(options.filter({ hasText: /BCA EDC/ }).first()).toBeVisible({ timeout: 8_000 });
});

test('choosing a terminal arms Save', async ({ page }) => {
  await openPayments(page);

  const select = page.locator('[data-testid="edc-default-select"]');
  const save = page.locator('[data-testid="restaurant-payments-save-btn"]');

  // A freshly loaded screen has nothing to save.
  await expect(select).toBeVisible({ timeout: TIMEOUT });
  await expect(save).toBeDisabled({ timeout: TIMEOUT });

  await select.click();
  const terminal = page.locator('[role="option"]').filter({ hasText: /BCA EDC/ }).first();
  await expect(terminal).toBeVisible({ timeout: 8_000 });
  await terminal.click();

  // Picking a terminal must arm Save. NOTE the arm alone is a WEAK claim here, and the
  // kill-test proved it: removing `updateRailParams('card', { defaultTerminalId: v })`
  // still arms Save, because `computeRailsDirty` returns true on the terminal ID ALONE
  // (`paymentRailsLogic.ts:104`). So the arm is pinned, and so is the thing that actually
  // persists it — below.
  await expect(save, 'picking a terminal must arm Save').toBeEnabled({ timeout: 8_000 });

  // THE PART THAT CARRIES THE VALUE. Saving must write the chosen terminal into the card
  // rail's parameters, which is what a reload reads back (`:1236` writes it; `handleSave`
  // persists `d.parameters` for a non-provider rail). The arm above would pass on a screen
  // that merely remembered the id in React state and lost it on save.
  await save.click();
  await expect(save).toBeDisabled({ timeout: TIMEOUT });

  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const raw = localStorage.getItem('oz-dev-mock:local-payment-methods');
          if (!raw) return null;
          for (const scope of Object.values(JSON.parse(raw) as Record<string, unknown>)) {
            if (!Array.isArray(scope)) continue;
            const card = scope.find((r) => (r as { rail_code?: string }).rail_code === 'card');
            if (!card) continue;
            const params = JSON.parse((card as { parameters?: string }).parameters ?? '{}');
            const id = (params as { defaultTerminalId?: string }).defaultTerminalId;
            if (id !== undefined) return id;
          }
          return null;
        }),
      { timeout: TIMEOUT, message: 'the card rail must carry the chosen terminal' },
    )
    .toBeTruthy();
});