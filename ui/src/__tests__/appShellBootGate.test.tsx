// ── AppShell boot gate: an unknown answer must never be written as a fact ────
//
// The desktop boot effect (ui/src/frontend/shell/AppShell.tsx) used to decide
// three things from ONE try/catch around a Promise.all, and its catch wrote
// `hasActiveLicense = true` AND `hasCompletedSetup = true`. A single transient
// IPC throw therefore suppressed the activation screen, suppressed the setup
// wizard, and — because the !session branch offers owner creation whenever
// has_users answered `false` — could hand out first-run owner bootstrap. One
// boolean meant both "we checked" and "it is so".
//
// The model now separates AVAILABILITY (`bootAllowed`) from the TRUTH CLAIM
// (`licenseState`: active | grace | inactive | unknown) and from the
// setup-complete flag, and each boot read is caught on its own.
//
// INVARIANTS THIS FILE PINS (do not relax them by "simplifying" the flags back
// into one boolean):
//   (1) a read that threw yields `unknown` and writes true into nothing;
//   (2) `bootAllowed` may be true because of a completed-setup read ONLY when
//       that specific call succeeded — the pass that keeps a paying existing
//       install from being nagged into a second owner account is preserved
//       verbatim, which is the compatibility contract of this change;
//   (3) one failing call cannot forge another call's answer;
//   (4) only an unusable/unknown licence with no other evidence blocks;
//       inactive/unknown is otherwise surfaced by the non-blocking badge.
//
// Out of scope here, unchanged by design: the `import.meta.env.DEV` bypass
// (dev-only, no IPC), and the Rust-side trust decision
// (crates/oz-bridge/src/auth.rs:611-621 is the only pre-activation gate).
//
// WHY `completed` CANNOT BE THE LICENCE FLAG: get_setup_status's `completed`
// is the SETUP-WIZARD DISMISSAL (crates/oz-bridge/src/setup.rs reads
// keys::SHOW_SETUP_WIZARD), not activation — so it is reachable on a
// never-activated install. It may still open the door (rule 2), but it may no
// longer be reported as "the licence is valid", and it is never inferred from
// a call that failed.

