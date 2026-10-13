// ── The thousands separator: one vocabulary, one reader ──────────────
//
// `currency.thousands_separator` is the store setting the PRINTER honours
// (`ReceiptConfig.grouping`, kasirmu-hal/src/drivers/receipt.rs:193) and the
// front end did not. Exposing it on `StoreSettingsDto` (e84ccdc62) gave the UI a
// value; this file pins the SYNCHRONOUS reader that lets a formatter use it.
//
// Modelled on `getDecimalSep` / `setDecimalSep` in the same module, which solve
// the identical problem for the decimal separator: `formatMoney` is synchronous
// and called from 149 non-test sites, so a value that arrives only through an async
// context is a value it cannot read. localStorage is the bridge, and this is the
// second one — same vocabulary shape, same validating reader, same try/catch.
//
// The four values are the printer's own vocabulary
// (`ThousandSeparator::from_setting`, receipt.rs:99-115): comma | dot | space | none.

import { describe, it, expect, beforeEach } from 'vitest';
import { getThousandsSep, setThousandsSep, thousandsSepFor } from '@/utils/storage';

const KEY = 'kasirmu-thousands-sep';

describe('thousands separator storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to none, which is the printer pre-D6 behaviour', () => {
    // NOT 'comma'. The core setting defaults to comma for a fresh store, but this
    // reader has no store to ask, and inventing grouping would restyle every
    // receipt that never asked for one — the same reasoning the printer's own
    // ReceiptConfig::default gives for ThousandSeparator::None.
    expect(getThousandsSep()).toBe('none');
  });

  it('round-trips every value in the printer vocabulary', () => {
    for (const v of ['comma', 'dot', 'space', 'none'] as const) {
      setThousandsSep(v);
      expect(getThousandsSep(), `round-trip ${v}`).toBe(v);
      expect(localStorage.getItem(KEY)).toBe(v);
    }
  });

  it('refuses an unknown value rather than storing it', () => {
    setThousandsSep('comma');
    setThousandsSep('semicolon');
    expect(getThousandsSep()).toBe('comma');
    expect(localStorage.getItem(KEY)).toBe('comma');
  });

  it('ignores a corrupted stored value and falls back', () => {
    // A value written by another build, or hand-edited, must not reach a formatter.
    localStorage.setItem(KEY, 'DOT');
    expect(getThousandsSep()).toBe('none');
    localStorage.setItem(KEY, '{}');
    expect(getThousandsSep()).toBe('none');
  });

  it('survives localStorage being unavailable', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new Error('denied'); },
    });
    try {
      expect(getThousandsSep()).toBe('none');
      // And the setter must not throw either.
      expect(() => setThousandsSep('dot')).not.toThrow();
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
    }
  });

  it('thousandsSepFor maps the store DTO value onto the vocabulary', () => {
    // The DTO hands back 'comma' by default for a fresh store, so the mapping must
    // be total rather than "present means chosen".
    expect(thousandsSepFor('comma')).toBe('comma');
    expect(thousandsSepFor('dot')).toBe('dot');
    expect(thousandsSepFor('space')).toBe('space');
    expect(thousandsSepFor('none')).toBe('none');
    // Absent / null / junk from an older bridge -> the safe default.
    expect(thousandsSepFor(undefined)).toBe('none');
    expect(thousandsSepFor(null)).toBe('none');
    expect(thousandsSepFor('')).toBe('none');
    expect(thousandsSepFor('semicolon')).toBe('none');
    // Case-insensitive, because the bridge normalises but an older payload may not.
    expect(thousandsSepFor(' DOT ')).toBe('dot');
  });
});
