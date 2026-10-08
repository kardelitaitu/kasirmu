import { describe, it, expect } from 'vitest';
import { parsePriceToMinor, formatMinorForInput } from '../features/restaurant/screens/menuEditorLogic';

// The price field is the one place a menu edit can silently corrupt an invoice,
// so the rounding boundary is pinned rather than assumed.

describe('parsePriceToMinor', () => {
  it('accepts a whole number of major units', () => {
    expect(parsePriceToMinor('50', 'IDR')).toBe(5000);
  });

  it('accepts two decimals as minor units', () => {
    expect(parsePriceToMinor('50.50', 'IDR')).toBe(5050);
    expect(parsePriceToMinor('50,50', 'IDR')).toBe(5050);
  });

  it('pads a single decimal to two minor digits', () => {
    expect(parsePriceToMinor('50.5', 'IDR')).toBe(5050);
  });

  it('strips dot grouping before deciding the decimal mark', () => {
    // 1.234.567 as grouping -> 1234567 major units, not 1.234567.
    expect(parsePriceToMinor('1.234.567', 'IDR')).toBe(123456700);
  });

  it('reads a three-digit dot-group as IDR grouping, not as three decimals', () => {
    // 50.123 is syntactically ambiguous. For IDR the grouped reading is the one
    // an operator means: a rupiah price is never written with three decimals,
    // and 50.123 as a decimal would not be representable in minor units anyway.
    expect(parsePriceToMinor('50.123', 'IDR')).toBe(5012300);
  });

  it('rejects a genuinely over-precise amount', () => {
    // Four decimals cannot be grouped into threes, so this is unambiguously a
    // decimal that IDR cannot hold.
    expect(parsePriceToMinor('50.1234', 'IDR')).toBeNull();
  });

  it('rejects empty and non-numeric input rather than coercing to zero', () => {
    // A silent 0 here would price an item as free.
    expect(parsePriceToMinor('', 'IDR')).toBeNull();
    expect(parsePriceToMinor('   ', 'IDR')).toBeNull();
    expect(parsePriceToMinor('abc', 'IDR')).toBeNull();
    expect(parsePriceToMinor('5o', 'IDR')).toBeNull();
  });
});

describe('formatMinorForInput', () => {
  it('renders whole major units without a decimal part', () => {
    expect(formatMinorForInput(5000)).toBe('50');
  });

  it('renders a fractional part with two digits', () => {
    expect(formatMinorForInput(5050)).toBe('50.50');
    expect(formatMinorForInput(5005)).toBe('50.05');
  });

  it('returns empty for values an operator could not have entered', () => {
    expect(formatMinorForInput(-1)).toBe('');
    expect(formatMinorForInput(Number.NaN)).toBe('');
  });
});

describe('round trip', () => {
  it('survives parse -> format for representative prices', () => {
    for (const minor of [0, 1, 100, 5050, 123456700]) {
      const text = formatMinorForInput(minor);
      if (text === '') continue;
      expect(parsePriceToMinor(text, 'IDR')).toBe(minor);
    }
  });
});
