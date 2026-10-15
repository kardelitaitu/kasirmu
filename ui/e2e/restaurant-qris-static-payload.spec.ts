import { test, expect, type Page } from '@playwright/test';
import { openRestaurantSidebarRow } from './helpers';

// WHY THIS FILE EXISTS
//
// `qris-static-payload-input` is one of the four ids round 283 classified as NOT chrome: it writes
// through a named transform, `writeStaticQrPayload` (`api/local-payment.ts:98`), whose invariants are
// unit-pinned at `PaymentModalSaleFlow.test.tsx:2135` — read tolerates junk, write preserves
// siblings, empty DELETES the key, malformed bags are REFUSED rather than laundered.
//
// What that unit test cannot show is that typing into the FIELD reaches the transform. This pins the
// round trip.
//
// THREE MEASURED FACTS, and rounds 284-285 each got one wrong:
//
//   1. the field mounts LATE. Bisected: present 0 times when the sidebar helper returns, 1 after
//      ~1.2s — the card body mounts once the rail read resolves. Wait for the FIELD.
//   2. the card is ALREADY expanded and clicking its toggle COLLAPSES it. Measured: its wrapper
//      carries `resto-payment-card-wrapper--expanded`, and the field count goes 1 -> 0 after a
//      toggle click. So there is nothing to open, and opening is harmful (round 257's trap).
//   3. SAVE DOES NOT UNMOUNT THE CARD. The field is still present afterwards and keeps its value.
//      Round 285's `AFTER=ERR` came from the expand click it performed after the save, not from the
//      save — which is why the round trip needs no reopen at all.

const TIMEOUT = 20_000;

async function openPayments(page: Page): Promise<void> {
  await openRestaurantSidebarRow(page, 'payments');
  // Wait for the FIELD, not the header: the header paints first and asserts nothing about this
  // control (round 252's rule — wait for the thing whose state you are measuring).
  await expect(
    page.locator('[data-testid="qris-static-payload-input"]'),
    'the qris card body mounts once the rail read resolves',
  ).toBeVisible({ timeout: TIMEOUT });
}

test('the static QRIS payload survives a save', async ({ page }) => {
  await openPayments(page);

  const payload = page.locator('[data-testid="qris-static-payload-input"]');
  await expect(
    page.locator('[data-testid="qris-mode-static"]'),
    'static is the default mode, and the mode this field belongs to',
  ).toBeVisible({ timeout: TIMEOUT });

  // A value deliberately NOT a valid EMVCo string: this asserts the ROUND TRIP, not validation, so
  // whatever the operator typed must come back unchanged.
  const typed = 'PROBE-STATIC-QR-' + Date.now();
  await payload.fill(typed);
  await expect(payload, 'the field reflects what was typed').toHaveValue(typed, { timeout: 5_000 });

  await page.locator('[data-testid="restaurant-payments-save-btn"]').first().click();

  // THE CLAIM: the value the operator typed is still there once the save round-trips. A field wired
  // to nothing — or one whose write is dropped — loses it here.
  await expect(
    payload,
    'the payload must survive a save — it reaches the saved configuration',
  ).toHaveValue(typed, { timeout: TIMEOUT });

  // AND THE SAVE REPORTED ITSELF. Without this the case would pass on a control whose save button
  // did nothing at all, since the field would simply keep the local value it already had.
  await expect(
    page.getByText(/saved successfully/i).first(),
    'the save must report itself, or the value above proves nothing',
  ).toBeVisible({ timeout: TIMEOUT });
});