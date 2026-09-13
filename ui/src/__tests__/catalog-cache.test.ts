import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listProductsScoped, listCategories, listCategoriesScoped, type ProductDto, type CategoryDto } from '@/api/products';
import { loadCatalog, getCatalog, invalidateCatalog } from '@/utils/catalog-cache';

/**
 * PERF-08 — unit tests for the scoped catalog cache.
 *
 * Verifies: caching per session token, in-flight request deduplication
 * (concurrent callers share ONE IPC round trip), explicit invalidation
 * after mutations, and that failed loads are never cached.
 */

vi.mock('@/api/products', () => ({
  listProductsScoped: vi.fn(),
  listCategories: vi.fn(),
  // The cache reads products through the scoped twin and categories through the ambient one, in
  // the same Promise.all. list_categories is registered by neither app shell's UI-facing set for
  // desktop, so on desktop loadCatalog threw every time it was called.
  listCategoriesScoped: vi.fn(),
}));

const mockProducts: ProductDto[] = [
  { sku: 'A', name: 'Alpha', category: null, price: { minor_units: 100, currency: 'IDR' }, barcode: null, in_stock: true, stock_qty: 5, tax_rate_ids: [], created_at: '', price_updated_at: '', product_type: 'retail' },
];
const mockCategories: CategoryDto[] = [
  { id: 'cat-1', name: 'Cat One', colour: '#fff', icon: 'dots-1' },
];

describe('catalog-cache (PERF-08)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateCatalog();
    vi.mocked(listProductsScoped).mockResolvedValue(mockProducts);
    vi.mocked(listCategoriesScoped).mockResolvedValue(mockCategories);
  });

  it('loads and caches the catalog per session token', async () => {
    const first = await loadCatalog('token-1');
    expect(first.products).toEqual(mockProducts);
    expect(first.categories).toEqual(mockCategories);
    expect(listProductsScoped).toHaveBeenCalledWith('token-1');

    // Second load for the same token is served from cache — no IPC.
    const second = await loadCatalog('token-1');
    expect(second).toBe(first);
    expect(listProductsScoped).toHaveBeenCalledTimes(1);
    // This asserted the AMBIENT call happened once -- the test was not merely tolerating the bug,
    // it was pinning it in place. Categories now come from the scoped twin, which is the only
    // variant desktop-client registers for a session.
    expect(listCategoriesScoped).toHaveBeenCalledTimes(1);
    expect(listCategories).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent in-flight loads (single IPC round trip)', async () => {
    let resolveProducts: (v: ProductDto[]) => void = () => {};
    vi.mocked(listProductsScoped).mockImplementationOnce(
      () => new Promise((resolve) => { resolveProducts = resolve; }),
    );
    const p1 = loadCatalog('token-2');
    const p2 = loadCatalog('token-2');
    expect(listProductsScoped).toHaveBeenCalledTimes(1);

    resolveProducts(mockProducts);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2);
  });

  it('isolates cache entries per token', async () => {
    const pA: ProductDto[] = [{ ...mockProducts[0]!, sku: 'A' }];
    const pB: ProductDto[] = [{ ...mockProducts[0]!, sku: 'B' }];
    vi.mocked(listProductsScoped)
      .mockResolvedValueOnce(pA)
      .mockResolvedValueOnce(pB);

    await loadCatalog('token-A');
    await loadCatalog('token-B');
    expect(getCatalog('token-A')!.products[0]!.sku).toBe('A');
    expect(getCatalog('token-B')!.products[0]!.sku).toBe('B');
  });

  it('invalidates a single token or the whole cache', async () => {
    await loadCatalog('token-X');
    expect(getCatalog('token-X')).toBeDefined();

    invalidateCatalog('token-X');
    expect(getCatalog('token-X')).toBeUndefined();

    await loadCatalog('token-X');
    invalidateCatalog();
    expect(getCatalog('token-X')).toBeUndefined();
  });

  it('never caches a failed load so retries re-fetch', async () => {
    vi.mocked(listProductsScoped).mockRejectedValueOnce(new Error('DB locked'));
    await expect(loadCatalog('token-err')).rejects.toThrow('DB locked');
    expect(getCatalog('token-err')).toBeUndefined();

    // Retry succeeds and caches.
    await loadCatalog('token-err');
    expect(getCatalog('token-err')).toBeDefined();
    expect(listProductsScoped).toHaveBeenCalledTimes(2);
  });

  // ADR #7: loadCatalog takes a REQUIRED token -- there is no no-token path to fall back on -- so
  // every read it makes must be scoped. It read products through listProductsScoped(token) and
  // categories through the ambient listCategories() in the same Promise.all, and desktop-client
  // registers no list_categories command, so the function rejected on every desktop call.
  it('reads categories through the scoped command, not the ambient one', async () => {
    vi.mocked(listProductsScoped).mockResolvedValue(mockProducts);
    vi.mocked(listCategoriesScoped).mockResolvedValue(mockCategories);

    const snapshot = await loadCatalog('token-scoped-cats');

    expect(listCategoriesScoped).toHaveBeenCalledWith('token-scoped-cats');
    expect(listCategories).not.toHaveBeenCalled();
    expect(snapshot.categories).toEqual(mockCategories);
  });
});
