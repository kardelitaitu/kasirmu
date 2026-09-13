// ── TabletAppShell routing tests (TAB-06) ─────────────────────────
//
// The tablet shell decides what renders based on four inputs:
//   setup status (getSetupStatus), auth session, active workspace,
//   and page-registry role gating. Each branch is exercised below:
//   loading → login → setup wizard → workspace picker → fullscreen
//   POS/KDS workspaces → sidebar workspaces → permission-denied.
//
// Mirrors the AppShell.test.tsx mocking conventions (dynamic auth +
// workspace mocks, lazy screen stubs, real page-registry seeded in
// beforeEach).

import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { renderWithProviders } from '@/__tests__/test-utils/render';
import TabletAppShell from '@/frontend/shell/tablet/TabletAppShell';
import type { AuthContextValue } from '@/contexts/AuthContext';
import { registerPage, clearPages } from '@/platform/ui/page-registry';
import { getSetupStatus, type SetupStatus } from '@/api/settings';
import sharedFtl from '@/locales/shared.ftl?raw';

// ── Mock lazy screens (TabletAppShell lazy-imports these) ────────

vi.mock('@/features/setup/SetupWizard', () => ({
  default: () => <div data-testid="setup-wizard">Setup Wizard</div>,
}));

vi.mock('@/features/auth/StaffLoginScreen', () => ({
  default: () => <div data-testid="staff-login-screen">Login</div>,
}));

vi.mock('@/features/workspaces/WorkspaceHome', () => ({
  default: () => <div data-testid="workspace-home">Workspace Home</div>,
}));

vi.mock('@/features/retail/RetailPosScreen', () => ({
  default: () => <div data-testid="retail-pos-screen">Retail POS</div>,
}));

vi.mock('@/features/sales/PosScreen', () => ({
  default: () => <div data-testid="pos-screen">POS</div>,
}));

vi.mock('@/features/kds/KdsScreen', () => ({
  default: () => <div data-testid="kds-screen">KDS</div>,
}));

// Memo banner surface stub: pins WHERE the banner mounts (the shell's job),
// not memo content — MemoBanner.test.tsx owns that. Records the kds prop so
// the doubled-cadence variant is assertable per surface.
const memoBannerKds: boolean[] = [];

vi.mock('@/features/memo/MemoBanner', () => ({
  default: (props: { kds?: boolean }) => {
    memoBannerKds.push(Boolean(props.kds));
    return <div data-testid="memo-banner-mount" />;
  },
}));

// ── Mock orientation lock (side effect only, no UI impact) ───────

vi.mock('@/hooks/useOrientation', () => ({
  useOrientation: () => ({
    orientation: { isLandscape: true, angle: 90, viewportWidth: 1024, viewportHeight: 1366 },
    locking: false,
    supported: false,
    lock: vi.fn(),
    unlock: vi.fn(),
  }),
}));

// ── Mock useFeatures ────────────────────────────────────────────

vi.mock('@/hooks/useFeatures', () => ({
  useFeatures: vi.fn(() => ({
    enabled: new Set<string>(),
    loading: false,
    isEnabled: () => true,
    loaded: true,
    filterRoutes: (routes: string[]) => routes,
    error: null,
  })),
}));

// ── Mock API modules used by TabletAppShell ─────────────────────

vi.mock('@/api/settings', () => ({
  getSetupStatus: vi.fn(() => Promise.resolve({ completed: true, preset: null })),
  completeSetup: vi.fn(),
  dismissSetupWizard: vi.fn(),
}));

// ── Mock auth context (dynamic per test) ───────────────────────

const mockAuthSession: Mock<() => AuthContextValue> = vi.fn(() => ({
  session: {
    user_id: 'user-1',
    role_name: 'owner',
    role_id: 'role-1',
    display_name: 'Test Owner',
    permissions: ['*'],
  },
  loading: false,
  error: null,
  login: vi.fn(),
  logout: vi.fn(),
  clearError: vi.fn(),
  swapSession: vi.fn(),
  pickerTicket: null,
  isManager: true,
  isOwner: true,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockAuthSession(),
}));

// ── Mock workspace context (dynamic per test) ──────────────────

const mockWorkspace = vi.fn();

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => mockWorkspace(),
}));

// ── Helpers ────────────────────────────────────────────────────

function mockWorkspaceValue(overrides: Record<string, unknown> = {}) {
  mockWorkspace.mockReturnValue({
    activeWorkspace: null,
    workspaceScreens: [],
    loading: false,
    error: null,
    ...overrides,
  });
}

