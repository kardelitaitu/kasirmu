// ── AppShell tests: KDS workspace navigation ──────────────────────
//
// Covers KDS rendering within store-pos (F12), restaurant-pos
// (chef button), and the standalone kds workspace, plus back-button
// navigation returning to the correct landing route.

import { describe, expect, it, vi, beforeEach, afterEach, type Mock } from 'vitest';
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

  // ── Settings sub-section deep links (Locations → Topology) ──

  describe('settings sub-section deep links', () => {
    beforeEach(() => {
      clearPages();
      registerPage({
        route: 'settings',
        component: () => <div data-testid="settings-page-stub" />,
        label: 'Settings',
      });
      window.location.hash = '';
    });

    afterEach(() => {
      window.location.hash = '';
    });

    it('routes a #/settings/<section> hashchange onto the settings page on the admin workspace', async () => {
      // The Locations dashboard's Configure topology action fires from the
      // admin workspace while another page (locations) is mounted: no
      // workspace switch happens, and `settings/topology` is not itself a
      // registered page — only the settings prefix sync must carry the
      // shell there, or the deep link silently does nothing.
      mockWorkspace.mockReturnValue({
        activeWorkspace: 'admin',
        setActiveWorkspace: vi.fn(),
        availableWorkspaces: [],
        workspaceScreens: [],
        loading: false,
      });
      await renderWithProviders(<AppShell />);
      await act(async () => {});

      await act(async () => {
        window.location.hash = '#/settings/topology?branch=store-1';
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('settings-page-stub')).toBeInTheDocument();
      });
    });

    it('strips the deep-link query before matching the registered page route', async () => {
      // `#/settings?x=1` must match the registered `settings` page (the
      // query belongs to the section, not the route).
      mockWorkspace.mockReturnValue({
        activeWorkspace: 'admin',
        setActiveWorkspace: vi.fn(),
        availableWorkspaces: [],
        workspaceScreens: [],
        loading: false,
      });
      window.location.hash = '#/settings?branch=store-1';
      await renderWithProviders(<AppShell />);
      await act(async () => {});

      await waitFor(() => {
        expect(screen.getByTestId('settings-page-stub')).toBeInTheDocument();
      });
    });
  });

  // ── Hash-route entry is access-gated ───────────────────────────
  // todo-tools-agents-3 :38 ("can a cashier bypass the gate by typing a
  // hash?"). The sync-from-hash listener (AppShell.tsx:244-277) calls
  // setCurrentRoute WITHOUT any isPageAccessible check — unlike
  // handleNavigate, which does check and falls back. What closes the gap is
  // NOT a guard in the listener: it is that pageDenied (:473) is recomputed
  // from currentRoute on every render, so the route change re-renders into
  // PermissionDenied. Nothing in the tree asserted that, which is why the box
  // looked open. The tablet twin (TabletAppShell.test.tsx:340) asserts the
  // MOUNT-time case only; these assert mount-by-hash AND the live hashchange,
  // end to end through the shell render — passesGate / isPageAccessible are
  // the real ones, not mocked, and nothing here stubs pageDenied (a stubbed
  // gate would be the shadow suite this repo already flagged at
  // KdsStatusAdvance.test.ts:4-8).
  describe('hash-route entry is access-gated', () => {
    beforeEach(() => {
      clearPages();
      // An ungated page (the allowed starting point), a role-gated page, and a
      // permission-gated page — all three land in the sidebar branch of the
      // shell (AppShell.tsx:606-617), which is the branch that renders the
      // registry page inside AppLayout.
      registerPage({
        route: 'products',
        component: () => <div data-testid="products-page-stub" />,
        label: 'Products',
      });
      registerPage({
        route: 'audit-log',
        component: () => <div data-testid="audit-page-stub" />,
        label: 'Audit Trail',
        requiredRole: 'manager',
      });
      registerPage({
        route: 'analytics',
        component: () => <div data-testid="analytics-page-stub" />,
        label: 'Analytics',
        requiredRole: 'manager',
        requiredPermission: 'analytics:view',
      });
      mockWorkspace.mockReturnValue({
        activeWorkspace: 'admin',
        setActiveWorkspace: vi.fn(),
        availableWorkspaces: [],
        workspaceScreens: [],
        loading: false,
      });
      window.location.hash = '';
    });

    afterEach(() => {
      window.location.hash = '';
    });

    function sessionFor(roleName: string, permissions: string[]) {
      mockAuthSession.mockReturnValue({
        session: {
          user_id: 'user-1',
          role_name: roleName,
          role_id: 'role-1',
          display_name: 'Test User',
          permissions,
        },
        loading: false,
        error: null,
        login: vi.fn(),
        logout: vi.fn(),
        clearError: vi.fn(),
        swapSession: vi.fn(),
        pickerTicket: null,
        isManager: roleName === 'manager' || roleName === 'owner',
        isOwner: roleName === 'owner',
      });
    }

    /**
     * Positive-then-negative denial check. `desc` is the denial copy that names
     * THIS route's label — role-gated pages get "<label> requires a <role>
     * role.", permission-gated pages get "You don't have permission to access
     * <label>." (PermissionDenied switches desc by requiredPermission, so the
     * two gates are distinguishable from the DOM, not just from the flag).
     * Read off .permission-denied-card's textContent because the fallback copy
     * nests the label in a <strong>, which splits the string across nodes.
     * The card + its wording can only exist if the shell rendered the denial
     * on purpose, so the absence checks below cannot be won by an empty or
     * crashed render.
     */
    function expectDeniedFor(desc: string) {
      expect(screen.getByText('Access Denied')).toBeInTheDocument();
      const card = document.querySelector('.permission-denied-card');
      expect(card).not.toBeNull();
      expect(card?.textContent).toContain(desc);
      // Negative: the gated screen itself is not mounted.
      expect(screen.queryByTestId('audit-page-stub')).not.toBeInTheDocument();
      expect(screen.queryByTestId('analytics-page-stub')).not.toBeInTheDocument();
    }

    it('denies a cashier who mounts straight on a role-gated route via the hash', async () => {
      sessionFor('cashier', []);
      window.location.hash = '#/audit-log';

      await renderWithProviders(<AppShell />, staffFtl);
      await act(async () => {});

      expectDeniedFor('Audit Trail requires a manager role.');
    });

    it('renders the same route normally for a role that satisfies requiredRole', async () => {
      // The control for the case above: same registry, same hash, same shell —
      // only the role changes. If this also denied, the first test would be
      // proving a routing failure rather than a gate.
      sessionFor('owner', []);
      window.location.hash = '#/audit-log';

      await renderWithProviders(<AppShell />, staffFtl);
      await act(async () => {});

      await waitFor(() => {
        expect(screen.getByTestId('audit-page-stub')).toBeInTheDocument();
      });
      expect(screen.queryByText('Access Denied')).not.toBeInTheDocument();
    });

    it('denies a hash CHANGE to a role-gated route while the shell is already mounted', async () => {
      // The actual bypass path: the cashier is legitimately on an ungated
      // page, then the hash moves to a gated one. The listener never checks
      // access; pageDenied is recomputed on the render that follows.
      sessionFor('cashier', []);
      window.location.hash = '#/products';

      await renderWithProviders(<AppShell />, staffFtl);
      await act(async () => {});
      await waitFor(() => {
        expect(screen.getByTestId('products-page-stub')).toBeInTheDocument();
      });
      expect(screen.queryByText('Access Denied')).not.toBeInTheDocument();

      await act(async () => {
        window.location.hash = '#/audit-log';
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });

      await waitFor(() => {
        expect(screen.getByText('Access Denied')).toBeInTheDocument();
      });
      expect(document.querySelector('.permission-denied-card')?.textContent).toContain(
        'Audit Trail requires a manager role.',
      );
      expect(screen.queryByTestId('audit-page-stub')).not.toBeInTheDocument();
      // The previously-mounted page is gone, not merely hidden behind it.
      expect(screen.queryByTestId('products-page-stub')).not.toBeInTheDocument();
    });

    it('denies a manager whose session lacks the page requiredPermission', async () => {
      // passesGate is permission-authoritative when present
      // (page-registry/index.ts:139-155): the role alone must not carry it.
      sessionFor('manager', ['sales:view']);
      window.location.hash = '#/analytics';

      await renderWithProviders(<AppShell />, staffFtl);
      await act(async () => {});

      expectDeniedFor("You don't have permission to access Analytics.");
    });

    it('renders the permission-gated route for the same role once the key is granted', async () => {
      // Control for the case above, including the wildcard form the backend
      // mirrors: owner grants ["*"], not a literal key.
      sessionFor('manager', ['analytics:*']);
      window.location.hash = '#/analytics';

      await renderWithProviders(<AppShell />, staffFtl);
      await act(async () => {});

      await waitFor(() => {
        expect(screen.getByTestId('analytics-page-stub')).toBeInTheDocument();
      });
      expect(screen.queryByText('Access Denied')).not.toBeInTheDocument();
    });
  });
});
