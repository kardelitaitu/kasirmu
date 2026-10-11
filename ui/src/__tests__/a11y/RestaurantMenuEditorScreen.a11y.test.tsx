//! A11y regression tests for RestaurantMenuEditorScreen.
//!
//! The menu editor is the largest screen in the restaurant POS — categories,
//! the item grid, the add/edit form with modifier groups, the bulk actions and
//! the icon/colour pickers — and it had no axe coverage while the menu panel,
//! sidebar, receipts and payments screens did. Renders with the products and
//! categories APIs stubbed so the grid and cards mount rather than the empty or
//! error state.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
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

  it('has no axe violations with the Add Item form and a modifier group open', async () => {
    // The scan flagged the modifier group's name/max inputs and the option
    // name/price inputs as having no id/label association. Only axe can say
    // whether that is a real defect or a false positive of the heuristic.
    const { container } = renderWithProviders(<RestaurantMenuEditorScreen />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="restaurant-menu-editor-new-item"]')).toBeTruthy();
    });

    fireEvent.click(container.querySelector('[data-testid="restaurant-menu-editor-new-item"]')!);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="restaurant-menu-editor-form"]')).toBeTruthy();
    });

    fireEvent.click(container.querySelector('[data-testid="restaurant-menu-editor-add-group-btn"]')!);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="modifier-group-0"]')).toBeTruthy();
    });

    await checkA11y(container);

    // Vacuity guard: the group's inputs are what this case is about.
    expect(container.querySelector('[data-testid="modifier-group-name-0"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="modifier-option-name-0-0"]')).toBeTruthy();
  });

  it('has no axe violations in the category modal (icon + colour pickers)', async () => {
    // The two pickers are the last interactive block of this screen without
    // coverage: an icon radiogroup and a row of colour swatches named only by
    // their hex value. Whether the hex name is an acceptable accessible name is
    // exactly the question axe answers here.
    const { container } = renderWithProviders(<RestaurantMenuEditorScreen />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="restaurant-menu-editor-btn-add-cat"]')).toBeTruthy();
    });

    fireEvent.click(container.querySelector('[data-testid="restaurant-menu-editor-btn-add-cat"]')!);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="restaurant-menu-editor-cat-input-name"]')).toBeTruthy();
    });

    await checkA11y(container);

    // Vacuity guard: the radiogroup, its options and the swatch row mounted.
    expect(container.querySelector('.restaurant-menu-editor-icon-picker')).toBeTruthy();
    expect(container.querySelectorAll('.restaurant-menu-editor-icon-btn').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.restaurant-menu-editor-color-swatch').length).toBeGreaterThan(0);
  });
});

