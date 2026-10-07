import { renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import { useMoney } from '@/features/analytics/cards/shared/useMoney';
import { CurrencyProvider } from '@/contexts/CurrencyContext';
import { withFluent } from '@/i18n/test-utils';
import analyticsFtl from '@/locales/analytics.ftl?raw';

/* useMoney is imported by 13 files — every analytics card, plus the reports
 * dashboard it mirrors — and its name appears in NO test. It was reached only
 * transitively, which is exactly the hole this file closes: transient
 * coverage proves a component RENDERS, not that its arithmetic is right, and
 * this hook's arithmetic is money.
 *
 * The three things worth pinning, none of which a render test would catch:
 *   1. minor-unit scaling, which differs BY CURRENCY (IDR exponent 0, USD 2);
 *   2. fmtIn formatting a row in the ROW'S currency (REP-06), not the active one;
 *   3. the locale coming from the Fluent bundle rather than a hardcoded 'en-US'.
 */
function wrapper(currency: string) {
  return ({ children }: { children: ReactNode }) =>
    withFluent(<CurrencyProvider fallback={currency}>{children}</CurrencyProvider>, analyticsFtl);
}

describe('useMoney', () => {
  describe('fmt — the active currency', () => {
    it('scales a USD minor amount by 10^2', () => {
      const { result } = renderHook(() => useMoney(), { wrapper: wrapper('USD') });
      // 123456 minor units of USD is $1,234.56
      const out = result.current.fmt(123456);
      expect(out).toContain('1,234.56');
      expect(out).toContain('$');
    });

    // The exponent is the whole point of the helper: IDR has NO minor unit, so
    // the same integer must NOT be divided by 100. Getting this wrong silently
    // understates every Rupiah figure by two orders of magnitude.
    it('does NOT scale an IDR minor amount, because IDR has no minor unit', () => {
      const { result } = renderHook(() => useMoney(), { wrapper: wrapper('IDR') });
      const out = result.current.fmt(123456);
      expect(out).toContain('123,456');
      expect(out).not.toContain('1,234.56');
    });

    it('honours a 3-exponent currency', () => {
      const { result } = renderHook(() => useMoney(), { wrapper: wrapper('KWD') });
      // 1234567 minor units of KWD is 1,234.567
      expect(result.current.fmt(1234567)).toContain('1,234.567');
    });

    it('formats zero without throwing', () => {
      const { result } = renderHook(() => useMoney(), { wrapper: wrapper('USD') });
      expect(result.current.fmt(0)).toContain('0.00');
    });

    it('formats a negative amount with a sign', () => {
      const { result } = renderHook(() => useMoney(), { wrapper: wrapper('USD') });
      const out = result.current.fmt(-5000);
      expect(out).toMatch(/-|−/);
      expect(out).toContain('50.00');
    });
  });

  describe('fmtIn — a row in its OWN currency (REP-06)', () => {
    it('uses the passed code, not the active one', () => {
      const { result } = renderHook(() => useMoney(), { wrapper: wrapper('USD') });
      // The context says USD; the row says IDR. The ROW must win.
      const out = result.current.fmtIn(123456, 'IDR');
      expect(out).toContain('123,456');
      expect(out).not.toContain('$');
      expect(out).not.toContain('1,234.56');
    });

    // The control for the case above: same amount, USD row, USD context.
    it('gives a different result for a USD row in a USD context', () => {
      const { result } = renderHook(() => useMoney(), { wrapper: wrapper('USD') });
      expect(result.current.fmtIn(123456, 'USD')).toContain('1,234.56');
    });
  });

  describe('short — compact notation', () => {
    it('compacts a large amount to one decimal place', () => {
      const { result } = renderHook(() => useMoney(), { wrapper: wrapper('USD') });
      const out = result.current.short(123456789);
      // ~$1.2M — compact, so the digits are abbreviated rather than spelled out.
      expect(out).not.toContain('1,234,567.89');
      expect(out.length).toBeLessThan(result.current.fmt(123456789).length);
    });

    it('scales by the active currency too, not by a fixed 100', () => {
      const { result } = renderHook(() => useMoney(), { wrapper: wrapper('IDR') });
      // 1_500_000 IDR minor units is Rp 1.5M, not Rp 15k.
      const out = result.current.short(1500000);
      expect(out).toContain('1.5');
    });
  });

  describe('count — plain integers', () => {
    it('groups thousands with the locale separator', () => {
      const { result } = renderHook(() => useMoney(), { wrapper: wrapper('USD') });
      expect(result.current.count(1234567)).toBe('1,234,567');
    });

    it('leaves a small count ungrouped', () => {
      const { result } = renderHook(() => useMoney(), { wrapper: wrapper('USD') });
      expect(result.current.count(42)).toBe('42');
    });
  });
});
