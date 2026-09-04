// Unit tests for course group done-count and allDone — the pure logic
// that determines whether all items in a course group are completed.
//
// itemDone was redeclared here with a DIFFERENT signature than the real one: the copy took
// an `item_status: string`, while KdsTicketCard.tsx:101 exports `itemDone(item: KdsLineItem)`
// and the component calls it as `group.items.filter(itemDone)` at :344. Importing the real
// function costs nothing because the fixtures already carry `item_status`, so the wrappers
// below now read exactly like the component.

import { describe, it, expect } from 'vitest';
import { itemDone } from '@/features/kds/components/KdsTicketCard';

type Item = { item_status: string };

function courseDoneCount(items: Item[]): number {
  return items.filter(itemDone).length;
}

function courseAllDone(items: Item[]): boolean {
  return courseDoneCount(items) === items.length;
}

describe('courseDoneCount', () => {
  it('0 of 3 done', () => {
    expect(courseDoneCount([
      { item_status: 'pending' },
      { item_status: 'preparing' },
      { item_status: 'ready' },
    ])).toBe(0);
  });

  it('1 of 3 done (served)', () => {
    expect(courseDoneCount([
      { item_status: 'served' },
      { item_status: 'preparing' },
      { item_status: 'ready' },
    ])).toBe(1);
  });

  it('2 of 3 done (served + cancelled)', () => {
    expect(courseDoneCount([
      { item_status: 'served' },
      { item_status: 'cancelled' },
      { item_status: 'preparing' },
    ])).toBe(2);
  });

  it('3 of 3 done', () => {
    expect(courseDoneCount([
      { item_status: 'served' },
      { item_status: 'served' },
      { item_status: 'cancelled' },
    ])).toBe(3);
  });

  it('empty list → 0', () => {
    expect(courseDoneCount([])).toBe(0);
  });
});

describe('courseAllDone', () => {
  it('all served → true', () => {
    expect(courseAllDone([
      { item_status: 'served' },
      { item_status: 'served' },
    ])).toBe(true);
  });

  it('mix of served/cancelled → true', () => {
    expect(courseAllDone([
      { item_status: 'served' },
      { item_status: 'cancelled' },
    ])).toBe(true);
  });

  it('one pending → false', () => {
    expect(courseAllDone([
      { item_status: 'served' },
      { item_status: 'pending' },
    ])).toBe(false);
  });

  it('empty list → true (vacuously)', () => {
    expect(courseAllDone([])).toBe(true);
  });

  it('single done item → true', () => {
    expect(courseAllDone([{ item_status: 'served' }])).toBe(true);
  });

  it('single pending item → false', () => {
    expect(courseAllDone([{ item_status: 'preparing' }])).toBe(false);
  });
});
