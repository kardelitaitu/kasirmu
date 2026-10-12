/**
 * @vitest-environment node
 *
 * This file's import graph is free of browser globals (no render, no
 * `document`/`window`/`localStorage`), so it does not need a jsdom window. Vitest
 * spawns a fresh jsdom per test FILE, which measured ~0.4-0.9s each; under the node
 * environment the same files report `environment: 0ms`.
 *
 * Do not copy this directive onto a file that renders or touches browser state —
 * it will fail with "document is not defined" rather than silently degrade.
 */
// ── Bundle expansion unit tests ───────────────────────────────────
//
// Tests for the `distributeBundlePrice` rounding logic:
// clean division, rounding edge cases, multi-item with varying
// quantities, zero quantities, and edge cases.

import { describe, it, expect, vi } from 'vitest';
import { distributeBundlePrice, expandBundleItems } from '@/features/sales/bundleExpansion';
import type { BundleItem } from '@/api/bundles';
import type { ProductDto } from '@/api/products';

// ── distributeBundlePrice (pure function) ─────────────────────────

describe('distributeBundlePrice', () => {
  it('returns base prices when baseTotal is 0', () => {
    const result = distributeBundlePrice(100, [
      { qty: 1, basePriceMinor: 0 },
      { qty: 2, basePriceMinor: 0 },
    ]);
    expect(result).toEqual([0, 0]);
  });

  it('handles a single item', () => {
    // Single item gets the full bundle price divided by its qty.
    const result = distributeBundlePrice(99, [{ qty: 3, basePriceMinor: 150 }]);
    expect(result).toHaveLength(1);
    expect(result[0]! * 3).toBe(99);
  });

  it('distributes evenly with clean division (qty=1 each)', () => {
    // 2 items, each qty=1, bundle price divides evenly by the proportion.
    // base: [60, 40], bundle = 100 → shares [60, 40] → unit prices [60, 40]
    const result = distributeBundlePrice(100, [
      { qty: 1, basePriceMinor: 60 },
      { qty: 1, basePriceMinor: 40 },
    ]);
    expect(result).toEqual([60, 40]);
    const total = result[0]! * 1 + result[1]! * 1;
    expect(total).toBe(100);
  });

  it('distributes with rounding remainder on last share (qty=1 each)', () => {
    // 2 items, each qty=1. bundle=99 with base [67, 33].
    // shares: [floor(99*67/100)=66, 99-66=33] → unit prices [66, 33]
    const result = distributeBundlePrice(99, [
      { qty: 1, basePriceMinor: 67 },
      { qty: 1, basePriceMinor: 33 },
    ]);
    expect(result).toHaveLength(2);
    const total = result[0]! * 1 + result[1]! * 1;
    // Carry-forward: no carry since qty=1 → exact
    expect(total).toBe(99);
  });

  it('distributes with carry-forward rounding (qty > 1)', () => {
    // 2 items with qty > 1 where division doesn't divide evenly.
    // base: [60, 40], bundle=99
    // baseTotals: [3*60=180, 2*40=80], baseTotal=260
    // shares: [floor(99*180/260)=68, 99-68=31]
    // Item 0: floor(68/3)=22, carry=68-66=2
    // Item 1: floor((31+2)/2)=16, carry=33-32=1 (lost)
    const result = distributeBundlePrice(99, [
      { qty: 3, basePriceMinor: 60 },
      { qty: 2, basePriceMinor: 40 },
    ]);
    expect(result).toHaveLength(2);
    const total = result[0]! * 3 + result[1]! * 2;
    // Total should be within carry of 99
    expect(total).toBeLessThanOrEqual(99);
    expect(total).toBeGreaterThanOrEqual(97);
  });

  it('handles three items with equal base prices', () => {
    // 3 items, qty=1 each, equal base prices, bundle=300
    const result = distributeBundlePrice(300, [
      { qty: 1, basePriceMinor: 50 },
      { qty: 1, basePriceMinor: 50 },
      { qty: 1, basePriceMinor: 50 },
    ]);
    expect(result).toHaveLength(3);
    const total = result.reduce((s: number, up: number) => s + up, 0);
    expect(total).toBe(300);
    // All should be equal (100 each)
    expect(result[0]).toBe(100);
    expect(result[1]).toBe(100);
    expect(result[2]).toBe(100);
  });

  it('handles three items with different base prices and quantities', () => {
    // bundle=500
    // base: [2*100=200, 3*50=150, 1*200=200], baseTotal=550
    // shares: [floor(500*200/550)=181, floor(500*150/550)=136, 500-317=183]
    const result = distributeBundlePrice(500, [
      { qty: 2, basePriceMinor: 100 },
      { qty: 3, basePriceMinor: 50 },
      { qty: 1, basePriceMinor: 200 },
    ]);
    expect(result).toHaveLength(3);
    const total = result[0]! * 2 + result[1]! * 3 + result[2]! * 1;
    // Should be within a few minor units of 500
    expect(Math.abs(total - 500)).toBeLessThanOrEqual(3);
  });

  it('assigns zero unit price when item qty is 0', () => {
    const result = distributeBundlePrice(100, [
      { qty: 0, basePriceMinor: 50 },
      { qty: 1, basePriceMinor: 50 },
    ]);
    expect(result[0]!).toBe(0);
    expect(result[1]!).toBeGreaterThan(0);
  });

  it('returns empty array for empty items', () => {
    const result = distributeBundlePrice(100, []);
    expect(result).toEqual([]);
  });

  it('handles a bundle price of 1 with many items (extreme rounding)', () => {
    // 10 items, each qty=1, equal base prices, bundle=1
    // The first item gets the 1 minor unit, others get 0
    const items = Array.from({ length: 10 }, () => ({ qty: 1, basePriceMinor: 100 }));
    const result = distributeBundlePrice(1, items);
    expect(result).toHaveLength(10);
    const total = result.reduce((s: number, up: number) => s + up, 0);
    expect(total).toBe(1);
  });

  it('keeps total within carry limit when quantities vary widely', () => {
    // bundle=999, large qty differences
    const result = distributeBundlePrice(999, [
      { qty: 10, basePriceMinor: 50 },
      { qty: 1, basePriceMinor: 200 },
      { qty: 5, basePriceMinor: 30 },
    ]);
    const total = result[0]! * 10 + result[1]! * 1 + result[2]! * 5;
    expect(Math.abs(total - 999)).toBeLessThanOrEqual(5);
  });
});

