//! A11y regression tests for KioskScreen.
//!
//! The self-service kiosk is scope-adjacent to the restaurant POS (its own
//! feature flag, not the POS workspace) but shares the POS product-grid shape:
//! a role="list" container whose children were bare <button> cards, so a screen
//! reader announced an empty list. Found by an audit that swept every
//! role="list" in the codebase after the same defect appeared twice in the
//! restaurant POS.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import { renderWithProviders, checkA11y } from './axe-helper';
import kioskFtl from '@/locales/kiosk.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';

const FTL = [sharedFtl, kioskFtl];

const { mockListProducts, mockListCategories } = vi.hoisted(() => ({
  mockListProducts: vi.fn(),
  mockListCategories: vi.fn(),
}));

vi.mock('@/api/products', () => ({
  listProducts: () => mockListProducts(),
  listProductsScoped: () => mockListProducts(),
  listCategories: () => mockListCategories(),
  listCategoriesScoped: () => mockListCategories(),
}));

vi.mock('@/contexts/CurrencyContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/contexts/CurrencyContext')>()),
  useCurrency: () => ({ currency: 'IDR', setCurrency: vi.fn(), loading: false }),
}));

import KioskScreen from '@/features/kiosk/KioskScreen';

const PRODUCTS = [
  { sku: 'SKU-001', name: 'Indomie Goreng', category: 'cat-food', price: { minor_units: 3500, currency: 'IDR' }, barcode: '8991002100110', in_stock: true, stock_qty: 100, tax_rate_ids: [], created_at: '', price_updated_at: '' },
  { sku: 'SKU-002', name: 'Teh Botol Sosro', category: 'cat-drink', price: { minor_units: 5000, currency: 'IDR' }, barcode: '8991002100220', in_stock: true, stock_qty: 50, tax_rate_ids: [], created_at: '', price_updated_at: '' },
];

beforeEach(() => {
  mockListProducts.mockReset().mockResolvedValue(PRODUCTS);
  mockListCategories.mockReset().mockResolvedValue([{ id: 'cat-food', name: 'Makanan', colour: '#e74c3c' }]);
});

describe('KioskScreen a11y', () => {
  it('has no axe violations with products listed', async () => {
    const { container } = renderWithProviders(<KioskScreen />, ...FTL);
    await waitFor(() => {
      expect(container.querySelector('.kiosk-grid')).toBeTruthy();
    });
    await checkA11y(container);

    // Vacuity guard: the list and its wrapped cards mounted, so the pass is
    // clearing real product tiles rather than an empty grid.
    expect(container.querySelectorAll('.kiosk-product-card').length).toBe(2);
    expect(container.querySelectorAll('.kiosk-grid > [role="listitem"]').length).toBe(2);
  });
});
