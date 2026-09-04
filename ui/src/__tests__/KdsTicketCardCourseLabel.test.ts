// Unit tests for courseLabel and header color selection — the pure
// mappings used by KdsTicketCard for course display names and card
// header colours.
//
// Everything here used to be a hand-written copy: COURSE_L10N_KEYS reproduced value for
// value, plus its own courseLabel ("Same courseLabel logic as KdsTicketCard (without l10n)")
// and its own headerBg ("Same header color logic as KdsTicketCard"). All three now come from
// the component, which calls the same functions in its own render path.

import { describe, it, expect } from 'vitest';
import {
  COURSE_L10N_KEYS,
  courseL10nKey as courseLabel,
  headerBg,
} from '@/features/kds/components/KdsTicketCard';

describe('courseLabel', () => {
  it('null → other', () => {
    expect(courseLabel(null)).toBe('kds-course-other');
  });

  it('appetizer → kds-course-appetizer', () => {
    expect(courseLabel('appetizer')).toBe('kds-course-appetizer');
  });

  it('main → kds-course-main', () => {
    expect(courseLabel('main')).toBe('kds-course-main');
  });

  it('side → kds-course-side', () => {
    expect(courseLabel('side')).toBe('kds-course-side');
  });

  it('dessert → kds-course-dessert', () => {
    expect(courseLabel('dessert')).toBe('kds-course-dessert');
  });

  it('beverage → kds-course-beverage', () => {
    expect(courseLabel('beverage')).toBe('kds-course-beverage');
  });

  it('unknown course → other', () => {
    expect(courseLabel('specials')).toBe('kds-course-other');
    expect(courseLabel('')).toBe('kds-course-other');
  });

  // Completeness over the real table, so adding a course without a key -- or renaming a
  // key without updating the mapping -- fails here instead of silently falling through to
  // "other" on the kitchen display.
  it('every course in the mapping resolves to its own key', () => {
    expect(Object.keys(COURSE_L10N_KEYS).length).toBeGreaterThan(0);
    for (const [course, key] of Object.entries(COURSE_L10N_KEYS)) {
      expect(courseLabel(course)).toBe(key);
    }
  });

  it('every mapped key is a kds-course-* term', () => {
    for (const key of Object.values(COURSE_L10N_KEYS)) {
      expect(key).toMatch(/^kds-course-/);
    }
  });
});

describe('headerBg', () => {
  const colors = { dinein: '#22c55e', takeaway: '#147EFB' };

  it('table_number present → dinein color', () => {
    expect(headerBg('T5', colors)).toBe('#22c55e');
  });

  it('table_number empty string → takeaway color', () => {
    expect(headerBg('', colors)).toBe('#147EFB');
  });

  it('table_number null → takeaway color', () => {
    expect(headerBg(null, colors)).toBe('#147EFB');
  });

  it('table_number whitespace → dinein color', () => {
    expect(headerBg('  ', colors)).toBe('#22c55e');
  });
});
