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
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { act } from 'react';
import { renderWithProviders } from '@/__tests__/test-utils/render';
import TabletAppShell from '@/app/tablet/TabletAppShell';
import type { AuthContextValue } from '@/contexts/AuthContext';
import { registerPage, clearPages } from '@/registries/page-registry';
import { getFirstRunState, type FirstRunState } from '@/api/settings';
import { bootRetryConfig } from '@/utils/boot-retry';
import sharedFtl from '@/locales/shared.ftl?raw';

// ── Mock lazy screens (TabletAppShell lazy-imports these) ────────

vi.mock('@/features/auth/LicenseActivationScreen', () => ({
  default: ({ onActivated, initialError }: { onActivated: () => void; initialError?: string | null }) => (
    <div data-testid="license-activation-screen">
      <span>License Activation</span>
      {initialError && <span data-testid="initial-error">{initialError}</span>}
      <button type="button" onClick={onActivated}>Activate</button>
    </div>
  ),
}));

vi.mock('@/features/setup/ProvisioningFlow', () => ({
  default: () => <div data-testid="provisioning-flow">Provisioning Flow</div>,
}));

vi.mock('@/features/auth/RevokedScreen', () => ({
  default: () => <div data-testid="revoked-screen">Account suspended</div>,
}));

vi.mock('@/features/auth/StaffLoginScreen', () => ({
  default: () => <div data-testid="staff-login-screen">Login</div>,
}));

vi.mock('@/features/auth/CreatePinScreen', () => ({
  default: ({ onCreated }: { onCreated: () => void }) => (
    <div data-testid="create-pin-screen">
      <button type="button" onClick={onCreated}>created</button>
    </div>
  ),
}));

