// Unit tests for groupByCourse — pure function that groups KDS line items
// by course in display order (appetizer → main → side → dessert → beverage → null/other).

import { describe, it, expect } from 'vitest';
import { groupByCourse } from '@/features/kds/components/KdsTicketCard';
import type { KdsLineItem } from '@/api/kds';

/** Minimal KdsLineItem builder — only fields used by groupByCourse. */
function item(course: string | null, display_name = 'Item'): KdsLineItem {
  return {
    id: crypto.randomUUID(),
    kds_order_id: 'order-1',
    sku: 'SKU',
    display_name,
    qty: 1,
    course,
    modifiers: [],
    line_position: 0,
    item_status: 'preparing',
    started_at: null,
    ready_at: null,
    served_at: null,
    created_at: new Date().toISOString(),
  };
}

describe('groupByCourse', () => {
  it('returns empty array for empty input', () => {
    expect(groupByCourse([])).toEqual([]);
  });

  it('returns a single group for one item', () => {
    const items = [item('main')];
    const groups = groupByCourse(items);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.course).toBe('main');
    expect(groups[0]!.items).toHaveLength(1);
  });

  it('groups items by course', () => {
    const items = [item('main'), item('main'), item('dessert')];
    const groups = groupByCourse(items);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.course).toBe('main');
    expect(groups[0]!.items).toHaveLength(2);
    expect(groups[1]!.course).toBe('dessert');
    expect(groups[1]!.items).toHaveLength(1);
  });

  it('preserves course display order: appetizer → main → side → dessert → beverage', () => {
    const items = [
      item('beverage'),
      item('dessert'),
      item('appetizer'),
      item('main'),
      item('side'),
    ];
    const groups = groupByCourse(items);
    expect(groups.map((g) => g.course)).toEqual([
      'appetizer',
      'main',
      'side',
      'dessert',
      'beverage',
    ]);
  });

  it('places null-course items at the end', () => {
    const items = [item(null), item('main'), item(null)];
    const groups = groupByCourse(items);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.course).toBe('main');
    expect(groups[1]!.course).toBeNull();
    expect(groups[1]!.items).toHaveLength(2);
  });

  it('places unknown course names after known courses', () => {
    const items = [item('specials'), item('main'), item('appetizer')];
    const groups = groupByCourse(items);
    expect(groups.map((g) => g.course)).toEqual([
      'appetizer',
      'main',
      'specials',
    ]);
  });

  it('preserves item insertion order within each course', () => {
    const items = [
      item('main', 'Steak'),
      item('main', 'Pasta'),
      item('main', 'Salad'),
    ];
    const groups = groupByCourse(items);
    expect(groups[0]!.items.map((i) => i.display_name)).toEqual([
      'Steak',
      'Pasta',
      'Salad',
    ]);
  });

  it('handles all five standard courses simultaneously', () => {
    const items = [
      item('appetizer', 'Wings'),
      item('main', 'Burger'),
      item('side', 'Fries'),
      item('dessert', 'Cake'),
      item('beverage', 'Cola'),
    ];
    const groups = groupByCourse(items);
    expect(groups).toHaveLength(5);
    expect(groups.map((g) => g.course)).toEqual([
      'appetizer',
      'main',
      'side',
      'dessert',
      'beverage',
    ]);
  });
});
