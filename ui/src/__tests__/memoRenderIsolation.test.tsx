//! Render-isolation probe (the nodeTopologyMemo pattern applied to the memo
//! surface): a memo ARRIVING — or the banner's own poll ticking — must
//! re-render only the memo banner subtree, never the host screen. All memo
//! state lives inside useMemos/MemoBanner, so the React contract says a
//! child's state change cannot re-render its parent; this probe pins that
//! contract to a test so a future "lift the state up" refactor fails loudly
//! here instead of silently re-rendering the POS on every cadence tick.

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { screen, waitFor, act } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils/render';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { HARNESS_SESSION_TOKEN } from '@/__tests__/test-utils/harnessDefaults';
import AppShell from '@/frontend/shell/AppShell';
import sharedFtl from '@/locales/shared.ftl?raw';
import staffFtl from '@/locales/staff.ftl?raw';
import type { ActiveMemo } from '@/api/memos';

// ── Memo read path ────────────────────────────────────────────────

const mockList = vi.fn();
vi.mock('@/api/memos', () => ({
  listActiveMemosScoped: (token: string) => mockList(token),
  acknowledgeMemoScoped: vi.fn(() => Promise.resolve()),
}));

// ── Render-count boundary on the host screen ──────────────────────

let posScreenRenders = 0;
vi.mock('@/features/retail/RetailPosScreen', () => ({
  default: () => {
    posScreenRenders += 1;
    return <div data-testid="retail-pos-screen">Retail POS</div>;
  },
}));

// ── Auth context: a live session so the shell reaches store-pos ───

const mockAuthSession: Mock = vi.fn();
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockAuthSession(),
}));

function mockSession() {
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
}

// ── Lazy screens AppShell imports (stubbed — not the subject) ─────

vi.mock('@/features/setup/SetupWizard', () => ({
  default: () => <div data-testid="setup-wizard">Setup Wizard</div>,
}));
vi.mock('@/features/auth/StaffLoginScreen', () => ({
  default: () => <div data-testid="staff-login-screen">Login</div>,
}));
vi.mock('@/features/workspaces/WorkspaceHome', () => ({
  default: () => <div data-testid="workspace-home">Workspace Home</div>,
}));
vi.mock('@/features/sales/PosScreen', () => ({
  default: () => <div data-testid="pos-screen">POS</div>,
}));
vi.mock('@/features/kds/KdsScreen', () => ({
  default: () => <div data-testid="kds-screen">KDS</div>,
}));

// ── Hook/API mocks AppShell needs to reach its render branches ────

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
  getSetupStatus: vi.fn(() => Promise.resolve({ completed: true })),
  completeSetup: vi.fn(),
  dismissSetupWizard: vi.fn(),
}));

vi.mock('@/api/license', () => ({
  getLicenseStatus: vi.fn(() => Promise.resolve({ is_active: true, payload: null })),
  activateLicense: vi.fn(),
  testAuthConnection: vi.fn(() =>
    Promise.resolve({ ok: true, status: 'Connected', latencyMs: 10 }),
  ),
}));

// AppShell: idle-timeout hook — a no-op here (this probe never locks).
vi.mock('@/hooks/useIdleTimer', () => ({
  useIdleTimer: () => undefined,
}));

vi.mock('@/hooks/useTerminalProfile', () => ({
  useTerminalProfile: () => ({
    profile: null,
    loading: false,
    isKdsKiosk: false,
    error: null,
  }),
}));

// ── Workspace context: the global test-setup mock stays active; the token
// must flow or useMemos bails before touching the API.

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

// ── Fixtures ──────────────────────────────────────────────────────

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

const emptyEnvelope = {
  memos: [] as ActiveMemo[],
  cadence: { baseIntervalSecs: 900, kdsIntervalSecs: 1800 },
};

const memoEnvelope = {
  memos: [memo],
  cadence: { baseIntervalSecs: 900, kdsIntervalSecs: 1800 },
};

const secondMemo: ActiveMemo = {
  memo: {
    ...memo.memo,
    id: 'm2',
    title: 'Restock aisle 4',
    body: 'Second memo body.',
  },
  deliveryStatus: 'pending',
};

beforeEach(() => {
  mockList.mockReset();
  mockList.mockResolvedValue(emptyEnvelope);
  mockSession();
  posScreenRenders = 0;
  vi.mocked(useWorkspace).mockImplementation(() =>
    workspaceValue({ activeWorkspace: 'store-pos' }),
  );
});

describe('memo render isolation (banner state never re-renders the app)', () => {
  it('a memo arriving re-renders only the banner, not the host screen', async () => {
    await renderWithProviders(<AppShell />, staffFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByTestId('retail-pos-screen')).toBeInTheDocument();
    });
    const baseline = posScreenRenders;
    expect(baseline).toBeGreaterThan(0);
    expect(screen.queryByText('Restock aisle 3')).not.toBeInTheDocument();

    // A memo publishes server-side; the dev-toolbar bridge delivers it
    // without waiting out the poll cadence (same event MemoBannerMount's
    // real shells see in dev builds).
    mockList.mockResolvedValue(memoEnvelope);
    await act(async () => {
      window.dispatchEvent(new Event('memos:refresh'));
    });

    // The banner subtree re-rendered with the memo…
    await waitFor(() => {
      expect(screen.getByText('Restock aisle 3')).toBeInTheDocument();
    });
    // …and the host screen did not render again for it.
    expect(posScreenRenders).toBe(baseline);
  });

  it('an idempotent poll (same memo list) re-renders neither the screen nor shows churn', async () => {
    mockList.mockResolvedValue(memoEnvelope);
    await renderWithProviders(<AppShell />, staffFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('Restock aisle 3')).toBeInTheDocument();
    });
    const baseline = posScreenRenders;

    // The next poll returns the SAME list; the hook replaces its state with
    // a fresh array (new identity), so the banner re-renders — but the host
    // screen must still not move.
    await act(async () => {
      window.dispatchEvent(new Event('memos:refresh'));
    });
    await waitFor(() => {
      expect(mockList).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByText('Restock aisle 3')).toBeInTheDocument();
    expect(posScreenRenders).toBe(baseline);
  });

  it('first spawn and second spawn (stacking) are both host-screen-stable', async () => {
    // The owner observed (browser + React DevTools): the FIRST memo spawn
    // appeared to re-render the page; the SECOND (stacking) did not. This
    // reproduces that exact sequence against the real shell and measures
    // each stage separately.
    await renderWithProviders(<AppShell />, staffFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByTestId('retail-pos-screen')).toBeInTheDocument();
    });
    const baseline = posScreenRenders;

    // Stage 1 — first spawn (empty stack → 1 bubble; the .memo-stack
    // container mounts for the first time).
    mockList.mockResolvedValue(memoEnvelope);
    await act(async () => {
      window.dispatchEvent(new Event('memos:refresh'));
    });
    await waitFor(() => {
      expect(screen.getByText('Restock aisle 3')).toBeInTheDocument();
    });
    const afterFirst = posScreenRenders;

    // Stage 2 — second spawn (stacks on top; container already mounted).
    mockList.mockResolvedValue({
      memos: [secondMemo, memo],
      cadence: { baseIntervalSecs: 900, kdsIntervalSecs: 1800 },
    });
    await act(async () => {
      window.dispatchEvent(new Event('memos:refresh'));
    });
    await waitFor(() => {
      expect(screen.getByText('Restock aisle 4')).toBeInTheDocument();
    });

    // BOTH stages must leave the host screen untouched.
    expect(afterFirst).toBe(baseline);
    expect(posScreenRenders).toBe(baseline);
  });
});
