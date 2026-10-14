// ── The shortfall dialog must forward every nullable field it accepts ────
//
// `StockShortfallDialog` rebuilds the checkout args for the retry, so every prop it
// takes has to survive the round trip. Two ways that fails silently:
//
//   1. A prop typed WITHOUT \`| null\` cannot receive a null the caller has, so the
//      value is dropped at the boundary — the retry records a different sale than the
//      first submission.
//   2. A forward written as \`...(x != null ? { x } : {})\` DISCARDS an explicit null.
//      \`!= null\` is true for undefined AND null, so both vanish; the wire type is
//      an \`Option\`, which accepts null as a value meaning "none".
//
// Both are invisible: the sale completes, the numbers are just wrong.
//
// The fields checked are the CUR-02 tender snapshot, whose whole purpose is to carry
// what the customer actually paid through a retry (FRONTEND-04).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = resolve(__dirname, '../../..');
const DIALOG = readFileSync(
  resolve(REPO, 'ui/src/features/sales/StockShortfallDialog.tsx'),
  'utf-8',
);

/** The dialog's props interface. */
function propsBlock(): string {
  const at = DIALOG.indexOf('export interface StockShortfallDialogProps');
  expect(at, 'the props interface moved — repoint this guard').toBeGreaterThan(-1);
  return DIALOG.slice(at, DIALOG.indexOf('\n}', at));
}

/**
 * The CUR-02 fields the dialog accepts and forwards.
 *
 * Each is \`Option\` on the Rust side (\`pos/checkout.rs:265-277\`), so the prop must
 * admit null AND the forward must pass it through.
 */
const CUR02_FIELDS = [
  'discountLabel',
  'tipMinor',
  'serviceChargeMinor',
  'baseCurrency',
  'baseTotalMinor',
  'tenderRateMillionths',
] as const;

describe('StockShortfallDialog forwards the CUR-02 snapshot intact', () => {
  it('every CUR-02 prop admits null, because the wire type does', () => {
    const props = propsBlock();
    for (const field of CUR02_FIELDS) {
      const m = props.match(new RegExp('\\b' + field + '(\\??): ([^;\\n]+);'));
      expect(m, field + ' is not declared on the props — repoint this guard').not.toBeNull();
      expect(
        m![1],
        field + ' must be optional: the wire field is an Option.',
      ).toBe('?');
      expect(
        m![2],
        field + ' must include "| null". An Option accepts an explicit null as well as ' +
          'an absent key, and a prop that cannot receive null drops it at the boundary.',
      ).toMatch(/null/);
    }
  });

  it('every CUR-02 forward passes an explicit null through rather than dropping it', () => {
    // \`x != null\` is the defect: it is true for BOTH undefined and null, so an
    // explicit null — a real answer meaning "none" — is silently omitted.
    for (const field of CUR02_FIELDS) {
      expect(
        DIALOG,
        field + ' is forwarded with a null-dropping guard. Use a form that keeps an ' +
          'explicit null, or the retry records a different sale than the first attempt.',
      ).not.toMatch(new RegExp('\\.\\.\\.\\(' + field + ' != null \\?'));
    }
  });

  it('the guard is not vacuous — it read a props block with fields in it', () => {
    // A regex that matches nothing would make every case above pass silently.
    expect(propsBlock().length).toBeGreaterThan(500);
    expect(propsBlock()).toMatch(/currency:/);
  });
});
