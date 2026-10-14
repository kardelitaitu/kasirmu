// ── grandTotal's null contract, and why the assertion was a trap ────────
//
// RetailCartPanel.grandTotal() opened with:
//
//     const base = totals.total!;      // the type says Money | null
//
// The `!` was TRUE at its one call site, which guards with `totals.total ? ...`
// 370 lines away. That is the shape that breaks silently: the assertion's
// correctness lives in a different part of the file from the assertion, so a second
// caller — a new total row, a receipt line, an export — would compile and then throw
// on a null-money cart, inside render, which React retries.
//
// The fix is a signature, not a guard: grandTotal takes the nullable value and
// RETURNS null for it. The type then carries the fact, and the caller's own ternary
// disappears because it no longer has a second way to be wrong.
//
// These cases pin the contract. They are plain function tests rather than rendered
// ones because the property is about the TYPE and the return value; the rendered
// arithmetic is covered in RetailCartPanel.test.tsx:374+.

import { describe, it, expect } from 'vitest';
import { grandTotal } from '@/features/retail/RetailCartPanel';

const idr = (minor_units: number) => ({ minor_units, currency: 'IDR' });

function totals(overrides: Partial<Parameters<typeof grandTotal>[0]> = {}) {
  return {
    subtotal: idr(100_000),
    total: idr(100_000),
    discountPercent: 0,
    discountAmount: null,
    cartTax: 0,
    cartTaxExclusive: false,
    ...overrides,
  };
}

describe('grandTotal null contract', () => {
  it('returns null when the cart has no total', () => {
    // The case the non-null assertion could not express. A caller passing this used to
    // get a runtime TypeError; now it gets null and can render an em dash.
    expect(grandTotal(totals({ total: null }))).toBeNull();
  });

  it('returns the base total when tax is inclusive', () => {
    // Inclusive tax is already embedded in the line prices, so adding it again
    // over-charges. This is the rule the whole function exists for.
    expect(grandTotal(totals({ cartTax: 15_000, cartTaxExclusive: false }))).toEqual(idr(100_000));
  });

  it('adds exclusive tax on top', () => {
    expect(grandTotal(totals({ cartTax: 15_000, cartTaxExclusive: true }))).toEqual(idr(115_000));
  });

  it('adds nothing when an exclusive tax is zero', () => {
    expect(grandTotal(totals({ cartTax: 0, cartTaxExclusive: true }))).toEqual(idr(100_000));
  });

  it('never mutates the input total', () => {
    const t = totals({ cartTax: 15_000, cartTaxExclusive: true });
    const before = { ...t.total! };
    grandTotal(t);
    expect(t.total).toEqual(before);
  });
});
