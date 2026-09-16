import { describe, expect, it } from 'vitest';
import { STORAGE_KEYS, getDecimalSep, setDecimalSep } from '@/utils/storage';

describe('STORAGE_KEYS', () => {
  it('defines CART_WIDTH key', () => {
    expect(STORAGE_KEYS.CART_WIDTH).toBe('pos-cart-width');
  });

  it('defines LOCALE key', () => {
    expect(STORAGE_KEYS.LOCALE).toBe('kasirmu-locale');
  });

  it('defines DECIMAL_SEP key', () => {
    expect(STORAGE_KEYS.DECIMAL_SEP).toBe('kasirmu-decimal-sep');
  });
});

describe('getDecimalSep', () => {
  it('returns dot by default when nothing is stored', () => {
    expect(getDecimalSep()).toBe('dot');
  });

  it('returns stored value when valid', () => {
    localStorage.setItem(STORAGE_KEYS.DECIMAL_SEP, 'comma');
    expect(getDecimalSep()).toBe('comma');
  });

  it('returns dot when stored value is invalid', () => {
    localStorage.setItem(STORAGE_KEYS.DECIMAL_SEP, 'invalid');
    expect(getDecimalSep()).toBe('dot');
  });

  it('returns dot when stored value is empty', () => {
    localStorage.setItem(STORAGE_KEYS.DECIMAL_SEP, '');
    expect(getDecimalSep()).toBe('dot');
  });
});

describe('setDecimalSep', () => {
  it('stores valid values', () => {
    setDecimalSep('comma');
    expect(localStorage.getItem(STORAGE_KEYS.DECIMAL_SEP)).toBe('comma');
  });

  it('stores dot', () => {
    setDecimalSep('dot');
    expect(localStorage.getItem(STORAGE_KEYS.DECIMAL_SEP)).toBe('dot');
  });

  it('does not store invalid values', () => {
    setDecimalSep('semicolon');
    expect(localStorage.getItem(STORAGE_KEYS.DECIMAL_SEP)).toBeNull();
  });
});
