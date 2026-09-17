// ── KNOWN-HAZARD PIN (TABLET twin of b89bae413): pageDenied at TabletAppShell.tsx:196 is a ROLE gate only ──
//
// Same deciding functions as the desktop pin (AppShellFeatureGateRoute.test.tsx):
// isPageAccessible / getEnabledPages / getNavItems. Re-verified on this checkout:
// :196 computes the IDENTICAL expression to AppShell.tsx:473 — registration +
// !isPageAccessible(registration, userRole, userPermissions) — and the sidebar
// render at :207-217 consults only that. PageRegistration.feature is never read
// on the render path. IT RECORDS, IT DOES NOT ENDORSE; invert, never delete.
//
// HOW THE TABLET DIFFERS (measured; it shapes every case below):
//   * NO HASH ROUTING. git grep location.hash|hashchange over
//     ui/src/app/tablet/ = zero hits. currentRoute is internal state
//     (:39 default 'pos') set only by handleNavigate (:89-101 — checks ONLY
//     isPageAccessible, never feature) and by the workspace-rebind effect
//     (:50-62: admin->settings, warehouse->products). The desktop's
//     direct-hash-entry vector does not exist here; case 6 pins that inertness,
//     cases 2-4 drive the tablet's real route sources: boot default and
//     workspace rebind.
//   * THREE fullscreen branches (restaurant-pos :157, store-pos :168, kds :179)
//     render hardcoded screens without ever consulting getPage/pageDenied —
//     there NEITHER gate can fire (cases 7-9). The tablet has NO isKdsKiosk
//     branch: desktop AppShell.tsx:443 has it; this shell never imports
//     useTerminalProfile. That branch is desktop-only, not shared.
//
// NOT COVERED, AND WHY: handleNavigate's in-shell call sites — the tabs live
// inside TabletAppLayout and the real ones are feature-AND-role-filtered, so a
// disabled page has no button to click; faking one would make the mock decide
// the outcome. The fallback list at :92-96 is therefore unpinned; the CONTROL
// (case 5) proves the deciding line :196 is live. Real registrations are not
// imported (synthetic pages, same as the desktop pin). Fullscreen cases assert
// via the same lazy-screen stubs TabletAppShell.test.tsx uses: the claim is
// WHAT THE SHELL RETURNED, not the screens' internals.

import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { renderWithProviders, rerenderWithProviders } from '@/__tests__/test-utils/render';
import TabletAppShell from '@/app/tablet/TabletAppShell';
import type { AuthContextValue } from '@/contexts/AuthContext';
import staffFtl from '@/locales/staff.ftl?raw';
import {
  clearPages,
  getEnabledPages,
  getPage,
  isPageAccessible,
  registerPage,
} from '@/platform/ui/page-registry';
import { clearNavItems, getNavItems, registerNavItem } from '@/platform/ui/menu-registry';

const DISABLED_FEATURE = 'restaurant';

const mockUseFeatures = vi.fn(() => ({
  enabled: new Set<string>(),
  loading: false,
  isEnabled: (feature?: string): boolean => feature === undefined,
  loaded: true,
  filterRoutes: (routes: string[]) => routes,
  error: null,
}));
vi.mock('@/hooks/useFeatures', () => ({
  useFeatures: () => mockUseFeatures(),
  FEATURES: { KITCHEN_DISPLAY: 'kitchen-display' } as const,
}));

vi.mock('@/features/setup/SetupWizard', () => ({ default: () => <div data-testid="setup-wizard" /> }));
vi.mock('@/features/auth/StaffLoginScreen', () => ({ default: () => <div data-testid="staff-login-screen" /> }));
vi.mock('@/features/workspaces/WorkspaceHome', () => ({ default: () => <div data-testid="workspace-home" /> }));
vi.mock('@/features/retail/RetailPosScreen', () => ({ default: () => <div data-testid="retail-pos-screen" /> }));
vi.mock('@/features/sales/PosScreen', () => ({ default: () => <div data-testid="pos-screen" /> }));
vi.mock('@/features/kds/KdsScreen', () => ({ default: () => <div data-testid="kds-screen" /> }));
vi.mock('@/features/memo/MemoBanner', () => ({ default: () => <div data-testid="memo-banner-mount" /> }));
vi.mock('@/hooks/useOrientation', () => ({
  useOrientation: () => ({
    orientation: { isLandscape: true, angle: 90, viewportWidth: 1024, viewportHeight: 1366 },
    locking: false, supported: false, lock: vi.fn(), unlock: vi.fn(),
  }),
}));
vi.mock('@/api/settings', () => ({
  getSetupStatus: vi.fn(() => Promise.resolve({ completed: true, preset: null })),
  completeSetup: vi.fn(),
  dismissSetupWizard: vi.fn(),
}));

const mockAuthSession: Mock<() => AuthContextValue> = vi.fn();
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => mockAuthSession() }));

const mockWorkspace = vi.fn();
vi.mock('@/contexts/WorkspaceContext', () => ({ useWorkspace: () => mockWorkspace() }));

