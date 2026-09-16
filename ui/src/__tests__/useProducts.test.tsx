import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { useProducts } from '@/features/products/useProducts';
import type { ProductDto, CategoryDto } from '@/api/products';

const mocks = vi.hoisted(() => ({
  listProducts: vi.fn(),
  listCategories: vi.fn(),
  getString: vi.fn(),
}));

vi.mock('@/api/products', () => ({
  listProductsScoped: (...args: unknown[]) => mocks.listProducts(...args),
  listCategoriesScoped: (...args: unknown[]) => mocks.listCategories(...args),
}));

vi.mock('@fluent/react', () => ({
  useLocalization: vi.fn(() => ({ l10n: { getString: mocks.getString } })),
}));

/**
 * T21: the hook's reads are scoped-only now, and a null token is answered with an error rather
 * than a call to a door neither shell registers. Every loading case therefore needs a token.
 */
const TOKEN = 'tok';

function makeProductDto(overrides: Partial<ProductDto> = {}): ProductDto {
  return {
    sku: 'LATTE',
    name: 'Caffè Latte',
    category: 'Hot Drinks',
    price: { minor_units: 450, currency: 'USD' },
    barcode: '4901234567890',
    in_stock: true,
    stock_qty: 50,
    tax_rate_ids: [],
    created_at: '2024-01-01',
    price_updated_at: '2024-01-01',
    product_type: 'restaurant',
    ...overrides,
  };
}

function makeCategoryDto(overrides: Partial<CategoryDto> = {}): CategoryDto {
  return {
    id: 'cat-hot-drinks',
    name: 'Hot Drinks',
    colour: '#ef4444',
    icon: 'hot-drink',
    ...overrides,
  };
}

