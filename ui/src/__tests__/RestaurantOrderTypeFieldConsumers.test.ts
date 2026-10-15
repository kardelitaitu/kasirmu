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
const FLOATING_CART_BAR = read('../features/restaurant/components/RestaurantFloatingCartBar.tsx');
const CART_SHEET = read('../features/restaurant/components/RestaurantCartSheet.tsx');
const SPLIT_BILL_MODAL = read('../features/sales/components/SplitBillModal.tsx');

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
    // ⚠️ The window is 6000, not 3000. It was 3000 and the rule sat at ~2700 —
    // close enough that round 201's fix (a comment on the dispatch record, which
    // sits BETWEEN the handler's head and `trimmedTable`) pushed it to 3956 and
    // this guard failed RED on a change that did not touch the dine-in rule at
    // all. A character-count window is a fragile way to scope a region; the size
    // is chosen to leave the rule well inside it rather than near the edge.
    const kitchen = POS_SCREEN.slice(
      POS_SCREEN.indexOf('const handleSendToKitchen'),
      POS_SCREEN.indexOf('const handleSendToKitchen') + 6000,
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

  it('print-bill GATE and PAYLOAD — the table it names on an interim check', () => {
    // The NINTH site, found 2026-10-12 by sweeping every derivation rather than the
    // payloads alone. Two halves, both unguarded:
    //
    //   CartActionBar gates the button on `Boolean(tableNumber?.trim()) ||
    //   Boolean(activeOpenBillId)` — the SAME condition that made site 7's whole
    //   open-bill block run. The table field renders on restaurant POS
    //   unconditionally (CartPanel.tsx:864), so on a takeaway with a stray number
    //   the button APPEARS.
    //
    //   handlePrintBill then puts that table into the printed args, and
    //   completedSale.ts:212 derives the receipt NUMBER from it too — so the check
    //   handed to the customer names a table the order does not have.
    //
    // An interim bill is a table's check. A takeaway gets a receipt, not a check
    // for table 99.
    const actionBar = read('../features/sales/components/CartActionBar.tsx');
    expect(
      actionBar,
      'the Print Bill button must not treat a bare table number as a reason to show ' +
        'itself on a non-dine-in order; the button gates on the same unguarded ' +
        'condition that let site 7 run its open-bill block.',
    ).toContain("orderType === 'dine_in'");

    const printHandler = POS_SCREEN.slice(
      POS_SCREEN.indexOf('const handlePrintBill'),
      POS_SCREEN.indexOf('const handleConfirmSplitBill'),
    );
    expect(printHandler.length, 'handlePrintBill moved — re-point this guard').toBeGreaterThan(0);
    expect(
      /const billTable = orderType === 'dine_in'/.test(printHandler),
      'handlePrintBill must derive the table it prints under the dine-in rule; ' +
        'otherwise a takeaway with a stray number prints a check naming that table, ' +
        'and completedSale.ts derives the receipt number from it.',
    ).toBe(true);
  });

  it('portrait cart bar and sheet — the table they show on the TABLET', () => {
    // The TENTH and ELEVENTH consumers, found 2026-10-12 by walking the portrait
    // path rather than the desktop one. The tablet is where a restaurant POS
    // actually runs, and both of these are always in view: the bar sits pinned at
    // the bottom all service, and the sheet holds the whole sale.
    //
    // Both derived their table chrome from `tableNumber` alone. Combined with the
    // field rendering unconditionally (CartPanel.tsx:864), a takeaway with a stray
    // number advertised a table it does not have on the surface the cashier looks
    // at continuously.
    for (const [label, src] of [
      ['RestaurantFloatingCartBar', FLOATING_CART_BAR],
      ['RestaurantCartSheet', CART_SHEET],
    ] as Array<[string, string]>) {
      expect(
        src,
        label + ' must gate its table chrome on the order type; it renders the ' +
          'table from tableNumber alone, which the Table field populates on every ' +
          'order type.',
      ).toContain("orderType === 'dine_in'");
    }
  });

  it('the kitchen CHIT carries no table for a non-dine-in order', () => {
    // The TWELFTH site, and the only one with a physical consequence: every other
    // mislabelled a record, this one misdirects FOOD. handleDispatchKitchenDelta
    // passed tableNumber straight into buildKitchenChitReceipt, which turns it into
    // both the ticket number (KOT-99-...) and a payload field -- so a takeaway with
    // a stray number sent the pass a chit naming a table that did not order.
    const dispatch = POS_SCREEN.slice(
      POS_SCREEN.indexOf('const handleDispatchKitchenDelta'),
      POS_SCREEN.indexOf('const handleSendToKitchen'),
    );
    expect(dispatch.length, 'handleDispatchKitchenDelta moved - re-point this guard').toBeGreaterThan(0);
    expect(
      dispatch,
      'the kitchen chit must derive its table under the dine-in rule. The builder ' +
        'fallback to ORDER is not the guard: it handles a MISSING table, not a ' +
        'table that should never have been sent.',
    ).toContain("const chitTable = orderType === 'dine_in'");
  });

  it('the split dialog names no table for a non-dine-in order', () => {
    // The THIRTEENTH site. The modal header rendered the table from the field alone
    // and the dialog is reachable on any order type.
    expect(
      SPLIT_BILL_MODAL,
      'SplitBillModal must gate its header table on the order type; a takeaway ' +
        'with a stray number announced a table on the split dialog.',
    ).toContain("orderType === 'dine_in'");
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
