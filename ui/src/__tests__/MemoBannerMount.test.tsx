//! Integration test: MemoBanner is mounted on the spec'd memo surfaces and is
//! actually REACHABLE through the real shells.
//!
//! Phase 2 journal (round 17) caught the earlier version of this file rendering
//! `TabletAppLayout` directly — bypassing `TabletAppShell`, which early-returns
//! before the layout on every surface the spec names. A mount test has to
//! render the shell and drive it into each surface; otherwise it certifies the
//! wiring of a component that ships invisible.
//!
//! Surfaces covered here (session exists on all of them, so the session-scoped
//! `list_active_memos_scoped` answers):
//!   • tablet KDS workspace (TabletAppShell kds branch)
//!   • desktop KDS kiosk lockdown (AppShell isKdsKiosk branch)
//!   • desktop standalone KDS workspace (AppShell kds branch)
//! The session lock screen is covered as a NEGATIVE test: owner ruling
//! 2026-09-08 (`c7294c28`) — the banner is app-wide EXCEPT the login and
//! lock screens, because a locked terminal must not display ops memos to
//! anyone standing at it. Locking must REMOVE the retail-pos banner.
//!
//! The staff-login surface is intentionally absent: `list_active_memos_scoped`
//! derives the terminal identity from the session, so it cannot answer before
//! login. That gap needs the owner's security ruling recorded in
//! `todo-global-saas-2.md` — it is not fixable by mounting alone.
//!
//! Token discipline (the probe's lesson): each test asserts the read fired
//! with the harness session token through the real WorkspaceContext mock, so a
//! rendered banner proves the context actually carried a token — not just
//! that a component appeared.

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { screen, waitFor, act } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils/render';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { HARNESS_SESSION_TOKEN } from '@/__tests__/test-utils/harnessDefaults';
import AppShell from '@/app/AppShell';
import TabletAppShell from '@/app/tablet/TabletAppShell';
import sharedFtl from '@/locales/shared.ftl?raw';
import staffFtl from '@/locales/staff.ftl?raw';
import type { ActiveMemo } from '@/api/memos';

// ── Memo read path (the surface under test) ──────────────────────

const mockList = vi.fn();
vi.mock('@/api/memos', () => ({
  listActiveMemosScoped: (token: string) => mockList(token),
  acknowledgeMemoScoped: vi.fn(() => Promise.resolve()),
}));

// ── Auth context: both shells gate on a session (dynamic per test) ──

const mockAuthSession: Mock = vi.fn();
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockAuthSession(),
}));

