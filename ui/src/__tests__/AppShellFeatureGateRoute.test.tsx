// ── KNOWN-HAZARD PIN: PageRegistration.feature is a NAV filter, not a ROUTE gate ──
//
// What this file records (current behaviour, NOT endorsed):
//
//   A page whose 'feature' is DISABLED still renders when its hash route is
//   entered directly ('#/some-route'). The nav/list path filters by feature
//   (getNavItems at menu-registry/index.ts:100, getEnabledPages at
//   page-registry/index.ts:126), but the render-decision path does not:
//   AppShell.tsx:473 computes
//       pageDenied = pageRegistration && !isPageAccessible(pageRegistration, userRole, userPermissions)
//   and isPageAccessible (page-registry/index.ts:92-104) forwards ONLY
//   requiredRole + requiredPermission to passesGate. PageRegistration.feature
//   is never read on the render path — 'enabled' from useFeatures() reaches
//   AppShell only as a prop to AppLayout (AppShell.tsx:80, :605-607), i.e. the
//   sidebar. The gap was re-verified against this checkout before writing:
//   isPageAccessible takes (registration, userRole, permissions) only.
//
// This is the feature-shaped twin of the role/permission case already pinned in
// AppShell.test.tsx ('hash-route entry is access-gated', :893-1069). That suite
// proves the ROLE gate does close the hash path; nothing here re-pins it beyond
// the one CONTROL case below, whose only job is to show this file's green is not
// the result of a dead render decision.
//
// WHY IT IS PARKED, NOT FIXED: ui/src/contexts/SubscriptionContext.tsx:86-99
// documents the ruling that operational screens must survive the administrative
// gate, so an under-strict render path is currently load-bearing for a POS that
// must keep selling. The gap's own disposition — route-gate the feature, or
// record it as accepted — awaits that same product ruling. This file waits for
// the ruling by making any change to the render decision noisy.
// IT RECORDS, IT DOES NOT ENDORSE.
//
// IF FEATURE GATING LANDS ON THE RENDER PATH, INVERT THESE TESTS, DO NOT DELETE
// THEM. A flipped expectation keeps the decision on record; a deleted one leaves
// the fix as unobserved as the hole was.
//
// COVERAGE of the four WORKSPACE fullscreen branches (line numbers re-read in
// this checkout: isKdsKiosk :443, restaurant-pos :477, store-pos :519, kds :560;
// pageDenied is computed at :473 but first consulted at :579 and again at :609):
//   * isKdsKiosk     :443  — covered below (KDS screen mounts with the
//                            'kitchen-display' feature disabled).
//   * restaurant-pos :477  — covered below.
//   * store-pos      :519  — covered below.
//   * kds            :560  — covered below.
// All four are exercised for 'the feature gate is not consulted'. They also show
// the stronger form of the gap: each renders a HARDCODED screen and never consults
// getPage(currentRoute) / pageDenied, so on those paths neither the feature gate
// NOR the role gate can fire at all.
//
// WHAT THIS FILE DOES NOT REACH:
//   * TabletAppShell.tsx:196 carries the same pageDenied expression; only the
//     desktop shell is rendered here.
//   * Real feature registrations are NOT imported — they are lazy
//     (ui/src/features/*/register.tsx; 12 of those files carry feature: on
//     registerPage, measured with
//     'grep -rl "feature:" --include=register.tsx ui/src/features | wc -l' = 12).
//     Every page below is a SYNTHETIC registration of the same shape, so real
//     registration order / route-override behaviour is not exercised.
//   * The backend that decides which features are enabled (getEnabledFeatures) is
//     mocked at the API boundary, as in AppShell.test.tsx, and the useFeatures
//     mock below is the only source of 'enabled'. That narrows the claim but not
//     its shape: the shell never reads 'enabled' on the render path, so no mock of
//     it can make the tests below pass or fail.
//   * App.tsx (which wires the real registrations and the hash router around
//     AppShell) is not mounted; the hash is driven directly, as in AppShell.test.tsx.

