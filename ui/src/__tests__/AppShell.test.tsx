// ── AppShell tests: KDS workspace navigation ──────────────────────
//
// Covers KDS rendering within store-pos (F12), restaurant-pos
// (chef button), and the standalone kds workspace, plus back-button
// navigation returning to the correct landing route.

import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import type { ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/__tests__/test-utils/render';
import AppShell from '@/frontend/shell/AppShell';
import type { AuthContextValue } from '@/contexts/AuthContext';
import staffFtl from '@/locales/staff.ftl?raw';

// ── Mock sub-screens ─────────────────────────────────────────────

vi.mock('@/features/kds/KdsScreen', () => ({
  default: () => <div data-testid="kds-screen">Kitchen Display System</div>,
}));

vi.mock('@/features/retail/RetailPosScreen', () => ({
  default: ({ onNavigate }: { onNavigate?: (route: string) => void }) => (
    <div data-testid="retail-pos-screen">
      <button
        data-testid="trigger-kds-store"
        onClick={() => onNavigate?.('kds')}
      >
        Open KDS
      </button>
    </div>
  ),
}));

vi.mock('@/features/sales/PosScreen', () => ({
  default: ({ onNavigate }: { onNavigate?: (route: string) => void }) => (
    <div data-testid="pos-screen">
      <button
        data-testid="trigger-kds-restaurant"
        onClick={() => onNavigate?.('kds')}
      >
        Open KDS
      </button>
    </div>
  ),
}));

// Memo banner surface stub: the shell tests pin WHERE the banner mounts,
// not memo content (MemoBanner.test.tsx owns that). The stub records its
// kds prop so the doubled-cadence variant is assertable per surface.
const memoBannerKds: boolean[] = [];

vi.mock('@/features/memo/MemoBanner', () => ({
  default: (props: { kds?: boolean }) => {
    memoBannerKds.push(Boolean(props.kds));
    return <div data-testid="memo-banner-mount" />;
  },
}));

// ── Mock API modules used by AppShell ────────────────────────────

vi.mock('@/api/license', () => ({
  getLicenseStatus: vi.fn(() => Promise.resolve({ is_active: true, payload: null })),
  activateLicense: vi.fn(),
}));

vi.mock('@/api/settings', () => ({
  getSetupStatus: vi.fn(() => Promise.resolve({ completed: true })),
  completeSetup: vi.fn(),
  dismissSetupWizard: vi.fn(),
  getEnabledFeatures: vi.fn(() => Promise.resolve({ features: [] })),
  getStoreSettings: vi.fn(() =>
    Promise.resolve({ name: '', address: '', taxId: '', currency: 'IDR', branch: '', logo: '' }),
  ),
  getReceiptSettings: vi.fn(() =>
    Promise.resolve({
      showCurrency: true, decimalSeparator: 'dot', showTax: true,
      footer: '', paperWidth: 'standard', showTableNumber: false,
      marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
    }),
  ),
  listCreditSales: vi.fn(() => Promise.resolve([])),
  settleCredit: vi.fn(),
}));

// ── Mock useTerminalProfile (default: not kiosk) ─────────────

const mockTerminalProfile = vi.fn(() => ({
  profile: null,
  loading: false,
  isKdsKiosk: false,
  error: null,
}));

vi.mock('@/hooks/useTerminalProfile', () => ({
  useTerminalProfile: () => mockTerminalProfile(),
}));

// ── Mock other hooks and APIs ───────────────────────────────────

let idleCallback: (() => void) | null = null;

vi.mock('@/hooks/useIdleTimer', () => ({
  useIdleTimer: (cb: () => void) => { idleCallback = cb; },
}));

vi.mock('@/hooks/useFeatures', () => ({
  useFeatures: vi.fn(() => ({
    enabled: new Set<string>(),
    loading: false,
    isEnabled: () => true,
    loaded: true,
    filterRoutes: (routes: string[]) => routes,
    error: null,
  })),
  FEATURES: {
    KITCHEN_DISPLAY: 'kitchen-display',
    TABLE_MANAGEMENT: 'table-management',
    USB_SCALE: 'usb-scale',
    QUICK_RETURN: 'quick-return',
    SERIAL_TRACKING: 'serial-tracking',
  } as const,
}));

// ── Auth context mock (dynamic per test) ────────────────────

const mockAuthSession: Mock<() => AuthContextValue> =
  vi.fn(() => ({
  session: {
    user_id: 'user-1',
    role_name: 'cashier',
    role_id: 'role-1',
    display_name: 'Test User',
    permissions: [],
  },
  loading: false,
  error: null,
  login: vi.fn(),
  logout: vi.fn(),
  clearError: vi.fn(),
  swapSession: vi.fn(),
  pickerTicket: null,
  isManager: false,
  isOwner: false,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockAuthSession(),
}));

// ── Workspace context mock (dynamic per test) ─────────────────

const mockWorkspace = vi.fn();

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => mockWorkspace(),
  WorkspaceProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// ── page-registry: register the kds route so handleNavigate works ──
import { getLicenseStatus } from '@/api/license';
import { getSetupStatus } from '@/api/settings';
import { registerPage, clearPages } from '@/platform/ui/page-registry';
import { registerNavItem, clearNavItems } from '@/platform/ui/menu-registry';



// ── Helpers ───────────────────────────────────────────────────

function mockStorePos() {
  mockWorkspace.mockReturnValue({
    activeWorkspace: 'store-pos',
    setActiveWorkspace: vi.fn(),
    availableWorkspaces: [],
    workspaceScreens: [],
    loading: false,
  });
}

function mockRestaurantPos() {
  mockWorkspace.mockReturnValue({
    activeWorkspace: 'restaurant-pos',
    setActiveWorkspace: vi.fn(),
    availableWorkspaces: [],
    workspaceScreens: [],
    loading: false,
  });
}

function mockKdsWorkspace() {
  mockWorkspace.mockReturnValue({
    activeWorkspace: 'kds',
    setActiveWorkspace: vi.fn(),
    availableWorkspaces: [],
    workspaceScreens: [],
    loading: false,
  });
}

// ── Helper: set Kitchen role on the auth mock ───────────────

function mockKitchenRole() {
  mockAuthSession.mockReturnValue({
    session: {
      user_id: 'user-1',
      role_name: 'Kitchen',
      role_id: 'role-kitchen',
      display_name: 'Chef',
      permissions: ['*'],
    },
    loading: false,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    clearError: vi.fn(),
    swapSession: vi.fn(),
  pickerTicket: null,
    isManager: false,
    isOwner: false,
  });
}

// ── Tests ────────────────────────────────────────────────────

describe('AppShell — KDS workspace navigation', () => {
  beforeEach(() => {
    // Reset auth mock to default (cashier) before each test
    mockAuthSession.mockReset();
    mockAuthSession.mockReturnValue({
      session: {
        user_id: 'user-1',
        role_name: 'cashier',
        role_id: 'role-1',
        display_name: 'Test User',
        permissions: [],
      },
      loading: false,
      error: null,
      login: vi.fn(),
      logout: vi.fn(),
      clearError: vi.fn(),
      swapSession: vi.fn(),
  pickerTicket: null,
      isManager: false,
      isOwner: false,
    });
    clearPages();
    // Register the kds page so handleNavigate's accessibility check passes
    registerPage({ route: 'kds', component: () => null, label: 'KDS' });
  });

  // ── Idle auto-return ──────────────────────────────────────

  describe('idle auto-return', () => {
    beforeEach(() => {
      idleCallback = null;
    });

    it('locks screen when idle timeout fires with an active session', async () => {
      mockAuthSession.mockReturnValue({
        session: {
          user_id: 'user-1',
          role_name: 'cashier',
          role_id: 'role-1',
          display_name: 'Test User',
          permissions: [],
        },
        loading: false,
        error: null,
        login: vi.fn(),
        logout: vi.fn(),
        clearError: vi.fn(),
        swapSession: vi.fn(),
  pickerTicket: null,
        isManager: false,
        isOwner: false,
      });

      mockWorkspace.mockReturnValue({
        activeWorkspace: 'store-pos',
        setActiveWorkspace: vi.fn(),
        availableWorkspaces: [],
        workspaceScreens: [],
        loading: false,
      });

      await renderWithProviders(<AppShell />, staffFtl);

      await act(async () => {});

      await waitFor(() => {
        expect(screen.getByTestId('retail-pos-screen')).toBeInTheDocument();
      });

      // Invoke the idle callback to simulate timeout
      await act(() => {
        idleCallback?.();
      });

      // Screen should now be locked. Assert the screen itself, not a hint
      // line: the "Enter PIN to unlock" copy was removed from the lock
      // screen, and the PIN pad is now its only content.
      await waitFor(() => {
        expect(screen.getByTestId('session-lock-screen')).toBeInTheDocument();
      });
    });

    it('stays on login screen when idle fires with no session', async () => {
      mockAuthSession.mockReturnValue({
        session: null,
        loading: false,
        error: null,
        login: vi.fn(),
        logout: vi.fn(),
        clearError: vi.fn(),
        swapSession: vi.fn(),
  pickerTicket: null,
        isManager: false,
        isOwner: false,
      });

      mockWorkspace.mockReturnValue({
        activeWorkspace: null,
        setActiveWorkspace: vi.fn(),
        availableWorkspaces: [],
        workspaceScreens: [],
        loading: false,
      });

      await renderWithProviders(<AppShell />);

      await act(async () => {});

      // When no session, AppShell shows the login screen
      await waitFor(() => {
        expect(document.querySelector('.staff-login-screen')).toBeInTheDocument();
      });

      // Invoke the idle callback
      await act(() => {
        idleCallback?.();
      });

      // Should still be on the login screen (no change)
      expect(document.querySelector('.staff-login-screen')).toBeInTheDocument();
    });
  });

  // ── KDS Kiosk lockdown ────────────────────────────────────

  describe('kds kiosk lockdown', () => {
    beforeEach(() => {
      mockTerminalProfile.mockReturnValue({
        profile: { terminalId: 't1', profileType: 'kds_kiosk', lockedScreen: 'kds' },
        loading: false,
        isKdsKiosk: true,
        error: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    });

    it('renders KdsScreen when terminal is in kds_kiosk lockdown', async () => {
      await renderWithProviders(<AppShell />);

      await waitFor(() => {
        expect(screen.getByTestId('kds-screen')).toBeInTheDocument();
      });
      // No back button in kiosk lockdown
      expect(screen.queryByRole('button', { name: /back/i })).not.toBeInTheDocument();
      // No workspace picker
      expect(screen.queryByText('No workspaces available')).not.toBeInTheDocument();
    });

    it('skips workspace picker when terminal is in kds_kiosk lockdown', async () => {
      // Even without active workspace, kds kiosk bypasses the picker.
      mockWorkspace.mockReturnValue({
        activeWorkspace: null,
        setActiveWorkspace: vi.fn(),
        availableWorkspaces: [],
        workspaceScreens: [],
        loading: false,
      });

      await renderWithProviders(<AppShell />);

      await waitFor(() => {
        expect(screen.getByTestId('kds-screen')).toBeInTheDocument();
      });
      expect(screen.queryByText('No workspaces available')).not.toBeInTheDocument();
    });

    it('renders normal KDS workspace when not in kiosk lockdown', async () => {
      mockTerminalProfile.mockReturnValue({
        profile: null,
        loading: false,
        isKdsKiosk: false,
        error: null,
      });
      mockKdsWorkspace();

      await renderWithProviders(<AppShell />);

      await waitFor(() => {
        expect(screen.getByTestId('kds-screen')).toBeInTheDocument();
      });
      // Normal KDS workspace has no back button (standalone)
      expect(screen.queryByRole('button', { name: /back/i })).not.toBeInTheDocument();
    });
  });

  // ── store-pos workspace ────────────────────────────────────

  describe('store-pos workspace', () => {
    it('renders RetailPosScreen when currentRoute is not kds', async () => {
      mockStorePos();
      await renderWithProviders(<AppShell />);

      await waitFor(() => {
        expect(screen.getByTestId('retail-pos-screen')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('kds-screen')).not.toBeInTheDocument();
    });

    it('renders KdsScreen with back button when navigating to kds route', async () => {
      mockStorePos();
      await renderWithProviders(<AppShell />);

      // Retail POS renders first
      await waitFor(() => {
        expect(screen.getByTestId('retail-pos-screen')).toBeInTheDocument();
      });

      // Navigate to KDS
      await userEvent.click(screen.getByTestId('trigger-kds-store'));

      await waitFor(() => {
        expect(screen.getByTestId('kds-screen')).toBeInTheDocument();
      });
      // Back button should be present
      expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument();
      // Retail POS should no longer be visible
      expect(screen.queryByTestId('retail-pos-screen')).not.toBeInTheDocument();
    });

    it('navigates back to products when back button is clicked from KDS', async () => {
      mockStorePos();
      await renderWithProviders(<AppShell />);

      await waitFor(() => {
        expect(screen.getByTestId('retail-pos-screen')).toBeInTheDocument();
      });

      // Navigate to KDS
      await userEvent.click(screen.getByTestId('trigger-kds-store'));
      await waitFor(() => {
        expect(screen.getByTestId('kds-screen')).toBeInTheDocument();
      });

      // Click back button
      await userEvent.click(screen.getByRole('button', { name: /back/i }));
      await waitFor(() => {
        expect(screen.getByTestId('retail-pos-screen')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('kds-screen')).not.toBeInTheDocument();
    });
  });

  // ── restaurant-pos workspace ───────────────────────────────

  describe('restaurant-pos workspace', () => {
    it('renders PosScreen when currentRoute is not kds', async () => {
      mockRestaurantPos();
      await renderWithProviders(<AppShell />);

      await waitFor(() => {
        expect(screen.getByTestId('pos-screen')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('kds-screen')).not.toBeInTheDocument();
    });

    it('renders KdsScreen with back button when navigating to kds route', async () => {
      mockRestaurantPos();
      await renderWithProviders(<AppShell />);

      await waitFor(() => {
        expect(screen.getByTestId('pos-screen')).toBeInTheDocument();
      });

      // Navigate to KDS via chef button
      await userEvent.click(screen.getByTestId('trigger-kds-restaurant'));

      await waitFor(() => {
        expect(screen.getByTestId('kds-screen')).toBeInTheDocument();
      });
      // Back button should be present
      expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument();
      expect(screen.queryByTestId('pos-screen')).not.toBeInTheDocument();
    });

    it('navigates back to sales when back button is clicked from KDS', async () => {
      mockRestaurantPos();
      await renderWithProviders(<AppShell />);

      await waitFor(() => {
        expect(screen.getByTestId('pos-screen')).toBeInTheDocument();
      });

      // Navigate to KDS
      await userEvent.click(screen.getByTestId('trigger-kds-restaurant'));
      await waitFor(() => {
        expect(screen.getByTestId('kds-screen')).toBeInTheDocument();
      });

      // Click back button
      await userEvent.click(screen.getByRole('button', { name: /back/i }));
      await waitFor(() => {
        expect(screen.getByTestId('pos-screen')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('kds-screen')).not.toBeInTheDocument();
    });
  });

  // ── Standalone KDS workspace ───────────────────────────────

  describe('standalone kds workspace', () => {
    it('renders KdsScreen standalone without a back button', async () => {
      mockKdsWorkspace();
      await renderWithProviders(<AppShell />);

      await waitFor(() => {
        expect(screen.getByTestId('kds-screen')).toBeInTheDocument();
      });
      // No back button in standalone mode
      expect(screen.queryByRole('button', { name: /back/i })).not.toBeInTheDocument();
      // Neither POS screen should be visible
      expect(screen.queryByTestId('retail-pos-screen')).not.toBeInTheDocument();
      expect(screen.queryByTestId('pos-screen')).not.toBeInTheDocument();
    });
  });

  // ── Dev-mode license bypass ───────────────────────────────

  describe('dev-mode license bypass', () => {
    beforeEach(() => {
      // Reset workspace to no active workspace (workspace picker)
      mockWorkspace.mockReturnValue({
        activeWorkspace: null,
        setActiveWorkspace: vi.fn(),
        availableWorkspaces: [],
        workspaceScreens: [],
        loading: false,
      });
    });

    it('skips license check and renders login screen in dev mode', async () => {
      // Override auth to no session → login screen
      mockAuthSession.mockReturnValue({
        session: null,
        loading: false,
        error: null,
        login: vi.fn(),
        logout: vi.fn(),
        clearError: vi.fn(),
        swapSession: vi.fn(),
  pickerTicket: null,
        isManager: false,
        isOwner: false,
      });

      await renderWithProviders(<AppShell />);

      // Dev bypass means no license IPC calls should be made
      expect(vi.mocked(getLicenseStatus)).not.toHaveBeenCalled();
      expect(vi.mocked(getSetupStatus)).not.toHaveBeenCalled();

      // Login screen should render (no session, dev bypass skips license check)
      await waitFor(() => {
        expect(screen.getByPlaceholderText('Username')).toBeInTheDocument();
      });

      // No license warning toast should appear
      expect(screen.queryByText(/License is inactive/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/License is in grace period/i)).not.toBeInTheDocument();
    });

    it('renders workspace picker for logged-in users in dev mode', async () => {
      // Uses default cashier session from parent beforeEach

      await renderWithProviders(<AppShell />);

      // No license IPC calls
      expect(vi.mocked(getLicenseStatus)).not.toHaveBeenCalled();
      expect(vi.mocked(getSetupStatus)).not.toHaveBeenCalled();

      // Workspace picker should render (empty state)
      await waitFor(() => {
        expect(screen.getByText('No workspaces available')).toBeInTheDocument();
      });

      // No license toast
      expect(screen.queryByText(/License is inactive/i)).not.toBeInTheDocument();
    });
  });

  // ── Kitchen role ───────────────────────────────────────────

  describe('kitchen role', () => {
    it('renders KDS workspace with Kitchen role', async () => {
      mockKitchenRole();
      mockKdsWorkspace();
      await renderWithProviders(<AppShell />);

      await waitFor(() => {
        expect(screen.getByTestId('kds-screen')).toBeInTheDocument();
      });
      // No back button in standalone mode
      expect(screen.queryByRole('button', { name: /back/i })).not.toBeInTheDocument();
    });

    it('can navigate to KDS from store-pos with Kitchen role', async () => {
      mockKitchenRole();
      mockStorePos();
      await renderWithProviders(<AppShell />);

      await waitFor(() => {
        expect(screen.getByTestId('retail-pos-screen')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByTestId('trigger-kds-store'));

      await waitFor(() => {
        expect(screen.getByTestId('kds-screen')).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument();
    });

    it('can navigate back from KDS to store-pos with Kitchen role', async () => {
      mockKitchenRole();
      mockStorePos();
      await renderWithProviders(<AppShell />);

      await waitFor(() => {
        expect(screen.getByTestId('retail-pos-screen')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByTestId('trigger-kds-store'));
      await waitFor(() => {
        expect(screen.getByTestId('kds-screen')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('button', { name: /back/i }));
      await waitFor(() => {
        expect(screen.getByTestId('retail-pos-screen')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('kds-screen')).not.toBeInTheDocument();
    });

    it('can navigate to KDS from restaurant-pos with Kitchen role', async () => {
      mockKitchenRole();
      mockRestaurantPos();
      await renderWithProviders(<AppShell />);

      await waitFor(() => {
        expect(screen.getByTestId('pos-screen')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByTestId('trigger-kds-restaurant'));

      await waitFor(() => {
        expect(screen.getByTestId('kds-screen')).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument();
    });

    it('can navigate back from KDS to restaurant-pos with Kitchen role', async () => {
      mockKitchenRole();
      mockRestaurantPos();
      await renderWithProviders(<AppShell />);

      await waitFor(() => {
        expect(screen.getByTestId('pos-screen')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByTestId('trigger-kds-restaurant'));
      await waitFor(() => {
        expect(screen.getByTestId('kds-screen')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('button', { name: /back/i }));
      await waitFor(() => {
        expect(screen.getByTestId('pos-screen')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('kds-screen')).not.toBeInTheDocument();
    });
  });

  // ── Memo banner surface (owner ruling 2026-09-08) ──────────
  //
  // App-wide on authenticated surfaces: every shell branch mounts it.
  // Hidden exactly where the ruling says: the login screen (the
  // session-scoped memo read has no session to read with), the session
  // lock screen, and the customer-facing kiosk route (internal staff
  // comms must not display to customers). AppLayout carries the mount
  // for sidebar pages; these tests pin the shell-level branches.

  describe('memo banner surface', () => {
    beforeEach(() => {
      memoBannerKds.length = 0;
      idleCallback = null;
      registerPage({
        route: 'kiosk',
        component: () => <div data-testid="kiosk-screen">Kiosk</div>,
        label: 'Kiosk',
        fullscreen: true,
      });
    });

    it('mounts the banner on the workspace picker', async () => {
      // The parent beforeEach resets auth only; the workspace mock is a
      // shared vi.fn — set the picker state explicitly here.
      mockWorkspace.mockReturnValue({
        activeWorkspace: null,
        setActiveWorkspace: vi.fn(),
        availableWorkspaces: [],
        workspaceScreens: [],
        loading: false,
      });
      await renderWithProviders(<AppShell />);
      await waitFor(() => {
        expect(screen.getByText('No workspaces available')).toBeInTheDocument();
      });
      expect(screen.getByTestId('memo-banner-mount')).toBeInTheDocument();
    });

    it('mounts the banner on the restaurant-pos workspace', async () => {
      mockRestaurantPos();
      await renderWithProviders(<AppShell />);
      await waitFor(() => {
        expect(screen.getByTestId('pos-screen')).toBeInTheDocument();
      });
      expect(screen.getByTestId('memo-banner-mount')).toBeInTheDocument();
    });

    it('mounts the banner on the store-pos workspace', async () => {
      mockStorePos();
      await renderWithProviders(<AppShell />);
      await waitFor(() => {
        expect(screen.getByTestId('retail-pos-screen')).toBeInTheDocument();
      });
      expect(screen.getByTestId('memo-banner-mount')).toBeInTheDocument();
    });

    it('uses the doubled-cadence kds variant on the kds workspace', async () => {
      mockKdsWorkspace();
      await renderWithProviders(<AppShell />);
      await waitFor(() => {
        expect(screen.getByTestId('kds-screen')).toBeInTheDocument();
      });
      expect(memoBannerKds.at(-1)).toBe(true);
    });

    it('keeps the banner off the login screen', async () => {
      mockAuthSession.mockReturnValue({
        session: null,
        loading: false,
        error: null,
        login: vi.fn(),
        logout: vi.fn(),
        clearError: vi.fn(),
        swapSession: vi.fn(),
        pickerTicket: null,
        isManager: false,
        isOwner: false,
      });
      await renderWithProviders(<AppShell />);
      await waitFor(() => {
        expect(screen.getByPlaceholderText('Username')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('memo-banner-mount')).not.toBeInTheDocument();
    });

    it('keeps the banner off the session lock screen', async () => {
      mockStorePos();
      await renderWithProviders(<AppShell />);
      await waitFor(() => {
        expect(screen.getByTestId('retail-pos-screen')).toBeInTheDocument();
      });
      await act(() => {
        idleCallback?.();
      });
      await waitFor(() => {
        expect(screen.getByTestId('session-lock-screen')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('memo-banner-mount')).not.toBeInTheDocument();
    });

    it('keeps the banner off the customer-facing kiosk route', async () => {
      // The kiosk route is reached from a sidebar workspace via the nav
      // (the POS branches swallow every non-kds route), so seed the nav
      // registry and expand its section like a real session would.
      clearNavItems();
      registerNavItem({ route: 'kiosk', label: 'Kiosk', section: 'tools' });
      localStorage.setItem('app-sidebar-expanded', 'tools');
      mockWorkspace.mockReturnValue({
        activeWorkspace: 'admin',
        setActiveWorkspace: vi.fn(),
        availableWorkspaces: [],
        workspaceScreens: [],
        loading: false,
      });
      await renderWithProviders(<AppShell />);
      // AppLayout renders for the sidebar workspace, banner mount included…
      await waitFor(() => {
        expect(screen.getByTestId('memo-banner-mount')).toBeInTheDocument();
      });
      // …then the kiosk route mounts WITHOUT it: customer-facing surface.
      await userEvent.click(screen.getByRole('button', { name: 'Kiosk' }));
      await waitFor(() => {
        expect(screen.getByTestId('kiosk-screen')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('memo-banner-mount')).not.toBeInTheDocument();
      localStorage.removeItem('app-sidebar-expanded');
    });
  });
});
