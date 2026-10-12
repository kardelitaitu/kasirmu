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

import { convertMinorUnits } from '@/api/currency';

/**
 * Exact fixed-point conversion (MONEY-01 repair, 2026-08-31).
 *
 * The PaymentModal used to convert tender amounts through binary floats
 * (`baseMinor / 10**baseExp * (rate_millionths / 1e6) * 10**chargeExp`),
 * which mis-rounds every product that lands exactly on the .5 minor-unit
 * boundary: 0.03 USD at 149.5 renders as 4.4849999… in binary and
 * Math.round yields 448 where exact decimal half-up gives 449. These
 * tests pin the EXACT decimal behavior — brute-forced counterexamples
 * of the old float path are the primary cases.
 */
describe('convertMinorUnits — exact decimal half-up', () => {
  it('rounds the 0.03 @ 149.5 boundary UP (float path gave 448)', () => {
    // 0.03 USD × 149.5 = 4.485 → half-up → 4.49 (449 minor).
    expect(
      convertMinorUnits({ baseMinor: 3, baseExponent: 2, rateMillionths: 149_500_000, chargeExponent: 2 }),
    ).toBe(449);
  });

  it('rounds the 0.41 @ 149.5 boundary UP (float path gave 6129)', () => {
    // 0.41 × 149.5 = 61.295 → 61.30 (6130).
    expect(
      convertMinorUnits({ baseMinor: 41, baseExponent: 2, rateMillionths: 149_500_000, chargeExponent: 2 }),
    ).toBe(6130);
  });

  it('rounds 0.57 @ 149.5 UP (float path gave 8521)', () => {
    expect(
      convertMinorUnits({ baseMinor: 57, baseExponent: 2, rateMillionths: 149_500_000, chargeExponent: 2 }),
    ).toBe(8522);
  });

  it('handles exponent-0 charge currencies (USD minor → IDR)', () => {
    // 12345 minor USD = $123.45 × 16_000 = 1_975_200 IDR (exact).
    expect(
      convertMinorUnits({ baseMinor: 12345, baseExponent: 2, rateMillionths: 16_000_000_000, chargeExponent: 0 }),
    ).toBe(1_975_200);
  });

  it('handles exponent-0 base currencies (IDR minor → USD)', () => {
    // 1_000_000 IDR × (1/16_000) = 62.5 USD = 6250 cents (exact, no rounding needed).
    // The old inverse path computed 1/(16000.0) as a float first.
    expect(
      convertMinorUnits({
        baseMinor: 1_000_000,
        baseExponent: 0,
        rateMillionths: 16_000_000_000,
        chargeExponent: 2,
        inverse: true,
      }),
    ).toBe(6250);
  });

  it('inverse rate: 1.00 @ 1.08 back-currency lands exactly', () => {
    // 10800 minor (108.00) at rate 1.08 inverse → 10000 (100.00), exact.
    expect(
      convertMinorUnits({
        baseMinor: 10_800,
        baseExponent: 2,
        rateMillionths: 1_080_000,
        chargeExponent: 2,
        inverse: true,
      }),
    ).toBe(10_000);
  });

  it('three-decimal charge currency (KWD): 1 USD @ 0.307 → 0.307 KWD', () => {
    expect(
      convertMinorUnits({ baseMinor: 100, baseExponent: 2, rateMillionths: 307_000, chargeExponent: 3 }),
    ).toBe(307);
  });

  it('identity rate 1.0 preserves minor units across equal exponents', () => {
    expect(
      convertMinorUnits({ baseMinor: 999_999, baseExponent: 2, rateMillionths: 1_000_000, chargeExponent: 2 }),
    ).toBe(999_999);
  });

  it('zero amount converts to zero', () => {
    expect(
      convertMinorUnits({ baseMinor: 0, baseExponent: 2, rateMillionths: 149_500_000, chargeExponent: 2 }),
    ).toBe(0);
  });

  it('large IDR amounts stay exact (no 2^53 drift)', () => {
    // 9_000_000_000 IDR (9 billion) × 1/16_000 = 562_500.00 USD = 56_250_000 minor.
    expect(
      convertMinorUnits({
        baseMinor: 9_000_000_000,
        baseExponent: 0,
        rateMillionths: 16_000_000_000,
        chargeExponent: 2,
        inverse: true,
      }),
    ).toBe(56_250_000);
  });

  it('negative amounts round half-up toward +Infinity (Math.round parity)', () => {
    // -3 minor × 149.5 / 100 = -448.5 → half-up (toward +inf) → -448.
    expect(
      convertMinorUnits({ baseMinor: -3, baseExponent: 2, rateMillionths: 149_500_000, chargeExponent: 2 }),
    ).toBe(-448);
  });
});
