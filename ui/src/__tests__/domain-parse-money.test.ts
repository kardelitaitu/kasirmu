import { describe, expect, it } from 'vitest';
import {
  parseMoneyInput,
  formatMoneyInput,
  minorUnitsToInputString,
  parseBalanceInput,
} from '@/types/domain';

describe('parseMoneyInput across all currencies', () => {
  describe('IDR (exponent 0)', () => {
    it('parses plain rupiah integers', () => {
      expect(parseMoneyInput('5000', 'IDR')).toBe(5000);
      expect(parseMoneyInput('50000', 'IDR')).toBe(50000);
      expect(parseMoneyInput('100000', 'IDR')).toBe(100000);
      expect(parseMoneyInput('0', 'IDR')).toBe(0);
    });

    it('strips thousands grouping dots correctly', () => {
      expect(parseMoneyInput('5.000', 'IDR')).toBe(5000);
      expect(parseMoneyInput('50.000', 'IDR')).toBe(50000);
      expect(parseMoneyInput('100.000', 'IDR')).toBe(100000);
      expect(parseMoneyInput('1.234.567', 'IDR')).toBe(1234567);
      expect(parseMoneyInput('50.123', 'IDR')).toBe(50123);
    });

    it('strips thousands grouping commas and underscores', () => {
      expect(parseMoneyInput('50,000', 'IDR')).toBe(50000);
      expect(parseMoneyInput('1,234,567', 'IDR')).toBe(1234567);
      expect(parseMoneyInput(' 50_000 ', 'IDR')).toBe(50000);
      expect(parseMoneyInput('1_234_567', 'IDR')).toBe(1234567);
    });

    it('accepts trailing zero decimals without error', () => {
      expect(parseMoneyInput('5000.00', 'IDR')).toBe(5000);
      expect(parseMoneyInput('5000,00', 'IDR')).toBe(5000);
      expect(parseMoneyInput('0.00', 'IDR')).toBe(0);
      expect(parseMoneyInput('0,00', 'IDR')).toBe(0);
    });

    it('rejects non-zero fractional cents that IDR cannot represent', () => {
      expect(parseMoneyInput('50.5', 'IDR')).toBeNull();
      expect(parseMoneyInput('50.50', 'IDR')).toBeNull();
      expect(parseMoneyInput('50,5', 'IDR')).toBeNull();
      expect(parseMoneyInput('50.1234', 'IDR')).toBeNull();
    });

    it('rejects negative, empty, and invalid strings', () => {
      expect(parseMoneyInput('-5000', 'IDR')).toBeNull();
      expect(parseMoneyInput('', 'IDR')).toBeNull();
      expect(parseMoneyInput('   ', 'IDR')).toBeNull();
      expect(parseMoneyInput('abc', 'IDR')).toBeNull();
      expect(parseMoneyInput('5o00', 'IDR')).toBeNull();
    });
  });

  describe('Other zero-exponent currencies (JPY, KRW, VND)', () => {
    it('parses integers and strips grouping without multiplying', () => {
      expect(parseMoneyInput('1000', 'JPY')).toBe(1000);
      expect(parseMoneyInput('1,000', 'JPY')).toBe(1000);
      expect(parseMoneyInput('50000', 'KRW')).toBe(50000);
      expect(parseMoneyInput('50,000', 'KRW')).toBe(50000);
      expect(parseMoneyInput('100000', 'VND')).toBe(100000);
      expect(parseMoneyInput('100.000', 'VND')).toBe(100000);
    });
  });

  describe('USD / EUR / SGD (exponent 2)', () => {
    it('scales major units to cents', () => {
      expect(parseMoneyInput('50', 'USD')).toBe(5000);
      expect(parseMoneyInput('100', 'USD')).toBe(10000);
      expect(parseMoneyInput('0', 'USD')).toBe(0);
    });

    it('parses decimal values to cents', () => {
      expect(parseMoneyInput('50.50', 'USD')).toBe(5050);
      expect(parseMoneyInput('50.5', 'USD')).toBe(5050);
      expect(parseMoneyInput('0.05', 'USD')).toBe(5);
      expect(parseMoneyInput('0.99', 'USD')).toBe(99);
    });

    it('handles European comma decimal and grouping', () => {
      expect(parseMoneyInput('50,50', 'EUR')).toBe(5050);
      expect(parseMoneyInput('1.234,50', 'EUR')).toBe(123450);
      expect(parseMoneyInput('1,234.50', 'USD')).toBe(123450);
    });

    it('rejects over-precision beyond 2 decimals', () => {
      expect(parseMoneyInput('50.123', 'USD')).toBeNull();
      expect(parseMoneyInput('50.1234', 'USD')).toBeNull();
    });

    it('rejects negative, empty, and invalid values', () => {
      expect(parseMoneyInput('-50', 'USD')).toBeNull();
      expect(parseMoneyInput('', 'USD')).toBeNull();
      expect(parseMoneyInput('xyz', 'USD')).toBeNull();
    });
  });

  describe('KWD (exponent 3)', () => {
    it('scales major units to 3 decimal places', () => {
      expect(parseMoneyInput('5', 'KWD')).toBe(5000);
      expect(parseMoneyInput('5.123', 'KWD')).toBe(5123);
      expect(parseMoneyInput('5.12', 'KWD')).toBe(5120);
      expect(parseMoneyInput('5.1234', 'KWD')).toBeNull();
    });
  });
});

