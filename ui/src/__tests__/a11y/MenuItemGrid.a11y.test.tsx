//! A11y regression tests for MenuItemGrid + MenuItemTile.
//!
//! The product grid is the main surface of the restaurant POS menu — the list of
//! tappable cards a cashier builds an order from. It had no axe coverage, and its
//! container declares role="list" while rendering <button> children directly,
//! which is the same shape that was already wrong once on the floor plan
//! (TableManagementScreen, round 8). axe is asked rather than the pattern
//! assumed.
//!
//! Names come from the REAL products bundle.

import { describe, it, expect, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { Sku } from '@/types/domain';
import { renderWithProviders, checkA11y } from './axe-helper';
import { MenuItemGrid } from '@/features/restaurant/components/MenuItemGrid';
import productsFtl from '@/locales/products.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';

const FTL = [sharedFtl, productsFtl];

// The grid takes the menu's INTERNAL Product shape (inStock/stockQty/
// productType camelCase), not the IPC ProductDto — duck-typing the DTO here
// would fail typecheck, as it did.
const PRODUCTS: ComponentProps<typeof MenuItemGrid>['items'] = [
  {
    sku: 'SKU-1' as Sku,
    name: 'Nasi Goreng',
    category: 'Makanan',
    price: { minor_units: 50000, currency: 'IDR' },
    barcode: null,
    inStock: true,
    stockQty: 10,
    productType: 'restaurant',
  },
  {
    sku: 'SKU-2' as Sku,
    name: 'Es Teh Manis',
    category: 'Minuman',
    price: { minor_units: 8000, currency: 'IDR' },
    barcode: null,
    inStock: true,
    stockQty: 50,
    productType: 'restaurant',
  },
];

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    loading: false,
    error: null,
    onRetry: vi.fn(),
    items: PRODUCTS,
    hasActiveFilter: false,
    onClearFilter: vi.fn(),
    pinned: new Set<string>(),
    unavailable: new Set<string>(),
    colors: {},
    catMetaMap: new Map(),
    addedSku: null,
    onAdd: vi.fn(),
    onContextMenu: vi.fn(),
    ...overrides,
  } as React.ComponentProps<typeof MenuItemGrid>;
}

describe('MenuItemGrid a11y', () => {
  it('has no axe violations with two products listed', async () => {
    const { container } = renderWithProviders(<MenuItemGrid {...makeProps()} />, ...FTL);
    await checkA11y(container);

    // Vacuity guard: the list and its two tiles mounted, so the pass is
    // clearing the real grid and not the loading/empty branch.
    expect(container.querySelector('[role="list"]')).toBeTruthy();
    expect(container.querySelectorAll('.restaurant-card').length).toBe(2);
  });

  it('has no axe violations on the empty state', async () => {
    const { container } = renderWithProviders(
      <MenuItemGrid {...makeProps({ items: [], hasActiveFilter: true })} />,
      ...FTL,
    );
    await checkA11y(container);

    // The recovery action is what makes this state useful.
    expect(container.querySelector('.restaurant-empty')).toBeTruthy();
  });
});
