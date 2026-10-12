// ── Dev-mock: the seeded sale must match the menu it was sold from ───────
//
// WHY THIS FILE EXISTS
//
// A Playwright pass over the rendered Restaurant POS
// (docs/records/audits/restaurant-pos-rendered-behaviour-playwright.md) found the
// Sales History screen rendering "\$ 12,502" — a DOLLAR amount. This is an
// Indonesian rupiah restaurant POS: every menu card reads "Rp 45.000", the
// printed receipt reads "Rp", and the catalogue is IDR-denominated.
//
// Cause: seedMockSalesStore() (handlers/sales.ts:307) seeded 'seed-sale-001'
// with currency 'USD' and minor_units 1250, while the SAME SKUs in
// MOCK_PRODUCTS (handlers/catalog.ts) are IDR at 100x the value:
//
//   LATTE   catalogue 45000 IDR (Rp 45.000)   seed sale  450 USD (\$ 4.50)
//   CROISS  catalogue 35000 IDR (Rp 35.000)   seed sale  320 USD (\$ 3.20)
//
// So History showed a sale that could not have been rung up on this POS, in the
// wrong currency, with prices that disagree with the menu. A cashier reconciling
// the day reads that screen.
//
// These tests tie the seed to the catalogue rather than to a new literal, so the
// two cannot drift apart again in either direction.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { invoke } from '@/dev-mock/tauri-api';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

type SaleRow = { id: string; total: { minor_units: number; currency: string } };
type Product = { sku: string; price: { minor_units: number; currency: string } };

// list_sales_scoped returns a paged envelope, not a bare array (sales.ts:717).
const listSales = async (): Promise<SaleRow[]> =>
  (await invoke<{ sales: SaleRow[] }>('list_sales_scoped', { sessionToken: 't' })).sales;
const listProducts = async (): Promise<Product[]> => {
  const r = await invoke<Product[] | { products: Product[] }>('list_products_scoped', { sessionToken: 't' });
  return Array.isArray(r) ? r : r.products;
};

describe('dev-mock seeded sale agrees with the catalogue', () => {
  it('prices the seed in the catalogue currency, not dollars', async () => {
    const sales = await listSales();
    expect(sales.length, 'history must have a seeded row to render').toBeGreaterThan(0);
    const currencies = [...new Set(sales.map((s) => s.total.currency))];
    expect(
      currencies,
      'every seeded sale must be priced in the currency the menu sells in — ' +
        'a USD row renders "\$ 12,502" on an Indonesian POS',
    ).toEqual(['IDR']);
  });

  it('prices the seeded lines from the catalogue SKUs', async () => {
    // The seed names LATTE and CROISS. Whatever prices those entries carry, the
    // seeded sale must total to the same numbers — otherwise History and the menu
    // disagree about what a latte costs.
    const sales = await listSales();
    const seed = sales.find((s) => s.id === 'seed-sale-001');
    expect(seed, 'seed-sale-001 is the fixture the History screen renders').toBeTruthy();

    const products = await listProducts();
    const latte = products.find((p) => p.sku === 'LATTE');
    const croiss = products.find((p) => p.sku === 'CROISS');
    expect(latte, 'LATTE must exist in the catalogue').toBeTruthy();
    expect(croiss, 'CROISS must exist in the catalogue').toBeTruthy();

    expect(latte!.price.currency).toBe('IDR');
    expect(croiss!.price.currency).toBe('IDR');
    // The seed sells 1 latte + 2 croissants.
    const expected = latte!.price.minor_units * 1 + croiss!.price.minor_units * 2;
    expect(
      seed!.total.minor_units,
      'the seeded total must equal the catalogue prices for its own lines ' +
        '(1x LATTE + 2x CROISS); it read 1250 while the menu charges ' +
        expected,
    ).toBe(expected);
  });

  it('has no dollar-denominated sale anywhere in the mock store', async () => {
    // Guards the class, not just seed-sale-001: a future fixture added with a
    // hardcoded USD literal fails here too.
    const sales = await listSales();
    const usd = sales.filter((s) => s.total.currency !== 'IDR');
    expect(usd.map((s) => s.id + ':' + s.total.currency)).toEqual([]);
  });
});