// Session lock stub — the shell lazy-loads the real screen only while locked.
// The stub exposes an unlock affordance so the round trip is assertable; the
// PIN keypad itself is SessionLockScreen.test.tsx's contract, not the shell's.
vi.mock('@/features/auth/SessionLockScreen', () => ({
  default: ({ onUnlock }: { onUnlock: () => void }) => (
    <div data-testid="session-lock-screen">
      <button type="button" onClick={onUnlock}>unlock</button>
    </div>
  ),
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

// Workspace settings stub. TabletAppShell lazy-loads the real modal and only
// on F10. The stub reports the card type it was handed so the type_key →
// WorkspaceType mapping is assertable, and it declares aria-modal like the real
// one does (WorkspaceSettingsModal.tsx:169) — that matters, because the shell's
// handler is guarded by isAnyAriaModalOpen(), so an open modal suppresses the
// shortcut. A stub without aria-modal would make a second F10 look like a
// toggle when production cannot do that.
vi.mock('@/features/settings/WorkspaceSettingsModal', () => ({
  default: (props: { open: boolean; workspaceType?: string }) =>
    props.open
      ? <div data-testid="ws-settings-modal" aria-modal="true">{props.workspaceType}</div>
      : null,
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

vi.mock('@/api/license', () => ({
  getLicenseStatus: vi.fn(() => Promise.resolve({
    isActive: true,
    status: 'valid' as const,
    tier: 'free',
    payload: null,
    message: null,
  })),
  activateLicense: vi.fn(),
}));

import { getLicenseStatus } from '@/api/license';

vi.mock('@/api/settings', () => ({
  getFirstRunState: vi.fn(() => Promise.resolve({ state: 'provisioned', location_id: 'loc-1', owner_user_id: 'user-1', mode: 'local', home_region: 'global', tenant_id: null })),
  provisionDevice: vi.fn(),
}));

// The boot gate resolves the terminal id before reading the first-run state
// (ADR #56 §2.1: the state is keyed per terminal), so the device id must answer
// or the gate never settles and every case renders the splash.
vi.mock('@/api/system', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getDeviceId: vi.fn(() => Promise.resolve('dev-1')),
}));

// Extend the real module rather than replace it: StaffLoginScreen imports
// `checkUsername` from the same path, and a bare `{ hasUsers }` mock would
// hand it undefined. Only `hasUsers` — the read the shell boot gate makes —
// is overridden; the default `true` keeps every pre-existing test (users
// exist → login screen) exactly where it was.
vi.mock('@/api/staff', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasUsers: vi.fn(() => Promise.resolve({ has_users: true })),
}));

import { hasUsers } from '@/api/staff';

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

let mockSubscriptionState = 'active';

vi.mock('@/contexts/SubscriptionContext', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useSubscription: () => ({
      caps: null,
      state: mockSubscriptionState,
      loading: false,
      refresh: vi.fn(),
    }),
  };
});

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
    vi.mocked(getLicenseStatus).mockReset();
    vi.mocked(getLicenseStatus).mockResolvedValue({
      isActive: true,
      status: 'valid',
      tier: 'free',
      payload: null,
      message: null,
    });
    vi.mocked(getFirstRunState).mockReset();
    vi.mocked(getFirstRunState).mockResolvedValue({ state: 'provisioned', location_id: 'loc-1', owner_user_id: 'user-1', mode: 'local', home_region: 'global', tenant_id: null });
    vi.mocked(hasUsers).mockReset();
    vi.mocked(hasUsers).mockResolvedValue({ has_users: true });
    mockSubscriptionState = 'active';
    // Shrink the lost-response retry window so the recovery test below
    // exercises real timeouts without waiting seconds per attempt.
    bootRetryConfig.timeoutMs = 25;
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
      // Keep the full retry window: this pin resolves the deferred promise
      // after render, and that resolution must win the attempt-1 race (a
      // shrunken window would let the timeout exhaust into the wizard branch
      // and make this test flaky).
      bootRetryConfig.timeoutMs = 5000;
      let resolveStatus!: (v: FirstRunState) => void;
      vi.mocked(getFirstRunState).mockReturnValue(
        new Promise((resolve) => { resolveStatus = resolve; }),
      );

      await renderWithProviders(<TabletAppShell />, sharedFtl);

      expect(screen.getByText(/Loading/i)).toBeInTheDocument();

      // Resolve the pending setup-status promise; the shell transitions
      // from loading to the workspace picker.
      await act(async () => {
        resolveStatus({ state: 'provisioned', location_id: 'loc-1', owner_user_id: 'user-1', mode: 'local', home_region: 'global', tenant_id: null });
      });
      await waitFor(() => {
        expect(screen.getByTestId('workspace-home')).toBeInTheDocument();
      });
    });

    it('renders the license activation screen on fresh unactivated install', async () => {
      vi.mocked(getLicenseStatus).mockResolvedValue({
        isActive: false,
        status: 'missing',
        tier: null,
        payload: null,
        message: 'No license installed',
      });
      vi.mocked(getFirstRunState).mockResolvedValue({ state: 'unprovisioned' as const });
      vi.mocked(hasUsers).mockResolvedValue({ has_users: false });
      mockNoSession();

      await renderWithProviders(<TabletAppShell />, sharedFtl);

      await waitFor(() => {
        expect(screen.getByTestId('license-activation-screen')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('provisioning-flow')).not.toBeInTheDocument();

      // Activating transitions to the provisioning flow
      fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
      await waitFor(() => {
        expect(screen.getByTestId('provisioning-flow')).toBeInTheDocument();
      });
    });

    it('bypasses license activation when device is already provisioned even if license is inactive', async () => {
      vi.mocked(getLicenseStatus).mockResolvedValue({
        isActive: false,
        status: 'expired',
        tier: null,
        payload: null,
        message: 'License expired',
      });
      vi.mocked(getFirstRunState).mockResolvedValue({ state: 'provisioned', location_id: 'loc-1', owner_user_id: 'user-1', mode: 'local', home_region: 'global', tenant_id: null });
      vi.mocked(hasUsers).mockResolvedValue({ has_users: true });

      await renderWithProviders(<TabletAppShell />, sharedFtl);

      await waitFor(() => {
        expect(screen.getByTestId('workspace-home')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('license-activation-screen')).not.toBeInTheDocument();
    });

    it('renders the setup wizard when setup is incomplete', async () => {
      vi.mocked(getFirstRunState).mockResolvedValue({ state: 'unprovisioned' as const });

      await renderWithProviders(<TabletAppShell />, sharedFtl);

      await waitFor(() => {
        expect(screen.getByTestId('provisioning-flow')).toBeInTheDocument();
      });
    });

    it('falls back to the setup wizard when getSetupStatus rejects', async () => {
      vi.mocked(getFirstRunState).mockRejectedValue(new Error('boom'));

      await renderWithProviders(<TabletAppShell />, sharedFtl);

      await waitFor(() => {
        expect(screen.getByTestId('provisioning-flow')).toBeInTheDocument();
      });
    });

    it('prefers the setup wizard over login on a fresh install (no session)', async () => {
      // The combination the suite never covered, and the one a fresh device
      // actually boots into: setup incomplete AND no session. `!session` used
      // to be tested first, so an unconfigured terminal landed on
      // StaffLoginScreen — asking staff to authenticate against a terminal
      // nobody had set up.
      vi.mocked(getFirstRunState).mockResolvedValue({ state: 'unprovisioned' as const });
      mockNoSession();

      await renderWithProviders(<TabletAppShell />, sharedFtl);

      await waitFor(() => {
        expect(screen.getByTestId('provisioning-flow')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('staff-login-screen')).not.toBeInTheDocument();
    });

    it('still prefers the setup wizard over login when getSetupStatus rejects', async () => {
      // The last cell of the boot cross-product, and the one the reorder
      // changed: a FAILED setup read (the catch pins the flag to `false`)
      // combined with no session. Before the reorder `!session` won and this
      // landed on login; now it reaches the wizard, which is the only route
      // forward on a device whose setup state is unknown. Pinned so that
      // flipping it back is a deliberate decision, not a silent cleanup.
      vi.mocked(getFirstRunState).mockRejectedValue(new Error('boom'));
      mockNoSession();

      await renderWithProviders(<TabletAppShell />, sharedFtl);

      await waitFor(() => {
        expect(screen.getByTestId('provisioning-flow')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('staff-login-screen')).not.toBeInTheDocument();
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

    it('renders owner bootstrap when there is no session and no users', async () => {
      // The first-run dead end, pinned: setup completed but zero staff
      // accounts. Before the has_users gate this landed on StaffLoginScreen,
      // which can never succeed (no user exists) and had no route to
      // bootstrap_owner — the terminal was unrecoverable without adb.
      mockNoSession();
      vi.mocked(hasUsers).mockResolvedValue({ has_users: false });

      await renderWithProviders(<TabletAppShell />, sharedFtl);

      await waitFor(() => {
        expect(screen.getByTestId('create-pin-screen')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('staff-login-screen')).not.toBeInTheDocument();
    });

    it('recovers when a boot read is answered into the void (lost IPC response)', async () => {
      // The measured fresh-install failure mode on Android: the shell's boot
      // invokes fire while the backend is still applying migrations; the Rust
      // side resolves but the response never reaches the WebView, and the
      // pending promise neither resolves nor rejects — the shell hung on the
      // splash forever. The gate must re-issue the read and recover.
      vi.mocked(getFirstRunState)
        .mockImplementationOnce(() => new Promise(() => {})) // first call: never settles
        .mockResolvedValue({ state: 'provisioned', location_id: 'loc-1', owner_user_id: 'user-1', mode: 'local', home_region: 'global', tenant_id: null });
      mockNoSession();

      await renderWithProviders(<TabletAppShell />, sharedFtl);

      // The shell must end on the login screen — not stranded on the splash.
      await waitFor(
        () => {
          expect(screen.getByTestId('staff-login-screen')).toBeInTheDocument();
        },
        { timeout: 4000 },
      );
      // And it must have got there by re-issuing the swallowed read.
      expect(vi.mocked(getFirstRunState).mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('falls through to login when the has_users read fails (unknown is not "no users")', async () => {
      // `false` is the value that opens CreatePinScreen, so a REJECTED read
      // must leave the gate's answer at unknown (null) — mirroring AppShell's
      // has_users discipline — and render the login screen, not bootstrap.
      mockNoSession();
      vi.mocked(hasUsers).mockRejectedValue(new Error('boom'));

      await renderWithProviders(<TabletAppShell />, sharedFtl);

      await waitFor(() => {
        expect(screen.getByTestId('staff-login-screen')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('create-pin-screen')).not.toBeInTheDocument();
    });

    it('replaces owner bootstrap with login after onCreated fires', async () => {
      // bootstrap_owner auto-logs-in via swapSession; the shell only has to
      // flip hasAnyUsers back to true. With a session still absent (the mock
      // does not model auto-login), the next render must be the login screen
      // — never a second bootstrap pass over a store that now has an owner.
      mockNoSession();
      vi.mocked(hasUsers).mockResolvedValue({ has_users: false });

      await renderWithProviders(<TabletAppShell />, sharedFtl);

      await waitFor(() => {
        expect(screen.getByTestId('create-pin-screen')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: /created/i }));
      await waitFor(() => {
        expect(screen.getByTestId('staff-login-screen')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('create-pin-screen')).not.toBeInTheDocument();
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

  // ── Session lock (the `app:lock` contract shared with the desktop shell) ──
  //
  // The restaurant sidebar's "Lock Terminal" item and DevToolbar both fire
  // `app:lock`; the shell is the only place that owns the lock screen. Without
  // this listener the tablet button would lock nothing.

  describe('session lock', () => {
    it('swaps the restaurant-pos screen for the lock screen on app:lock, and back on unlock', async () => {
      mockWorkspaceValue({ activeWorkspace: 'restaurant-pos' });
      await renderWithProviders(<TabletAppShell />, sharedFtl);
      await waitFor(() => {
        expect(screen.getByTestId('pos-screen')).toBeInTheDocument();
      });

      await act(async () => {
        window.dispatchEvent(new CustomEvent('app:lock'));
      });
      // Lazy-loaded screen: findBy gives the Suspense boundary a tick.
      expect(await screen.findByTestId('session-lock-screen')).toBeInTheDocument();
      // A locked terminal renders nothing else — not the workspace, and not
      // the memo banner (same ruling as the desktop shell at AppShell.tsx).
      expect(screen.queryByTestId('pos-screen')).not.toBeInTheDocument();
      expect(screen.queryByTestId('memo-banner-mount')).not.toBeInTheDocument();

      await act(async () => {
        screen.getByRole('button', { name: 'unlock' }).click();
      });
      await waitFor(() => {
        expect(screen.getByTestId('pos-screen')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('session-lock-screen')).not.toBeInTheDocument();
    });

    it('ignores app:lock with no session, rather than rendering a lock screen nobody can leave', async () => {
      mockNoSession();
      await renderWithProviders(<TabletAppShell />, sharedFtl);
      await waitFor(() => {
        expect(screen.getByTestId('staff-login-screen')).toBeInTheDocument();
      });

      await act(async () => {
        window.dispatchEvent(new CustomEvent('app:lock'));
      });
      expect(screen.queryByTestId('session-lock-screen')).not.toBeInTheDocument();
      expect(screen.getByTestId('staff-login-screen')).toBeInTheDocument();
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
  // surfaces, hidden on the login screen (and on the session lock screen —
  // see the `session lock` group above, which asserts the locked branch
  // renders the lock screen alone). The sidebar branch's mount lives in
  // TabletAppLayout and is pinned here too.

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

  // ── F10 workspace settings (parity with the desktop shell) ──────

  describe('F10 workspace settings modal', () => {
    function pressF10() {
      fireEvent.keyDown(document, { key: 'F10' });
    }

    it('opens the settings modal on F10 with the active workspace card', async () => {
      mockWorkspaceValue({ activeWorkspace: 'restaurant-pos' });
      await renderWithProviders(<TabletAppShell />, sharedFtl);
      await waitFor(() => {
        expect(screen.getByTestId('pos-screen')).toBeInTheDocument();
      });

      expect(screen.queryByTestId('ws-settings-modal')).not.toBeInTheDocument();

      pressF10();

      await waitFor(() => {
        expect(screen.getByTestId('ws-settings-modal')).toBeInTheDocument();
      });
      // The card is derived from the workspace type_key, not hardcoded — this
      // is the defect class PosScreen had before 3af8e2989.
      expect(screen.getByTestId('ws-settings-modal')).toHaveTextContent('restaurant-pos');
    });

    it('derives the card from the active workspace, so store-pos is not restaurant-pos', async () => {
      mockWorkspaceValue({ activeWorkspace: 'store-pos' });
      await renderWithProviders(<TabletAppShell />, sharedFtl);
      await waitFor(() => {
        expect(screen.getByTestId('retail-pos-screen')).toBeInTheDocument();
      });

      pressF10();

      await waitFor(() => {
        expect(screen.getByTestId('ws-settings-modal')).toHaveTextContent('store-pos');
      });
    });

    it('leaves a second F10 to the open modal rather than toggling it shut', async () => {
      // Deliberate, and matching AppShell: once open, the modal's own
      // aria-modal makes isAnyAriaModalOpen() true, so the shell stands down.
      // Closing is the modal's job (its close button / focus trap).
      mockWorkspaceValue({ activeWorkspace: 'restaurant-pos' });
      await renderWithProviders(<TabletAppShell />, sharedFtl);
      await waitFor(() => {
        expect(screen.getByTestId('pos-screen')).toBeInTheDocument();
      });

      pressF10();
      await waitFor(() => {
        expect(screen.getByTestId('ws-settings-modal')).toBeInTheDocument();
      });

      pressF10();

      expect(screen.getByTestId('ws-settings-modal')).toBeInTheDocument();
    });

    it('renders no modal for a workspace that has no settings card (admin)', async () => {
      mockWorkspaceValue({ activeWorkspace: 'admin', workspaceScreens: ['pos'] });
      await renderWithProviders(<TabletAppShell />, sharedFtl);
      await waitFor(() => {
        expect(screen.getByTestId('memo-banner-mount')).toBeInTheDocument();
      });

      pressF10();

      // admin is a reachable type_key with no WorkspaceType card. The shell
      // must render nothing rather than fall back to a wrong card.
      expect(screen.queryByTestId('ws-settings-modal')).not.toBeInTheDocument();
    });

    it('ignores F10 while an unrelated modal already owns the screen', async () => {
      mockWorkspaceValue({ activeWorkspace: 'restaurant-pos' });
      await renderWithProviders(<TabletAppShell />, sharedFtl);
      await waitFor(() => {
        expect(screen.getByTestId('pos-screen')).toBeInTheDocument();
      });

      const blocker = document.createElement('div');
      blocker.setAttribute('aria-modal', 'true');
      document.body.appendChild(blocker);
      try {
        pressF10();
        expect(screen.queryByTestId('ws-settings-modal')).not.toBeInTheDocument();
      } finally {
        blocker.remove();
      }
    });
  });

  describe('ADR #58 §2.6 — Revoked tenant gate', () => {
    it('renders RevokedScreen when subscriptionState is revoked on a provisioned tablet', async () => {
      mockSubscriptionState = 'revoked';
      await renderWithProviders(<TabletAppShell />, sharedFtl);
      await waitFor(() => {
        expect(screen.getByTestId('revoked-screen')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('staff-login-screen')).not.toBeInTheDocument();
      expect(screen.queryByTestId('pos-screen')).not.toBeInTheDocument();
    });
  });
});