function workspace(active: string | null) {
  mockWorkspace.mockReturnValue({
    activeWorkspace: active,
    setActiveWorkspace: vi.fn(),
    workspaceScreens: [],
    loading: false,
    error: null,
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

function sessionCashier() {
  mockAuthSession.mockReturnValue({
    session: {
      user_id: 'u1',
      role_name: 'cashier',
      role_id: 'r1',
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

function registerDisabledPage(route: string, testid: string) {
  registerPage({
    route,
    component: () => <div data-testid={testid} />,
    label: route + ' label',
    feature: DISABLED_FEATURE,
  });
  registerNavItem({ route, label: route, feature: DISABLED_FEATURE, section: 'operations' });
}

describe('TabletAppShell — feature-disabled pages still render via every tablet route source (pinned hazard)', () => {
  beforeEach(() => {
    clearPages();
    clearNavItems();
    sessionCashier();
    workspace('inventory');
    enabledFeatures([]);
    window.location.hash = '';
  });

  // ── 1. The asymmetry lives in the deciding functions the tablet imports ──
  it('isPageAccessible ignores feature while getEnabledPages and getNavItems honour it', () => {
    registerDisabledPage('restaurant-reports', 'rr-stub');
    const page = getPage('restaurant-reports');
    expect(page?.feature).toBe(DISABLED_FEATURE);
    expect(getEnabledPages(new Set<string>(), 'cashier').map((p) => p.route))
      .not.toContain('restaurant-reports');
    expect(getNavItems(new Set<string>(), 'cashier').map((i) => i.route))
      .not.toContain('restaurant-reports');
    expect(getEnabledPages(new Set([DISABLED_FEATURE]), 'cashier').map((p) => p.route))
      .toContain('restaurant-reports');
    expect(isPageAccessible(page, 'cashier')).toBe(true);
  });

  // ── 2/3. Boot route (currentRoute = 'pos', :39) — the tablet direct-entry twin ──
  it('mounts a feature-disabled page on the boot route, though nav hides it', async () => {
    registerDisabledPage('pos', 'pos-page-stub');
    await renderWithProviders(<TabletAppShell />, staffFtl);
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByTestId('pos-page-stub')).toBeInTheDocument();
    });
    expect(screen.queryByText('Access Denied')).not.toBeInTheDocument();
    expect(getNavItems(new Set<string>(), 'cashier').map((i) => i.route))
      .not.toContain('pos');
  });

  it('renders the SAME boot page identically when its feature IS enabled', async () => {
    registerDisabledPage('pos', 'pos-page-stub');
    enabledFeatures([DISABLED_FEATURE]);
    await renderWithProviders(<TabletAppShell />, staffFtl);
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByTestId('pos-page-stub')).toBeInTheDocument();
    });
    expect(screen.queryByText('Access Denied')).not.toBeInTheDocument();
  });

  // ── 4. The workspace-rebind effect (:50-62) re-routes with NO gate of any kind ──
  it('mounts a feature-disabled settings page after a workspace rebind to admin', async () => {
    registerDisabledPage('pos', 'pos-page-stub');
    registerDisabledPage('settings', 'settings-stub');
    const result = await renderWithProviders(<TabletAppShell />, staffFtl);
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByTestId('pos-page-stub')).toBeInTheDocument();
    });
    workspace('admin'); // device rebind: effect :59 setCurrentRoute('settings')
    await act(async () => {
      rerenderWithProviders(result, <TabletAppShell />, staffFtl);
    });
    await waitFor(() => {
      expect(screen.getByTestId('settings-stub')).toBeInTheDocument();
    });
    expect(screen.queryByText('Access Denied')).not.toBeInTheDocument();
  });

  // ── 5. CONTROL: the deciding line :196 IS live — a role gate closes it ──
  it('CONTROL — the same boot path denies on a role gate, so pageDenied is not dead code', async () => {
    registerPage({
      route: 'pos',
      component: () => <div data-testid="pos-page-stub" />,
      label: 'POS',
      requiredRole: 'manager',
    });
    await renderWithProviders(<TabletAppShell />, staffFtl);
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByText('Access Denied')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('pos-page-stub')).not.toBeInTheDocument();
  });

  // ── 6. Boundary: hash entry, the desktop vector, is INERT on the tablet ──
  it('ignores location.hash entirely — the desktop direct-entry vector does not exist here', async () => {
    registerDisabledPage('pos', 'pos-page-stub');
    registerDisabledPage('restaurant-reports', 'rr-stub');
    window.location.hash = '#/restaurant-reports';
    await renderWithProviders(<TabletAppShell />, staffFtl);
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByTestId('pos-page-stub')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('rr-stub')).not.toBeInTheDocument();
  });

  // ── 7-9. Fullscreen branches: hardcoded screens, neither gate reachable ──
  it('restaurant-pos branch renders PosScreen with the feature disabled and never consults pageDenied', async () => {
    workspace('restaurant-pos');
    registerDisabledPage('pos', 'pos-page-stub');
    await renderWithProviders(<TabletAppShell />, staffFtl);
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByTestId('pos-screen')).toBeInTheDocument();
    });
    expect(screen.queryByText('Access Denied')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pos-page-stub')).not.toBeInTheDocument();
  });

  it('store-pos branch renders RetailPosScreen with the feature disabled', async () => {
    workspace('store-pos');
    registerDisabledPage('pos', 'pos-page-stub');
    await renderWithProviders(<TabletAppShell />, staffFtl);
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByTestId('retail-pos-screen')).toBeInTheDocument();
    });
    expect(screen.queryByText('Access Denied')).not.toBeInTheDocument();
  });

  it('kds branch renders KdsScreen with kitchen-display disabled — role gate cannot fire either', async () => {
    workspace('kds');
    registerPage({ route: 'kds', component: () => null, label: 'KDS', feature: 'kitchen-display', requiredRole: 'manager' });
    await renderWithProviders(<TabletAppShell />, staffFtl);
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByTestId('kds-screen')).toBeInTheDocument();
    });
    expect(screen.queryByText('Access Denied')).not.toBeInTheDocument();
  });
});
