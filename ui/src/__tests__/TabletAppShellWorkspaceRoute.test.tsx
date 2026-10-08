// ── Warehouse routing on the tablet (2026-10-04) ────────────────────────────
//
// Two defects, both measured, both fixed in the same change as this pin.
//
// 1. WRONG TARGET. The tablet's workspace map sent `warehouse` to the `products`
//    route, so the workspace rendered ProductLookupScreen instead of the
//    WarehouseConsole that ui/src/features/warehouse/register.tsx:8 registers at
//    `route: 'warehouse'`. The desktop map (AppShell.tsx:340) has always said
//    `warehouse: 'warehouse'`; the tablet was the outlier. This matters because
//    a Retail provision creates exactly three workspaces — store-pos, warehouse,
//    admin (provisioning.rs:90) — so Warehouse is one of the few a retail tablet
//    can open at all.
//
//    The other two divergences in that map are HARMLESS and are pinned as such
//    below: restaurant-pos and store-pos both have fullscreen branches
//    (TabletAppShell.tsx:517, :529) that render hardcoded screens without
//    consulting getPage, so their route target is never read.
//
// 2. NO REBIND ON MOUNT. The rebind effect (:138) is guarded by
//    `prevWorkspaceRef.current !== activeWorkspace`, and that ref is
//    INITIALISED to activeWorkspace (:137). When a workspace is already active
//    on the shell's first render — a device-bound auto-boot — prev === active,
//    the body is skipped, and nothing sets the workspace's route. The hash
//    effect (:272) then runs and, finding an empty hash, sets 'pos' regardless
//    of which workspace is active. A warehouse boot therefore landed on 'pos'.
//    The existing case in TabletAppShellFeatureGateRoute.test.tsx exercises the
//    rebind as a CHANGE (inventory -> admin), which is exactly the path that
//    works; the mount path was unpinned.
//
// Verified by reading, not by running on a device: the fix is shipped on code
// evidence alone, so these pins are the whole safety net.

import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { renderWithProviders } from '@/__tests__/test-utils/render';
import TabletAppShell from '@/app/tablet/TabletAppShell';
import type { AuthContextValue } from '@/contexts/AuthContext';
import staffFtl from '@/locales/staff.ftl?raw';
import { clearPages, registerPage } from '@/registries/page-registry';
import { clearNavItems } from '@/registries/menu-registry';

vi.mock('@/hooks/useFeatures', () => ({
  useFeatures: () => ({
    enabled: new Set<string>(),
    loading: false,
    isEnabled: (feature?: string): boolean => feature === undefined,
    loaded: true,
    filterRoutes: (routes: string[]) => routes,
    error: null,
  }),
  FEATURES: { KITCHEN_DISPLAY: 'kitchen-display' } as const,
}));

vi.mock('@/features/setup/ProvisioningFlow', () => ({ default: () => <div data-testid="provisioning-flow" /> }));
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
  getFirstRunState: vi.fn(() => Promise.resolve({ state: 'provisioned', location_id: 'loc-1', owner_user_id: 'user-1', mode: 'local', home_region: 'global', tenant_id: null })),
  provisionDevice: vi.fn(),
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

function sessionManager() {
  mockAuthSession.mockReturnValue({
    session: {
      user_id: 'u1',
      role_name: 'manager',
      role_id: 'r1',
      display_name: 'Test Manager',
      permissions: [],
    },
    loading: false,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    clearError: vi.fn(),
    swapSession: vi.fn(),
    pickerTicket: null,
    isManager: true,
    isOwner: false,
  });
}

