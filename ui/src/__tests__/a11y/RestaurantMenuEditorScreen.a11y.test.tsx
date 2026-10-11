//! A11y regression tests for RestaurantMenuEditorScreen.
//!
//! The menu editor is the largest screen in the restaurant POS — categories,
//! the item grid, the add/edit form with modifier groups, the bulk actions and
//! the icon/colour pickers — and it had no axe coverage while the menu panel,
//! sidebar, receipts and payments screens did. Renders with the products and
//! categories APIs stubbed so the grid and cards mount rather than the empty or
//! error state.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import { renderWithProviders, checkA11y } from './axe-helper';
import RestaurantMenuEditorScreen from '@/features/restaurant/screens/RestaurantMenuEditorScreen';
import * as productsApi from '@/api/products';

vi.mock('@/utils/catalog-cache', () => ({ invalidateCatalog: vi.fn() }));

vi.mock('@/api/products', () => ({
  listProductsScoped: vi.fn(),
  createProductScoped: vi.fn(),
  updateProductScoped: vi.fn(),
  deleteProductScoped: vi.fn(),
  listCategoriesScoped: vi.fn(),
  createCategoryScoped: vi.fn(),
  updateCategoryScoped: vi.fn(),
  deleteCategoryScoped: vi.fn(),
}));

const mockProducts = [
  {
    sku: 'MN001',
    name: 'Nasi Goreng Kampung',
    category: 'Mains',
    price: { minor_units: 35000, currency: 'IDR' },
    barcode: null,
    in_stock: true,
    stock_qty: 10,
    tax_rate_ids: [],
    created_at: '2026-10-08T00:00:00Z',
    price_updated_at: '2026-10-08T00:00:00Z',
    product_type: 'restaurant',
    is_active: true,
    notes: 'Served with crackers and pickles',
  },
];

const mockCategories = [
  { id: 'cat-mains', name: 'Mains', colour: '#f97316', icon: 'food' },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(productsApi.listProductsScoped).mockResolvedValue([...mockProducts] as never);
  vi.mocked(productsApi.listCategoriesScoped).mockResolvedValue([...mockCategories] as never);
});

describe('RestaurantMenuEditorScreen a11y', () => {
  it('has no axe violations with the menu grid mounted', async () => {
    const { container } = renderWithProviders(<RestaurantMenuEditorScreen />);

    // Let the catalog read settle, then pin that the real grid mounted rather
    // than an empty/loading state axe would also clear.
    await waitFor(() => {
      expect(container.querySelector('[data-testid="restaurant-menu-editor-search-input"]')).toBeTruthy();
    });
    await checkA11y(container);

    expect(container.querySelector('[data-testid="restaurant-menu-editor-new-item"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="menu-item-card-MN001"]')).toBeTruthy();
  });
});
