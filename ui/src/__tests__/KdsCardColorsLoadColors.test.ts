// Unit tests for loadColors — contract test for the KDS card color persistence logic:
// reads per-theme colors from localStorage, falls back to defaults when missing/malformed.
//
// This suite used to redeclare STORAGE_KEY, both default palettes and loadColors() itself
// ("Same loadColors logic as KdsCardColorsContext.tsx") and import nothing from the module
// under test. The palettes still match kdsCardColors.ts key for key, which is precisely the
// condition under which drift is invisible: change a colour in production and the suite
// keeps passing against values nothing uses. Everything now comes from the real modules.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadColors,
  STORAGE_KEY,
} from '@/features/kds/KdsCardColorsContext';
import {
  DEFAULT_COLORS_DARK as DEFAULT_DARK,
  DEFAULT_COLORS_LIGHT as DEFAULT_LIGHT,
} from '@/features/kds/kdsCardColors';

describe('loadColors contract', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // Every test below writes through the imported STORAGE_KEY and reads back through
  // loadColors(), which uses the same constant -- so both sides move together and a rename
  // of the real key leaves all of them green. That is the blind spot documented in
  // 3e0e156c, reproduced here by importing rather than copying. Pinning the literal is the
  // only thing that turns a key change into a deliberate act: renaming it orphans every
  // kitchen's customised card colours with nothing to restore them.
  it('pins the localStorage key so a rename is a deliberate change', () => {
    expect(STORAGE_KEY).toBe('kds-card-colors-v1');
  });

  it('reads what the real key holds, not just what the constant points at', () => {
    const custom = { ...DEFAULT_DARK, dinein: '#ff0000' };
    // Written as a literal on purpose: if STORAGE_KEY changes, this must fail even though
    // the round-trip tests would keep passing, because they use the constant on both sides.
    localStorage.setItem('kds-card-colors-v1', JSON.stringify({ dark: custom }));
    expect(loadColors('dark')).toEqual(custom);
  });

  it('returns dark defaults when no stored data', () => {
    const colors = loadColors('dark');
    expect(colors).toEqual(DEFAULT_DARK);
  });

  it('returns light defaults when no stored data', () => {
    const colors = loadColors('light');
    expect(colors).toEqual(DEFAULT_LIGHT);
  });

  it('reads saved dark colors', () => {
    const custom = { ...DEFAULT_DARK, dinein: '#ff0000' };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ dark: custom }));
    expect(loadColors('dark').dinein).toBe('#ff0000');
  });

  it('reads saved light colors', () => {
    const custom = { ...DEFAULT_LIGHT, takeaway: '#00ff00' };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ light: custom }));
    expect(loadColors('light').takeaway).toBe('#00ff00');
  });

  it('falls back to defaults for unknown theme', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ dark: DEFAULT_DARK }));
    expect(loadColors('unknown')).toEqual(DEFAULT_DARK);
  });

  it('falls back to defaults for invalid JSON', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json');
    expect(loadColors('dark')).toEqual(DEFAULT_DARK);
  });

  it('falls back to defaults when key missing from parsed JSON', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ other: DEFAULT_DARK }));
    expect(loadColors('dark')).toEqual(DEFAULT_DARK);
  });

  it('preserves all color keys from stored data', () => {
    const custom = {
      dinein: '#111',
      takeaway: '#222',
      rush: '#333',
      processing: '#444',
      prepared: '#555',
      pause: '#666',
      resume: '#777',
      complete: '#888',
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ dark: custom }));
    const colors = loadColors('dark');
    expect(colors).toEqual(custom);
  });
});
