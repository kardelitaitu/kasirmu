// ── AppShell DEV-branch boot read: a swallowed failure is not an answer ──────
//
// Every boot IPC on the production path goes through `settle()`
// (ui/src/app/AppShell.tsx:87-94), whose whole job is to record
// answered-or-unknown: it logs `[boot] <label> read failed — recording unknown`
// and returns `{ ok: false }`, so the caller writes true/false into NOTHING.
// The dev-mode bypass (:193-206) skips the licence and setup calls but still
// asks `has_users` — first-run owner bootstrap is reachable in dev — and that
// one call was written `hasUsers().then(...).catch(() => {})`: an EMPTY catch.
//
// Why the empty catch matters even though `hasAnyUsers` is `boolean | null`
// with null = UNKNOWN: an unregistered command (the tablet shell registers
// fewer commands than desktop) rejects, and the swallow leaves that failure with
// no trace anywhere. An operator debugging a boot screen then has exactly one
// signal for two different worlds: "the call is still in flight" and "the call
// can never answer on this build". The failure must be written down, not kept as
// an absence. This file pins that the dev read is held to the same rule as its
// siblings: the throw is recorded, and what is presented is UNKNOWN — never the
// positive assertion "this store has no users", which is the value that opens
// CreatePinScreen (:511).
//
// Out of scope by the same reasoning that keeps `appShellBootGate.test.tsx`
// honest: the rest of the dev bypass (setup-complete / licence-active /
// bootAllowed) is a stated dev decision with no IPC behind it, so those writes
// are not forged reads and are left exactly as they are.

import { describe, expect, it, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import type { ReactNode } from 'react';
import { renderWithProviders } from '@/__tests__/test-utils/render';
import AppShell from '@/app/AppShell';
import { clearPages } from '@/platform/ui/page-registry';
import settingsFtl from '@/locales/settings.ftl?raw';
import staffFtl from '@/locales/staff.ftl?raw';

// ── Boot IPC: per-test answers, including the ability to make a call THROW ──

const mockHasUsers: Mock<() => Promise<unknown>> = vi.fn();

vi.mock('@/api/staff', () => ({
  hasUsers: () => mockHasUsers(),
}));

// Unused on this path (the DEV bypass makes no licence/setup call) but mocked so
// that an accidental new boot call cannot escape into the real Tauri invoke.
vi.mock('@/api/license', () => ({
  getLicenseStatus: vi.fn(() => Promise.resolve({ isActive: true, status: 'valid', tier: 'pro', payload: null, message: null })),
  activateLicense: vi.fn(),
  renewLicense: vi.fn(),
  checkLicenseStatus: vi.fn(),
  getMachineId: vi.fn(),
  getHardwareFingerprint: vi.fn(),
}));

vi.mock('@/api/settings', () => ({
  getSetupStatus: vi.fn(() => Promise.resolve({ completed: true, preset: 'store-pos' })),
  completeSetup: vi.fn(() => Promise.resolve()),
  dismissSetupWizard: vi.fn(() => Promise.resolve()),
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

// ── Screens: stubs, so each test asserts WHICH gate the shell landed on ─────

vi.mock('@/features/auth/LicenseActivationScreen', () => ({
  default: () => <div data-testid="license-activation-screen" />,
}));
vi.mock('@/features/auth/CreatePinScreen', () => ({
  default: () => <div data-testid="create-pin-screen" />,
}));
vi.mock('@/features/auth/StaffLoginScreen', () => ({
  default: () => <div data-testid="staff-login-screen" />,
}));
vi.mock('@/features/setup/SetupWizard', () => ({
  default: () => <div data-testid="setup-wizard" />,
}));
vi.mock('@/features/workspaces/WorkspaceHome', () => ({
  default: () => <div data-testid="workspace-home" />,
}));
vi.mock('@/features/memo/MemoBanner', () => ({ default: () => <div data-testid="memo-banner" /> }));

// ── Hooks / contexts the shell reads before it can decide ──────────────────

const mockAuth: Mock<() => unknown> = vi.fn();
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => mockAuth() }));

const mockWorkspace: Mock<() => unknown> = vi.fn();
vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => mockWorkspace(),
  WorkspaceProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks/useFeatures', () => ({
  useFeatures: () => ({
    enabled: new Set<string>(),
    loading: false,
    isEnabled: () => true,
    loaded: true,
    filterRoutes: (routes: string[]) => routes,
    error: null,
  }),
  FEATURES: {
    KITCHEN_DISPLAY: 'kitchen-display',
    TABLE_MANAGEMENT: 'table-management',
    USB_SCALE: 'usb-scale',
    QUICK_RETURN: 'quick-return',
    SERIAL_TRACKING: 'serial-tracking',
  } as const,
}));

