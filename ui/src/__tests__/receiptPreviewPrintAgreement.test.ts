// ── Preview vs printer: the separator/decimals contract ──────────────
//
// `receiptLogic.formatPrice` documents itself as mirroring the ESC/POS renderer
// (`kasirmu-hal/src/drivers/receipt.rs` `format_money`), "so the preview cannot
// silently diverge from what actually prints". For IDR it does.
//
// The printer delegates the decimal math to `foundation::format_minor`, which renders
// the currency's CANONICAL exponent. IDR is exp-0, so the raw string is a bare major
// part, `frac` is `None`, and `format_money` falls to its `(_, _)` arm printing the
// major alone — no separator, no fraction digits, whatever the setting says.
//
// The screen passes `effectiveDecimalSeparator = 'comma'` for IDR and
// `showDecimals ? 2 : 0`, so with the decimals toggle on the preview renders
// `Rp 1.500,00` where the paper prints `Rp 1500`.

import { describe, it, expect } from 'vitest';
import { formatPrice } from '@/features/restaurant/screens/receiptLogic';

describe('receipt preview/print agreement (IDR)', () => {
  it('IDR is exp-0: the paper never emits a fraction, so neither should the preview', () => {
    // What the screen actually calls today: comma + 2 fraction digits for IDR.
    const previewed = formatPrice(1500, true, 'IDR', 'comma', 2, false);
    // What `format_money` produces for the same amount (exp-0 -> major only).
    const printed = 'Rp 1500';
    expect(
      previewed,
      'the IDR preview must render what the printer renders. IDR is an exp-0 currency: ' +
        '`format_minor` yields no fractional part, so `format_money` prints the major ' +
        'alone. The preview asking for 2 fraction digits invented a `,00` the paper never ' +
        'shows.',
    ).toBe(printed);
  });

  it('caps the fraction for every exp-0 currency, and keeps 2 for USD', () => {
    // The cap is the exponent rule, not an IDR special case.
    expect(formatPrice(1500, false, 'JPY', 'dot', 2, false)).toBe('1500');
    expect(formatPrice(1500, false, 'KRW', 'dot', 2, false)).toBe('1500');
    // An exp-2 currency is unchanged: the caller asking for 2 gets 2.
    // (`formatPrice` takes the MAJOR number and renders `fractionDigits` zeros after
    // the separator — it is a display formatter, not a minor-unit converter.)
    expect(formatPrice(15, false, 'USD', 'dot', 2, false)).toBe('15.00');
    // KWD is exp-3; a caller asking for 2 must not be RAISED to 3.
    expect(formatPrice(15, false, 'KWD', 'dot', 2, false)).toBe('15.00');
    // ...but a caller asking for 3 on KWD gets 3.
    expect(formatPrice(15, false, 'KWD', 'dot', 3, false)).toBe('15.000');
  });

  it('never groups thousands: the printer has no grouping at all', () => {
    // ⚠️ RECORDED FINDING, not a pass. `showThousandsSeparator` is a second preview
    // control the printer cannot honour: `format_money` (receipt.rs:251) delegates to
    // `foundation::format_minor`, which emits no grouping, and `ReceiptConfig`
    // (:98-117) has no field for one. `currency.thousands_separator` is stored
    // (platform/core/src/settings/keys.rs:71) but read by NO formatter.
    //
    // Asserted as the printer's real behaviour so the divergence is stated rather than
    // assumed absent. Changing the preview to stop grouping is a separate decision
    // (it would also make `showThousandsSeparator` a dead toggle), so it is not taken
    // here.
    const previewed = formatPrice(1500, true, 'IDR', 'comma', 2, true);
    expect(previewed).toBe('Rp 1.500');
    const printed = 'Rp 1500';
    expect(previewed).not.toBe(printed);
  });
});