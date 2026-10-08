import { describe, it, expect } from 'vitest';
import {
  CATEGORY_ICON_OPTIONS,
  CATEGORY_ICON_IDS,
  CATEGORY_COLOURS,
  categoryIconLabelId,
  nextRadioValue,
  randomCategoryIcon,
} from '../features/categories/categoryIcons';

// These ids are persisted on every category row, so this file is a compatibility
// contract with data already in the field, not just a UI helper.

describe('CATEGORY_ICON_OPTIONS', () => {
  it('covers the operator-facing categories the menu editor offers', () => {
    const ids = CATEGORY_ICON_OPTIONS.map((o) => o.id);
    // The five the product asked for, plus the generics.
    expect(ids).toContain('food');
    expect(ids).toContain('snack');
    expect(ids).toContain('hot-drink');
    expect(ids).toContain('cold-drink');
    expect(ids.filter((i) => i.startsWith('dots-')).length).toBeGreaterThan(0);
  });

  it('has a unique id per icon', () => {
    const ids = CATEGORY_ICON_OPTIONS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every icon a non-empty label', () => {
    for (const opt of CATEGORY_ICON_OPTIONS) {
      expect(opt.label.trim().length).toBeGreaterThan(0);
    }
  });

  it('exposes ids in the same order as the options', () => {
    expect(CATEGORY_ICON_IDS).toEqual(CATEGORY_ICON_OPTIONS.map((o) => o.id));
  });
});

describe('categoryIconLabelId', () => {
  it('maps each known icon to its own accessible-name id', () => {
    expect(categoryIconLabelId('food')).toBe('categories-icon-food');
    expect(categoryIconLabelId('snack')).toBe('categories-icon-snack');
    expect(categoryIconLabelId('hot-drink')).toBe('categories-icon-hot-drink');
    expect(categoryIconLabelId('cold-drink')).toBe('categories-icon-cold-drink');
  });

  it('falls back to the generic label rather than returning empty', () => {
    // A category may carry an icon id this build does not know (written by a
    // newer build, or hand-edited). The picker button is icon-only, so an empty
    // label would leave it unnamed to assistive tech.
    expect(categoryIconLabelId('dots-1')).toBe('categories-icon-generic');
    expect(categoryIconLabelId('unknown-icon')).toBe('categories-icon-generic');
    expect(categoryIconLabelId('')).toBe('categories-icon-generic');
  });
});

describe('nextRadioValue', () => {
  const opts = ['a', 'b', 'c'];

  it('wraps forward and backward', () => {
    expect(nextRadioValue(opts, 'c', 'ArrowRight')).toBe('a');
    expect(nextRadioValue(opts, 'a', 'ArrowLeft')).toBe('c');
  });

  it('treats Up/Down like Left/Right, as a single-line radiogroup', () => {
    expect(nextRadioValue(opts, 'a', 'ArrowDown')).toBe('b');
    expect(nextRadioValue(opts, 'b', 'ArrowUp')).toBe('a');
  });

  it('returns null for a non-arrow key so the caller can ignore it', () => {
    expect(nextRadioValue(opts, 'a', 'Enter')).toBeNull();
    expect(nextRadioValue(opts, 'a', 'Tab')).toBeNull();
  });

  it('returns null when the current value is not in the group', () => {
    expect(nextRadioValue(opts, 'zzz', 'ArrowRight')).toBeNull();
  });
});

describe('randomCategoryIcon', () => {
  it('always yields an id from the set', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(CATEGORY_ICON_IDS).toContain(randomCategoryIcon());
    }
  });
});

describe('CATEGORY_COLOURS', () => {
  it('are hex strings, since the icon renderer derives a contrast fg from them', () => {
    for (const c of CATEGORY_COLOURS) {
      expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('is non-empty, so the menu editor has a default to fall back to', () => {
    expect(CATEGORY_COLOURS.length).toBeGreaterThan(0);
    expect(CATEGORY_COLOURS[0]).toBeDefined();
  });
});
