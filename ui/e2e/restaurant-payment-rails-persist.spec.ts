import { test, expect, type Page } from '@playwright/test';
import { loginAs, selectWorkspace, WORKSPACES } from './helpers';

/**
 * E2E: Restaurant POS — the Payments rail toggles actually write (F40).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * F40 (round 89, `267e23e9e`) found the restaurant Payments screen's rail toggles could not be
 * saved at all on the device: the store's `local_payment_methods` table held zero rows, every
 * card sat on the defaulted branch, and Save stayed disabled while the header read "All changes
 * saved". The fix landed and the plan has carried `the device confirmation is outstanding`
 * since round 90.
 *
 * Round 111 tried to close it on the tablet and established the blocker is a FIXTURE, not a
 * defect: the device now shows exactly one workspace card ("Retail POS"), so the restaurant
 * Payments screen is unreachable there at all. `adb devices` is empty in this environment.
 *
 * WHAT THIS PROVES, AND WHAT IT CANNOT
 * ------------------------------------
 * It proves the screen's own write path: a toggle arms Save, Save issues the write, and the
 * rail read back through the IPC agrees with what was clicked. That is the half of F40 the
 * defect was in — the screen never reached the write at all.
 *
 * It canNOT prove durability across a restart, and not because of a gap in the test: the dev
 * mock's rail store is a `new Map()` held in module memory with no `readSlice`/`writeSlice`
 * (`handlers/payment.ts:24-30` — *"Session-local maps — the mock has no multi-row table"*).
 * A page reload wipes it, so an assertion about surviving one would be testing the mock's
 * documented design rather than the screen. The DB half stays owed to the device.
 *
 * Selectors: the rail `input` is styled out (same pattern as round 148's settings toggles),
 * so state is read through `aria-checked` and the click goes through its label.
 */

const TIMEOUT = 20_000;

async function openPayments(page: Page): Promise<void> {
  await loginAs(page, 'owner', '1234');
  await selectWorkspace(page, WORKSPACES.RESTAURANT_POS);
  await expect(page.locator('.restaurant-card').first()).toBeVisible({ timeout: TIMEOUT });

  const sidebarBtn = page.locator('.restaurant-sidebar-btn');
  await expect(sidebarBtn).toBeVisible({ timeout: TIMEOUT });
  await sidebarBtn.click();
  await page.locator('[data-testid="restaurant-sidebar-payments"]').click();

  await expect(page.locator('[data-testid="restaurant-payments-save-btn"]')).toBeVisible({
    timeout: TIMEOUT,
  });
}

test('F40: the rail toggle arms Save, writes, and reads back', async ({ page }) => {
  await openPayments(page);

  // The effective read is what the cards render, so an empty switch list means the read
  // failed — the defaulted branch F40's device evidence described.
  const switches = page.locator('[role="switch"]');
  await expect.poll(() => switches.count(), { timeout: TIMEOUT }).toBeGreaterThan(3);

  const save = page.locator('[data-testid="restaurant-payments-save-btn"]');

  // F40's signature was Save staying DISABLED while an edit was on screen. Assert the
  // opposite here, before any click, so a regression to that state fails on this line.
  const first = switches.first();
  const before = await first.getAttribute('aria-checked');
  const rail = (await first.getAttribute('data-testid')) ?? '';
  const railId = rail.replace(/^payment-card-toggle-/, '');
  expect(railId, 'the first switch should carry a rail testid').not.toBe('');

  await page.locator(`label[for="rail-toggle-${railId}"]`).first().click();
  const after = before === 'true' ? 'false' : 'true';
  await expect(first).toHaveAttribute('aria-checked', after, { timeout: 8_000 });

  await expect(save, 'an edit must arm Save — F40 left it disabled').toBeEnabled({
    timeout: 8_000,
  });
  await save.click();

  // The write is acknowledged: Save goes back to disabled and the header leaves the
  // dirty state. A save that silently did nothing would leave it enabled.
  await expect(save).toBeDisabled({ timeout: TIMEOUT });

  // And the toggle still reads what was clicked — the drafts were not re-seeded from a
  // stale baseline, which would flip it back.
  await expect(first).toHaveAttribute('aria-checked', after);
});