beforeEach(() => {
  mocks.listProducts.mockResolvedValue([makeProductDto()]);
  mocks.listCategories.mockResolvedValue([makeCategoryDto()]);
  mocks.getString.mockReturnValue('Uncategorised');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useProducts', () => {
  describe('loading state', () => {
    it('starts with loading=true', () => {
      mocks.listProducts.mockReturnValue(new Promise(() => {}));

      let result!: ReturnType<typeof renderHook<ReturnType<typeof useProducts>, unknown>>['result'];
      act(() => {
        const hook = renderHook(() => useProducts(TOKEN));
        result = hook.result;
      });

      expect(result.current.loading).toBe(true);
      expect(result.current.products).toEqual([]);
    });

    it('sets loading=false after fetch completes', async () => {
      const { result } = renderHook(() => useProducts(TOKEN));

      await waitFor(() => expect(result.current.loading).toBe(false));
    });
  });

  describe('successful fetch', () => {
    it('returns products from the API', async () => {
      const { result } = renderHook(() => useProducts(TOKEN));

      await waitFor(() => {
        expect(result.current.products).toHaveLength(1);
        expect(result.current.products[0]!.sku).toBe('LATTE');
      });
    });

    it('maps ProductDto fields to Product correctly', async () => {
      const { result } = renderHook(() => useProducts(TOKEN));

      await waitFor(() => {
        const p = result.current.products[0]!;
        expect(p.productType).toBe('restaurant');
        expect(p.category).toBe('Hot Drinks');
        expect(p.barcode).toBe('4901234567890');
        expect(p.inStock).toBe(true);
        expect(p.stockQty).toBe(50);
      });
    });

    it('uses fallback label for null category', async () => {
      mocks.listProducts.mockResolvedValue([makeProductDto({ category: null })]);
      mocks.getString.mockReturnValue('Other');

      const { result } = renderHook(() => useProducts(TOKEN));

      await waitFor(() => {
        expect(result.current.products[0]!.category).toBe('Other');
      });
    });

    it('returns category metadata from the API', async () => {
      const cat = makeCategoryDto({ id: 'cat-food', name: 'Food', colour: '#f97316' });
      mocks.listCategories.mockResolvedValue([cat]);

      const { result } = renderHook(() => useProducts(TOKEN));

      await waitFor(() => {
        expect(result.current.categoryMeta).toHaveLength(1);
        expect(result.current.categoryMeta[0]!.name).toBe('Food');
      });
    });

    it('derives unique category names sorted alphabetically', async () => {
      mocks.listProducts.mockResolvedValue([
        makeProductDto({ sku: 'LATTE', category: 'Hot Drinks' }),
        makeProductDto({ sku: 'BAGEL', category: 'Food' }),
        makeProductDto({ sku: 'COOKIE', category: 'Snacks' }),
        makeProductDto({ sku: 'TEA', category: 'Hot Drinks' }),
      ]);

      const { result } = renderHook(() => useProducts(TOKEN));

      await waitFor(() => {
        expect(result.current.categories).toEqual(['Food', 'Hot Drinks', 'Snacks']);
      });
    });

    it('sets usingFallback=false when API returns data', async () => {
      const { result } = renderHook(() => useProducts(TOKEN));

      await waitFor(() => {
        expect(result.current.usingFallback).toBe(false);
      });
    });
  });

  describe('fallback when API fails', () => {
    it('falls back to sample products when listProducts throws', async () => {
      mocks.listProducts.mockRejectedValue(new Error('IPC unavailable'));

      const { result } = renderHook(() => useProducts(TOKEN));

      await waitFor(() => {
        expect(result.current.usingFallback).toBe(true);
        expect(result.current.products.length).toBeGreaterThan(0);
      });
    });

    it('sets error message when API throws', async () => {
      mocks.listProducts.mockRejectedValue(new Error('IPC timeout'));
      // ERR-05: the localized copy (what getString returns) is surfaced —
      // never the raw backend message.
      mocks.getString.mockReturnValue('Failed to load products');

      const { result } = renderHook(() => useProducts(TOKEN));

      await waitFor(() => {
        expect(result.current.error).toBe('Failed to load products');
        expect(result.current.usingFallback).toBe(true);
      });
    });

    it('falls back to sample products when API returns empty list', async () => {
      mocks.listProducts.mockResolvedValue([]);

      const { result } = renderHook(() => useProducts(TOKEN));

      await waitFor(() => {
        expect(result.current.usingFallback).toBe(true);
        expect(result.current.products.length).toBeGreaterThan(0);
      });
    });
  });

  describe('production mode (LOAD-03)', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('does NOT expose demo products when listProducts rejects in a production build', async () => {
      // Simulate a production build: DEV=false and VITE_DEMO_MODE unset.
      vi.stubEnv('DEV', false);
      vi.stubEnv('VITE_DEMO_MODE', undefined);
      mocks.listProducts.mockRejectedValue(new Error('IPC unavailable'));

      const { result } = renderHook(() => useProducts(TOKEN));

      await waitFor(() => {
        expect(result.current.usingFallback).toBe(false);
        expect(result.current.products).toEqual([]);
        expect(result.current.error).not.toBeNull();
      });
    });

    it('does NOT substitute sample products for an empty DB in a production build', async () => {
      vi.stubEnv('DEV', false);
      vi.stubEnv('VITE_DEMO_MODE', undefined);
      mocks.listProducts.mockResolvedValue([]);

      const { result } = renderHook(() => useProducts(TOKEN));

      await waitFor(() => {
        expect(result.current.usingFallback).toBe(false);
        expect(result.current.products).toEqual([]);
        expect(result.current.error).toBeNull();
      });
    });

    it('surfaces a Retry action that refetches after a production failure', async () => {
      vi.stubEnv('DEV', false);
      vi.stubEnv('VITE_DEMO_MODE', undefined);
      mocks.listProducts.mockRejectedValueOnce(new Error('IPC unavailable'));
      mocks.listProducts.mockResolvedValueOnce([makeProductDto()]);

      const { result } = renderHook(() => useProducts(TOKEN));

      await waitFor(() => {
        expect(result.current.products).toEqual([]);
        expect(result.current.error).not.toBeNull();
      });

      act(() => result.current.reload());

      await waitFor(() => {
        expect(result.current.products).toHaveLength(1);
        expect(result.current.error).toBeNull();
      });
    });
  });

  describe('no session token (T21)', () => {
    it('answers an error instead of calling a door neither shell registers', async () => {
      const { result } = renderHook(() => useProducts());

      await waitFor(() => expect(result.current.loading).toBe(false));

      // Neither read is attempted: the old code issued a doomed IPC round trip to the unregistered
      // unscoped names and let the catch turn the rejection into this same error. The refusal is
      // now deliberate and local to the hook.
      expect(mocks.listProducts).not.toHaveBeenCalled();
      expect(mocks.listCategories).not.toHaveBeenCalled();
      expect(result.current.error).not.toBeNull();
    });
  });

  describe('cleanup', () => {
    it('does not set state after unmount', () => {
      let resolve!: (v: unknown) => void;
      mocks.listProducts.mockReturnValue(new Promise((r) => { resolve = r; }));

      let result!: ReturnType<typeof renderHook<ReturnType<typeof useProducts>, unknown>>['result'];
      let unmount!: () => void;
      act(() => {
        const hook = renderHook(() => useProducts(TOKEN));
        result = hook.result;
        unmount = hook.unmount;
      });

      unmount();
      act(() => { resolve([makeProductDto()]); });

      expect(result.current.loading).toBe(true);
    });
  });

  describe('stability', () => {
    it('does not refetch when l10n changes after initial load', async () => {
      const { result, rerender } = renderHook(() => useProducts(TOKEN));

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(mocks.listProducts).toHaveBeenCalledTimes(1);

      // Simulate locale change — getString returns different label
      mocks.getString.mockReturnValue('Tanpa Kategori');
      rerender();

      // listProducts must NOT be called again — l10n is captured via ref
      expect(mocks.listProducts).toHaveBeenCalledTimes(1);
    });
  });
});
