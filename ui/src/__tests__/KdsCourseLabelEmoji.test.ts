import { describe, it, expect } from 'vitest';
import { courseLabel, courseEmoji, COURSES } from '@/types/domain';

describe('courseLabel', () => {
  it('returns "Appetizer" for appetizer', () => {
    expect(courseLabel('appetizer')).toBe('Appetizer');
  });

  it('returns "Main Course" for main', () => {
    expect(courseLabel('main')).toBe('Main Course');
  });

  it('returns "Dessert" for dessert', () => {
    expect(courseLabel('dessert')).toBe('Dessert');
  });

  it('returns "Beverage" for beverage', () => {
    expect(courseLabel('beverage')).toBe('Beverage');
  });

  it('resolves legacy "drinks" to the beverage label', () => {
    expect(courseLabel('drinks')).toBe('Beverage');
  });

  it('returns the raw id for unknown course', () => {
    expect(courseLabel('unknown-course' as never)).toBe('unknown-course');
  });

  it('returns empty string for empty string', () => {
    expect(courseLabel('' as never)).toBe('');
  });
});

describe('courseEmoji', () => {
  it('returns salad emoji for appetizer', () => {
    expect(courseEmoji('appetizer')).toBe('🥗');
  });

  it('returns plate emoji for main', () => {
    expect(courseEmoji('main')).toBe('🍽️');
  });

  it('returns cake emoji for dessert', () => {
    expect(courseEmoji('dessert')).toBe('🍰');
  });

  it('returns drink emoji for beverage', () => {
    expect(courseEmoji('beverage')).toBe('🥤');
  });

  it('resolves legacy "drinks" to the beverage emoji', () => {
    expect(courseEmoji('drinks')).toBe('🥤');
  });

  it('returns fallback plate emoji for unknown course', () => {
    expect(courseEmoji('unknown-course' as never)).toBe('🍽️');
  });

  it('returns fallback plate emoji for empty string', () => {
    expect(courseEmoji('' as never)).toBe('🍽️');
  });
});

describe('COURSES constant', () => {
  it('has exactly 5 courses', () => {
    expect(COURSES).toHaveLength(5);
  });

  it('every course has id, label, and emoji', () => {
    for (const c of COURSES) {
      expect(c.id).toBeTruthy();
      expect(c.label).toBeTruthy();
      expect(c.emoji).toBeTruthy();
    }
  });

  it('all course ids are unique', () => {
    const ids = COURSES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