function mockOwnerSession() {
  mockAuthSession.mockReturnValue({
    session: {
      user_id: 'user-1',
      role_name: 'owner',
      role_id: 'role-1',
      display_name: 'Test Owner',
      permissions: ['*'],
    },
    loading: false,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    clearError: vi.fn(),
    swapSession: vi.fn(),
  pickerTicket: null,
    isManager: true,
    isOwner: true,
  });
}

function mockCashierSession() {
  mockAuthSession.mockReturnValue({
    session: {
      user_id: 'user-2',
      role_name: 'cashier',
      role_id: 'role-cashier',
      display_name: 'Cashier',
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
}

function mockNoSession() {
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
}

// ── Tests ───────────────────────────────────────────────────────

describe('TabletAppShell — routing', () => {
  beforeEach(() => {
    vi.mocked(getSetupStatus).mockReset();
    vi.mocked(getSetupStatus).mockResolvedValue({ completed: true, preset: null });
    mockOwnerSession();
    mockWorkspaceValue();
    clearPages();
    // Default 'pos' page so the sidebar workspace branch has a
    // registered component to render.
    registerPage({ route: 'pos', component: () => null, label: 'POS Terminal' });
  });

  // ── Loading bootstrap ────────────────────────────────────────

  describe('setup bootstrap', () => {
    it('renders a loading state while getSetupStatus is in flight', async () => {
      let resolveStatus!: (v: SetupStatus) => void;
      vi.mocked(getSetupStatus).mockReturnValue(
        new Promise((resolve) => { resolveStatus = resolve; }),
      );

      await renderWithProviders(<TabletAppShell />, sharedFtl);

      expect(screen.getByText(/Loading/i)).toBeInTheDocument();

      // Resolve the pending setup-status promise; the shell transitions
      // from loading to the workspace picker.
      await act(async () => {
        resolveStatus({ completed: true, preset: null });
      });
      await waitFor(() => {
        expect(screen.getByTestId('workspace-home')).toBeInTheDocument();
      });
    });

    it('renders the setup wizard when setup is incomplete', async () => {
      vi.mocked(getSetupStatus).mockResolvedValue({ completed: false, preset: null });

      await renderWithProviders(<TabletAppShell />, sharedFtl);

      await waitFor(() => {
        expect(screen.getByTestId('setup-wizard')).toBeInTheDocument();
      });
    });

    it('falls back to the setup wizard when getSetupStatus rejects', async () => {
      vi.mocked(getSetupStatus).mockRejectedValue(new Error('boom'));

      await renderWithProviders(<TabletAppShell />, sharedFtl);

      await waitFor(() => {
        expect(screen.getByTestId('setup-wizard')).toBeInTheDocument();
      });
    });
  });

  // ── Auth gating ───────────────────────────────────────────────

  describe('auth gating', () => {
    it('renders the login screen when there is no session', async () => {
      mockNoSession();

      await renderWithProviders(<TabletAppShell />, sharedFtl);

      await waitFor(() => {
        expect(screen.getByTestId('staff-login-screen')).toBeInTheDocument();
      });
    });
  });

  // ── Workspace picker ──────────────────────────────────────────

  describe('workspace picker', () => {
    it('renders WorkspaceHome when no workspace is active', async () => {
      await renderWithProviders(<TabletAppShell />, sharedFtl);

      await waitFor(() => {
        expect(screen.getByTestId('workspace-home')).toBeInTheDocument();
      });
    });
  });

  // ── Fullscreen workspaces ─────────────────────────────────────

  describe('fullscreen workspaces', () => {
    it('renders RetailPosScreen for store-pos', async () => {
      mockWorkspaceValue({ activeWorkspace: 'store-pos' });

      await renderWithProviders(<TabletAppShell />, sharedFtl);

      await waitFor(() => {
        expect(screen.getByTestId('retail-pos-screen')).toBeInTheDocument();
      });
    });

    it('renders PosScreen for restaurant-pos', async () => {
      mockWorkspaceValue({ activeWorkspace: 'restaurant-pos' });

      await renderWithProviders(<TabletAppShell />, sharedFtl);

      await waitFor(() => {
        expect(screen.getByTestId('pos-screen')).toBeInTheDocument();
      });
    });

    it('renders KdsScreen for the kds workspace', async () => {
      mockWorkspaceValue({ activeWorkspace: 'kds' });

      await renderWithProviders(<TabletAppShell />, sharedFtl);

      await waitFor(() => {
        expect(screen.getByTestId('kds-screen')).toBeInTheDocument();
      });
    });
  });

  // ── Sidebar workspaces ────────────────────────────────────────

  describe('sidebar workspaces', () => {
    it('renders TabletAppLayout with the registered page for admin', async () => {
      clearPages();
      registerPage({
        route: 'pos',
        component: () => <div data-testid="page-content">Page Content</div>,
        label: 'POS Terminal',
      });
      mockWorkspaceValue({ activeWorkspace: 'admin', workspaceScreens: ['pos'] });

      await renderWithProviders(<TabletAppShell />, sharedFtl);

      await waitFor(() => {
        expect(screen.getByTestId('page-content')).toBeInTheDocument();
      });
      // The sidebar branch renders the tab bar shell (no nav items are
      // registered in this test, so zero tabs is fine).
      expect(document.querySelector('.tablet-shell .tablet-tab-bar')).not.toBeNull();
    });
  });

  // ── Permission gating ─────────────────────────────────────────

  describe('permission gating', () => {
    it('renders PermissionDenied when the current page requires a higher role', async () => {
      clearPages();
      registerPage({
        route: 'pos',
        component: () => <div data-testid="page-content">Page Content</div>,
        label: 'POS Terminal',
        requiredRole: 'owner',
      });
      mockCashierSession();
      mockWorkspaceValue({ activeWorkspace: 'admin' });

      await renderWithProviders(<TabletAppShell />, sharedFtl);

      await waitFor(() => {
        expect(screen.queryByTestId('page-content')).not.toBeInTheDocument();
      });
      // PermissionDenied falls back to its hardcoded English copy when the
      // FTL keys are absent (shared.ftl only in this test).
      expect(screen.getByText('Access Denied')).toBeInTheDocument();
    });
  });

  // ── Memo banner surface (owner ruling 2026-09-08) ──────────
  //
  // Same ruling as the desktop shell: app-wide on authenticated
  // surfaces, hidden on the login screen. The tablet has no session
  // lock screen and no customer-facing kiosk route; the sidebar
  // branch's mount lives in TabletAppLayout and is pinned here too.

  describe('memo banner surface', () => {
    beforeEach(() => {
      memoBannerKds.length = 0;
    });

    it('mounts the banner on the workspace picker', async () => {
      // beforeEach leaves activeWorkspace null with an owner session.
      await renderWithProviders(<TabletAppShell />, sharedFtl);
      await waitFor(() => {
        expect(screen.getByTestId('workspace-home')).toBeInTheDocument();
      });
      expect(screen.getByTestId('memo-banner-mount')).toBeInTheDocument();
    });

    it('mounts the banner on the restaurant-pos workspace', async () => {
      mockWorkspaceValue({ activeWorkspace: 'restaurant-pos' });
      await renderWithProviders(<TabletAppShell />, sharedFtl);
      await waitFor(() => {
        expect(screen.getByTestId('pos-screen')).toBeInTheDocument();
      });
      expect(screen.getByTestId('memo-banner-mount')).toBeInTheDocument();
    });

    it('mounts the banner on the store-pos workspace', async () => {
      mockWorkspaceValue({ activeWorkspace: 'store-pos' });
      await renderWithProviders(<TabletAppShell />, sharedFtl);
      await waitFor(() => {
        expect(screen.getByTestId('retail-pos-screen')).toBeInTheDocument();
      });
      expect(screen.getByTestId('memo-banner-mount')).toBeInTheDocument();
    });

    it('uses the doubled-cadence kds variant on the kds workspace', async () => {
      mockWorkspaceValue({ activeWorkspace: 'kds' });
      await renderWithProviders(<TabletAppShell />, sharedFtl);
      await waitFor(() => {
        expect(screen.getByTestId('kds-screen')).toBeInTheDocument();
      });
      expect(memoBannerKds.at(-1)).toBe(true);
    });

    it('mounts the banner inside the sidebar layout branch', async () => {
      mockWorkspaceValue({ activeWorkspace: 'admin', workspaceScreens: ['pos'] });
      await renderWithProviders(<TabletAppShell />, sharedFtl);
      await waitFor(() => {
        expect(screen.getByTestId('memo-banner-mount')).toBeInTheDocument();
      });
    });

    it('keeps the banner off the login screen', async () => {
      mockNoSession();
      await renderWithProviders(<TabletAppShell />, sharedFtl);
      await waitFor(() => {
        expect(screen.getByTestId('staff-login-screen')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('memo-banner-mount')).not.toBeInTheDocument();
    });
  });
});
