import { describe, it, expect } from 'vitest';
import { addOrUpdatePicked } from '@/features/kds/components/KdsProductPickerModal';

/**
 * Tests for addOrUpdatePicked — the pure logic behind the product picker's
 * add-to-order behavior. When the same SKU is added twice, qty increments.
 * When a new SKU is added, it's appended with qty=1 and course resolved
 * from the category.
 */

interface PickedEntry {
  sku: string;
  display_name: string;
  qty: number;
  course: string | null;
}

function picked(sku: string, name: string, qty: number, course: string | null = null): PickedEntry {
  return { sku, display_name: name, qty, course };
}

describe('addOrUpdatePicked', () => {
  it('adds a new product to empty list', () => {
    const result = addOrUpdatePicked([], { sku: 'A', name: 'Product A' });
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(picked('A', 'Product A', 1));
  });

  it('adds a new product to existing list', () => {
    const initial = [picked('A', 'Product A', 1)];
    const result = addOrUpdatePicked(initial, { sku: 'B', name: 'Product B' });
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual(picked('B', 'Product B', 1));
  });

  it('increments qty when same SKU added', () => {
    const initial = [picked('A', 'Product A', 1)];
    const result = addOrUpdatePicked(initial, { sku: 'A', name: 'Product A' });
    expect(result).toHaveLength(1);
    expect(result[0]!.qty).toBe(2);
  });

  it('increments qty on third add of same SKU', () => {
    let list = addOrUpdatePicked([], { sku: 'A', name: 'Product A' });
    list = addOrUpdatePicked(list, { sku: 'A', name: 'Product A' });
    list = addOrUpdatePicked(list, { sku: 'A', name: 'Product A' });
    expect(list[0]!.qty).toBe(3);
  });

  it('does not affect other products when incrementing', () => {
    const initial = [picked('A', 'Product A', 1), picked('B', 'Product B', 2)];
    const result = addOrUpdatePicked(initial, { sku: 'A', name: 'Product A' });
    expect(result[0]!.qty).toBe(2);
    expect(result[1]!.qty).toBe(2);
  });

  it('resolves course from category', () => {
    const result = addOrUpdatePicked([], {
      sku: 'A', name: 'Spring Rolls', category: 'appetizer',
    });
    expect(result[0]!.course).toBe('appetizer');
  });

  it('resolves course from category for beverages', () => {
    const result = addOrUpdatePicked([], {
      sku: 'T1', name: 'Teh Manis', category: 'drinks',
    });
    expect(result[0]!.course).toBe('beverage');
  });

  it('sets course to null when category is null', () => {
    const result = addOrUpdatePicked([], {
      sku: 'X', name: 'Generic', category: null,
    });
    expect(result[0]!.course).toBeNull();
  });

  it('preserves other entries when adding new', () => {
    const initial = [picked('A', 'A', 1), picked('B', 'B', 1)];
    const result = addOrUpdatePicked(initial, { sku: 'C', name: 'C' });
    expect(result.map((e) => e.sku)).toEqual(['A', 'B', 'C']);
  });

  it('preserves display_name from original entry when incrementing', () => {
    const initial = [picked('A', 'Original Name', 1)];
    const result = addOrUpdatePicked(initial, { sku: 'A', name: 'Different Name' });
    // qty increments but the entry is a spread of the old one
    expect(result[0]!.display_name).toBe('Original Name');
    expect(result[0]!.qty).toBe(2);
  });
});
