import { describe, it, expect } from 'vitest';
import { addStationToList } from '@/features/kds/components/KdsEnrollmentModal';

/**
 * Tests for addStationToList — the pure logic behind the enrollment modal's
 * station name input. Trims whitespace, rejects empty strings and duplicates.
 */

describe('addStationToList', () => {
  it('adds a station to an empty list', () => {
    expect(addStationToList([], 'Grill')).toEqual(['Grill']);
  });

  it('appends to existing list', () => {
    expect(addStationToList(['Grill'], 'Fryer')).toEqual(['Grill', 'Fryer']);
  });

  it('trims whitespace before adding', () => {
    expect(addStationToList([], '  Grill  ')).toEqual(['Grill']);
  });

  it('rejects empty string', () => {
    const list = ['Grill'];
    expect(addStationToList(list, '')).toBe(list);
  });

  it('rejects whitespace-only string', () => {
    const list = ['Grill'];
    expect(addStationToList(list, '   ')).toBe(list);
  });

  it('rejects duplicate station', () => {
    const list = ['Grill', 'Fryer'];
    expect(addStationToList(list, 'Grill')).toBe(list);
  });

  it('rejects duplicate after trim', () => {
    const list = ['Grill'];
    expect(addStationToList(list, '  Grill  ')).toBe(list);
  });

  it('case-sensitive: Grill ≠ grill', () => {
    expect(addStationToList(['Grill'], 'grill')).toEqual(['Grill', 'grill']);
  });

  it('returns same reference when no change', () => {
    const list = ['Grill'];
    expect(addStationToList(list, 'Grill')).toBe(list);
  });

  it('returns same reference for empty input', () => {
    const list = ['Grill'];
    expect(addStationToList(list, '')).toBe(list);
  });

  it('handles multiple additions', () => {
    let list = addStationToList([], 'Grill');
    list = addStationToList(list, 'Fryer');
    list = addStationToList(list, 'Salad');
    expect(list).toEqual(['Grill', 'Fryer', 'Salad']);
  });

  it('handles UUID-style station names', () => {
    expect(addStationToList([], 'station-550e8400')).toEqual(['station-550e8400']);
  });
});
