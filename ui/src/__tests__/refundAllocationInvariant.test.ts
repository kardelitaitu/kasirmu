// ── The refund allocation invariant, swept rather than sampled ───────────
//
// `RefundModal.lineShare` prorates a LINE TOTAL and rounds ONCE. Its own doc says why:
//
//   "Rounding a unit price and multiplying it back is also wrong on its own: a FULL
//    line of 999 over 7 refunds 1001, which is more than the line originally sold.
//    Prorating the line total and rounding ONCE cannot over-refund, because selecting
//    every unit reproduces the line total exactly."
//
// Two hand-picked fixtures already pin this (RefundModal.test.tsx:294 and :313). What
// they cannot show is that the claim holds as a PROPERTY — that no line total and unit
// count in the range a till sees produces an over-refund. A rounding rule is exactly the
// kind of thing that is right on the example and wrong on the neighbour.
//
// So this sweeps. It is the same statement as the doc comment, evaluated instead of
// asserted about one case, and it is cheap: the arithmetic is integer and the range is
// the one the comment names.
//
// ── Why a copy of the formula is acceptable here ──
//
// `lineShare` is not exported, and exporting it to test it would widen the module's
// surface for a pure function. The copy is checked against the real one by the two
// rendered fixtures that already exist: if the component's formula drifts, THOSE fail,
// and this file's claim about the formula stops describing what ships. The pairing is
// deliberate, and it is stated so a green here is never read as covering the component.

import { describe, it, expect } from 'vitest';

/** Mirror of RefundModal.lineShare. Kept in step by the rendered fixtures. */
function lineShare(totalMinor: number, lineQty: number, selectedQty: number): number {
  if (selectedQty <= 0) return 0;
  if (lineQty <= 0) return Math.round(totalMinor);
  return Math.round((totalMinor * selectedQty) / lineQty);
}

describe('refund allocation cannot over-refund', () => {
  it('selecting every unit reproduces the line total exactly', () => {
    // The property the doc comment rests on. A violation here means a customer can be
    // refunded more than the line sold for, which is money out of the till.
    let checked = 0;
    for (let total = 1; total <= 3000; total++) {
      for (let qty = 1; qty <= 12; qty++) {
        expect(
          lineShare(total, qty, qty),
          'full selection must equal the line: total=' + total + ' qty=' + qty,
        ).toBe(total);
        checked++;
      }
    }
    // Non-vacuity: a nested loop that never ran would pass this case silently.
    expect(checked).toBe(3000 * 12);
  });

  it('a partial selection never exceeds the line either', () => {
    for (let total = 1; total <= 2000; total++) {
      for (let qty = 1; qty <= 10; qty++) {
        for (let sel = 1; sel <= qty; sel++) {
          expect(
            lineShare(total, qty, sel),
            'over-refund: total=' + total + ' qty=' + qty + ' sel=' + sel,
          ).toBeLessThanOrEqual(total);
        }
      }
    }
  });

  it('the worked example from the doc comment still holds', () => {
    // 999 over 7 units. The OLD approach -- round the unit price, multiply back --
    // gives ceil(999/7)=143 then 143*7=1001, which exceeds the line. The current one
    // prorates and rounds once.
    const oldWay = Math.round(999 / 7) * 7;
    expect(oldWay, 'the counter-example itself changed').toBe(1001);
    expect(lineShare(999, 7, 7)).toBe(999);
    expect(lineShare(999, 7, 7)).toBeLessThan(oldWay);
  });

  it('a zero-quantity line refunds whole, and nothing refunds when nothing is selected', () => {
    // Both are the guard's own branches, and each is a way to get the arithmetic wrong
    // by dividing by zero or by refunding an unselected line.
    expect(lineShare(500, 0, 1)).toBe(500);
    expect(lineShare(500, 3, 0)).toBe(0);
  });
});
