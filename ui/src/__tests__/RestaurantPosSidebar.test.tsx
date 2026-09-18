import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/__tests__/test-utils/render';
import salesFtl from '@/locales/sales.ftl?raw';
import productsFtl from '@/locales/products.ftl?raw';
import inventoryFtl from '@/locales/inventory.ftl?raw';
import settingsFtl from '@/locales/settings.ftl?raw';
import tablesFtl from '@/locales/tables.ftl?raw';
import kdsFtl from '@/locales/kds.ftl?raw';
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
const mockLogout = vi.hoisted(() => vi.fn());
const mockGoToWorkspacePicker = vi.hoisted(() => vi.fn());
const mockGetActiveShift = vi.hoisted(() => vi.fn().mockResolvedValue(null));

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
  useWorkspaceNav: () => ({ goToWorkspacePicker: mockGoToWorkspacePicker }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    session: { user_id: 'user-1', username: 'test', role_name: 'cashier', token: 't', role_id: 'r', display_name: 'Test' },
    loading: false,
    error: null,
    login: vi.fn(),
    logout: mockLogout,
    clearError: vi.fn(),
    isManager: false,
    isOwner: false,
  }),
}));

vi.mock('@/app/ThemeProvider', () => ({
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
  getActiveShiftScoped: mockGetActiveShift,
  getActiveShift: mockGetActiveShift,
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
    // The retail cases below flip this, so the restaurant cases must not
    // inherit whatever the previous test left behind.
    mockActiveWorkspace.current = 'restaurant-pos';
    mockLogout.mockClear();
    mockGoToWorkspacePicker.mockClear();
    mockGetActiveShift.mockReset().mockResolvedValue(null);
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

    // CartPanel & handle play exit animation then are hidden
    expect(cartPanel).toHaveClass('pos-cart-panel--exiting');
    expect(resizeHandle).toHaveClass('pos-resize-handle--exiting');
    await waitFor(() => {
      expect(cartPanel.style.display).toBe('none');
    });
    expect(resizeHandle.style.display).toBe('none');

    // Click toggle button again to close sidebar
    await user.click(toggleBtn);

    // Sidebar is closed (plays exit animation then unmounts)
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.restaurant-sidebar')).toHaveClass('restaurant-sidebar--exiting');

    // CartPanel & handle play entering animation and are visible again
    expect(cartPanel).toHaveClass('pos-cart-panel--entering');
    expect(resizeHandle).toHaveClass('pos-resize-handle--entering');
    expect(cartPanel.style.display).not.toBe('none');
    expect(resizeHandle.style.display).not.toBe('none');

    await waitFor(() => {
      expect(document.querySelector('.restaurant-sidebar')).not.toBeInTheDocument();
    });
  });

  // The sidebar item is labelled "Lock Terminal", so it has to lock the
  // terminal: fire the shell's `app:lock` contract (AppShell / TabletAppShell
  // swap in SessionLockScreen) and leave the auth session in place. It used to
  // call logout(), which ended the cashier's session and dropped the open cart
  // into a full staff login.
  it('Lock Terminal fires app:lock without logging the session out', async () => {
    const user = userEvent.setup();
    await renderWithProviders(<PosScreen />, salesFtl, productsFtl, inventoryFtl, settingsFtl);

    await user.click(document.querySelector('.restaurant-hamburger-btn') as HTMLButtonElement);
    expect(document.querySelector('.restaurant-sidebar')).toBeInTheDocument();

    mockLogout.mockClear();
    const lockEvents: Event[] = [];
    const record = (e: Event) => lockEvents.push(e);
    // PosScreen alone is mounted here — no shell listener — so this spy sees
    // exactly the event the button dispatched.
    window.addEventListener('app:lock', record);
    try {
      await user.click(screen.getByRole('button', { name: 'Lock Terminal' }));
    } finally {
      window.removeEventListener('app:lock', record);
    }

    expect(lockEvents).toHaveLength(1);
    expect(mockLogout).not.toHaveBeenCalled();
    // The popover closes on the lock, like every other item in it.
    await waitFor(() => {
      expect(document.querySelector('.restaurant-sidebar')).not.toBeInTheDocument();
    });
  });

  it('Exit Terminal shows confirmation dialog when shift is closed, and exits on confirm', async () => {
    const user = userEvent.setup();
    await renderWithProviders(<PosScreen />, salesFtl, productsFtl, inventoryFtl, settingsFtl);

    await user.click(document.querySelector('.restaurant-hamburger-btn') as HTMLButtonElement);
    expect(document.querySelector('.restaurant-sidebar')).toBeInTheDocument();

    const exitBtn = screen.getByRole('button', { name: 'Exit Terminal' });
    expect(exitBtn).toBeInTheDocument();

    // Click Exit Terminal -> opens exit confirmation dialog
    await user.click(exitBtn);

    // Sidebar closes
    await waitFor(() => {
      expect(document.querySelector('.restaurant-sidebar')).not.toBeInTheDocument();
    });

    // Exit confirmation modal appears
    expect(screen.getByText('Exit Workspace')).toBeInTheDocument();
    expect(mockGoToWorkspacePicker).not.toHaveBeenCalled();

    // Confirm exit
    const confirmExitBtn = screen.getByRole('button', { name: 'Exit' });
    await user.click(confirmExitBtn);

    expect(mockGoToWorkspacePicker).toHaveBeenCalledTimes(1);
  });

  it('Exit Terminal prompts to close shift when an active shift exists', async () => {
    mockGetActiveShift.mockResolvedValue({
      id: 'shift-1',
      cashier_id: 'user-1',
      opened_at: '2026-09-18T08:00:00Z',
      opening_balance_minor: 100000,
      opening_balance: 100000,
      total_sales_minor: 0,
      total_sales: 0,
      cash_sales_minor: 0,
    });

    const user = userEvent.setup();
    await renderWithProviders(<PosScreen />, salesFtl, productsFtl, inventoryFtl, settingsFtl);

    await user.click(document.querySelector('.restaurant-hamburger-btn') as HTMLButtonElement);
    expect(document.querySelector('.restaurant-sidebar')).toBeInTheDocument();

    const exitBtn = screen.getByRole('button', { name: 'Exit Terminal' });
    await user.click(exitBtn);

    // Sidebar closes
    await waitFor(() => {
      expect(document.querySelector('.restaurant-sidebar')).not.toBeInTheDocument();
    });

    // Close Shift modal opens instead of exit dialog or direct exit
    expect(mockGoToWorkspacePicker).not.toHaveBeenCalled();
    expect(screen.queryByText('Exit Workspace')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Close shift' })).toBeInTheDocument();
  });

  it('header back button prompts to close shift when active, and shows exit confirm when closed', async () => {
    // 1. Shift is closed (null)
    const user = userEvent.setup();
    await renderWithProviders(<PosScreen />, salesFtl, productsFtl, inventoryFtl, settingsFtl);

    const backBtn = document.querySelector('.restaurant-back-btn') as HTMLButtonElement;
    expect(backBtn).toBeInTheDocument();

    await user.click(backBtn);
    expect(screen.getByText('Exit Workspace')).toBeInTheDocument();
    expect(mockGoToWorkspacePicker).not.toHaveBeenCalled();
  });

  // The restaurant cart header is an order list now, not a toolbar: every
  // button that used to sit in `.pos-cart-header` is either relocated into this
  // popover (shift, deduction override, tables, history, KDS) or replaced by
  // the "Lock Terminal" row. The shift STATUS stays in the panel — it is a fact
  // about the order, not a control.
  it('hosts the relocated cart-header buttons and leaves none of them in the cart panel', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    await renderWithProviders(
      <PosScreen onNavigate={onNavigate} />,
      salesFtl, productsFtl, inventoryFtl, settingsFtl, tablesFtl, kdsFtl,
    );

    const cartPanel = document.querySelector('.pos-cart-panel') as HTMLElement;
    expect(cartPanel.querySelector('.pos-cart-header-actions')).toBeNull();
    expect(within(cartPanel).queryByRole('button', { name: 'Kitchen Display' })).toBeNull();
    expect(within(cartPanel).queryByRole('button', { name: 'Open a new shift' })).toBeNull();
    expect(within(cartPanel).queryByRole('button', { name: 'Lock' })).toBeNull();
    await waitFor(() => {
      expect(cartPanel.querySelector('.pos-cart-header-shift')?.textContent).toContain('No active shift');
    });

    await user.click(document.querySelector('.restaurant-hamburger-btn') as HTMLButtonElement);
    const sidebar = document.querySelector('.restaurant-sidebar') as HTMLElement;
    expect(within(sidebar).getByRole('button', { name: 'Open a new shift' })).toBeInTheDocument();
    expect(within(sidebar).getByRole('button', { name: 'History' })).toBeInTheDocument();
    // Table Management is feature-gated and this harness enables no features, so
    // the row is absent rather than rendered-and-disabled.
    expect(within(sidebar).queryByRole('button', { name: 'Table Management' })).toBeNull();

    // The row is the header's old button, not a stub: it drives the same
    // navigation and closes the popover like every other item in it.
    await user.click(within(sidebar).getByRole('button', { name: 'Kitchen Display' }));
    expect(onNavigate).toHaveBeenCalledWith('kds');
    await waitFor(() => {
      expect(document.querySelector('.restaurant-sidebar')).not.toBeInTheDocument();
    });
  });

  it('keeps the cart header buttons in the cart panel for the retail workspace', async () => {
    mockActiveWorkspace.current = 'store-pos';
    await renderWithProviders(
      <PosScreen />,
      salesFtl, productsFtl, inventoryFtl, settingsFtl, tablesFtl, kdsFtl,
    );

    const cartPanel = document.querySelector('.pos-cart-panel') as HTMLElement;
    expect(cartPanel.querySelector('.pos-cart-header-actions')).not.toBeNull();
    expect(within(cartPanel).getByRole('button', { name: 'Kitchen Display' })).toBeInTheDocument();
    expect(within(cartPanel).getByRole('button', { name: 'Lock' })).toBeInTheDocument();
    // Retail has no sidebar to relocate them into.
    expect(document.querySelector('.restaurant-hamburger-btn')).not.toBeInTheDocument();
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
