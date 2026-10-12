// ── The order-type rule is applied at ALL five consumers of cart identity state ──
//
// Rounds 40-44 fixed five sites where an order-type-DEPENDENT field was read as
// though it were unconditional (docs/records/audits/restaurant-pos-order-type-fields.md).
// Each has its own behavioural test. This file guards the CLASS:
//
//   the rule is "dine_in only", and it must be applied at every consumer, not
//   most of them.
//
// WHY A SOURCE-LEVEL SWEEP is worth having on top of five behavioural tests: the
// five sites live in three files and the failure mode is PARTIAL application —
// which is exactly how the series went. #1 was fixed while #2 was not; #2 while
// #3 was not. Each round found the next one by reading the field again. A test
// that asserts every consumer at once fails the moment a sixth appears or a
// guard is dropped, instead of waiting for someone to think of looking.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf-8');

const PAYMENT_MODAL = read('../features/sales/PaymentModal.tsx');
const POS_SCREEN = read('../features/sales/PosScreen.tsx');
const CART_PANEL = read('../features/sales/components/CartPanel.tsx');

const DINE_IN = "orderType === 'dine_in'";

describe('the dine-in rule is applied at every consumer of cart identity state', () => {
  it('table CLAIM — both checkout paths (cash/QRIS and card/terminal)', () => {
    // Two paths, and fixing only one leaves the defect reachable by switching
    // tender. That asymmetry was the round-40 finding.
    const guards = PAYMENT_MODAL.match(
      /if \(sessionToken && tableNumber && orderType === 'dine_in'\)/g,
    ) ?? [];
    expect(
      guards.length,
      'both assignment paths must carry the guard — found ' + guards.length + ' of 2. ' +
        'A single-path fix leaves the other reachable.',
    ).toBe(2);
  });

  it('table RELEASE — PosScreen completion', () => {
    const guards = POS_SCREEN.match(
      /if \(tableNumber && sessionToken && orderType === 'dine_in'\)/g,
    ) ?? [];
    expect(
      guards.length,
      'the release must be dine-in only, or a takeaway frees a table it never claimed',
    ).toBe(1);
  });

  it('open-bill PAYLOAD — the saved table number', () => {
    const guards = PAYMENT_MODAL.match(
      /const trimmedTable = orderType === 'dine_in'/g,
    ) ?? [];
    expect(
      guards.length,
      'the open-bill table must be dine-in only, or the tab persists a table it ' +
        'does not own',
    ).toBe(1);
  });

  it('table DISPLAY — the active-tab banner', () => {
    const guards = CART_PANEL.match(/showTableForOrder = orderType === 'dine_in'/g) ?? [];
    expect(
      guards.length,
      'the banner must not NAME a table on a non-dine-in order',
    ).toBe(1);
  });

  it('PAX field — the seated-guests prompt', () => {
    // products.ftl:105 defines pax as "seated guests per table", so the prompt is
    // dine-in only. Matched as the render condition, not the bare string, so a
    // comment mentioning the rule cannot satisfy this.
    const guards = CART_PANEL.match(/guestCountEnabled !== false && orderType === 'dine_in' &&/g) ?? [];
    expect(
      guards.length,
      'the pax prompt must be dine-in only (a takeaway has no table to seat)',
    ).toBe(1);
  });

  it('every guard uses the SAME spelling of the rule', () => {
    // Five sites agreeing by convention is the thing being protected. A guard
    // written as `orderType !== 'takeaway'` would be WRONG (it would let delivery
    // through) while still looking like a guard — so assert the positive form.
    const negativeForms = [
      ...PAYMENT_MODAL.matchAll(/orderType !== 'dine_in'/g),
      ...POS_SCREEN.matchAll(/orderType !== 'dine_in'/g),
      ...CART_PANEL.matchAll(/orderType !== 'dine_in'/g),
    ];
    expect(
      negativeForms.length,
      'no consumer may use the negative form — only dine_in means a table, and ' +
        '\'!== dine_in\' would wrongly admit delivery',
    ).toBe(0);

    // And the sources must still actually contain the positive rule, so this file
    // cannot pass vacuously against a refactor that deleted them all.
    expect(PAYMENT_MODAL).toContain(DINE_IN);
    expect(POS_SCREEN).toContain(DINE_IN);
    expect(CART_PANEL).toContain(DINE_IN);
  });

  it('the customer-name field is deliberately NOT restricted', () => {
    // A takeaway still has a customer to name on the ticket, so restricting it
    // would be a regression introduced by symmetry with the table/pax cases.
    // Asserted so a future "tidy pass" cannot remove it.
    const customerGate = CART_PANEL.match(/setCustomerName && customerNameEnabled !== false && \(/g) ?? [];
    expect(
      customerGate.length,
      'the customer-name render gate must NOT carry an order-type condition',
    ).toBe(1);
  });
});
