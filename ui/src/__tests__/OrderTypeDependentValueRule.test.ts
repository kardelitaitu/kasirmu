// ── The ORDER-TYPE-DEPENDENT VALUE rule, asserted field-agnostically ────────
//
// THE HISTORY THAT PRODUCED THIS FILE
//
// Rounds 40-48 fixed thirteen sites where a value only meaningful for a DINE-IN
// order reached a consumer unconditionally: the table claim, the release, the
// open-bill payload, the cart banner, the pax field, the split tab, the
// send-to-kitchen tab, the held-cart hook, the printed check, the portrait bar,
// the portrait sheet, the kitchen chit, the split dialog. Round 49 found the SAME
// class on the sibling field `guestCount` — a party size persisted onto a
// takeaway, and restored by a recall.
//
// Every one of those was found by a sweep keyed to a FIELD. That is the weakness
// this file removes: a field-keyed sweep finds the field you name, and round 49
// happened only because someone chose to look next door. The rule is not about a
// field:
//
//     A value only meaningful for a DINE-IN order must not reach a consumer
//     unless the order type permits it.
//
// THE FIELD SET IS CLOSED, AND THAT WAS CHECKED — not assumed
//
// The persisted payloads write: lines, discountPercent, discountLabel,
// tableNumber, customerName, guestCount, tipPercent, serviceChargeEnabled,
// serviceChargePercent, orderType. Exactly TWO are dine-in-only:
//
//   tableNumber  — a table exists only for a dine-in order       (rounds 40-48)
//   guestCount   — "SEATED GUESTS PER TABLE" (products.ftl:105)   (round 49)
//
// The rest are deliberately NOT restricted, each for a reason: a discount and a
// tip apply to any order; a service charge can; and customerName is asserted
// unrestricted below because a takeaway still names its customer.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO
//
// It does NOT try to detect an *enclosing* block gate. Two attempts were made and
// both were wrong: a 16-line lookback excused a reverted guard because a
// NEIGHBOURING derivation carried the rule, and a brace-depth walk mis-read the
// gate at PosScreen:766 because the nested .then() block never returns depth to
// zero. Each version reported a fix as a failure, or a failure as a fix.
//
// So the rule is asserted where it is unambiguous — ON THE DERIVATION LINE — and
// the one genuine block-gated case is named explicitly with its reason. That is a
// narrower check than 'any gate anywhere', and it is the narrower claim this file
// can actually prove: reverting the guards makes it FAIL (verified: 6 and 2
// offenders in the two files), which the broader versions did not.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf-8');

const SOURCES: Array<[string, string]> = [
  ['PosScreen.tsx', read('../features/sales/PosScreen.tsx')],
  ['usePosHeldCarts.ts', read('../features/sales/hooks/usePosHeldCarts.ts')],
  ['PaymentModal.tsx', read('../features/sales/PaymentModal.tsx')],
  ['CartPanel.tsx', read('../features/sales/components/CartPanel.tsx')],
];

/** The dine-in-only state values, and why each is dine-in-only. */
const DINE_IN_ONLY: Array<{ state: string; why: string }> = [
  { state: 'tableNumber', why: 'a table exists only for a dine-in order' },
  { state: 'guestCount', why: 'the setting reads SEATED GUESTS PER TABLE (products.ftl:105)' },
];

/**
 * Derivations that are block-gated rather than line-gated, named with the reason.
 *
 * `const bareInput = bareTableNumber(tableNumber)` reads a value ONLY to match a
 * table row inside `if (tableNumber && sessionToken && orderType === 'dine_in')`
 * (PosScreen:766, PaymentModal:922/1469). It is neither persisted nor rendered, and
 * the guard cannot see its enclosing block for the reason in the header.
 */
const BLOCK_GATED: RegExp[] = [/const bareInput = bareTableNumber\(/];

function offenders(src: string): string[] {
  const lines = src.split(/\r?\n/);
  const out: string[] = [];
  lines.forEach((text, i) => {
    const reads = DINE_IN_ONLY.find((d) =>
      new RegExp('const\\s+\\w+\\s*=[^=]*\\b' + d.state + '\\b').test(text),
    );
    if (!reads) return;
    if (/orderType === 'dine_in'/.test(text)) return;        // the rule, on the line
    if (BLOCK_GATED.some((re) => re.test(text))) return;      // named above, with reason
    out.push((i + 1) + ': ' + text.trim() + '   [' + reads.why + ']');
  });
  return out;
}

describe('a dine-in-only value is gated at every derivation', () => {
  it.each(SOURCES)('%s gates every derivation of tableNumber/guestCount', (_name, src) => {
    expect(
      offenders(src),
      'These derive an order-type-dependent value unconditionally. Gate the ' +
        'derivation on the order type (the same rule the sibling lines apply), or ' +
        'add the field to DINE_IN_ONLY with its reason.',
    ).toEqual([]);
  });

  it('finds the derivations, so the cases above cannot pass vacuously', () => {
    // A rename of either state or of the derivation shape would leave the scan
    // matching nothing — and an empty offender list reads exactly like success.
    // Measured at time of writing: 8 line-gated derivations across the four files.
    const gated = SOURCES.reduce((n, [, src]) => {
      const m = src.match(/const\s+\w+\s*=[^=]*\borderType === 'dine_in'/g);
      return n + (m ? m.length : 0);
    }, 0);
    expect(gated, 'no derivation carrying the rule was found — the scan is blind').toBeGreaterThanOrEqual(6);
  });

  it('customerName stays deliberately unrestricted', () => {
    // The counter-case, kept so a tidy pass cannot "fix" it by symmetry: a
    // takeaway still has a customer to name on the ticket.
    const cartPanel = read('../features/sales/components/CartPanel.tsx');
    const gate = cartPanel.match(/setCustomerName && customerNameEnabled !== false && \(/g) ?? [];
    expect(gate.length, 'the customer-name render gate must NOT carry an order-type condition').toBe(1);
  });
});