import { describe, expect, it, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import type { ReactNode } from 'react';
import { renderWithProviders } from '@/__tests__/test-utils/render';
import AppShell from '@/app/AppShell';
import type { AuthContextValue } from '@/contexts/AuthContext';
import staffFtl from '@/locales/staff.ftl?raw';
import {
  clearPages,
  getEnabledPages,
  getPage,
  isPageAccessible,
  registerPage,
} from '@/registries/page-registry';
import { clearNavItems, getNavItems, registerNavItem } from '@/registries/menu-registry';

// ── Feature key under test ───────────────────────────────────────────
// Synthetic on purpose (see WHAT THIS FILE DOES NOT REACH): mirrors the shape of
// ui/src/features/reports/register.tsx:45 (feature: 'restaurant') and
// ui/src/features/kds/register.tsx:9 (feature: 'kitchen-display').
const DISABLED_FEATURE = 'restaurant';
const ENABLED_FEATURE = 'simple-retail';

// ── useFeatures mock: 'enabled' is the disabled-feature knob ─────────
const mockUseFeatures = vi.fn(() => ({
  enabled: new Set<string>(),
  loading: false,
  // Signature kept identical to the one enabledFeatures() installs below, so
  // mockReturnValue() type-checks against the inferred return of this vi.fn.
  isEnabled: (feature?: string): boolean => feature === undefined,
  loaded: true,
  filterRoutes: (routes: string[]) => routes,
  error: null,
}));

vi.mock('@/hooks/useFeatures', () => ({
  useFeatures: () => mockUseFeatures(),
  FEATURES: {
    KITCHEN_DISPLAY: 'kitchen-display',
    TABLE_MANAGEMENT: 'table-management',
    USB_SCALE: 'usb-scale',
    QUICK_RETURN: 'quick-return',
    SERIAL_TRACKING: 'serial-tracking',
  } as const,
}));

// ── Mock sub-screens (only the ones AppShell can reach) ──────────────
vi.mock('@/features/kds/KdsScreen', () => ({
  default: () => <div data-testid="kds-screen">Kitchen Display System</div>,
}));

vi.mock('@/features/retail/RetailPosScreen', () => ({
  default: () => <div data-testid="retail-pos-screen" />,
}));

vi.mock('@/features/sales/PosScreen', () => ({
  default: () => <div data-testid="pos-screen" />,
}));

vi.mock('@/features/memo/MemoBanner', () => ({
  default: () => <div data-testid="memo-banner-mount" />,
}));

// ── Mock APIs so the shell reaches its post-login render path ────────
vi.mock('@/api/license', () => ({
  getLicenseStatus: vi.fn(() => Promise.resolve({ is_active: true, payload: null })),
  activateLicense: vi.fn(),
  // StatusBar's auth-pill poll (co-consumer of this module): `useAuthConnection`
  // reads this key on mount, and a mock missing it takes the shell down.
  testAuthConnection: vi.fn(() =>
    Promise.resolve({ ok: true, status: 'Connected', latencyMs: 10 }),
  ),
}));

vi.mock('@/api/settings', () => ({
  getFirstRunState: vi.fn(() => Promise.resolve({ state: 'provisioned', location_id: 'loc-1', owner_user_id: 'user-1', mode: 'local', home_region: 'global', tenant_id: null })),
  provisionDevice: vi.fn(),
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

const mockTerminalProfile = vi.fn(() => ({
  profile: null,
  loading: false,
  isKdsKiosk: false,
  error: null,
}));

vi.mock('@/hooks/useTerminalProfile', () => ({
  useTerminalProfile: () => mockTerminalProfile(),
}));

// The real idle timer would lock the shell mid-test; this file never exercises
// it, so the mock swallows the callback (AppShell.test.tsx keeps a handle to
// it because that suite tests the lock).
vi.mock('@/hooks/useIdleTimer', () => ({
  useIdleTimer: (_cb: () => void) => {},
}));

// ── Auth: cashier, and NO role/permission gate on the pages below ────
// A role that satisfies 'requiredRole: undefined' trivially, so the only gate in
// play is 'feature' — which the render path does not read.
const mockAuthSession: Mock<() => AuthContextValue> = vi.fn();

function sessionCashier() {
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

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockAuthSession(),
}));

const mockWorkspace = vi.fn();
vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => mockWorkspace(),
  WorkspaceProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function workspace(active: string | null) {
  mockWorkspace.mockReturnValue({
    activeWorkspace: active,
    setActiveWorkspace: vi.fn(),
    availableWorkspaces: [],
    workspaceScreens: [],
    loading: false,
  });
}

function enabledFeatures(features: string[]) {
  mockUseFeatures.mockReturnValue({
    enabled: new Set<string>(features),
    loading: false,
    isEnabled: (feature?: string) => feature !== undefined && features.includes(feature),
    loaded: true,
    filterRoutes: (routes: string[]) => routes,
    error: null,
  });
}

// ── Tests ────────────────────────────────────────────────────────────
describe('AppShell — feature-disabled page still renders on direct hash entry (pinned hazard)', () => {
  beforeEach(() => {
    clearPages();
    clearNavItems();
    sessionCashier();
    workspace('admin');
    enabledFeatures([]); // DISABLED_FEATURE is NOT in the enabled set
    mockTerminalProfile.mockReturnValue({
      profile: null, loading: false, isKdsKiosk: false, error: null,
    });
    window.location.hash = '';
  });

  afterEach(() => {
    window.location.hash = '';
  });

  /** Register the page whose feature is disabled: no role, no permission. */
  function registerFeatureGatedPage(overrides?: { fullscreen?: boolean }) {
    registerPage({
      route: 'restaurant-reports',
      component: () => <div data-testid="restaurant-reports-stub" />,
      label: 'Restaurant Reports',
      feature: DISABLED_FEATURE,
      ...(overrides ?? {}),
    });
    registerNavItem({
      route: 'restaurant-reports',
      label: 'Restaurant Reports',
      feature: DISABLED_FEATURE,
      section: 'reports',
    });
  }

  // ── The asymmetry, at the deciding functions ───────────────────────
  it('isPageAccessible ignores feature while getEnabledPages and getNavItems honour it', () => {
    registerFeatureGatedPage();
    const page = getPage('restaurant-reports');
    expect(page?.feature).toBe(DISABLED_FEATURE);

    // Nav/list filtering is feature-aware: an empty enabled set removes it…
    expect(getEnabledPages(new Set<string>(), 'cashier').map((p) => p.route))
      .not.toContain('restaurant-reports');
    expect(getNavItems(new Set<string>(), 'cashier').map((i) => i.route))
      .not.toContain('restaurant-reports');
    // …and it reappears when the feature is enabled, so the absence above proves
    // the feature filter is working, not that the fixture is empty.
    expect(getEnabledPages(new Set([DISABLED_FEATURE]), 'cashier').map((p) => p.route))
      .toContain('restaurant-reports');

    // The render-path predicate is the one that never looks at feature.
    expect(isPageAccessible(page, 'cashier')).toBe(true);
    expect(isPageAccessible(page, 'cashier', [])).toBe(true);
  });

  // ── Sidebar branch (AppShell.tsx:599-620) ──────────────────────────
  it('mounts a feature-disabled page entered directly by hash', async () => {
    registerFeatureGatedPage();
    window.location.hash = '#/restaurant-reports';

    await renderWithProviders(<AppShell />, staffFtl);
    await act(async () => {});

    await waitFor(() => {
      expect(screen.getByTestId('restaurant-reports-stub')).toBeInTheDocument();
    });
    expect(screen.queryByText('Access Denied')).not.toBeInTheDocument();
  });

  it('renders the disabled-feature page from a LIVE hashchange, not only on mount', async () => {
    // The actual bypass path: the cashier is legitimately on an ungated page,
    // then the hash moves to the feature-disabled route. Mount-time hash entry
    // is covered by the test above; this one covers the listener path, which
    // (AppShell.tsx:244-277) calls setCurrentRoute with no gate of any kind.
    registerFeatureGatedPage();
    registerPage({
      route: 'products',
      component: () => <div data-testid="products-stub" />,
      label: 'Products',
    });
    window.location.hash = '#/products';

    await renderWithProviders(<AppShell />, staffFtl);
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByTestId('products-stub')).toBeInTheDocument();
    });

    await act(async () => {
      window.location.hash = '#/restaurant-reports';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByTestId('restaurant-reports-stub')).toBeInTheDocument();
    });
    expect(screen.queryByText('Access Denied')).not.toBeInTheDocument();
  });

  it('renders the SAME page identically when its feature IS enabled', async () => {
    // Paired with the two disabled-feature cases above: identical assertions in
    // both states, which is what proves the render decision reads nothing but
    // role/permission. (A single test cannot show independence — only the
    // disabled case would fail if 'enabled' ever entered the path.)
    registerFeatureGatedPage();
    enabledFeatures([DISABLED_FEATURE]);
    window.location.hash = '#/restaurant-reports';

    await renderWithProviders(<AppShell />, staffFtl);
    await act(async () => {});

    await waitFor(() => {
      expect(screen.getByTestId('restaurant-reports-stub')).toBeInTheDocument();
    });
    expect(screen.queryByText('Access Denied')).not.toBeInTheDocument();
  });

  // ── Registry fullscreen branch (AppShell.tsx:578-597) ──────────────
  it('mounts a feature-disabled FULLSCREEN page on direct hash entry', async () => {
    // Shape taken from ui/src/features/kiosk/register.tsx:8
    // (feature: 'self-service-kiosk', fullscreen: true).
    registerFeatureGatedPage({ fullscreen: true });
    window.location.hash = '#/restaurant-reports';

    await renderWithProviders(<AppShell />, staffFtl);
    await act(async () => {});

    await waitFor(() => {
      expect(screen.getByTestId('restaurant-reports-stub')).toBeInTheDocument();
    });
    expect(screen.queryByText('Access Denied')).not.toBeInTheDocument();
  });

  // ── The four workspace fullscreen branches ─────────────────────────
  it('kdsKiosk branch renders the KDS screen with kitchen-display disabled', async () => {
    mockTerminalProfile.mockReturnValue({
      profile: { terminal_id: 't1', workspace_mode: 'kds-kiosk' } as never,
      loading: false,
      isKdsKiosk: true,
      error: null,
    });
    registerPage({ route: 'kds', component: () => null, label: 'KDS', feature: 'kitchen-display' });

    await renderWithProviders(<AppShell />, staffFtl);
    await act(async () => {});

    await waitFor(() => {
      expect(screen.getByTestId('kds-screen')).toBeInTheDocument();
    });
    expect(screen.queryByText('Access Denied')).not.toBeInTheDocument();
  });

  it('kds workspace branch renders the KDS screen with kitchen-display disabled', async () => {
    workspace('kds');
    registerPage({ route: 'kds', component: () => null, label: 'KDS', feature: 'kitchen-display' });
    window.location.hash = '#/kds';

    await renderWithProviders(<AppShell />, staffFtl);
    await act(async () => {});

    await waitFor(() => {
      expect(screen.getByTestId('kds-screen')).toBeInTheDocument();
    });
    expect(screen.queryByText('Access Denied')).not.toBeInTheDocument();
  });

  it('restaurant-pos branch renders PosScreen for a feature-disabled route', async () => {
    workspace('restaurant-pos');
    registerFeatureGatedPage();
    window.location.hash = '#/restaurant-reports';

    await renderWithProviders(<AppShell />, staffFtl);
    await act(async () => {});

    await waitFor(() => {
      expect(screen.getByTestId('pos-screen')).toBeInTheDocument();
    });
    expect(screen.queryByText('Access Denied')).not.toBeInTheDocument();
    expect(screen.queryByTestId('restaurant-reports-stub')).not.toBeInTheDocument();
  });

  it('store-pos branch renders RetailPosScreen for a feature-disabled route', async () => {
    workspace('store-pos');
    registerFeatureGatedPage();
    window.location.hash = '#/restaurant-reports';

    await renderWithProviders(<AppShell />, staffFtl);
    await act(async () => {});

    await waitFor(() => {
      expect(screen.getByTestId('retail-pos-screen')).toBeInTheDocument();
    });
    expect(screen.queryByText('Access Denied')).not.toBeInTheDocument();
    expect(screen.queryByTestId('restaurant-reports-stub')).not.toBeInTheDocument();
  });

  // ── Control: the green above is not a dead render decision ─────────
  it('CONTROL — the same hash path denies on a role gate, so pageDenied is live', async () => {
    registerPage({
      route: 'restaurant-reports',
      component: () => <div data-testid="restaurant-reports-stub" />,
      label: 'Restaurant Reports',
      feature: ENABLED_FEATURE,        // irrelevant to the decision either way
      requiredRole: 'manager',         // the gate that IS read
    });
    window.location.hash = '#/restaurant-reports';

    await renderWithProviders(<AppShell />, staffFtl);
    await act(async () => {});

    await waitFor(() => {
      expect(screen.getByText('Access Denied')).toBeInTheDocument();
    });
    expect(document.querySelector('.permission-denied-card')?.textContent)
      .toContain('Restaurant Reports requires a manager role.');
    expect(screen.queryByTestId('restaurant-reports-stub')).not.toBeInTheDocument();
  });
});

