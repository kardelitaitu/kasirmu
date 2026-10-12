// ── A kitchen chit must not name a table the order does not have ─────────────
//
// handleDispatchKitchenDelta builds the chit the pass actually cooks from:
//
//     buildKitchenChitReceipt({ cartLines: deltaLines, ..., tableNumber: tableNumber })
//
// `tableNumber` is passed straight through with no order-type check, and the
// builder turns it into BOTH the ticket number and a payload field:
//
//     receiptNumber: chitNumber ?? `KOT-${bareTableNumber(tableNumber) || 'ORDER'}-...`
//     ...(tableNumber ? { tableNumber } : {})
//
// The builder's `|| 'ORDER'` fallback is correct for a MISSING table, which is why
// the defect is invisible from inside it: the problem is that a value arrives at
// all. The Table field renders on restaurant POS unconditionally
// (CartPanel.tsx:864), so a takeaway with a stray number sends the pass a ticket
// that names table 99 — and the kitchen plates for a table that did not order.
//
// Of the twelve sites this is the one with the DIRECT physical consequence: every
// other mislabelled a record, this one misdirects food.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(resolve(__dirname, '../features/sales/PosScreen.tsx'), 'utf-8');

/** The handleDispatchKitchenDelta body — the chit builder's only production caller. */
function dispatchBody(): string {
  const at = SRC.indexOf('const handleDispatchKitchenDelta');
  // 3000, not the 1400 this started at: the fix carries an explanatory comment, and
  // a window sized to the code alone truncates before the dependency array.
  return at === -1 ? '' : SRC.slice(at, at + 3000);
}

describe('PosScreen kitchen chit table scoping', () => {
  it('derives the chit table under the dine-in rule', () => {
    const body = dispatchBody();
    expect(body.length, 'handleDispatchKitchenDelta moved — re-point this guard').toBeGreaterThan(0);
    expect(
      body,
      'the kitchen chit must derive its table under the dine-in rule. Passing ' +
        'tableNumber straight through sends the pass a ticket naming a table that ' +
        'did not order, because the Table field is populated on every order type.',
    ).toMatch(/tableNumber: chitTable/);
    expect(
      /const chitTable = orderType === 'dine_in'/.test(body),
      'chitTable must be derived from the order type before it is passed.',
    ).toBe(true);
  });

  it('lists orderType in the callback dependencies', () => {
    // Without it the chit closes over the mount-time order type — the same
    // stale-closure trap that tripped the print handler in round 5.
    //
    // The array is read as the LAST bracketed group in the callback, not by
    // searching for `}, [`: the close brace and the array sit on separate lines
    // whenever the handler carries a comment above the deps, which this one does.
    // A matcher keyed to the layout would have reported the fix as a failure.
    const body = dispatchBody();
    const open = body.lastIndexOf('[');
    expect(open, 'no dependency array found — re-point this guard').toBeGreaterThan(-1);
    const deps = body.slice(open);
    expect(
      deps,
      'orderType must be listed; otherwise a mid-sale switch to Takeaway still ' +
        'sends the pass a table. Deps found: ' + deps.replace(/\s+/g, ' '),
    ).toContain('orderType');
  });
});
