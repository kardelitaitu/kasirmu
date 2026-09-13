import { describe, it, expect } from 'vitest';
import { resolveCourseFromCategory } from '@/features/kds/components/KdsProductPickerModal';

describe('resolveCourseFromCategory', () => {
  it('returns null for null', () => {
    expect(resolveCourseFromCategory(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(resolveCourseFromCategory(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(resolveCourseFromCategory('')).toBeNull();
  });

  it('returns null for unrecognized category', () => {
    expect(resolveCourseFromCategory('snacks')).toBeNull();
  });

  // Appetizer mappings
  it('maps "appetizer" to appetizer', () => {
    expect(resolveCourseFromCategory('appetizer')).toBe('appetizer');
  });

  it('maps "Appetizer" (case-insensitive)', () => {
    expect(resolveCourseFromCategory('Appetizer')).toBe('appetizer');
  });

  it('maps "Starter" to appetizer', () => {
    expect(resolveCourseFromCategory('Starter')).toBe('appetizer');
  });

  it('maps "starters" to appetizer', () => {
    expect(resolveCourseFromCategory('starters')).toBe('appetizer');
  });

  // Main mappings
  it('maps "main" to main', () => {
    expect(resolveCourseFromCategory('main')).toBe('main');
  });

  it('maps "Main Course" to main', () => {
    expect(resolveCourseFromCategory('Main Course')).toBe('main');
  });

  it('maps "entree" to main', () => {
    expect(resolveCourseFromCategory('entree')).toBe('main');
  });

  it('does not match accented "Entrée" (accented e ≠ plain e)', () => {
    // toLowerCase does not normalize accents, so 'entrée' doesn't match 'entree'
    expect(resolveCourseFromCategory('Entrée')).toBeNull();
  });

  // Side
  it('maps "side" to side', () => {
    expect(resolveCourseFromCategory('side')).toBe('side');
  });

  it('maps "Side Dishes" to side', () => {
    expect(resolveCourseFromCategory('Side Dishes')).toBe('side');
  });

  // Dessert
  it('maps "dessert" to dessert', () => {
    expect(resolveCourseFromCategory('dessert')).toBe('dessert');
  });

  it('maps "Desserts" to dessert', () => {
    expect(resolveCourseFromCategory('Desserts')).toBe('dessert');
  });

  // Beverage
  it('maps "drink" to beverage', () => {
    expect(resolveCourseFromCategory('drink')).toBe('beverage');
  });

  it('maps "drinks" to beverage', () => {
    expect(resolveCourseFromCategory('drinks')).toBe('beverage');
  });

  it('maps "beverage" to beverage', () => {
    expect(resolveCourseFromCategory('beverage')).toBe('beverage');
  });

  it('maps "Beverages" to beverage', () => {
    expect(resolveCourseFromCategory('Beverages')).toBe('beverage');
  });

  // Substring matching
  it('matches "appetizers" (substring of "appetizer")', () => {
    expect(resolveCourseFromCategory('appetizers')).toBe('appetizer');
  });

  it('matches "mains" (substring of "main")', () => {
    expect(resolveCourseFromCategory('mains')).toBe('main');
  });

  it('matches "desserts" (substring of "dessert")', () => {
    expect(resolveCourseFromCategory('desserts')).toBe('dessert');
  });

  // Priority: appetizer takes precedence over main
  it('returns first match: appetizer before main for ambiguous input', () => {
    // 'appetizer main' → appetizer (checked first)
    expect(resolveCourseFromCategory('appetizer main')).toBe('appetizer');
  });

  // Whitespace handling
  it('handles leading/trailing whitespace', () => {
    expect(resolveCourseFromCategory('  dessert  ')).toBe('dessert');
  });
});