describe('TabletAppShell — warehouse routing', () => {
  beforeEach(() => {
    clearPages();
    clearNavItems();
    sessionManager();
    workspace('inventory');
    window.location.hash = '';
  });

  // ── 1. The mount case: a workspace already active on the first render ────
  it('routes to the workspace screen when the workspace is active on mount', async () => {
    registerPage({ route: 'warehouse', component: () => <div data-testid="warehouse-console" />, label: 'Warehouse' });
    registerPage({ route: 'products', component: () => <div data-testid="product-lookup" />, label: 'Products' });
    registerPage({ route: 'pos', component: () => <div data-testid="pos-page" />, label: 'POS' });
    // No prior render, no rebind: the shell's FIRST render already has a
    // workspace, which is what a device-bound auto-boot looks like.
    workspace('warehouse');
    await renderWithProviders(<TabletAppShell />, staffFtl);
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByTestId('warehouse-console')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('product-lookup')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pos-page')).not.toBeInTheDocument();
  });

  // ── 2. The rebind case still works (regression guard for the fix) ────────
  it('still routes on a later rebind to warehouse', async () => {
    registerPage({ route: 'warehouse', component: () => <div data-testid="warehouse-console" />, label: 'Warehouse' });
    registerPage({ route: 'pos', component: () => <div data-testid="pos-page" />, label: 'POS' });
    registerPage({ route: 'products', component: () => <div data-testid="product-lookup" />, label: 'Products' });
    const { rerenderWithProviders } = await import('@/__tests__/test-utils/render');
    const result = await renderWithProviders(<TabletAppShell />, staffFtl);
    await act(async () => {});
    workspace('warehouse');
    await act(async () => { rerenderWithProviders(result, <TabletAppShell />, staffFtl); });
    await waitFor(() => {
      expect(screen.getByTestId('warehouse-console')).toBeInTheDocument();
    });
  });

  // ── 3. admin on mount — the same guard, a second workspace that has no
  //      fullscreen branch, so it is the same class of defect ──────────────
  it('routes to settings when admin is active on mount', async () => {
    registerPage({ route: 'settings', component: () => <div data-testid="settings-page" />, label: 'Settings' });
    registerPage({ route: 'pos', component: () => <div data-testid="pos-page" />, label: 'POS' });
    registerPage({ route: 'products', component: () => <div data-testid="product-lookup" />, label: 'Products' });
    workspace('admin');
    await renderWithProviders(<TabletAppShell />, staffFtl);
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByTestId('settings-page')).toBeInTheDocument();
    });
  });

  // ── 4. CONTROL: the fullscreen branches do NOT depend on the route map, so
  //      their divergence from the desktop map is harmless and must not be
  //      'fixed' into a regression ─────────────────────────────────────────
  it('CONTROL — store-pos renders RetailPosScreen regardless of the route target', async () => {
    registerPage({ route: 'pos', component: () => <div data-testid="pos-page" />, label: 'POS' });
    workspace('store-pos');
    await renderWithProviders(<TabletAppShell />, staffFtl);
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByTestId('retail-pos-screen')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('pos-page')).not.toBeInTheDocument();
  });
});

// ── The withdrawn topology route (plan §1 acceptance, item 2) ───────────────
//
// MEASURED 2026-10-07: `#/settings/topology` reached TopologyScreen, which
// threw on the tablet (the settings shell it needs is not mounted there) and
// left the FULL-PAGE error boundary up — every later section rendered the
// boundary until a reload. The screen now returns a hook-free notice before
// its content mounts (pinned in TopologyScreen.test.tsx); this is the
// shell-level half: the alias must still reach the registered page, and no
// boundary may appear on the way.

describe('TabletAppShell — the withdrawn topology route', () => {
  beforeEach(() => {
    clearPages();
    clearNavItems();
    sessionManager();
    workspace('inventory');
    window.location.hash = '';
  });

  it('routes #/settings/topology to the topology page without an error boundary', async () => {
    registerPage({
      route: 'topology',
      component: () => <div data-testid="topology-page" />,
      label: 'Topology',
    });
    window.location.hash = '#/settings/topology';
    await renderWithProviders(<TabletAppShell />, staffFtl);
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByTestId('topology-page')).toBeInTheDocument();
    });
    expect(document.querySelector('.error-boundary')).toBeNull();
  });
});
