import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { withFluent } from '@/i18n/test-utils';
import productsFtl from '@/locales/products.ftl?raw';
import type { Product, Sku } from '@/types/domain';
import { MenuItemGrid } from '@/features/restaurant/components/MenuItemGrid';

/**
 * The restaurant selling-grid memo surface — scoped to what a unit test can prove.
 *
 * WHY THIS FILE IS NARROW, recorded so a future round does not repeat three attempts.
 * The grid is now `memo`ised and its parent no longer passes inline handler arrows, so a
 * parent-only re-render (a search keystroke) does not reach it. That claim could NOT be
 * pinned here, and each attempt failed in the same instructive way:
 *
 *  1. A counting wrapper around the tile — the wrapper's own memo absorbed the
 *     difference, so the count was identical with and without the real comparator.
 *  2. DOM presence — unchanged by a re-render, so it passed either way.
 *  3. <Profiler onRender> — MEASURED, and this is the useful one: it fires for the
 *     PARENT's commit pass over the subtree, so the counter read the same (1) with the
 *     grid memoised AND with `memo` deliberately removed. It measures the commit, not
 *     the component.
 *
 * Proving this properly needs the real parent (`RestaurantMenu` rendering with a live
 * search box) or a render-count assertion that React itself reports per component —
 * neither is available from jsdom without the scaffolding the production code does not
 * have. So the stronger claim is stated in the source comments instead, where the
 * reasoning is close to the code it explains.
 *
 * WHAT IS PINNED here: the memo is not over-broad — a prop the grid draws must reach it.
 * A memo that never re-renders is broken rather than fast, and that half IS observable.
 */
const menuFtl = productsFtl;

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

const PRODUCTS = [
  makeProduct({ sku: 'SKU-1' as Sku, name: 'Nasi Goreng' }),
  makeProduct({ sku: 'SKU-2' as Sku, name: 'Es Teh', price: { minor_units: 5000, currency: 'IDR' } }),
];

// Stable for the whole module: a fresh identity here would make EVERY prop unstable and
// the memo would correctly never hit — which is the fixture mistake round 85 made.
const STABLE = {
  pinned: new Set<string>(),
  unavailable: new Set<string>(),
  colors: {} as Record<string, string>,
  catMetaMap: new Map<string, { colour: string; icon: string }>(),
  onRetry: () => {},
  onClearFilter: () => {},
  onAdd: () => {},
  onContextMenu: () => {},
};

describe('MenuItemGrid memo', () => {
  // See the header: the parent-only re-render claim is documented but not asserted here,
  // because every instrument tried measured the parent's commit rather than the grid's
  // render. Recorded as a gap rather than replaced with an assertion that passes either way.
  it('mounts the grid with its tiles', () => {
    render(withFluent(
      <MenuItemGrid
        loading={false} error={null} items={PRODUCTS}
        hasActiveFilter={false} addedSku={null} {...STABLE}
      />,
      menuFtl,
    ));
    expect(screen.getByText('Nasi Goreng')).toBeInTheDocument();
    expect(screen.getByText('Es Teh')).toBeInTheDocument();
  });
  it('reaches the card when addedSku changes (the memo is not over-broad)', async () => {
    // The other half, and the observable that actually distinguishes: `addedSku` is
    // the prop that moves on every add, and the tile renders the 400ms add flash from
    // it. A memo that swallowed this would freeze the add confirmation — the cashier
    // taps a dish and gets no visual acknowledgement, which is the exact bug a memo
    // that is too broad introduces.
    const { rerender } = render(withFluent(
      <MenuItemGrid
        loading={false} error={null} items={PRODUCTS}
        hasActiveFilter={false} addedSku={null} {...STABLE}
      />,
      menuFtl,
    ));
    expect(
      document.querySelector('.restaurant-card--added'),
      'the fixture is wrong: no card is flashed at mount',
    ).toBeNull();

    await act(async () => {
      rerender(withFluent(
        <MenuItemGrid
          loading={false} error={null} items={PRODUCTS}
          hasActiveFilter={false} addedSku={'SKU-1' as Sku} {...STABLE}
        />,
        menuFtl,
      ));
    });

    expect(
      document.querySelector('.restaurant-card--added'),
      'the addedSku change did not reach the card — the memo is swallowing a change it draws',
    ).not.toBeNull();
  });
});