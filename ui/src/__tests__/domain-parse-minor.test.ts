/**
 * @vitest-environment node
 *
 * This file's import graph is free of browser globals (no render, no
 * `document`/`window`/`localStorage`), so it does not need a jsdom window. Vitest
 * spawns a fresh jsdom per test FILE, which measured ~0.4-0.9s each; under the node
 * environment the same files report `environment: 0ms`.
 *
 * Do not copy this directive onto a file that renders or touches browser state —
 * it will fail with "document is not defined" rather than silently degrade.
 */
import { describe, expect, it } from 'vitest';

import { millionthsToDecimalString, parseMinorUnits } from '@/types/domain';

/**
 * Exact decimal parsing of user-entered money strings (MONEY-02,
 * 2026-08-31).
 *
 * The tender/split/rate inputs are free text (`type="text"
 * inputMode="decimal"`) and were converted with
 * `Math.round(parseFloat(s) * 10**exp)` — binary float parsing
 * mis-rounds boundary decimals (`"1.005"` × 100 = 100.49999… → 100
 * instead of 101) and parseFloat silently accepts garbage the field
 * should reject (`"1e3"` → 1000, `"1,500"` → 1). This helper parses the
 * decimal string exactly and rounds half-up toward +Infinity at the
 * target scale — the same tie rule Math.round applied to positives.
 */
describe('parseMinorUnits', () => {
  it('parses plain integers at the currency exponent', () => {
    expect(parseMinorUnits('123', 2)).toBe(12300);
    expect(parseMinorUnits('123', 0)).toBe(123);
    expect(parseMinorUnits('123', 3)).toBe(123000);
  });

  it('parses exact decimals without float drift', () => {
    expect(parseMinorUnits('123.45', 2)).toBe(12345);
    expect(parseMinorUnits('0.01', 2)).toBe(1);
    expect(parseMinorUnits('7.00', 2)).toBe(700);
  });

  it('rounds the 1.005 boundary UP (parseFloat path gave 100)', () => {
    expect(parseMinorUnits('1.005', 2)).toBe(101);
  });

  it('rounds 2.675 UP (parseFloat happened to land right — pinned anyway)', () => {
    expect(parseMinorUnits('2.675', 2)).toBe(268);
  });

  it('rounds half-up beyond the exponent', () => {
    expect(parseMinorUnits('1.999', 2)).toBe(200);
    expect(parseMinorUnits('1.2345', 3)).toBe(1235); // 1234.5 → half-up
    expect(parseMinorUnits('0.004', 2)).toBe(0);
  });

  it('exponent-0 currencies truncate by rounding the fraction', () => {
    expect(parseMinorUnits('10000.5', 0)).toBe(10001); // half-up
    expect(parseMinorUnits('10000.4', 0)).toBe(10000);
  });

  it('rate scale (millionths) parses exactly', () => {
    // ExchangeRateScreen encodes user rates at 1e6.
    expect(parseMinorUnits('149.5', 6)).toBe(149_500_000);
    expect(parseMinorUnits('1.0000005', 6)).toBe(1_000_001); // .5 → half-up
  });

  it('accepts leading + and trailing/leading dot forms', () => {
    expect(parseMinorUnits('+5.25', 2)).toBe(525);
    expect(parseMinorUnits('.5', 2)).toBe(50);
    expect(parseMinorUnits('5.', 2)).toBe(500);
  });

  it('negatives round half-up toward +Infinity (Math.round parity)', () => {
    expect(parseMinorUnits('-2.675', 2)).toBe(-267); // -267.5 → -267
    expect(parseMinorUnits('-1.005', 2)).toBe(-100); // -100.5 → -100
  });

  it('rejects non-decimal strings parseFloat would swallow', () => {
    expect(parseMinorUnits('1e3', 2)).toBeNull();
    expect(parseMinorUnits('1,500', 2)).toBeNull();
    expect(parseMinorUnits('abc', 2)).toBeNull();
    expect(parseMinorUnits('1.2.3', 2)).toBeNull();
    expect(parseMinorUnits('', 2)).toBeNull();
    expect(parseMinorUnits('   ', 2)).toBeNull();
    expect(parseMinorUnits('0x10', 2)).toBeNull();
    expect(parseMinorUnits('Infinity', 2)).toBeNull();
  });

  it('treats empty string as zero only via explicit caller default', () => {
    // Call sites use `input || '0'` before parsing; the helper itself is
    // strict so a blank field never silently becomes money.
    expect(parseMinorUnits('0', 2)).toBe(0);
  });

  it('rejects results beyond the safe integer range', () => {
    expect(parseMinorUnits('9007199254740993', 2)).toBeNull();
    expect(parseMinorUnits('99999999999999999999', 0)).toBeNull();
  });
});

/**
 * millionthsToDecimalString (LOYALTY-01, 2026-08-31): fixed-point
 * millionths → plain decimal display, integer-only arithmetic.
 */
describe('millionthsToDecimalString (LOYALTY-01)', () => {
  it('renders seeded and custom multipliers without trailing zeros', () => {
    expect(millionthsToDecimalString(1_000_000)).toBe('1');
    expect(millionthsToDecimalString(1_250_000)).toBe('1.25');
    expect(millionthsToDecimalString(1_400_000)).toBe('1.4');
    expect(millionthsToDecimalString(2_000_000)).toBe('2');
    expect(millionthsToDecimalString(1_070_000)).toBe('1.07');
  });

  it('keeps interior zeros and full six-digit fractions', () => {
    expect(millionthsToDecimalString(1_000_001)).toBe('1.000001');
    expect(millionthsToDecimalString(1_100_000)).toBe('1.1');
    expect(millionthsToDecimalString(1_010_000)).toBe('1.01');
  });

  it('round-trips through parseMinorUnits at scale 6', () => {
    for (const m of [1_000_000, 1_250_000, 1_400_000, 1_000_001, 2_000_000]) {
      expect(parseMinorUnits(millionthsToDecimalString(m), 6)).toBe(m);
    }
  });

  it('handles zero and sub-one values', () => {
    expect(millionthsToDecimalString(0)).toBe('0');
    expect(millionthsToDecimalString(500_000)).toBe('0.5');
  });
});
