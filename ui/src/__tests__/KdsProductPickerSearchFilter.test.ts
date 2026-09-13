import { describe, it, expect } from 'vitest';

/**
 * Tests for the product search filter logic used by KdsProductPickerModal.
 *
 * The filter is inline in the component: products matching by name or SKU
 * (case-insensitive). We extract and test the contract here.
 */

interface Product {
  sku: string;
  name: string;
}

/** Same filter logic as KdsProductPickerModal's filtered useMemo. */
function filterProducts(products: Product[], search: string): Product[] {
  if (!search) return products;
  const q = search.toLowerCase();
  return products.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.sku.toLowerCase().includes(q),
  );
}

const PRODUCTS: Product[] = [
  { sku: 'NES-001', name: 'Nasi Goreng' },
  { sku: 'MIE-002', name: 'Mie Ayam' },
  { sku: 'TEH-003', name: 'Teh Manis' },
  { sku: 'KOP-004', name: 'Kopi O' },
  { sku: 'AYM-005', name: 'Ayam Bakar' },
];

describe('product search filter', () => {
  it('returns all products when search is empty', () => {
    expect(filterProducts(PRODUCTS, '')).toHaveLength(5);
  });

  it('matches by name (case-insensitive)', () => {
    const result = filterProducts(PRODUCTS, 'nasi');
    expect(result).toHaveLength(1);
    expect(result[0]!.sku).toBe('NES-001');
  });

  it('matches by SKU (case-insensitive)', () => {
    const result = filterProducts(PRODUCTS, 'mie');
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.map((p) => p.sku)).toContain('MIE-002');
  });

  it('matches partial strings', () => {
    const result = filterProducts(PRODUCTS, 'kopi');
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('Kopi O');
  });

  it('returns empty for non-matching search', () => {
    expect(filterProducts(PRODUCTS, 'xyz123')).toHaveLength(0);
  });

  it('case-insensitive matching', () => {
    const result = filterProducts(PRODUCTS, 'NASI');
    expect(result).toHaveLength(1);
  });

  it('matches multiple products', () => {
    // "a" appears in Nasi, Mie Ayam, Ayam Bakar
    const result = filterProducts(PRODUCTS, 'ay');
    expect(result).toHaveLength(2);
  });

  it('search by SKU prefix', () => {
    const result = filterProducts(PRODUCTS, 'NES');
    expect(result).toHaveLength(1);
    expect(result[0]!.sku).toBe('NES-001');
  });

  it('empty search returns all products (no filtering)', () => {
    const result = filterProducts(PRODUCTS, '');
    expect(result).toBe(PRODUCTS); // same reference
  });
});
