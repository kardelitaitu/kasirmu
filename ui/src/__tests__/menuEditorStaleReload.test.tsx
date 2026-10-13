// ── A stale menu reload must not overwrite a newer one (round 116) ──────
//
// `RestaurantMenuEditorScreen.tsx:303-309` sequences its product/category reload:
//
//     const seq = ++loadSeqRef.current;
//     ... await Promise.allSettled([listProductsScoped, listCategoriesScoped]) ...
//     if (seq !== loadSeqRef.current) return;   // <- drops a superseded response
//
// Round 116 measured that removing that line leaves `RestaurantMenuEditorScreen.test.tsx`
// at 25 passed. The guard is unpinned.
//
// ── The overlapping calls are reachable ──
//
// `reloadData` depends on `sessionToken` (`:334`), so a session change re-creates it; the
// mount effect depends on `reloadData` (`:338`), so it re-runs; and EIGHT mutation paths
// call `reloadData` directly — the item toggle, bulk availability, the category save and
// both delete flows. A save's refetch and a token-change refetch therefore overlap, and
// without the guard whichever settles LAST wins regardless of which was issued first.
//
// Unlike the credit guard corrected in round 115, this one guards a state the screen can
// actually reach, so it is pinned rather than deleted.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders, rerenderWithProviders } from '@/__tests__/test-utils/render';
import RestaurantMenuEditorScreen from '@/features/restaurant/screens/RestaurantMenuEditorScreen';
import * as productsApi from '@/api/products';
import productsFtl from '../../../shared-ui/locales/products.ftl?raw';

vi.mock('@/utils/catalog-cache', () => ({
  invalidateCatalog: vi.fn(),
}));
vi.mock('@/api/products', () => ({
  listProductsScoped: vi.fn(),
  listCategoriesScoped: vi.fn(),
  updateProductScoped: vi.fn(),
  createCategoryScoped: vi.fn(),
  deleteCategoryScoped: vi.fn(),
  deleteProductScoped: vi.fn(),
}));

function product(name: string, sku: string) {
  return {
    sku,
    name,
    category: 'Mains',
    price: { minor_units: 1000, currency: 'USD' },
    is_active: true,
    product_type: 'restaurant',
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('a superseded menu reload cannot overwrite a newer one', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(productsApi.listCategoriesScoped).mockResolvedValue([] as never);
  });

  it('keeps the LATER response when an earlier one settles last', async () => {
    const first = deferred<unknown>();
    vi.mocked(productsApi.listProductsScoped)
      .mockReturnValueOnce(first.promise as never)   // read 1, held open
      .mockResolvedValue([product('Fresh Item', 'SKU-NEW')] as never);

    const view = await renderWithProviders(
      <RestaurantMenuEditorScreen />,
      productsFtl,
    );

    // The mount read is in flight. A save's refetch issues read 2 and settles first.
    await waitFor(() => expect(productsApi.listProductsScoped).toHaveBeenCalled());
    vi.mocked(productsApi.listProductsScoped).mockResolvedValue(
      [product('Fresh Item', 'SKU-NEW')] as never,
    );
    rerenderWithProviders(view, <RestaurantMenuEditorScreen />, productsFtl);
    await screen.findByText('Fresh Item');

    // NOW the superseded read lands, carrying the OLD list.
    first.resolve([product('Stale Item', 'SKU-OLD')] as never);
    await waitFor(() => {
      expect(
        screen.queryByText('Stale Item'),
        'the superseded read overwrote the newer list: the editor shows a menu the ' +
          'store no longer has.',
      ).toBeNull();
    });
    expect(screen.getByText('Fresh Item')).toBeInTheDocument();
  });
});
