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
import { describe, it, expect } from 'vitest';
import {
  clamp,
  rollWidthMm,
  printableAreaMm,
  approxCols,
  formatPrice,
  fontSizeClass,
  computeReceiptPreview,
} from '@/features/restaurant/screens/receiptLogic';

describe('clamp', () => {
  it('returns the value when within range', () => {
    expect(clamp(5, 0, 30)).toBe(5);
    expect(clamp(0, 0, 30)).toBe(0);
    expect(clamp(30, 0, 30)).toBe(30);
  });

  it('clamps to min when below range', () => {
    expect(clamp(-5, 0, 30)).toBe(0);
    expect(clamp(-1, 0, 15)).toBe(0);
  });

  it('clamps to max when above range', () => {
    expect(clamp(50, 0, 30)).toBe(30);
    expect(clamp(31, 0, 30)).toBe(30);
    expect(clamp(20, 0, 15)).toBe(15);
  });

  it('falls back to min for NaN, infinities, and edge jsdom number inputs', () => {
    expect(clamp(Number.NaN, 0, 30)).toBe(0);
    expect(clamp(Number.POSITIVE_INFINITY, 0, 30)).toBe(30);
    expect(clamp(Number.NEGATIVE_INFINITY, 0, 30)).toBe(0);
  });
});

describe('rollWidthMm', () => {
  it('maps narrow to 58mm and standard (and any other) to 80mm', () => {
    expect(rollWidthMm('narrow')).toBe(58);
    expect(rollWidthMm('standard')).toBe(80);
  });
});

describe('printableAreaMm', () => {
  it('subtracts left+right margins from the roll width', () => {
    expect(printableAreaMm(80, 3, 3)).toBe(74);
    expect(printableAreaMm(58, 3, 3)).toBe(52);
  });

  it('floors at 15mm even when margins exceed the roll width', () => {
    expect(printableAreaMm(58, 30, 30)).toBe(15);
    expect(printableAreaMm(80, 100, 100)).toBe(15);
  });

  it('handles zero margins', () => {
    expect(printableAreaMm(80, 0, 0)).toBe(80);
  });
});

describe('approxCols', () => {
  it('computes standard (80mm) medium base and applies medium as identity', () => {
    // printable area 74 -> Math.max(20, Math.round((74/74)*44)) = 44
    expect(approxCols('standard', 74, 'medium')).toBe(44);
  });

  it('computes narrow base with its own formula', () => {
    // printable area 52 -> Math.max(16, Math.round((52/52)*32)) = 32
    expect(approxCols('narrow', 52, 'medium')).toBe(32);
  });

  it('enforces the lower bound on the base before multiplying', () => {
    // Very narrow printable area, e.g. tiny margins produce a small area on narrow.
    expect(approxCols('narrow', 20, 'medium')).toBe(16); // Math.max(16, round((20/52)*32)=12) -> 16
    expect(approxCols('standard', 20, 'medium')).toBe(20); // Math.max(20, round((20/74)*44)=11) -> 20
  });

  it('applies font-size multipliers', () => {
    expect(approxCols('standard', 74, 'very_small')).toBe(Math.round(44 * 1.25)); // 55
    expect(approxCols('standard', 74, 'small')).toBe(Math.round(44 * 1.1)); // 48
    expect(approxCols('standard', 74, 'large')).toBe(Math.round(44 * 0.85)); // 37
  });
});

describe('formatPrice', () => {
  it('renders the major part verbatim, matching the ESC/POS renderer (no grouping)', () => {
    expect(formatPrice(85255, false, 'IDR')).toBe('85255');
    expect(formatPrice(93000, false, 'USD')).toBe('93000');
  });

  it('prefixes IDR with "Rp "', () => {
    expect(formatPrice(85255, true, 'IDR')).toBe('Rp 85255');
    expect(formatPrice(85255, true, '')).toBe('Rp 85255'); // empty currency defaults to IDR
  });

  it('prefixes other currencies with the code + space', () => {
    expect(formatPrice(85255, true, 'USD')).toBe('USD 85255');
    expect(formatPrice(85255, true, 'SGD')).toBe('SGD 85255');
  });

  it('handles zero', () => {
    expect(formatPrice(0, true, 'IDR')).toBe('Rp 0');
  });

  it('applies the decimal separator only when there are fractional digits', () => {
    // IDR is exp-0, so asking for 2 fraction digits yields NONE — the printer's
    // `format_money` delegates to `foundation::format_minor`, which uses the currency's
    // canonical exponent, so the paper never shows a `,00` for Rupiah. An exp-2 currency
    // is where the separator is actually observable.
    expect(formatPrice(85255, true, 'IDR', 'dot', 2)).toBe('Rp 85255');
    expect(formatPrice(85255, true, 'IDR', 'comma', 2)).toBe('Rp 85255');
    expect(formatPrice(85255, true, 'IDR', 'none', 2)).toBe('Rp 85255');
    expect(formatPrice(85255, true, 'USD', 'dot', 2)).toBe('USD 85255.00');
    expect(formatPrice(85255, true, 'USD', 'comma', 2)).toBe('USD 85255,00');
    // whole minor units render identically under dot/comma
    expect(formatPrice(85255, true, 'USD', 'comma')).toBe('USD 85255');
  });

  it('renders a negative amount with a leading minus', () => {
    expect(formatPrice(-5000, true, 'IDR')).toBe('-Rp 5000');
  });

  it('formats with thousands separator when showThousandsSeparator is true', () => {
    // With comma decimal separator (IDR convention): thousand separator is dot '.'
    expect(formatPrice(10000, false, 'IDR', 'comma', 0, true)).toBe('10.000');
    expect(formatPrice(10000, false, 'IDR', 'comma', 0, false)).toBe('10000');
    // exp-0: no fraction is appended, so only the grouping differs here.
    expect(formatPrice(10000, false, 'IDR', 'comma', 2, true)).toBe('10.000');
    expect(formatPrice(10000, false, 'IDR', 'comma', 2, false)).toBe('10000');

    // With dot decimal separator (US convention): thousand separator is comma ','
    expect(formatPrice(10000, false, 'USD', 'dot', 0, true)).toBe('10,000');
    expect(formatPrice(10000, false, 'USD', 'dot', 0, false)).toBe('10000');
    expect(formatPrice(10000, false, 'USD', 'dot', 2, true)).toBe('10,000.00');
    expect(formatPrice(10000, false, 'USD', 'dot', 2, false)).toBe('10000.00');

    // With currency prefix and large numbers
    expect(formatPrice(1250000, true, 'IDR', 'comma', 0, true)).toBe('Rp 1.250.000');
    expect(formatPrice(1250000, true, 'IDR', 'comma', 2, true)).toBe('Rp 1.250.000');
  });
});

