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
    expect(formatPrice(85255, true, 'IDR', 'dot', 2)).toBe('Rp 85255.00');
    expect(formatPrice(85255, true, 'IDR', 'comma', 2)).toBe('Rp 85255,00');
    expect(formatPrice(85255, true, 'IDR', 'none', 2)).toBe('Rp 85255');
    // whole minor units render identically under dot/comma
    expect(formatPrice(85255, true, 'IDR', 'comma')).toBe('Rp 85255');
  });

  it('renders a negative amount with a leading minus', () => {
    expect(formatPrice(-5000, true, 'IDR')).toBe('-Rp 5000');
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
  it('computes gross prices when tax is hidden (subtotal 93000, no tax)', () => {
    const r = computeReceiptPreview({ taxRatePercent: 10, showTax: false, taxRoundingMode: 'half_up' });
    expect(r.itemPrices).toEqual([35000, 16000, 42000]);
    expect(r.subtotal).toBe(93000);
    expect(r.tax).toBe(0);
    expect(r.total).toBe(93000);
    expect(r.change).toBe(7000);
  });

  it('applies half-up rounding on tax with a 10% rate', () => {
    // multiplier = 100/110
    // item1Exact = 35000 * 100/110 = 31818.18..., item1 = 31818
    // item2Exact = 16000 * 100/110 = 14545.45..., item2 = 14545
    // item3Exact = 42000 * 100/110 = 38181.81..., item3 = 38182
    // exactSubtotal = 84545.45..., subtotal = round = 84545
    // rawTax = 84545.45... * 0.10 = 8454.54..., half-up = 8455
    const r = computeReceiptPreview({ taxRatePercent: 10, showTax: true, taxRoundingMode: 'half_up' });
    expect(r.itemPrices).toEqual([31818, 14545, 38182]);
    expect(r.subtotal).toBe(84545);
    expect(r.tax).toBe(8455);
    expect(r.total).toBe(93000);
  });

  it('applies truncate rounding on the same tax figure', () => {
    const r = computeReceiptPreview({ taxRatePercent: 10, showTax: true, taxRoundingMode: 'truncate' });
    // rawTax = 8454.54... -> truncated 8454
    expect(r.tax).toBe(8454);
    expect(r.total).toBe(84545 + 8454);
  });

  it('handles a 0% tax rate (net = gross)', () => {
    const r = computeReceiptPreview({ taxRatePercent: 0, showTax: true, taxRoundingMode: 'half_up' });
    expect(r.itemPrices).toEqual([35000, 16000, 42000]);
    expect(r.subtotal).toBe(93000);
    expect(r.tax).toBe(0);
    expect(r.total).toBe(93000);
    expect(r.change).toBe(7000);
  });

  it('preserves gross 93000 at any rate (net-of-tax math), so change is always 7000', () => {
    // Net-of-tax pricing keeps the gross total at 93.000 whatever the rate, so
    // the Rp 100.000 cash note always yields exactly Rp 7.000 change — the
    // Math.max(0, ...) floor in computeReceiptPreview is thus never exercised
    // for the sample item set (it is defensive for future price changes).
    const r = computeReceiptPreview({ taxRatePercent: 100, showTax: true, taxRoundingMode: 'half_up' });
    expect(r.subtotal).toBe(46500);
    expect(r.tax).toBe(46500);
    expect(r.total).toBe(93000);
    expect(r.change).toBe(7000);
  });
});
