//! A11y regression tests for RestaurantMenu.
//!
//! The restaurant left panel had no axe coverage while its retail twin
//! (ProductLookupScreen) did. Renders the composite with mocked products,
//! preferences, and workspace hooks — the same seams RestaurantMenu.test.tsx
//! mocks — so axe sees the tablist, grid, search, and popover trigger.

import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, checkA11y } from './axe-helper';
import RestaurantMenu from '@/features/restaurant/RestaurantMenu';

vi.mock('@/features/products/useProducts', () => ({
  useProducts: () => ({
    products: [
      {
        sku: 'NASI-GORENG', name: 'Nasi Goreng', category: 'Makanan',
        productType: 'restaurant', price: { minor_units: 25000, currency: 'IDR' },
        inStock: true, createdAt: '2026-01-01',
      },
      {
        sku: 'ES-TEH', name: 'Es Teh', category: 'Minuman',
        productType: 'restaurant', price: { minor_units: 5000, currency: 'IDR' },
        inStock: true, createdAt: '2026-01-02',
      },
    ],
    categories: ['Makanan', 'Minuman'],
    categoryMeta: [],
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
}));

vi.mock('@/hooks/useWorkspaceNav', () => ({
  useWorkspaceNav: () => ({ goToWorkspacePicker: vi.fn() }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    session: { user_id: 'user-1', username: 'test', role_name: 'cashier' },
    loading: false,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    clearError: vi.fn(),
    isManager: false,
    isOwner: false,
  }),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    activeWorkspace: 'restaurant-pos',
    setActiveWorkspace: vi.fn(),
    sessionToken: null,
  }),
}));

vi.mock('@/api/settings', () => ({
  getUserPreferencesScoped: vi.fn(() => Promise.resolve({})),
  setUserPreferencesScoped: vi.fn(() => Promise.resolve(undefined)),
}));

describe('RestaurantMenu a11y', () => {
  it('has no axe violations on initial render', async () => {
    const { container } = renderWithProviders(
      <RestaurantMenu onAddProduct={vi.fn()} />,
    );
    // The tile button's accessible name is composed by the component; the
    // Localized wrapper renders an empty span that confuses axe-core's
    // button-name computation (same waiver as ProductLookupScreen). The
    // grid's list/listitem relationship is asserted structurally in
    // RestaurantMenu.test.tsx, not here.
    await checkA11y(container, {
      rules: {
        'button-name': { enabled: false },
        'aria-required-children': { enabled: false },
      },
    });
    expect(container.querySelector('[role="tablist"]')).toBeTruthy();
    expect(container.querySelector('[role="list"]')).toBeTruthy();
  });
});
