/**
 * @vitest-environment node
 *
 * This file's entire import graph is free of browser globals (no render, no
 * `document`/`window`/`localStorage`), so it does not need a jsdom window. Vitest
 * spawns a fresh jsdom per test FILE, which measured ~0.4-0.9s each; under the node
 * environment the same files report `environment: 0ms`.
 *
 * Do not copy this directive onto a file that renders or touches browser state —
 * it will fail with "document is not defined" rather than silently degrade.
 */
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
const HELD_CARTS_HOOK = read('../features/sales/hooks/usePosHeldCarts.ts');

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

  it('split-bill REMAINING tab — the table it writes into the saved tab', () => {
    // The SIXTH site, found in the split-bill feature (276d6ce04). Its handler
    // builds the remaining tab's cart_data, label and customer_name from
    // `tableNumber` with no order-type check — and writes `orderType` into the
    // same record, so a takeaway could persist
    // `{"tableNumber":"T99","orderType":"takeaway"}`: the identical
    // self-contradicting payload fixed on the PaymentModal path in 795fc18d4.
    //
    // Assert the handler derives its table under the dine-in rule. Matched as the
    // derivation, not a bare string, so a comment cannot satisfy it.
    const guards = POS_SCREEN.match(
      /const trimmedTable = orderType === 'dine_in' \? \(tableNumber \?\? ''\)\.trim\(\) : ''/g,
    ) ?? [];
    // ⚠️ At least TWO, not exactly one. Pinning the count is what made this guard
    // BLIND to the seventh site: the rule was asserted as "appears once" rather than
    // "appears wherever the field is derived", so the pre-bill / send-to-kitchen
    // handler added in the same feature landed unguarded and this stayed green.
    expect(
      guards.length,
      'every handler that derives a table for a saved tab must apply the dine-in ' +
        'rule — found ' + guards.length + ' of at least 2 in PosScreen (the split-bill ' +
        'tab and the send-to-kitchen open bill), plus a third in the held-carts hook. ' +
        'Without it a takeaway persists a table number it does not own.',
    ).toBeGreaterThanOrEqual(2);
    // The third builder lives in the hook, and it is the path that actually saves a
    // tab — so it is asserted by name rather than left to the count above.
    expect(
      HELD_CARTS_HOOK,
      'usePosHeldCarts builds the saved tab and must apply the same dine-in rule; it ' +
        'writes tableNumber and orderType into one record.',
    ).toContain("const trimmedTable = orderType === 'dine_in'");
  });

  it('send-to-kitchen OPEN BILL — the table it writes when persisting the tab', () => {
    // The SEVENTH site, same feature as the sixth, found 2026-10-12 by asking which
    // OTHER payloads build a cart_data. handleSendToKitchen derives `trimmedTable`
    // unconditionally and then uses it twice:
    //
    //   if (activeOpenBillId || trimmedTable) { ... }   // the whole block runs
    //   cart_data: { tableNumber: trimmedTable, orderType }   // self-contradicting
    //   customer_name: ... || `Table ${bareTableNumber(trimmedTable)}`
    //
    // so a takeaway with a stray number in the Table field opened a tab named after
    // a table it does not own, and wrote the kitchen dispatch into it. The
    // order-type field itself rode along, which is what makes the payload
    // contradict itself rather than merely being wrong.
    const kitchen = POS_SCREEN.slice(
      POS_SCREEN.indexOf('const handleSendToKitchen'),
      POS_SCREEN.indexOf('const handleSendToKitchen') + 3000,
    );
    expect(kitchen.length, 'handleSendToKitchen moved — re-point this guard').toBeGreaterThan(0);
    expect(
      /const trimmedTable = orderType === 'dine_in'/.test(kitchen),
      'handleSendToKitchen derives its table unconditionally, so a takeaway with a ' +
        'stray table number opens an open bill it does not own and names it after ' +
        "that table. It must derive the table under the same dine-in rule as the " +
        'split-bill handler.',
    ).toBe(true);
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
