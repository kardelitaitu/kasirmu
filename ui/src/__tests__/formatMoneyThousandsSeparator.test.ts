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
    ['none', '$ 1,234,567.89'],
    ['comma', '$ 1,234,567.89'],
    ['dot', '$ 1.234.567.89'],
    ['space', '$ 1 234 567.89'],
  ] as const)('formats %s', (sep, expected) => {
    expect(formatMoney(money(USD_7, 'USD'), 'en-US', 'dot', sep)).toBe(expected);
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
    setThousandsSep('space');
    expect(formatMoney(money(123456789, 'USD'), 'en-US', 'dot', 'dot')).toBe('$ 1.234.567.89');
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

  it('keeps the sign outside the grouping', () => {
    expect(formatMoney(money(-USD_7, 'USD'), 'en-US', 'dot', 'comma')).toBe('$ -1,234,567.89');
  });
});