function mockSession(roleName = 'cashier') {
  mockAuthSession.mockReturnValue({
    session: {
      user_id: 'user-1',
      role_name: roleName,
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
}

// ── Lazy screens both shells import (stubbed — not the test subject) ──

vi.mock('@/features/setup/ProvisioningFlow', () => ({
  default: () => <div data-testid="provisioning-flow">Provisioning Flow</div>,
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

// ── Hook/API mocks AppShell needs to reach its render branches ──

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

vi.mock('@/api/settings', () => ({
  getFirstRunState: vi.fn(() => Promise.resolve({ state: 'provisioned', location_id: 'loc-1', owner_user_id: 'user-1', mode: 'local', home_region: 'global', tenant_id: null })),
  completeSetup: vi.fn(),
  provisionDevice: vi.fn(),
}));

vi.mock('@/api/license', () => ({
  getLicenseStatus: vi.fn(() => Promise.resolve({ is_active: true, payload: null })),
  activateLicense: vi.fn(),
  // SessionLockScreen's StatusBar connection check (co-consumer of the module).
  testAuthConnection: vi.fn(() =>
    Promise.resolve({ ok: true, status: 'Connected', latencyMs: 10 }),
  ),
}));

// AppShell: idle-timeout capture — firing the callback forces the lock screen.
let idleCallback: (() => void) | null = null;
vi.mock('@/hooks/useIdleTimer', () => ({
  useIdleTimer: (cb: () => void) => {
    idleCallback = cb;
  },
}));

// AppShell: terminal profile gate — `isKdsKiosk` selects the kiosk branch.
const mockTerminalProfile: Mock = vi.fn(() => ({
  profile: null as { terminalId: string; profileType: string } | null,
  loading: false,
  isKdsKiosk: false,
  error: null as string | null,
}));
vi.mock('@/hooks/useTerminalProfile', () => ({
  useTerminalProfile: () => mockTerminalProfile(),
}));

// Tablet shell: orientation lock is a side effect only.
vi.mock('@/hooks/useOrientation', () => ({
  useOrientation: () => ({
    orientation: { isLandscape: true, angle: 90, viewportWidth: 1024, viewportHeight: 1366 },
    locking: false,
    supported: false,
    lock: vi.fn(),
    unlock: vi.fn(),
  }),
}));

// ── Workspace context: the global test-setup mock stays active, so the
// session token flows through the real context. Per-test overrides always
// include the token — omitting it is the exact bug the probe hit (useMemos
// bails on a falsy token before touching the API, making every reading 0).
vi.mocked(useWorkspace).mockImplementation(() => workspaceValue());

function workspaceValue(overrides: Record<string, unknown> = {}) {
  return {
    activeWorkspace: null,
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
    sessionToken: HARNESS_SESSION_TOKEN,
    swapSessionToken: vi.fn(() => Promise.resolve()),
    terminalId: 'test-terminal',
    ...overrides,
  };
}

// ── Fixture: a Location Memo (badge + labels come from the real shared.ftl) ──

const memo: ActiveMemo = {
  memo: {
    id: 'm1',
    tenantId: 'default',
    locationIds: ['loc-1'],
    authorUserId: 'user-1',
    authorRole: 'role-manager',
    title: 'Restock aisle 3',
    body: 'Refill the front shelf before doors open.',
    status: 'published',
    duration: '12h',
    revision: 1,
    publishedAt: '2026-09-08T10:00:00.000Z',
    expiresAt: '2026-09-08T22:00:00.000Z',
    createdAt: '2026-09-08T10:00:00.000Z',
  },
  deliveryStatus: 'pending',
};

/** Response envelope of the real `list_active_memos_scoped` command:
 *  memos plus the server-issued cadence (`MemoDisplayDto`). */
const envelope = {
  memos: [memo],
  cadence: { baseIntervalSecs: 900, kdsIntervalSecs: 1800 },
};

beforeEach(() => {
  mockList.mockReset();
  // Seed BEFORE render: the shell mounts the banner synchronously and the
  // hook fires on mount — an unseeded mock returns undefined, which would
  // crash useMemos' re-render (setMemos(undefined)) and mask the assertion.
  mockList.mockResolvedValue(envelope);
  mockTerminalProfile.mockReturnValue({
    profile: null,
    loading: false,
    isKdsKiosk: false,
    error: null,
  });
  idleCallback = null;
  mockSession();
  vi.mocked(useWorkspace).mockImplementation(() => workspaceValue());
});

// ── Assertions shared by every surface ───────────────────────

async function expectBannerOnSurface(surfaceProbe: () => HTMLElement) {
  await waitFor(() => {
    // The read must have fired through the real WorkspaceContext with the
    // harness token — a rendered banner without this call would mean the
    // content came from somewhere other than the spec'd read path.
    expect(mockList).toHaveBeenCalledWith(HARNESS_SESSION_TOKEN);
  });
  await waitFor(() => {
    expect(surfaceProbe()).toBeInTheDocument();
  });
  expect(screen.getByText('Restock aisle 3')).toBeInTheDocument();
  // The scope badge was dropped (owner direction, 2026-09-08); the bubble
  // now exposes the memo through the open trigger + the (x) ack. The app's
  // bundles run with useIsolating: false, so no directional marks surround
  // the substituted title.
  expect(screen.getByTestId('memo-banner-open')).toHaveAttribute(
    'aria-label',
    'Read the full memo: Restock aisle 3',
  );
  expect(
    screen.getByRole('button', { name: 'Acknowledge this memo' }),
  ).toBeInTheDocument();
}

describe('MemoBanner — mounted on the spec surfaces through the real shells', () => {
  it('tablet: mounts on the KDS workspace', async () => {
    vi.mocked(useWorkspace).mockImplementation(() =>
      workspaceValue({ activeWorkspace: 'kds' }),
    );
    await renderWithProviders(<TabletAppShell />, sharedFtl);

    await expectBannerOnSurface(() => screen.getByTestId('kds-screen'));
  });

  it('desktop: the session lock screen shows NO memos (owner ruling)', async () => {
    // Owner ruling 2026-09-08 (c7294c28): the banner is app-wide EXCEPT the
    // login and lock screens. The store-pos surface itself carries the
    // banner (base interval); driving the shell into the lock must remove
    // it — a locked terminal never advertises ops memos to walk-ups.
    vi.mocked(useWorkspace).mockImplementation(() =>
      workspaceValue({ activeWorkspace: 'store-pos' }),
    );
    await renderWithProviders(<AppShell />, staffFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByTestId('retail-pos-screen')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('Restock aisle 3')).toBeInTheDocument();
    });

    // Force the idle timeout → AppShell returns the lock screen branch.
    await act(async () => {
      idleCallback?.();
    });

    expect(screen.getByTestId('session-lock-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('memo-stack')).not.toBeInTheDocument();
    expect(screen.queryByText('Restock aisle 3')).not.toBeInTheDocument();
  });

  it('desktop: mounts on the KDS kiosk lockdown', async () => {
    mockTerminalProfile.mockReturnValue({
      profile: { terminalId: 't1', profileType: 'kds_kiosk' },
      loading: false,
      isKdsKiosk: true,
      error: null,
    });
    await renderWithProviders(<AppShell />, staffFtl, sharedFtl);

    await expectBannerOnSurface(() => screen.getByTestId('kds-screen'));
  });

  it('desktop: mounts on the standalone KDS workspace', async () => {
    vi.mocked(useWorkspace).mockImplementation(() =>
      workspaceValue({ activeWorkspace: 'kds' }),
    );
    await renderWithProviders(<AppShell />, staffFtl, sharedFtl);

    await expectBannerOnSurface(() => screen.getByTestId('kds-screen'));
  });
});