// ── expandBundleItems (end-to-end pipeline) ──────────────────────

describe('expandBundleItems', () => {
  const currency = 'USD';

  /** Build a minimal ProductDto stub. */
  function stubDto(
    sku: string,
    priceMinor: number,
    overrides?: Partial<ProductDto>,
  ): ProductDto {
    return {
      sku,
      name: `Product ${sku}`,
      category: 'Test',
      price: { minor_units: priceMinor, currency },
      barcode: null,
      in_stock: true,
      stock_qty: 10,
      tax_rate_ids: [],
      ...overrides,
    } as ProductDto;
  }

  /** Build a minimal BundleItem stub. */
  function stubItem(
    sku: string,
    qty: number,
    unit_price_minor: number | null = null,
  ): BundleItem {
    return {
      id: `item-${sku}`,
      bundle_id: 'bundle-1',
      sku,
      qty,
      unit_price_minor,
    };
  }

  /** Lookup map: SKU → ProductDto. */
  function makeLookup(
    map: Record<string, ProductDto | null>,
  ): (sku: string) => Promise<ProductDto | null> {
    return vi.fn((sku: string) => Promise.resolve(map[sku] ?? null));
  }

  it('returns empty array for empty items', async () => {
    const result = await expandBundleItems([], currency, null, makeLookup({}));
    expect(result).toEqual([]);
  });

  it('expands items without bundle price override using product defaults', async () => {
    const items = [stubItem('SKU-A', 2), stubItem('SKU-B', 1)];
    const lookup = makeLookup({
      'SKU-A': stubDto('SKU-A', 400),
      'SKU-B': stubDto('SKU-B', 250),
    });

    const result = await expandBundleItems(items, currency, null, lookup);

    expect(result).toHaveLength(2);
    expect(result[0]!.product.sku).toBe('SKU-A');
    expect(result[0]!.product.price.minor_units).toBe(400); // default price
    expect(result[0]!.qty).toBe(2);
    expect(result[1]!.product.sku).toBe('SKU-B');
    expect(result[1]!.product.price.minor_units).toBe(250);
    expect(result[1]!.qty).toBe(1);
  });

  it('uses item-level unit_price_minor override when set', async () => {
    // Item SKU-A has a price override of 350 (product default is 400).
    const items = [stubItem('SKU-A', 1, 350)];
    const lookup = makeLookup({
      'SKU-A': stubDto('SKU-A', 400),
    });

    const result = await expandBundleItems(items, currency, null, lookup);

    expect(result).toHaveLength(1);
    expect(result[0]!.product.price.minor_units).toBe(350); // override wins
  });

  it('applies bundle price override distributed proportionally', async () => {
    // Bundle price = 600, items have default prices [400, 200], qty [1, 1]
    // Proportional: [floor(600*400/600)=400, 600-400=200] → unit prices [400, 200]
    const items = [stubItem('SKU-A', 1), stubItem('SKU-B', 1)];
    const lookup = makeLookup({
      'SKU-A': stubDto('SKU-A', 400),
      'SKU-B': stubDto('SKU-B', 200),
    });

    const result = await expandBundleItems(items, currency, 600, lookup);

    expect(result).toHaveLength(2);
    expect(result[0]!.product.price.minor_units).toBe(400);
    expect(result[1]!.product.price.minor_units).toBe(200);
    const total = result[0]!.product.price.minor_units * result[0]!.qty
      + result[1]!.product.price.minor_units * result[1]!.qty;
    expect(total).toBe(600);
  });

  it('skips items whose SKU cannot be resolved', async () => {
    // 3 items, but only 2 resolve.
    const items = [stubItem('SKU-A', 1), stubItem('MISSING', 2), stubItem('SKU-C', 1)];
    const lookup = makeLookup({
      'SKU-A': stubDto('SKU-A', 300),
      'SKU-C': stubDto('SKU-C', 150),
      // 'MISSING' intentionally absent
    });

    const result = await expandBundleItems(items, currency, null, lookup);

    expect(result).toHaveLength(2);
    expect(result[0]!.product.sku).toBe('SKU-A');
    expect(result[1]!.product.sku).toBe('SKU-C');
  });

  it('returns empty array when no items resolve', async () => {
    const items = [stubItem('UNKNOWN', 1)];
    const lookup = makeLookup({}); // nothing resolves

    const result = await expandBundleItems(items, currency, null, lookup);
    expect(result).toEqual([]);
  });

  it('correctly maps all ProductDto fields to ExpandedItem', async () => {
    const items = [stubItem('SKU-A', 3)];
    const lookup = makeLookup({
      'SKU-A': stubDto('SKU-A', 500, {
        name: 'Premium Widget',
        category: 'Widgets',
        barcode: '4901234567890',
        in_stock: true,
        stock_qty: 25,
        tax_rate_ids: ['tax-vat']
      }),
    });

    const result = await expandBundleItems(items, 'EUR', null, lookup);

    expect(result).toHaveLength(1);
    expect(result[0]!.product.sku).toBe('SKU-A');
    expect(result[0]!.product.name).toBe('Premium Widget');
    expect(result[0]!.product.category).toBe('Widgets');
    expect(result[0]!.product.barcode).toBe('4901234567890');
    expect(result[0]!.product.inStock).toBe(true);
    expect(result[0]!.product.stockQty).toBe(25);
    expect(result[0]!.product.price.currency).toBe('EUR'); // bundle currency
    expect(result[0]!.qty).toBe(3);
  });

  it('calls lookupItem once per item SKU', async () => {
    const items = [stubItem('A', 1), stubItem('B', 2), stubItem('C', 1)];
    const lookup = makeLookup({
      'A': stubDto('A', 100),
      'B': stubDto('B', 200),
      'C': stubDto('C', 300),
    });

    await expandBundleItems(items, currency, null, lookup);

    expect(lookup).toHaveBeenCalledTimes(3);
    expect(lookup).toHaveBeenCalledWith('A');
    expect(lookup).toHaveBeenCalledWith('B');
    expect(lookup).toHaveBeenCalledWith('C');
  });

  it('handles a single item with bundle price override', async () => {
    // Bundle price 150 for 1 item qty=3 with default 60 → floor(150/3)=50
    const items = [stubItem('SKU-A', 3)];
    const lookup = makeLookup({ 'SKU-A': stubDto('SKU-A', 60) });

    const result = await expandBundleItems(items, currency, 150, lookup);

    expect(result).toHaveLength(1);
    expect(result[0]!.product.price.minor_units).toBe(50);
    expect(result[0]!.qty).toBe(3);
  });

  it('distributes bundle price with carry-forward rounding (qty > 1, uneven division)', async () => {
    // 2 items with qty > 1, bundle price doesn't divide evenly.
    // Items: SKU-A qty=3 base=60, SKU-B qty=2 base=40, bundle=99
    // baseTotals: [3*60=180, 2*40=80], baseTotal=260
    // shares: [floor(99*180/260)=68, 99-68=31]
    // Item 0: floor(68/3)=22, carry=68-66=2
    // Item 1: floor((31+2)/2)=16, carry=33-32=1 (lost)
    // Total: 22*3 + 16*2 = 98 (off by 1 from 99)
    const items = [stubItem('SKU-A', 3), stubItem('SKU-B', 2)];
    const lookup = makeLookup({
      'SKU-A': stubDto('SKU-A', 60),
      'SKU-B': stubDto('SKU-B', 40),
    });

    const result = await expandBundleItems(items, currency, 99, lookup);

    expect(result).toHaveLength(2);
    expect(result[0]!.product.price.minor_units).toBe(22);
    expect(result[0]!.qty).toBe(3);
    expect(result[1]!.product.price.minor_units).toBe(16);
    expect(result[1]!.qty).toBe(2);

    const total = result[0]!.product.price.minor_units * result[0]!.qty
      + result[1]!.product.price.minor_units * result[1]!.qty;
    expect(total).toBeLessThanOrEqual(99);
    expect(total).toBeGreaterThanOrEqual(97);
  });

  it('distributes bundle price with carry across three items of varying quantities', async () => {
    // 3 items with different qtys and base prices, bundle=500.
    // SKU-A qty=2 base=100, SKU-B qty=3 base=50, SKU-C qty=1 base=200
    // baseTotals: [200, 150, 200], baseTotal=550
    // shares: [floor(500*200/550)=181, floor(500*150/550)=136, 500-317=183]
    // Item 0: floor(181/2)=90, carry=181-180=1
    // Item 1: floor((136+1)/3)=45, carry=137-135=2
    // Item 2: floor((183+2)/1)=185, carry=185-185=0
    // Total: 90*2 + 45*3 + 185*1 = 180+135+185 = 500 (exact!)
    const items = [
      stubItem('SKU-A', 2),
      stubItem('SKU-B', 3),
      stubItem('SKU-C', 1),
    ];
    const lookup = makeLookup({
      'SKU-A': stubDto('SKU-A', 100),
      'SKU-B': stubDto('SKU-B', 50),
      'SKU-C': stubDto('SKU-C', 200),
    });

    const result = await expandBundleItems(items, currency, 500, lookup);

    expect(result).toHaveLength(3);

    const total = result[0]!.product.price.minor_units * result[0]!.qty
      + result[1]!.product.price.minor_units * result[1]!.qty
      + result[2]!.product.price.minor_units * result[2]!.qty;
    expect(total).toBe(500);
  });

  it('preserves item-level price override during carry-forward distribution', async () => {
    // SKU-A has an override (unit_price_minor=80), SKU-B uses product default.
    // Items: SKU-A qty=3 override=80, SKU-B qty=2 default=40, bundle=99
    // basePrices: [80, 40] (override used for SKU-A)
    // baseTotals: [3*80=240, 2*40=80], baseTotal=320
    // shares: [floor(99*240/320)=74, 99-74=25]
    // Item 0: floor(74/3)=24, carry=74-72=2
    // Item 1: floor((25+2)/2)=13, carry=27-26=1 (lost)
    // Total: 24*3 + 13*2 = 72+26 = 98 (off by 1 from 99)
    const items = [
      stubItem('SKU-A', 3, 80),  // override=80
      stubItem('SKU-B', 2),
    ];
    const lookup = makeLookup({
      'SKU-A': stubDto('SKU-A', 60),  // product default 60, but override=80 wins
      'SKU-B': stubDto('SKU-B', 40),
    });

    const result = await expandBundleItems(items, currency, 99, lookup);

    expect(result).toHaveLength(2);
    expect(result[0]!.product.price.minor_units).toBe(24);
    expect(result[0]!.qty).toBe(3);
    expect(result[1]!.product.price.minor_units).toBe(13);
    expect(result[1]!.qty).toBe(2);

    const total = result[0]!.product.price.minor_units * result[0]!.qty
      + result[1]!.product.price.minor_units * result[1]!.qty;
    expect(total).toBeLessThanOrEqual(99);
    expect(total).toBeGreaterThanOrEqual(97);
  });

  it('handles large carry-forward with many items having different qtys', async () => {
    // 5 items with varied qtys and base prices, small bundle price.
    // Bundle=199, this forces significant carry-forward rounding.
    const items = [
      stubItem('A', 3),
      stubItem('B', 1),
      stubItem('C', 4),
      stubItem('D', 2),
      stubItem('E', 5),
    ];
    const lookup = makeLookup({
      'A': stubDto('A', 100),
      'B': stubDto('B', 50),
      'C': stubDto('C', 30),
      'D': stubDto('D', 80),
      'E': stubDto('E', 20),
    });

    const result = await expandBundleItems(items, currency, 199, lookup);

    expect(result).toHaveLength(5);

    const total = result.reduce(
      (s, r) => s + r.product.price.minor_units * r.qty,
      0,
    );
    // The total should be close to 199 within carry limits.
    expect(Math.abs(total - 199)).toBeLessThanOrEqual(5);
  });

  it('rejects when one item rejects and another resolves (Promise.all semantics)', async () => {
    // Promise.all rejects as soon as the first rejection occurs, even if
    // other promises have resolved. This test verifies that the rejection
    // wins — the expandBundleItems call rejects and no items are returned.
    const items = [
      stubItem('A', 1),
      stubItem('B', 1),
      stubItem('C', 1),
    ];
    const error = new Error('Backend timeout');
    const lookup = vi.fn((sku: string) => {
      if (sku === 'B') return Promise.reject(error);
      return Promise.resolve(stubDto(sku, 100));
    });

    await expect(
      expandBundleItems(items, currency, null, lookup),
    ).rejects.toThrow('Backend timeout');

    // All three lookups should have been initiated (Promise.all calls all
    // promises in parallel, it doesn't short-circuit on the first rejection).
    expect(lookup).toHaveBeenCalledTimes(3);
    expect(lookup).toHaveBeenCalledWith('A');
    expect(lookup).toHaveBeenCalledWith('B');
    expect(lookup).toHaveBeenCalledWith('C');
  });

  it('propagates when lookupItem rejects for every item', async () => {
    const items = [stubItem('A', 1), stubItem('B', 2)];
    const error = new Error('Service unavailable');
    const lookup = vi.fn(() => Promise.reject(error));

    await expect(
      expandBundleItems(items, currency, null, lookup),
    ).rejects.toThrow('Service unavailable');
  });

  it('propagates rejection even with null bundlePriceMinor', async () => {
    const items = [stubItem('X', 1)];
    const lookup = vi.fn(() => Promise.reject(new Error('timeout')));

    await expect(
      expandBundleItems(items, currency, null, lookup),
    ).rejects.toThrow('timeout');
  });

  it('propagates rejection even with a bundle price set', async () => {
    const items = [stubItem('Y', 2)];
    const lookup = vi.fn(() => Promise.reject(new Error('rate limited')));

    await expect(
      expandBundleItems(items, currency, 500, lookup),
    ).rejects.toThrow('rate limited');
  });

  it('does not call lookupItem when items array is empty', async () => {
    const lookup = vi.fn();

    const result = await expandBundleItems([], currency, null, lookup);

    expect(result).toEqual([]);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('propagates rejection when some items return null and one rejects', async () => {
    // 4 items: A resolves, B returns null (not found), C rejects, D returns null.
    // The rejection from C should propagate through Promise.all and reject
    // the entire expandBundleItems call, even though others resolved or
    // returned null.
    const items = [
      stubItem('A', 1),
      stubItem('B', 2),
      stubItem('C', 3),
      stubItem('D', 1),
    ];
    const error = new Error('DB timeout');
    const lookup = vi.fn((sku: string) => {
      if (sku === 'A') return Promise.resolve(stubDto('A', 100));
      if (sku === 'B') return Promise.resolve(null);
      if (sku === 'C') return Promise.reject(error);
      // D returns null
      return Promise.resolve(null);
    });

    await expect(
      expandBundleItems(items, currency, null, lookup),
    ).rejects.toThrow('DB timeout');

    // All 4 lookups should have been initiated.
    expect(lookup).toHaveBeenCalledTimes(4);
    expect(lookup).toHaveBeenCalledWith('A');
    expect(lookup).toHaveBeenCalledWith('B');
    expect(lookup).toHaveBeenCalledWith('C');
    expect(lookup).toHaveBeenCalledWith('D');
  });

  describe('performance', () => {
    function makeItems(count: number): BundleItem[] {
      return Array.from({ length: count }, (_, i) =>
        stubItem(`SKU-${i}`, 1),
      );
    }

    function makeLookupFast(): (sku: string) => Promise<ProductDto | null> {
      return vi.fn((sku: string) =>
        Promise.resolve(stubDto(sku, 100)),
      );
    }

    it('resolves 100 items under 500ms without bundle price', async () => {
      const items = makeItems(100);
      const lookup = makeLookupFast();

      const start = performance.now();
      const result = await expandBundleItems(items, currency, null, lookup);
      const elapsed = performance.now() - start;

      expect(result).toHaveLength(100);
      expect(elapsed).toBeLessThan(500);
    });

    it('resolves 100 items under 500ms with bundle price distribution', async () => {
      const items = makeItems(100);
      const lookup = makeLookupFast();

      const start = performance.now();
      const result = await expandBundleItems(items, currency, 9999, lookup);
      const elapsed = performance.now() - start;

      expect(result).toHaveLength(100);
      expect(elapsed).toBeLessThan(500);
    });

    it('resolves 200 items under 1000ms without bundle price', async () => {
      const items = makeItems(200);
      const lookup = makeLookupFast();

      const start = performance.now();
      const result = await expandBundleItems(items, currency, null, lookup);
      const elapsed = performance.now() - start;

      expect(result).toHaveLength(200);
      expect(elapsed).toBeLessThan(1000);
    });
  });
});
