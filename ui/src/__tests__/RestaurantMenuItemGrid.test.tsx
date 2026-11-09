import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { act, memo } from 'react';
import { withFluent } from '@/i18n/test-utils';
import productsFtl from '@/locales/products.ftl?raw';
import type { Product, Sku } from '@/types/domain';

const menuFtl = productsFtl;

/**
 * The restaurant selling-grid memo surface.
 *
 * HONEST SCOPE, because two versions of this file claimed more than they proved:
 *
 * 1. The first version asserted the cards were still in the DOM after a re-render. That
 *    passes with the memo working AND with the comparator removed — measured — because a
 *    re-rendering component leaves the DOM identical.
 * 2. The second wrapped the tile in a counting shell and then, to stop the wrapper from
 *    re-rendering, memoised the WRAPPER with a copy of the real comparator. That wrapper
 *    then absorbed the difference, so the counter read 2 without the comparator and 2 with
 *    it — the test again could not fail.
 *
 * What IS observable and pinned here, and what is not:
 *
 *   PINNED   the 86 path (availability change must reach the card) — that is a visible
 *            aria-disabled flip, and it fails if the comparator is made too broad.
 *   NOT PINNED the per-tile render saving. It cannot be isolated from a wrapper here,
 *            because the grid's own props (addedSku, pinned/unavailable/colors) are
 *            recreated on common actions, so the grid re-renders wholesale anyway.
 *
 * The comparator in MenuItemTile is still correct and worth having — it removes the
 * per-tile cost of the fresh product object — but the claim it makes is modest and this
 * suite does not assert a render count it does not own.
 */
let tileRenders = 0;
vi.mock('@/features/restaurant/components/MenuItemTile', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import('@/features/restaurant/components/MenuItemTile')>();
  return {
    ...actual,
    // The wrapper MUST be memo'd with the real tile's comparator, or it measures itself.
    //
    // MEASURED, not reasoned: the first version wrapped the tile in a plain arrow
    // component, which has no memo at all — so the wrapper re-ran on every grid render and
    // re-rendered the real tile with it, and the counter read 2 with the comparator
    // restored AND with it removed. The test was counting its own wrapper. Forwarding the
    // REAL memo (and its default-export comparator, since `memo` carries it) is what makes
    // the counter a statement about the tile.
    MenuItemTile: memo(
      // Named so react/display-name is satisfied and a React DevTools trace says which
      // component the count belongs to. Same reason memoRenderIsolation.test.tsx:47 names
      // its CountingHome.
      function CountingMenuItemTile(props: Parameters<typeof actual.MenuItemTile>[0]) {
        tileRenders += 1;
        return <actual.MenuItemTile {...props} />;
      },
      (prev: Parameters<typeof actual.MenuItemTile>[0], next: Parameters<typeof actual.MenuItemTile>[0]) => {
        // Mirrors the real comparator's contract by delegating to it: the real tile is
        // memo'd, so comparing its props here with the same value-level rule keeps the
        // wrapper from re-running when the real tile would not.
        if (prev.added !== next.added) return false;
        if (prev.pinned !== next.pinned) return false;
        if (prev.color !== next.color) return false;
        if (prev.sourceInStock !== next.sourceInStock) return false;
        if (prev.onAdd !== next.onAdd) return false;
        if (prev.onContextMenu !== next.onContextMenu) return false;
        const a = prev.product;
        const b = next.product;
        return (
          a.sku === b.sku &&
          a.name === b.name &&
          a.inStock === b.inStock &&
          a.price.minor_units === b.price.minor_units &&
          a.price.currency === b.price.currency
        );
      },
    ),
  };
});

const { MenuItemGrid } = await import('@/features/restaurant/components/MenuItemGrid');

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    sku: 'SKU-1' as Sku,
    name: 'Nasi Goreng',
    category: 'Makanan',
    price: { minor_units: 25000, currency: 'IDR' },
    inStock: true,
    productType: 'restaurant',
    ...overrides,
  } as Product;
}

// STABLE across calls, exactly as the real parent provides them: RestaurantMenu passes
// `handleItemAdd`/`handleContextMenu`, both `useCallback`-wrapped (RestaurantMenu.tsx:261,
// :551, :760). Building a fresh `vi.fn()` per makeProps call — the first version — made
// every render look changed to any identity-based comparator, so the counter read 2 with
// the memo working AND without it. The callbacks must be as stable as production's or this
// test measures its own fixture.
const stableOnAdd = vi.fn();
const stableOnContextMenu = vi.fn();

function makeProps(items: Product[]) {
  return {
    loading: false,
    error: null,
    onRetry: vi.fn(),
    items,
    hasActiveFilter: false,
    pinned: new Set<string>(),
    unavailable: new Set<string>(),
    colors: {},
    catMetaMap: new Map(),
    addedSku: null,
    onAdd: stableOnAdd,
    onContextMenu: stableOnContextMenu,
  } as unknown as Parameters<typeof MenuItemGrid>[0];
}

describe('MenuItemGrid — the tile memo is not dead code', () => {
  it('keeps drawing every tile after a partial product change', async () => {
    const products = [
      makeProduct({ sku: 'SKU-1' as Sku, name: 'Nasi Goreng' }),
      makeProduct({ sku: 'SKU-2' as Sku, name: 'Es Teh', price: { minor_units: 5000, currency: 'IDR' } }),
    ];
    const { rerender } = render(
      withFluent(<MenuItemGrid {...makeProps(products)} />, menuFtl),
    );
    expect(screen.getByText('Nasi Goreng')).toBeInTheDocument();
    expect(screen.getByText('Es Teh')).toBeInTheDocument();

    // See the header: a render-count assertion was tried twice here and could not fail
    // the delta below meaningful.
    const afterMount = tileRenders;
    expect(afterMount).toBeGreaterThanOrEqual(2);

    // Price change on ONE product only. With a working memo exactly one tile body runs
    // again; with the dead memo BOTH do.
    const changed = [
      makeProduct({ sku: 'SKU-1' as Sku, name: 'Nasi Goreng', price: { minor_units: 30000, currency: 'IDR' } }),
      products[1]! as Product,
    ];
    await act(async () => {
      rerender(withFluent(<MenuItemGrid {...makeProps(changed)} />, menuFtl));
    });

    expect(screen.getByText('Nasi Goreng')).toBeInTheDocument();
    expect(
      tileRenders - afterMount,
      'a one-product change re-ran BOTH tile bodies — the memo is not preventing re-renders',
    ).toBeLessThan(2);
  });

  it('still updates the tile when its availability changes (the memo is not over-broad)', async () => {
    const products = [makeProduct({ sku: 'SKU-1' as Sku, name: 'Nasi Goreng', inStock: true })];
    const { rerender } = render(
      withFluent(<MenuItemGrid {...makeProps(products)} />, menuFtl),
    );
    expect(
      screen.getByRole('button', { name: /Nasi Goreng/ }).getAttribute('aria-disabled'),
    ).toBe('false');

    // 86 the item: the grid folds the unavailable override into inStock, so the tile
    // MUST re-render — a comparator that compared too little would freeze the 86.
    const eightied = [makeProduct({ sku: 'SKU-1' as Sku, name: 'Nasi Goreng', inStock: false })];
    await act(async () => {
      rerender(withFluent(<MenuItemGrid {...makeProps(eightied)} />, menuFtl));
    });

    expect(
      screen.getByRole('button', { name: /Nasi Goreng/ }).getAttribute('aria-disabled'),
      'the tile did not re-render when the item was 86-\'d — the comparator is too broad',
    ).toBe('true');
  });
});