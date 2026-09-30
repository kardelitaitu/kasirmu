import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import RestaurantMenu from '@/features/restaurant/RestaurantMenu';
import type { Product, Sku } from '@/types/domain';
import sharedFtl from '@/locales/shared.ftl?raw';
import productsFtl from '@/locales/products.ftl?raw';
import salesFtl from '@/locales/sales.ftl?raw';

const mockSessionToken = { current: 'test-session-token' as string | null };
const mockLocationId = { current: 'loc-branch-1' as string | null };

const customizableProduct: Product = {
  sku: 'STEAK-RIBEYE' as Sku,
  name: 'Steak Ribeye',
  category: 'Food',
  productType: 'restaurant',
  price: { minor_units: 100000, currency: 'IDR' },
  inStock: true,
  barcode: null,
  stockQty: null,
  createdAt: '2026-01-01',
  modifierGroups: [
    {
      id: 'grp-doneness',
      name: 'Doneness',
      minSelections: 1,
      maxSelections: 1,
      sortOrder: 1,
      modifiers: [
        { id: 'mod-rare', name: 'Rare', priceMinor: 0, sortOrder: 1, isDefault: false },
        { id: 'mod-medium', name: 'Medium', priceMinor: 0, sortOrder: 2, isDefault: true },
        { id: 'mod-well', name: 'Well Done', priceMinor: 0, sortOrder: 3, isDefault: false },
      ],
    },
    {
      id: 'grp-sauce',
      name: 'Sauce',
      minSelections: 0,
      maxSelections: 1,
      sortOrder: 2,
      modifiers: [
        { id: 'mod-mushroom', name: 'Mushroom Sauce', priceMinor: 15000, sortOrder: 1, isDefault: false },
      ],
    },
  ],
};

const plainProduct: Product = {
  sku: 'MINERAL-WATER' as Sku,
  name: 'Mineral Water',
  category: 'Drinks',
  productType: 'restaurant',
  price: { minor_units: 10000, currency: 'IDR' },
  inStock: true,
  barcode: null,
  stockQty: null,
  createdAt: '2026-01-02',
};

const mockGetPrimaryLocationScoped = vi.fn();
const mockGetSettingScoped = vi.fn();
const mockSetSettingScoped = vi.fn();

vi.mock('@/features/products/useProducts', () => ({
  useProducts: () => ({
    products: [customizableProduct, plainProduct],
    categoryMeta: [],
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    activeWorkspace: 'restaurant-pos',
    setActiveWorkspace: vi.fn(),
    sessionToken: mockSessionToken.current,
  }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    session: { user_id: 'cashier-1', username: 'cashier' },
    loading: false,
    isManager: false,
  }),
}));

vi.mock('@/app/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks/useFullscreen', () => ({
  useFullscreen: () => ({ toggleFullscreen: vi.fn() }),
}));

vi.mock('@/hooks/useWorkspaceNav', () => ({
  useWorkspaceNav: () => ({ goToWorkspacePicker: vi.fn() }),
}));

vi.mock('@/api/locations', () => ({
  getPrimaryLocationScoped: (...args: unknown[]) => mockGetPrimaryLocationScoped(...args),
}));

vi.mock('@/api/settings', () => ({
  getUserPreferencesScoped: vi.fn().mockResolvedValue({}),
  setUserPreferencesScoped: vi.fn().mockResolvedValue(undefined),
  getSettingScoped: (...args: unknown[]) => mockGetSettingScoped(...args),
  setSettingScoped: (...args: unknown[]) => mockSetSettingScoped(...args),
}));

describe('RestaurantMenu — Modifiers & Location-Aware 86 state', () => {
  beforeEach(() => {
    localStorage.clear();
    mockGetPrimaryLocationScoped.mockReset().mockResolvedValue({ id: mockLocationId.current });
    mockGetSettingScoped.mockReset().mockResolvedValue(null);
    mockSetSettingScoped.mockReset().mockResolvedValue(undefined);
  });

  it('triggers ItemModifierModal when clicking a product with modifier groups', async () => {
    const onAddProduct = vi.fn();
    renderWithFluentSync(
      <RestaurantMenu onAddProduct={onAddProduct} />,
      sharedFtl,
      productsFtl,
      salesFtl,
    );

    await waitFor(() => expect(screen.getByText('Steak Ribeye')).toBeDefined());

    // Click on the customizable product
    await userEvent.click(screen.getByText('Steak Ribeye'));

    // Modal opens showing product name and modifier groups
    await waitFor(() => expect(screen.getByRole('dialog', { name: /Customise Steak Ribeye/i })).toBeDefined());
    expect(screen.getByText('Doneness')).toBeDefined();
    expect(screen.getByText('Sauce')).toBeDefined();

    // Select mushroom sauce addon (+15,000 IDR)
    await userEvent.click(screen.getByText('Mushroom Sauce'));

    // Confirm add to order
    await userEvent.click(screen.getByRole('button', { name: /Add to/i }));

    // onAddProduct receives the customized product with updated price and modifier selections
    expect(onAddProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        sku: 'STEAK-RIBEYE',
        price: expect.objectContaining({ minor_units: 115000 }), // 100,000 + 15,000
      }),
      expect.objectContaining({
        modifiers: expect.arrayContaining([
          expect.objectContaining({ modifierId: 'mod-medium' }),
          expect.objectContaining({ modifierId: 'mod-mushroom' }),
        ]),
      }),
    );
  });

  it('adds plain product directly to cart without opening modifier modal', async () => {
    const onAddProduct = vi.fn();
    renderWithFluentSync(
      <RestaurantMenu onAddProduct={onAddProduct} />,
      sharedFtl,
      productsFtl,
      salesFtl,
    );

    await waitFor(() => expect(screen.getByText('Mineral Water')).toBeDefined());

    await userEvent.click(screen.getByText('Mineral Water'));

    expect(onAddProduct).toHaveBeenCalledWith(
      expect.objectContaining({ sku: 'MINERAL-WATER' }),
    );
    expect(screen.queryByText('Customise Mineral Water')).toBeNull();
  });

  it('loads location-scoped unavailable items from backend settings', async () => {
    mockGetSettingScoped.mockResolvedValue(JSON.stringify(['MINERAL-WATER']));

    renderWithFluentSync(
      <RestaurantMenu />,
      sharedFtl,
      productsFtl,
      salesFtl,
    );

    // Mineral water should be marked unavailable (86'd)
    await waitFor(() => {
      expect(mockGetSettingScoped).toHaveBeenCalledWith(
        'test-session-token',
        'restaurant.unavailable.loc-branch-1',
      );
    });

    await waitFor(() => {
      const card = screen.getByText('Mineral Water').closest('.restaurant-card');
      expect(card?.className).toContain('restaurant-card--disabled');
      expect(card?.textContent).toContain('Unavailable');
    });
  });
});
