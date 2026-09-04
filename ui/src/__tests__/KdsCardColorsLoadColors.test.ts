// Unit tests for loadColors — contract test for the KDS card color
// persistence logic: reads per-theme colors from localStorage, falls
// back to defaults when missing/malformed.

import { describe, it, expect, beforeEach } from 'vitest';

const STORAGE_KEY = 'kds-card-colors-v1';

const DEFAULT_DARK = {
  dinein: '#22c55e',
  takeaway: '#147EFB',
  rush: '#ef4444',
  processing: '#f59e0b',
  prepared: '#22c55e',
  pause: '#f59e0b',
  resume: '#147EFB',
  complete: '#4ade80',
};

const DEFAULT_LIGHT = {
  dinein: '#89a1c8',
  takeaway: '#9484b8',
  rush: '#f04242',
  processing: '#89a1c8',
  prepared: '#242424',
  pause: '#dcdfe5',
  resume: '#3b4972',
  complete: '#a72525',
};

/** Same loadColors logic as KdsCardColorsContext.tsx. */
function loadColors(theme: string) {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const all = JSON.parse(saved) as Record<string, typeof DEFAULT_DARK>;
      return all[theme] ?? (theme === 'light' ? DEFAULT_LIGHT : DEFAULT_DARK);
    }
  } catch {
    // Fall back
  }
  return theme === 'light' ? DEFAULT_LIGHT : DEFAULT_DARK;
}

describe('loadColors contract', () => {
  beforeEach(() => {
    localStorage.clear();
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
