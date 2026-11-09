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
// ── splitDistribution: the even-split law as a UNIT, not only through React ──
//
// The module doc (splitDistribution.ts:19-30) says the law is pinned by the 18
// cases in PaymentModalSplitTenderState.test.tsx (T8-T14). That claim was checked
// and is TRUE — T9-T14 really do assert 3333/3333/3335, 33333/33333/33334 and
// 2000x4+2001 through the rendered modal. So this file is NOT closing an unguarded
// hole, and should not be described as one.
//
// What it adds is a guard on the FUNCTION's own contract, independent of any
// render: the property that matters for money (`base * count + remainder ===
// total`) is asserted directly rather than only through literal rows a render
// happened to produce. A future edit to the caller cannot loosen these, and the
// floor/remainder rule is stated where the arithmetic lives.
//
// The values below are the same ones a live browser pass read back from the
// rendered inputs (docs/records/audits/restaurant-pos-split-tender-live.md), so
// the unit and the rendered behaviour are known to agree, not assumed to.

import { describe, expect, it } from 'vitest';
import { distributeEvenly } from './splitDistribution';

/** Re-sum the produced literals the way a currency would, without floats. */
const sumLiterals = (lits: string[], exponent: number): number =>
  lits.reduce((sum, l) => {
    const [whole = '0', frac = ''] = l.split('.');
    const padded = (frac + '0'.repeat(exponent)).slice(0, exponent);
    return sum + Number(whole) * 10 ** exponent + Number(padded || '0');
  }, 0);

describe('distributeEvenly', () => {
  it('puts the whole residual on the LAST row (USD, 10001 over 3)', () => {
    expect(distributeEvenly(10001, 3, 2)).toEqual(['33.33', '33.33', '33.35']);
  });

  it('handles a single residual unit (USD, 10000 over 3)', () => {
    expect(distributeEvenly(10000, 3, 2)).toEqual(['33.33', '33.33', '33.34']);
  });

  it('splits evenly with no residual (USD, 10000 over 4)', () => {
    expect(distributeEvenly(10000, 4, 2)).toEqual(['25.00', '25.00', '25.00', '25.00']);
  });

  it('carries one odd unit across five rows (USD, 10001 over 5)', () => {
    expect(distributeEvenly(10001, 5, 2)).toEqual(['20.00', '20.00', '20.00', '20.00', '20.01']);
  });

  it('places digits at the EXPONENT, not by dividing (IDR has none)', () => {
    // The live browser pass read exactly these back for Rp 100.000 over 3 rows.
    expect(distributeEvenly(100000, 3, 0)).toEqual(['33333', '33333', '33334']);
    // No decimal separator may appear anywhere at exponent 0.
    for (const l of distributeEvenly(100000, 3, 0)) expect(l).not.toContain('.');
  });

  it('matches the live pass for Rp 95.000 over 3 rows', () => {
    expect(distributeEvenly(95000, 3, 0)).toEqual(['31666', '31666', '31668']);
  });

  it('returns an empty array for zero rows rather than NaN strings', () => {
    // The documented choice (splitDistribution.ts:32-40): "no rows" means nothing
    // is written. Dividing by zero would produce NaN literals in the inputs.
    expect(distributeEvenly(45000, 0, 0)).toEqual([]);
    expect(distributeEvenly(45000, 0, 2)).toEqual([]);
  });

  it('is exactly total-preserving across a sweep — no unit lost or invented', () => {
    // The property, not a fixed list: the over-split this rule exists to prevent
    // was 4,450,001 / 2 becoming 2,225,001 + 2,225,002 = one unit MORE than the
    // sale. Sweeping totals and counts against an exact re-sum is what catches a
    // float division or a toFixed creeping back in.
    for (let total = 1; total <= 401; total += 7) {
      for (let count = 1; count <= 7; count++) {
        for (const exponent of [0, 2]) {
          const lits = distributeEvenly(total, count, exponent);
          expect(lits).toHaveLength(count);
          expect(
            sumLiterals(lits, exponent),
            `${total} over ${count} rows at exponent ${exponent} produced ${JSON.stringify(lits)}`,
          ).toBe(total);
        }
      }
    }
  });

  // ⚠️ THE NEGATIVE DOMAIN, pinned as a KNOWN LIMIT rather than a silent one.
  //
  // The sweep above starts at `total = 1`, so it never sees this. Measured (round
  // 301): `-1` over 2 rows comes back `['-1','-2']` — a sum of -3, short by
  // (count - 1) — because `Math.floor` rounds negatives toward -infinity and `%`
  // keeps the dividend's sign, so the residual is subtracted instead of added.
  //
  // The function is NOT changed, because no caller can reach it: the total is
  // clamped at zero in `useTenderMath.ts:96` and cashier-typed amounts are floored
  // at zero in `:170`. Changing money arithmetic nobody exercises would be the
  // riskier edit. Pinning it means a future caller that CAN go negative goes red
  // here and reads why, instead of over-splitting a sale by (count - 1) units.
  //
  // If a negative-total caller ever becomes real, fix the arithmetic — the correct
  // form puts the residual on the last row in the direction of the sign, or
  // distributes `Math.trunc` shares — and flip this case.
  it('KNOWN LIMIT: is not total-preserving for negative totals (unreachable today)', () => {
    // Positive behaviour, for contrast: exact.
    expect(sumLiterals(distributeEvenly(10001, 3, 2), 2)).toBe(10001);

    // Negative: exactness does NOT hold, and the size of the error is (count - 1).
    // Asserted as a KNOWN, sized error rather than merely "not equal" — so if the
    // arithmetic is ever fixed, the number here changes and says so.
    for (const [total, count] of [
      [-1, 2],
      [-1, 3],
      [-100, 3],
      [-10001, 5],
    ] as Array<[number, number]>) {
      const lits = distributeEvenly(total, count, 0);
      const sum = sumLiterals(lits, 0);
      expect(
        sum,
        `negative totals are outside the documented domain (${total} over ${count}): ` +
          'the residual is subtracted instead of added, so the sum is short by a whole ' +
          'count. If this now passes as exact, a fix landed — re-read the module doc ' +
          'and flip this case to assert preservation.',
      ).toBe(total - count);
    }

    // The smallest reproducible example, written out so the shape is unmistakable.
    expect(distributeEvenly(-1, 2, 0)).toEqual(['-1', '-2']);
    expect(sumLiterals(['-1', '-2'], 0)).toBe(-3);
  });

  it('never spreads the residual over the first rows', () => {
    // A plausible-but-wrong alternative distributes the odd units across the
    // leading rows. Assert the first count-1 rows are all the floor.
    const total = 10007;
    const count = 3;
    const lits = distributeEvenly(total, count, 2);
    const base = '33.35'; // floor(10007/3) = 3335 minor = 33.35
    expect(lits.slice(0, count - 1)).toEqual([base, base]);
    expect(lits[count - 1]).not.toBe(base);
  });
});
