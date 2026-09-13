import { describe, it, expect, beforeEach } from 'vitest';
import { saveColors, loadColors, STORAGE_KEY } from '@/features/kds/KdsCardColorsContext';
import {
  DEFAULT_COLORS_DARK as DEFAULT_DARK,
  DEFAULT_COLORS_LIGHT as DEFAULT_LIGHT,
} from '@/features/kds/kdsCardColors';

describe('saveColors', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists dark colors and round-trips through loadColors', () => {
    const custom = { ...DEFAULT_DARK, dinein: '#ff0000' };
    saveColors('dark', custom);
    expect(loadColors('dark').dinein).toBe('#ff0000');
  });

  it('persists light colors independently from dark', () => {
    const customLight = { ...DEFAULT_LIGHT, dinein: '#aabbcc' };
    saveColors('light', customLight);
    // Dark should still be default
    expect(loadColors('dark')).toEqual(DEFAULT_DARK);
    // Light should be custom
    expect(loadColors('light').dinein).toBe('#aabbcc');
  });

  it('does not overwrite other theme when saving one theme', () => {
    const darkCustom = { ...DEFAULT_DARK, dinein: '#111111' };
    const lightCustom = { ...DEFAULT_LIGHT, dinein: '#cccccc' };
    saveColors('dark', darkCustom);
    saveColors('light', lightCustom);
    expect(loadColors('dark').dinein).toBe('#111111');
    expect(loadColors('light').dinein).toBe('#cccccc');
  });

  it('overwrites previous save for the same theme', () => {
    saveColors('dark', { ...DEFAULT_DARK, dinein: '#aaa' });
    saveColors('dark', { ...DEFAULT_DARK, dinein: '#bbb' });
    expect(loadColors('dark').dinein).toBe('#bbb');
  });

  it('writes valid JSON under the STORAGE_KEY', () => {
    saveColors('dark', DEFAULT_DARK);
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.dark).toBeDefined();
    expect(parsed.dark.dinein).toBe(DEFAULT_DARK.dinein);
  });

  it('handles corrupted existing localStorage without throwing', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json');
    // Should not throw — saveColors catches parse errors in the read path.
    // However, the catch is on the whole try block, so the write is also skipped.
    expect(() => saveColors('dark', DEFAULT_DARK)).not.toThrow();
  });
});
