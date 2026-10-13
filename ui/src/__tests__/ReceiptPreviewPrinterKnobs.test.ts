// ── The preview/printer knob contract is MEASURED, not claimed ──────────
//
// `receiptLogic.formatPrice`'s doc used to promise, flatly, that "the preview cannot
// silently diverge from what actually prints" — and then, 30 lines later, its own body
// capped the fraction and admitted the printer has no decimals field. Two halves of one
// file disagreeing is the F16 shape this plan keeps finding.
//
// The truth is a TABLE, not a promise. Against `ReceiptConfig` (receipt.rs:175-198):
//
//   grouping          :193  -> formatPrice's showThousandsSeparator   MIRRORED
//   decimal separator :181  -> formatPrice's decimalSeparator         MIRRORED
//   fraction digits   : none -> formatPrice's fractionDigits          PREVIEW-ONLY
//
// These cases read the Rust struct so the table cannot rot: add a field and the
// matching case starts failing, which is the signal to move that row from
// PREVIEW-ONLY to MIRRORED rather than leaving a stale claim in the doc.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatPrice } from '@/features/restaurant/screens/receiptLogic';

const RECEIPT_RS = resolve(__dirname, '../../..', 'crates/kasirmu-hal/src/drivers/receipt.rs');
const configStruct = (): string => {
  const src = readFileSync(RECEIPT_RS, 'utf-8');
  const at = src.indexOf('pub struct ReceiptConfig');
  expect(at, 'ReceiptConfig moved — repoint this guard').toBeGreaterThan(-1);
  return src.slice(at, src.indexOf('}', at));
};

describe('receipt preview knobs vs what ReceiptConfig can carry', () => {
  it('grouping is MIRRORED: the printer has the field, and IDR agrees', () => {
    expect(configStruct()).toMatch(/pub grouping: ThousandSeparator/);
    // ⚠️ The separator PAIRING is not arbitrary, and this is where a first draft of
    // this case got it wrong. formatPrice DERIVES the thousands character from the
    // decimal separator (`sep === ',' ? '.' : ','`), while the printer takes it from
    // currency.thousands_separator independently (hardware.rs:426-443). Feed the
    // preview a pairing the screen never produces and the two disagree:
    //
    //   formatPrice(1500, true, 'IDR', 'dot', 0, true) === 'Rp 1,500'
    //
    // For IDR that is unreachable: RestaurantReceiptsScreen:1323-1326 pins
    // effectiveDecimalSeparator to 'comma' for IDR before calling this, which yields
    // '.' as the thousands char — what the bridge's IDR default (`Dot`) prints. So
    // the agreement below holds for the configuration the app can actually send.
    expect(formatPrice(1500, true, 'IDR', 'comma', 0, true)).toBe('Rp 1.500');
    expect(formatPrice(1500, true, 'IDR', 'comma', 0, false)).toBe('Rp 1500');
    // The unreachable pairing, asserted so the coupling stays VISIBLE rather than
    // surprising the next reader who feeds this a different locale.
    expect(formatPrice(1500, true, 'IDR', 'dot', 0, true)).toBe('Rp 1,500');
  });

  it('the decimal separator is MIRRORED: the printer has the field', () => {
    expect(configStruct()).toMatch(/pub decimal_separator: DecimalSeparator/);
  });

  it('fraction digits are PREVIEW-ONLY, and the cap keeps them off exp-0 paper', () => {
    // The claim this pins is an ABSENCE, so it is asserted as one: no
    // fraction-digits field exists, therefore nothing a caller passes can reach
    // the printer, therefore the cap below is the only thing preventing a
    // divergence on IDR.
    const cfg = configStruct();
    expect(
      /fraction_digits|decimals/.test(cfg),
      'ReceiptConfig gained a fraction-digits field — move this row from PREVIEW-ONLY ' +
        'to MIRRORED in receiptLogic.formatPrice doc and drop the cap claim.',
    ).toBe(false);
    // The cap: IDR is exp-0, so a caller asking for 2 gets none.
    expect(formatPrice(1500, true, 'IDR', 'comma', 2, true)).toBe('Rp 1.500');
    // An exp-2 currency still gets the digits it asks for.
    expect(formatPrice(15, true, 'USD', 'dot', 2, false)).toBe('USD 15.00');
  });
});
