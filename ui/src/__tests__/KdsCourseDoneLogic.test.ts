// Unit tests for course group done-count and allDone — the pure logic
// that determines whether all items in a course group are completed.

import { describe, it, expect } from 'vitest';

function itemDone(item_status: string): boolean {
  return item_status === 'served' || item_status === 'cancelled';
}

function courseDoneCount(items: { item_status: string }[]): number {
  return items.filter((i) => itemDone(i.item_status)).length;
}

function courseAllDone(items: { item_status: string }[]): boolean {
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