import { describe, expect, it, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import type { ReactNode } from 'react';
import { renderWithProviders } from '@/__tests__/test-utils/render';
import AppShell from '@/frontend/shell/AppShell';
import { clearPages } from '@/platform/ui/page-registry';
import settingsFtl from '@/locales/settings.ftl?raw';
import staffFtl from '@/locales/staff.ftl?raw';

// ── Boot IPC: per-test answers, including the ability to make a call THROW ──

const mockGetLicenseStatus: Mock<() => Promise<unknown>> = vi.fn();
const mockGetSetupStatus: Mock<() => Promise<unknown>> = vi.fn();
const mockHasUsers: Mock<() => Promise<unknown>> = vi.fn();

vi.mock('@/api/license', () => ({
  getLicenseStatus: () => mockGetLicenseStatus(),
  activateLicense: vi.fn(),
  renewLicense: vi.fn(),
  checkLicenseStatus: vi.fn(),
  getMachineId: vi.fn(),
  getHardwareFingerprint: vi.fn(),
}));

vi.mock('@/api/staff', () => ({
  hasUsers: () => mockHasUsers(),
  listStaff: vi.fn(() => Promise.resolve([])),
  getStaff: vi.fn(),
  createStaff: vi.fn(),
  updateStaff: vi.fn(),
  deleteStaff: vi.fn(),
  bootstrapOwner: vi.fn(),
}));

vi.mock('@/api/settings', () => ({
  getSetupStatus: () => mockGetSetupStatus(),
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
vi.mock('@/features/kds/KdsScreen', () => ({ default: () => <div data-testid="kds-screen" /> }));
vi.mock('@/features/retail/RetailPosScreen', () => ({ default: () => <div data-testid="retail-pos-screen" /> }));
vi.mock('@/features/sales/PosScreen', () => ({ default: () => <div data-testid="pos-screen" /> }));
vi.mock('@/features/settings/WorkspaceSettingsModal', () => ({ default: () => null }));
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

/** Licence verdicts use the camelCase LicenseStatusDto shape. */
const LICENCE_ACTIVE = { isActive: true, status: 'valid', tier: 'pro', payload: null, message: null };
const LICENCE_MISSING = { isActive: false, status: 'missing', tier: null, payload: null, message: null };
const LICENCE_EXPIRED = {
  isActive: false, status: 'expired', tier: 'pro', payload: null, message: 'License expired',
};
const LICENCE_GRACE = {
  isActive: true, status: 'gracePeriod', tier: 'pro', payload: null, message: null,
};
const SETUP_DONE = { completed: true, preset: 'store-pos' };
const SETUP_FRESH = { completed: false, preset: null };
const USERS_PRESENT = { has_users: true };
const USERS_NONE = { has_users: false };

const THROWS = () => Promise.reject(new Error('IPC unavailable'));

function authSession(signedIn: boolean) {
  mockAuth.mockReturnValue({
    session: signedIn
      ? {
        user_id: 'u1', role_name: 'owner', role_id: 'r1', display_name: 'Owner',
        permissions: ['*'],
      }
      : null,
    loading: false,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    clearError: vi.fn(),
    swapSession: vi.fn(),
    pickerTicket: null,
    isManager: false,
    isOwner: true,
  });
}

/** `activeWorkspace: null` lands the shell on its WorkspaceHome branch. */
function workspaceHome() {
  mockWorkspace.mockReturnValue({
    activeWorkspace: null,
    setActiveWorkspace: vi.fn(),
    availableWorkspaces: [],
    workspaceScreens: [],
    loading: false,
  });
}

/** Mount, drain the boot IPC, and wait for the splash to clear. */
async function boot() {
  await renderWithProviders(<AppShell />, settingsFtl, staffFtl);
  await act(async () => {});
  await waitFor(() => { expect(document.querySelector('.app-splash')).toBeNull(); });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('AppShell boot gate — unknown is not a licence', () => {
  beforeEach(() => {
    // The DEV bypass skips the boot IPC entirely; this file is about the IPC.
    vi.stubEnv('DEV', false);
    clearPages();
    window.location.hash = '';
    authSession(false);
    workspaceHome();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  // (i) ── the whole boot round-trip throws on a fresh install ───────────────
  it('every boot read throws → activation screen is reachable, nothing is marked complete', async () => {
    mockGetLicenseStatus.mockImplementation(THROWS);
    mockGetSetupStatus.mockImplementation(THROWS);
    mockHasUsers.mockImplementation(THROWS);

    await boot();

    await waitFor(() => {
      expect(screen.getByTestId('license-activation-screen')).toBeInTheDocument();
    });
    // The old catch rendered BOTH of these instead: it wrote true into the
    // licence flag AND into the setup flag, so an unactivated install skipped
    // activation, had its wizard suppressed, and went on to offer owner
    // creation. All three must be absent.
    expect(screen.queryByTestId('staff-login-screen')).not.toBeInTheDocument();
    expect(screen.queryByTestId('create-pin-screen')).not.toBeInTheDocument();
    expect(screen.queryByTestId('workspace-home')).not.toBeInTheDocument();
    expect(screen.queryByTestId('setup-wizard')).not.toBeInTheDocument();
  });

  it('setup read succeeds as fresh + licence read throws → still gated, wizard not forged', async () => {
    mockGetLicenseStatus.mockImplementation(THROWS);
    mockGetSetupStatus.mockResolvedValue(SETUP_FRESH);
    mockHasUsers.mockResolvedValue(USERS_NONE);

    await boot();

    await waitFor(() => {
      expect(screen.getByTestId('license-activation-screen')).toBeInTheDocument();
    });
  });

  // (ii) ── the historical pass, kept, but the verdict no longer lies ────────
  it('setup.completed succeeded + licence read throws → login WITH the unknown badge, licence never claimed active', async () => {
    mockGetLicenseStatus.mockImplementation(THROWS);
    mockGetSetupStatus.mockResolvedValue(SETUP_DONE);
    mockHasUsers.mockResolvedValue(USERS_PRESENT);

    await boot();

    await waitFor(() => {
      expect(screen.getByTestId('staff-login-screen')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('license-activation-screen')).not.toBeInTheDocument();
    // The badge only renders from licenseState === 'unknown'. Had the failed
    // read written 'active' (the old `setHasActiveLicense(true)`), no badge
    // would exist at all — that is the whole claim of this case.
    expect(screen.getByTestId('boot-badge-license-unknown')).toBeInTheDocument();
    expect(screen.getByTestId('boot-status-badges')).toBeInTheDocument();
    expect(screen.queryByTestId('boot-badge-license-inactive')).not.toBeInTheDocument();
  });

  it('licence read succeeded as INACTIVE + setup.completed succeeded → login + inactive badge', async () => {
    mockGetLicenseStatus.mockResolvedValue(LICENCE_EXPIRED);
    mockGetSetupStatus.mockResolvedValue(SETUP_DONE);
    mockHasUsers.mockResolvedValue(USERS_PRESENT);

    await boot();

    await waitFor(() => {
      expect(screen.getByTestId('staff-login-screen')).toBeInTheDocument();
    });
    expect(screen.getByTestId('boot-badge-license-inactive')).toBeInTheDocument();
    expect(screen.getByTestId('boot-badge-license-inactive')).toHaveTextContent('License expired');
  });

  it('licence read throws but accounts exist → boot allowed by the ANSWERED call, licence stays unknown', async () => {
    // The case the shared catch used to cover by forging two flags: the
    // settings key itself is unreadable, so `completed` is unavailable, yet
    // the install is plainly not fresh. Access is preserved — by evidence.
    mockGetLicenseStatus.mockImplementation(THROWS);
    mockGetSetupStatus.mockImplementation(THROWS);
    mockHasUsers.mockResolvedValue(USERS_PRESENT);

    await boot();

    await waitFor(() => {
      expect(screen.getByTestId('staff-login-screen')).toBeInTheDocument();
    });
    expect(screen.getByTestId('boot-badge-license-unknown')).toBeInTheDocument();
  });

  // (iv) ── has_users: unknown is not "no users" ────────────────────────────
  it('has_users REJECTS → no owner-bootstrap screen, login + users-unknown badge', async () => {
    mockGetLicenseStatus.mockResolvedValue(LICENCE_ACTIVE);
    mockGetSetupStatus.mockResolvedValue(SETUP_FRESH);
    mockHasUsers.mockImplementation(THROWS);

    await boot();

    // The rejected read used to write `false`, which is precisely the value
    // that opens first-run owner creation.
    expect(screen.queryByTestId('create-pin-screen')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('staff-login-screen')).toBeInTheDocument();
    });
    expect(screen.getByTestId('boot-badge-users-unknown')).toBeInTheDocument();
  });

  it('has_users answers "no accounts" on an activated install → bootstrap offered, no unknown badge', async () => {
    mockGetLicenseStatus.mockResolvedValue(LICENCE_ACTIVE);
    mockGetSetupStatus.mockResolvedValue(SETUP_FRESH);
    mockHasUsers.mockResolvedValue(USERS_NONE);

    await boot();

    await waitFor(() => {
      expect(screen.getByTestId('create-pin-screen')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('boot-badge-users-unknown')).not.toBeInTheDocument();
    expect(screen.queryByTestId('boot-status-badges')).not.toBeInTheDocument();
  });

  // (v) ── a fresh, never-activated install is still gated by the licence ────
  it('inactive licence + fresh setup + no accounts → activation screen, not owner creation', async () => {
    mockGetLicenseStatus.mockResolvedValue(LICENCE_MISSING);
    mockGetSetupStatus.mockResolvedValue(SETUP_FRESH);
    mockHasUsers.mockResolvedValue(USERS_NONE);

    await boot();

    await waitFor(() => {
      expect(screen.getByTestId('license-activation-screen')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('create-pin-screen')).not.toBeInTheDocument();
  });

  // (iii) ── the happy paths, unchanged ─────────────────────────────────────
  it('happy path: active licence + completed setup + session → shell, no badge', async () => {
    authSession(true);
    mockGetLicenseStatus.mockResolvedValue(LICENCE_ACTIVE);
    mockGetSetupStatus.mockResolvedValue(SETUP_DONE);
    mockHasUsers.mockResolvedValue(USERS_PRESENT);

    await boot();

    await waitFor(() => {
      expect(screen.getByTestId('workspace-home')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('boot-status-badges')).not.toBeInTheDocument();
    expect(screen.queryByTestId('license-activation-screen')).not.toBeInTheDocument();
    expect(screen.queryByTestId('setup-wizard')).not.toBeInTheDocument();
  });

  it('happy path: active licence + completed setup, nobody signed in → login, no badge', async () => {
    mockGetLicenseStatus.mockResolvedValue(LICENCE_ACTIVE);
    mockGetSetupStatus.mockResolvedValue(SETUP_DONE);
    mockHasUsers.mockResolvedValue(USERS_PRESENT);

    await boot();

    await waitFor(() => {
      expect(screen.getByTestId('staff-login-screen')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('boot-status-badges')).not.toBeInTheDocument();
  });

  it('grace period on an existing install → login, no activation screen, no blocking badge', async () => {
    mockGetLicenseStatus.mockResolvedValue(LICENCE_GRACE);
    mockGetSetupStatus.mockResolvedValue(SETUP_DONE);
    mockHasUsers.mockResolvedValue(USERS_PRESENT);

    await boot();

    await waitFor(() => {
      expect(screen.getByTestId('staff-login-screen')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('license-activation-screen')).not.toBeInTheDocument();
    expect(screen.queryByTestId('boot-status-badges')).not.toBeInTheDocument();
  });

  it('active licence + signed-in + wizard NOT completed → the setup wizard really is live', async () => {
    // Rule (2)'s counterpart: `setupKnownComplete` is a real flag, not a
    // constant the catch can write. A successful `completed: false` read must
    // still reach the wizard.
    authSession(true);
    mockGetLicenseStatus.mockResolvedValue(LICENCE_ACTIVE);
    mockGetSetupStatus.mockResolvedValue(SETUP_FRESH);
    mockHasUsers.mockResolvedValue(USERS_PRESENT);

    await boot();

    await waitFor(() => {
      expect(screen.getByTestId('setup-wizard')).toBeInTheDocument();
    });
  });
});
