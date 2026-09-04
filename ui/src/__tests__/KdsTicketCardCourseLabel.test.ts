// Unit tests for courseLabel and header color selection — the pure
// mappings used by KdsTicketCard for course display names and card
// header colours.

import { describe, it, expect } from 'vitest';

const COURSE_L10N_KEYS: Record<string, string> = {
  appetizer: 'kds-course-appetizer',
  main: 'kds-course-main',
  side: 'kds-course-side',
  dessert: 'kds-course-dessert',
  beverage: 'kds-course-beverage',
};

/** Same courseLabel logic as KdsTicketCard (without l10n). */
function courseLabel(course: string | null): string {
  if (!course) return 'kds-course-other';
  const key = COURSE_L10N_KEYS[course];
  if (key) return key;
  return 'kds-course-other';
}

/** Same header color logic as KdsTicketCard. */
function headerBg(tableNumber: string | null, colors: { dinein: string; takeaway: string }): string {
  return tableNumber ? colors.dinein : colors.takeaway;
}

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
