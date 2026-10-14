// ── formatMoney honours the store's thousands separator ──────────────────
//
// The printer has honoured `currency.thousands_separator` since D6
// (`ReceiptConfig.grouping`, kasirmu-hal/src/drivers/receipt.rs:193) while this
// formatter grouped by LOCALE — so an IDR store that set `dot` printed `Rp 15.000`
// beside a preview reading `Rp 15,000` on a point-id locale. The pin that recorded
// that divergence (ReceiptPreviewGroupingParity.test.ts) retired its own ledger entry
// when this argument landed.
//
// Fixtures are MINOR UNITS and the expectations below were read from actual output
// rather than composed — an earlier draft of this file got the scale wrong twice
// (`1234567` minor USD is `$ 12,345.67`, not a seven-digit major) and produced a
// green suite asserting nothing. Every string here was copied from a real run.

import { describe, it, expect, beforeEach } from 'vitest';
import { formatMoney } from '@/types/domain';
import { setThousandsSep } from '@/utils/storage';

const money = (minor_units: number, currency: string) => ({ minor_units, currency });

// A seven-digit major WITH a fraction, so both halves are exercised at once.
const USD_7 = 123456789;

describe('formatMoney: thousands separator', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  it('groups the integer part and leaves the fraction alone', () => {
    // The separator never reaches the fraction: exactly one mark survives.
    const out = formatMoney(money(USD_7, 'USD'), 'en-US', 'dot', 'comma');
    expect(out).toBe('$ 1,234,567.89');
    // The fraction is the part after the LAST mark and has no separator in it.
    const lastMark = out.lastIndexOf('.');
    expect(out.slice(lastMark + 1)).toBe('89');
  });

  it('does not put a separator inside the fraction, whatever the separator is', () => {
    for (const sep of ['comma', 'dot', 'space'] as const) {
      const out = formatMoney(money(USD_7, 'USD'), 'en-US', 'dot', sep);
      const lastMark = Math.max(out.lastIndexOf('.'), out.lastIndexOf(','));
      const frac = out.slice(lastMark + 1);
      expect(frac, `${sep} leaked into the fraction`).toBe('89');
    }
  });

  it.each([
    // For en-US the locale's decimal mark IS '.', so a store separator of 'dot'
    // COLLIDES and the formatter falls back to the locale's own grouping — which
    // happens to be commas. That is the collision rule doing its job, and it is why
    // this table lives in a locale-specific file.
    ['none', '$ 1,234,567.89'],
    ['comma', '$ 1,234,567.89'],
    ['dot', '$ 1,234,567.89'],
    ['space', '$ 1 234 567.89'],
  ] as const)('formats %s', (sep, expected) => {
    expect(formatMoney(money(USD_7, 'USD'), 'en-US', 'dot', sep)).toBe(expected);
  });

  it.each([
    // de-DE is the mirror image: its decimal mark is ',', so 'dot' and 'space' pass
    // through and 'comma' collides.
    ['none', '$ 1.234.567,89'],
    ['dot', '$ 1.234.567,89'],
    ['comma', '$ 1.234.567,89'],
    ['space', '$ 1 234 567,89'],
  ] as const)('formats %s for de-DE', (sep, expected) => {
    expect(formatMoney(money(USD_7, 'USD'), 'de-DE', 'dot', sep)).toBe(expected);
  });

  it('reads the bridge when the caller passes no separator', () => {
    // The SYMMETRY case, and the one that makes the fix reach the operator.
    //
    // `decimalSep` already defaults through `getDecimalSep()` (domain.ts:477), so a
    // store's decimal setting applies to every call site without any of them asking.
    // The thousands separator defaulted to a literal 'none' instead, which meant the
    // setting reached ONLY a caller that passed it — and no call site does.
    //
    // Consequence of the asymmetry: an operator sets the separator, SettingsContext
    // seeds the bridge, and every screen still groups by locale. The setting appears
    // to do nothing.
    setThousandsSep('space');
    expect(formatMoney(money(123456789, 'USD'), 'en-US', 'dot')).toBe('$ 1 234 567.89');
    setThousandsSep('comma');
    expect(formatMoney(money(123456789, 'USD'), 'en-US', 'dot')).toBe('$ 1,234,567.89');
    setThousandsSep('none');
    // 'none' falls back to the locale's own grouping, which is the pre-fix behaviour.
    expect(formatMoney(money(123456789, 'USD'), 'en-US', 'dot')).toBe('$ 1,234,567.89');
  });

  it('an explicit argument still wins over the bridge', () => {
    setThousandsSep('none');
    // The ARGUMENT decides, not the bridge — space is applied, and en-US does not
    // collide with it.
    expect(formatMoney(money(123456789, 'USD'), 'en-US', 'dot', 'space')).toBe(
      '$ 1 234 567.89',
    );
    // But the collision rule outranks the argument too: 'dot' for en-US is the locale's
    // own decimal mark, so it is refused and the locale's grouping stands. A caller
    // cannot ask for an ambiguous figure, which is the point of the rule being a rule.
    setThousandsSep('comma');
    expect(formatMoney(money(123456789, 'USD'), 'en-US', 'dot', 'dot')).toBe(
      '$ 1,234,567.89',
    );
    setThousandsSep('none');
  });
  it('defaults to locale grouping when the caller passes nothing', () => {
    // The default must not restyle a caller that never asked. The existing call
    // sites pass at most three arguments, and stay on the locale's own grouping.
    expect(formatMoney(money(USD_7, 'USD'), 'en-US')).toBe('$ 1,234,567.89');
  });

  it('groups IDR the way the printer does when the store set dot', () => {
    // IDR is exp-0, so no fraction exists and the grouping is the whole story.
    // 'none' is the locale-driven path, which for id-ID already groups with dots.
    expect(formatMoney(money(15000, 'IDR'), 'id-ID', 'comma', 'none')).toBe('Rp 15.000');
    expect(formatMoney(money(15000, 'IDR'), 'id-ID', 'comma', 'comma')).toBe('Rp 15,000');
  });

  it('does not group a number with three or fewer digits', () => {
    expect(formatMoney(money(50000, 'USD'), 'en-US', 'dot', 'comma')).toBe('$ 500.00');
    expect(formatMoney(money(99900, 'USD'), 'en-US', 'dot', 'comma')).toBe('$ 999.00');
  });

  it('keeps the boundary right, including an exact multiple of three', () => {
    // A leading group of 3 rather than none: 123456 groups as 123,456.
    expect(formatMoney(money(12345600, 'USD'), 'en-US', 'dot', 'comma')).toBe('$ 123,456.00');
    expect(formatMoney(money(123400, 'USD'), 'en-US', 'dot', 'comma')).toBe('$ 1,234.00');
  });

  it('never emits the same character as both the group and the decimal mark', () => {
    // REGRESSION GUARD — this case exists because the first version of the grouping
    // had the defect it now prevents.
    //
    // The thousands character comes from the store SETTING and the decimal mark from
    // the LOCALE. For de-DE and id-ID the locale's decimal mark IS a comma, so a store
    // that sets `comma` produced:
    //
    //     $ 1,234,567,89      three commas, and no way to tell where the integer ends
    //
    // The printer cannot hit this: both its marks come from `ReceiptConfig`, so they
    // are resolved together (receipt.rs:360-365). A formatter that takes one from each
    // source has to check they differ, which is what this pins.
    setThousandsSep('comma');
    const de = formatMoney(money(123456789, 'USD'), 'de-DE', 'dot');
    // The integer part is everything before the fraction; count the marks inside it.
    const intPart = de.slice(0, de.lastIndexOf(','));
    expect(intPart, 'collision: ' + de).not.toContain(',');
    // And no mark may appear twice in a row, or the grouping is meaningless.
    expect(de).not.toMatch(/,,/);
    setThousandsSep('none');
  });

  it('falls back to the locale grouping when the store character would collide', () => {
    // de-DE is the clearest case: its decimal mark is already a comma, so grouping by
    // comma is the one thing it must not do. Falling back to Intl keeps the figure
    // readable and keeps the fraction unambiguous.
    setThousandsSep('comma');
    const de = formatMoney(money(123456789, 'USD'), 'de-DE', 'dot');
    expect(de).toBe('$ 1.234.567,89');
    setThousandsSep('none');
    // Sanity: without a collision the store value still wins.
    setThousandsSep('space');
    expect(formatMoney(money(123456789, 'USD'), 'en-US', 'dot')).toBe('$ 1 234 567.89');
    setThousandsSep('none');
  });
  it('an exp-0 currency has no decimal mark, so its grouping never collides', () => {
    // The collision rule is gated on `hasFraction` (decimals > 0), and this is why that
    // gate is correct rather than an oversight.
    //
    // IDR is exp-0, so the formatter renders NO fraction and therefore emits NO decimal
    // mark. A collision needs two marks in one figure, so with one mark absent the
    // store's character is always safe to use — even in a locale whose decimal mark
    // happens to be the same character, which is exactly the id-ID + 'comma' case that
    // the primary market uses.
    //
    // Measured, not reasoned: every exp-0 combination emits the store character alone.
    setThousandsSep('comma');
    expect(formatMoney(money(1350000, 'IDR'), 'de-DE', 'comma')).toBe('Rp 1,350,000');
    setThousandsSep('dot');
    expect(formatMoney(money(1350000, 'IDR'), 'de-DE', 'comma')).toBe('Rp 1.350.000');
    setThousandsSep('space');
    expect(formatMoney(money(1350000, 'IDR'), 'de-DE', 'comma')).toBe('Rp 1 350 000');
    setThousandsSep('none');
  });

  it('the store setting wins for every locale/currency pair that does not collide', () => {
    // The full measured matrix for one exp-2 currency, so a change to either the rule
    // or the fallback has to face all eight cells rather than the one it was written
    // against. 'en-US' + 'comma' equals its own 'none' because en-US groups by comma.
    setThousandsSep('none');
    expect(formatMoney(money(1350000, 'IDR'), 'id-ID', 'comma')).toBe('Rp 1.350.000');
    expect(formatMoney(money(1350000, 'IDR'), 'en-US', 'comma')).toBe('Rp 1,350,000');
    setThousandsSep('comma');
    expect(formatMoney(money(1350000, 'IDR'), 'id-ID', 'comma')).toBe('Rp 1,350,000');
    expect(formatMoney(money(1350000, 'IDR'), 'en-US', 'comma')).toBe('Rp 1,350,000');
    setThousandsSep('dot');
    expect(formatMoney(money(1350000, 'IDR'), 'id-ID', 'comma')).toBe('Rp 1.350.000');
    expect(formatMoney(money(1350000, 'IDR'), 'en-US', 'comma')).toBe('Rp 1.350.000');
    setThousandsSep('space');
    expect(formatMoney(money(1350000, 'IDR'), 'id-ID', 'comma')).toBe('Rp 1 350 000');
    expect(formatMoney(money(1350000, 'IDR'), 'en-US', 'comma')).toBe('Rp 1 350 000');
    setThousandsSep('none');
  });
  it('keeps the sign outside the grouping', () => {
    expect(formatMoney(money(-USD_7, 'USD'), 'en-US', 'dot', 'comma')).toBe('$ -1,234,567.89');
  });
});