describe('fontSizeClass', () => {
  it('maps each font size to its paper class token', () => {
    expect(fontSizeClass('very_small')).toBe('resto-receipt-paper--font-very-small');
    expect(fontSizeClass('small')).toBe('resto-receipt-paper--font-small');
    expect(fontSizeClass('medium')).toBe('resto-receipt-paper--font-medium');
    expect(fontSizeClass('large')).toBe('resto-receipt-paper--font-large');
  });
});

describe('computeReceiptPreview', () => {
  // The sample's unit prices are 35.000 / 16.000 / 42.000 and its QUANTITIES are 1 / 2 / 1,
  // so each rendered row carries a LINE TOTAL. That is the convention the real receipt
  // uses: `completedSale.ts:132` and `:221` both compute
  // `unit_price.minor_units * qty`. The gross line sum is 109.000.
  const GROSS = 109000;

  it('computes gross LINE TOTALS when tax is hidden', () => {
    const r = computeReceiptPreview({ taxRatePercent: 10, showTax: false, taxRoundingMode: 'half_up' });
    expect(r.itemPrices).toEqual([35000, 32000, 42000]);
    expect(r.subtotal).toBe(GROSS);
    expect(r.tax).toBe(0);
    expect(r.total).toBe(GROSS);
    expect(r.change).toBe(0); // 100.000 - 109.000 floors at zero
  });

  it('applies half-up rounding on tax with a 10% rate', () => {
    // multiplier = 100/110
    // item1Exact = 35000 * 100/110 * 1 = 31818.18..., item1 = 31818
    // item2Exact = 16000 * 100/110 * 2 = 29090.90..., item2 = 29091
    // item3Exact = 42000 * 100/110 * 1 = 38181.81..., item3 = 38182
    // exactSubtotal = 99090.90..., subtotal = round = 99091
    // rawTax = 99090.90... * 0.10 = 9909.09..., half-up = 9909
    const r = computeReceiptPreview({ taxRatePercent: 10, showTax: true, taxRoundingMode: 'half_up' });
    expect(r.itemPrices).toEqual([31818, 29091, 38182]);
    expect(r.subtotal).toBe(99091);
    expect(r.tax).toBe(9909);
    expect(r.total).toBe(109000);
  });

  it('applies truncate rounding on the same tax figure', () => {
    const r = computeReceiptPreview({ taxRatePercent: 10, showTax: true, taxRoundingMode: 'truncate' });
    // rawTax = 9909.09... -> truncated 9909
    expect(r.tax).toBe(9909);
    expect(r.total).toBe(99091 + 9909);
  });

  it('handles a 0% tax rate (net = gross)', () => {
    const r = computeReceiptPreview({ taxRatePercent: 0, showTax: true, taxRoundingMode: 'half_up' });
    expect(r.itemPrices).toEqual([35000, 32000, 42000]);
    expect(r.subtotal).toBe(GROSS);
    expect(r.tax).toBe(0);
    expect(r.total).toBe(GROSS);
    expect(r.change).toBe(0);
  });

  it('preserves the gross line sum at any rate (net-of-tax math)', () => {
    // At 100% tax the net is exactly half the gross line sum, so tax equals the
    // subtotal and the grand total returns to the gross 109.000.
    const r = computeReceiptPreview({ taxRatePercent: 100, showTax: true, taxRoundingMode: 'half_up' });
    expect(r.subtotal).toBe(54500);
    expect(r.tax).toBe(54500);
    expect(r.total).toBe(GROSS);
    expect(r.change).toBe(0);
  });

  it('prices each row as a LINE TOTAL, because the real receipt multiplies qty', () => {
    // The regression this guards: the preview labels its middle row `2x Es Teh` and used
    // to show the net of ONE unit beside it — a figure no real receipt ever prints.
    const r = computeReceiptPreview({
      taxRatePercent: 10,
      showTax: true,
      taxRoundingMode: 'half_up',
    });
    expect(r.itemPrices[0]).toBe(31818);   // 1x
    expect(
      r.itemPrices[1],
      'the row labelled 2x must carry twice the unit figure, not the unit figure',
    ).toBe(29091);
    expect(r.itemPrices[2]).toBe(38182);   // 1x
    expect(r.subtotal).toBe(99091);
    expect(r.tax).toBe(9909);
    expect(r.total).toBe(109000);
    expect(r.change).toBe(0);
  });
});