describe('formatMoneyInput', () => {
  it('formats exponent-0 currencies as clean whole digits', () => {
    expect(formatMoneyInput(5000, 'IDR')).toBe('5000');
    expect(formatMoneyInput(0, 'IDR')).toBe('0');
    expect(formatMoneyInput(35000, 'IDR')).toBe('35000');
    expect(formatMoneyInput(1000, 'JPY')).toBe('1000');
  });

  it('formats exponent-2 currencies with trimmed decimals', () => {
    expect(formatMoneyInput(5000, 'USD')).toBe('50');
    expect(formatMoneyInput(5050, 'USD')).toBe('50.50');
    expect(formatMoneyInput(5005, 'USD')).toBe('50.05');
    expect(formatMoneyInput(5, 'USD')).toBe('0.05');
    expect(formatMoneyInput(0, 'USD')).toBe('0');
  });

  it('formats exponent-3 currencies with up to 3 decimals', () => {
    expect(formatMoneyInput(5000, 'KWD')).toBe('5');
    expect(formatMoneyInput(5123, 'KWD')).toBe('5.123');
    expect(formatMoneyInput(5120, 'KWD')).toBe('5.120');
  });

  it('returns empty string for negative or non-finite numbers', () => {
    expect(formatMoneyInput(-1, 'IDR')).toBe('');
    expect(formatMoneyInput(Number.NaN, 'IDR')).toBe('');
    expect(formatMoneyInput(Number.POSITIVE_INFINITY, 'IDR')).toBe('');
  });
});

describe('minorUnitsToInputString', () => {
  it('formats exact decimals for inputs requiring full padded decimals', () => {
    expect(minorUnitsToInputString(5000, 0)).toBe('5000');
    expect(minorUnitsToInputString(5000, 2)).toBe('50.00');
    expect(minorUnitsToInputString(5050, 2)).toBe('50.50');
    expect(minorUnitsToInputString(5, 2)).toBe('0.05');
    expect(minorUnitsToInputString(0, 2)).toBe('0.00');
  });
});

describe('parseBalanceInput', () => {
  it('parses opening/closing balances in IDR including grouped thousands', () => {
    expect(parseBalanceInput('100000', 'IDR')).toBe(100000);
    expect(parseBalanceInput('100.000', 'IDR')).toBe(100000);
    expect(parseBalanceInput('0', 'IDR')).toBe(0);
    expect(parseBalanceInput('', 'IDR')).toBe(0);
  });

  it('parses balances in USD', () => {
    expect(parseBalanceInput('100', 'USD')).toBe(10000);
    expect(parseBalanceInput('100.50', 'USD')).toBe(10050);
  });
});

describe('two-way round-trip stability', () => {
  it('round-trips all representative amounts in IDR', () => {
    const samples = [0, 1, 100, 500, 5000, 25000, 50000, 100000, 1234567];
    for (const minor of samples) {
      const formatted = formatMoneyInput(minor, 'IDR');
      expect(parseMoneyInput(formatted, 'IDR')).toBe(minor);
    }
  });

  it('round-trips all representative amounts in USD', () => {
    const samples = [0, 5, 50, 100, 500, 5000, 5050, 123450];
    for (const minor of samples) {
      const formatted = formatMoneyInput(minor, 'USD');
      expect(parseMoneyInput(formatted, 'USD')).toBe(minor);
    }
  });
});