vi.mock('@/hooks/useTerminalProfile', () => ({
  useTerminalProfile: () => ({ profile: null, loading: false, isKdsKiosk: false, error: null }),
}));

// The real idle timer would lock the shell mid-test.
vi.mock('@/hooks/useIdleTimer', () => ({ useIdleTimer: (_cb: () => void) => {} }));

// ── Fixtures ───────────────────────────────────────────────────────────────

/** Nobody signed in: the shell must decide between bootstrap and login. */
function authNoSession() {
  mockAuth.mockReturnValue({
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

function workspaceHome() {
  mockWorkspace.mockReturnValue({
    activeWorkspace: null,
    setActiveWorkspace: vi.fn(),
    availableWorkspaces: [],
    workspaceScreens: [],
    loading: false,
  });
}

/** Mount the shell on its DEV bypass and wait for the splash to clear. */
async function boot() {
  await renderWithProviders(<AppShell />, settingsFtl, staffFtl);
  await act(async () => {});
  await waitFor(() => { expect(document.querySelector('.app-splash')).toBeNull(); });
}

/** True when some console.error line names the failed read (the settle record). */
function loggedFailureMentioning(name: string): boolean {
  return vi.mocked(console.error).mock.calls.some(
    (call: unknown[]) => call.some((arg: unknown) => typeof arg === 'string' && arg.includes(name)),
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('AppShell DEV-branch boot read — a failed has_users must be recorded', () => {
  let errorSpy: Mock;

  beforeEach(() => {
    // The branch under test is the dev bypass; DEV=false lands the production
    // Promise.all path, which appShellBootGate.test.tsx already pins.
    vi.stubEnv('DEV', true);
    clearPages();
    window.location.hash = '';
    authNoSession();
    workspaceHome();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    errorSpy.mockRestore();
  });

  it('has_users REJECTS on the dev path -> the failure is logged, not swallowed', async () => {
    // What an unregistered command looks like from the frontend.
    mockHasUsers.mockImplementation(() => Promise.reject(new Error('command has_users not found')));

    await boot();

    // THE CLAIM UNDER TEST: the throw must leave a record naming the read, the
    // way every sibling boot read does. `.catch(() => {})` produced no output
    // here, which is what made an unavailable capability indistinguishable from
    // a read still in flight.
    expect(loggedFailureMentioning('has_users')).toBe(true);
  });

  it('has_users REJECTS on the dev path -> UNKNOWN is presented, never "no users"', async () => {
    mockHasUsers.mockImplementation(() => Promise.reject(new Error('command has_users not found')));

    await boot();

    // `false` is the value that opens first-run owner bootstrap; a call that
    // could not answer must never be reported as that positive assertion.
    expect(screen.queryByTestId('create-pin-screen')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('staff-login-screen')).toBeInTheDocument();
    });
    // The file's existing degraded-state surface for this fact.
    expect(screen.getByTestId('boot-badge-users-unknown')).toBeInTheDocument();
  });

  it('has_users ANSWERS "no accounts" on the dev path -> bootstrap offered, nothing logged', async () => {
    // The counterpart that keeps the first case honest: a real `false` still
    // opens CreatePinScreen, and only a FAILURE is logged. Without this,
    // "log on has_users" could be satisfied by logging on every answer.
    mockHasUsers.mockResolvedValue({ has_users: false });

    await boot();

    await waitFor(() => {
      expect(screen.getByTestId('create-pin-screen')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('boot-badge-users-unknown')).not.toBeInTheDocument();
    expect(loggedFailureMentioning('has_users')).toBe(false);
  });
});
