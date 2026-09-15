import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/__tests__/test-utils/render';
import salesFtl from '@/locales/sales.ftl?raw';
import productsFtl from '@/locales/products.ftl?raw';
import inventoryFtl from '@/locales/inventory.ftl?raw';
import settingsFtl from '@/locales/settings.ftl?raw';
import PosScreen from '@/features/sales/PosScreen';
import type { Product } from '@/types/domain';

const mockProducts = [
  {
    sku: 'NASI-GORENG',
    name: 'Nasi Goreng',
    category: 'Makanan',
    productType: 'restaurant',
    price: { minor_units: 25000, currency: 'IDR' },
    inStock: true,
    createdAt: '2026-01-01',
  },
] as Product[];

const mockActiveWorkspace = vi.hoisted(() => ({ current: 'restaurant-pos' }));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    activeWorkspace: mockActiveWorkspace.current,
    setActiveWorkspace: vi.fn(),
    activeInstance: null,
    setActiveInstance: vi.fn(),
    availableWorkspaces: [],
    workspaceScreens: [],
    loading: false,
    error: null,
    retry: vi.fn(),
    lastWorkspace: null,
    switchStore: vi.fn(),
    resolvedStoreId: 'default',
    sessionToken: null,
    swapSessionToken: vi.fn(),
  }),
  useWorkspaceScope: () => ({ storeId: 'default', instanceId: 'default', typeKey: 'default' }),
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/features/products/useProducts', () => ({
  useProducts: () => ({
    products: mockProducts,
    categories: ['Makanan'],
    categoryMeta: [],
    loading: false,
  }),
}));

vi.mock('@/hooks/useWorkspaceNav', () => ({
  useWorkspaceNav: () => ({ goToWorkspacePicker: vi.fn() }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    session: { user_id: 'user-1', username: 'test', role_name: 'cashier', token: 't', role_id: 'r', display_name: 'Test' },
    loading: false,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    clearError: vi.fn(),
    isManager: false,
    isOwner: false,
  }),
}));

vi.mock('@/frontend/shell/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks/useFullscreen', () => ({
  useFullscreen: () => ({ toggleFullscreen: vi.fn() }),
}));

vi.mock('@/features/sales/useBarcodeScanner', async () => {
  const { createBarcodeScannerModuleMock } =
    await import('@/__tests__/test-utils/mocks/barcodeScanner');
  return createBarcodeScannerModuleMock();
});

vi.mock('@/api/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/settings')>();
  return {
    ...actual,
    getReceiptSettingsScoped: vi.fn().mockResolvedValue({ showTableNumber: false }),
    getReceiptSettings: vi.fn().mockResolvedValue({ showTableNumber: false }),
    getUserPreferencesScoped: vi.fn().mockResolvedValue({}),
    setUserPreferencesScoped: vi.fn().mockResolvedValue(undefined),
    getUserPreferences: vi.fn().mockResolvedValue({}),
    setUserPreferences: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@/api/shifts', () => ({
  getActiveShiftScoped: vi.fn().mockResolvedValue(null),
  getActiveShift: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/api/hardware', async () => {
  const actual = await vi.importActual<typeof import('@/api/hardware')>('@/api/hardware');
  return {
    ...actual,
    listDisplays: vi.fn(() => Promise.resolve([])),
    displayShow: vi.fn(() => Promise.resolve()),
    displayClear: vi.fn(() => Promise.resolve()),
  };
});

describe('RestaurantPosSidebar', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('hides the CartPanel when restaurant sidebar is toggled open and restores it when closed', async () => {
    const user = userEvent.setup();
    await renderWithProviders(<PosScreen />, salesFtl, productsFtl, inventoryFtl, settingsFtl);

    const cartPanel = document.querySelector('.pos-cart-panel') as HTMLElement;
    const resizeHandle = document.querySelector('.pos-resize-handle') as HTMLElement;
    expect(cartPanel).toBeInTheDocument();
    expect(cartPanel.style.display).not.toBe('none');
    expect(resizeHandle.style.display).not.toBe('none');

    // Toggle button in RestaurantMenu header
    const toggleBtn = document.querySelector('.restaurant-hamburger-btn') as HTMLButtonElement;
    expect(toggleBtn).toBeInTheDocument();
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');

    // Click toggle button to open sidebar
    await user.click(toggleBtn);

    // Sidebar is open
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('true');
    const sidebar = document.querySelector('.restaurant-sidebar');
    expect(sidebar).toBeInTheDocument();
    expect(screen.getByText('Manual')).toBeInTheDocument();

    // CartPanel and resize handle are hidden
    expect(cartPanel.style.display).toBe('none');
    expect(resizeHandle.style.display).toBe('none');

    // Click toggle button again to close sidebar
    await user.click(toggleBtn);

    // Sidebar is closed
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.restaurant-sidebar')).not.toBeInTheDocument();

    // CartPanel and resize handle are visible again
    expect(cartPanel.style.display).not.toBe('none');
    expect(resizeHandle.style.display).not.toBe('none');
  });

  it('keeps CartPanel visible in retail POS workspace', async () => {
    mockActiveWorkspace.current = 'store-pos';
    await renderWithProviders(<PosScreen />, salesFtl, productsFtl, inventoryFtl, settingsFtl);

    const cartPanel = document.querySelector('.pos-cart-panel') as HTMLElement;
    const resizeHandle = document.querySelector('.pos-resize-handle') as HTMLElement;
    expect(cartPanel).toBeInTheDocument();
    expect(cartPanel.style.display).not.toBe('none');
    expect(resizeHandle.style.display).not.toBe('none');

    // Restaurant hamburger/sidebar button is not present in Retail POS
    expect(document.querySelector('.restaurant-hamburger-btn')).not.toBeInTheDocument();
  });
});
