import { describe, it, expect } from 'vitest';
import { addOrUpdatePicked, clampQty, updateQtyEntry } from '@/features/kds/components/KdsProductPickerModal';

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

describe('clampQty', () => {
  it('passes through a positive quantity', () => {
    expect(clampQty(1)).toBe(1);
    expect(clampQty(5)).toBe(5);
    expect(clampQty(120)).toBe(120);
  });

  it('returns null for zero', () => {
    expect(clampQty(0)).toBeNull();
  });

  it('returns null for negative quantities', () => {
    expect(clampQty(-1)).toBeNull();
    expect(clampQty(-99)).toBeNull();
  });

  it('returns null for NaN', () => {
    expect(clampQty(NaN)).toBeNull();
  });

  it('returns null for non-finite values', () => {
    expect(clampQty(Infinity)).toBeNull();
    expect(clampQty(-Infinity)).toBeNull();
  });

  it('returns null for fractional values below 1', () => {
    expect(clampQty(0.5)).toBeNull();
    expect(clampQty(0.99)).toBeNull();
  });

  it('passes through fractional values at/above 1 (picker displays rounded later)', () => {
    expect(clampQty(1.5)).toBe(1.5);
    expect(clampQty(2.3)).toBe(2.3);
  });
});

describe('updateQtyEntry', () => {
  const base: PickedEntry[] = [
    picked('A', 'Product A', 2),
    picked('B', 'Product B', 5),
  ];

  it('sets the quantity for the matching SKU', () => {
    const result = updateQtyEntry(base, 'A', 3);
    expect(result[0]!.qty).toBe(3);
    expect(result[1]!.qty).toBe(5);
  });

  it('returns a new array (does not mutate the input)', () => {
    const result = updateQtyEntry(base, 'A', 3);
    expect(result).not.toBe(base);
    expect(result[0]).not.toBe(base[0]);
    expect(result[1]).toBe(base[1]);
  });

  it('rejects quantities below 1 (returns unchanged array)', () => {
    const result = updateQtyEntry(base, 'A', 0);
    expect(result).toBe(base);
    expect(result[0]!.qty).toBe(2);
  });

  it('rejects negative quantities (returns unchanged array)', () => {
    const result = updateQtyEntry(base, 'A', -3);
    expect(result).toBe(base);
  });

  it('rejects NaN (returns unchanged array)', () => {
    const result = updateQtyEntry(base, 'A', NaN);
    expect(result).toBe(base);
  });

  it('rejects Infinity (returns unchanged array)', () => {
    const result = updateQtyEntry(base, 'A', Infinity);
    expect(result).toBe(base);
  });

  it('applies the clamped value when qty is clamped higher than 1', () => {
    const result = updateQtyEntry(base, 'B', 10);
    expect(result[1]!.qty).toBe(10);
  });

  it('does nothing when the SKU is not found', () => {
    const result = updateQtyEntry(base, 'Z', 4);
    expect(result).toBe(base);
  });

  it('works with a single-entry list', () => {
    const single = [picked('X', 'Only', 1)];
    const result = updateQtyEntry(single, 'X', 7);
    expect(result).toHaveLength(1);
    expect(result[0]!.qty).toBe(7);
    expect(result).not.toBe(single);
  });
});
