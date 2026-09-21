// ── T3 declared-layout render branches (ADR-0001) ────────────────────
//
// WHAT THIS FILE PINS (and what it replaces as evidence):
//   AppShell.tsx:793-818 and TabletAppShell.tsx:47-72 each define a private
//   renderPageLayout(page, layout, isLandscape) with three outcomes:
//
//     - absent / 'fluid'              → the page node itself, NO extra DOM;
//     - 'landscape-locked' + portrait → the page PLUS a
//       .page-rotate-prompt[data-layout="landscape-locked"][role=status]
//       overlay (the page stays mounted — the prompt is not a gate);
//     - 'custom'                      → the page inside a
//       .page-layout-custom[data-layout="custom"] wrapper.
//
//   Until this file, nothing RENDERED those branches. The two existing suites
//   are both textual: orientationAdaptiveWalker.test.ts greps the shells'
//   SOURCE for the marker strings and noiseDitherCompliance.test.ts checks CSS
//   SELECTORS. A marker string present in the source but never reached at
//   runtime would satisfy both. These tests drive the real components with a
//   real registry registration and a deterministically mocked useOrientation,
//   and assert the rendered DOM.
//
// WHY createElement AND NOT JSX: this file is .ts (the task's fence names that
//   exact path), and esbuild does not parse JSX in a .ts module. The
//   createElement form is the same one ui/src/__tests__/widgetRegistry.test.ts
//   already uses.
//
// HOW isLandscape IS DRIVEN: useOrientation is mocked (the shells read only
//   orientation.isLandscape from it) so the measured-viewport input is a test
//   knob rather than jsdom's matchMedia stub. The hook's own behaviour is
//   useOrientation.test.ts's contract.
//
// BOTH SHELLS ARE EXERCISED because each carries its OWN copy of the helper —
//   TabletAppShell's own comment says so deliberately ("a test can pin each
//   shell's own render tree without a shared module's behaviour moving under
//   both"). Covering one copy would leave the other's drift unobserved.

import { createElement, Fragment, type ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils/render';
import AppShell from '@/app/AppShell';
import TabletAppShell from '@/app/tablet/TabletAppShell';
import type { AuthContextValue } from '@/contexts/AuthContext';
import { clearPages, registerPage } from '@/registries/page-registry';
import { clearNavItems } from '@/registries/menu-registry';

/** JSX-free element shorthand (this file is .ts, see the header note). */
function el(
  type: unknown,
  props: Record<string, unknown> | null,
  ...children: ReactNode[]
) {
  return createElement(
    type as Parameters<typeof createElement>[0],
    props as Parameters<typeof createElement>[1],
    ...children,
  );
}

/** A stub screen: one element, no props. */
function stub(testid: string) {
  return () => el('div', { 'data-testid': testid });
}

// ── The measured orientation, as a knob ──────────────────────────────
// Hoisted: vi.mock factories are lifted above the module body, so the state
// they close over must be hoisted with them.
const harness = vi.hoisted(() => ({ isLandscape: false }));

vi.mock('@/hooks/useOrientation', () => ({
  useOrientation: () => ({
    orientation: {
      isLandscape: harness.isLandscape,
      angle: harness.isLandscape ? 90 : 0,
      viewportWidth: harness.isLandscape ? 1366 : 1024,
      viewportHeight: harness.isLandscape ? 1024 : 1366,
    },
    locking: false,
    supported: false,
    lock: vi.fn(),
    unlock: vi.fn(),
  }),
}));

// ── Lazy / flow screens: stubs, so each branch settles in one tick ────
vi.mock('@/features/setup/SetupWizard', () => ({ default: stub('setup-wizard') }));
vi.mock('@/features/auth/StaffLoginScreen', () => ({ default: stub('staff-login-screen') }));
vi.mock('@/features/auth/CreatePinScreen', () => ({ default: stub('create-pin-screen') }));
vi.mock('@/features/auth/SessionLockScreen', () => ({ default: stub('session-lock-screen') }));
vi.mock('@/features/auth/LicenseActivationScreen', () => ({ default: stub('license-activation') }));
vi.mock('@/features/workspaces/WorkspaceHome', () => ({ default: stub('workspace-home') }));
vi.mock('@/features/retail/RetailPosScreen', () => ({ default: stub('retail-pos-screen') }));
vi.mock('@/features/sales/PosScreen', () => ({ default: stub('pos-screen') }));
vi.mock('@/features/kds/KdsScreen', () => ({ default: stub('kds-screen') }));
vi.mock('@/features/settings/WorkspaceSettingsModal', () => ({ default: () => null }));
vi.mock('@/features/memo/MemoBanner', () => ({ default: stub('memo-banner-mount') }));

// ── Boot reads: a licensed, set-up install that has users ─────────────
vi.mock('@/api/license', () => ({
  getLicenseStatus: vi.fn(() =>
    Promise.resolve({ is_active: true, isActive: true, status: 'active', message: null, payload: null }),
  ),
  activateLicense: vi.fn(),
  // StatusBar's auth-pill poll: a mock missing this key takes the shell down.
  testAuthConnection: vi.fn(() => Promise.resolve({ ok: true, status: 'Connected', latencyMs: 10 })),
}));

vi.mock('@/api/settings', () => ({
  getFirstRunState: vi.fn(() => Promise.resolve({ state: 'provisioned', location_id: 'loc-1', owner_user_id: 'user-1', mode: 'local', home_region: 'global', tenant_id: null })),
  completeSetup: vi.fn(),
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

vi.mock('@/api/staff', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasUsers: vi.fn(() => Promise.resolve({ has_users: true })),
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
}));

vi.mock('@/hooks/useTerminalProfile', () => ({
  useTerminalProfile: () => ({ profile: null, loading: false, isKdsKiosk: false, error: null }),
}));

// The idle timer would lock the shell mid-test; this file never exercises it.
vi.mock('@/hooks/useIdleTimer', () => ({ useIdleTimer: (_cb: () => void) => {} }));

// ── Auth: owner, so no role/permission gate can turn the render into
//    PermissionDenied and make a layout assertion pass vacuously ────────
const mockAuthSession: Mock<() => AuthContextValue> = vi.fn();

function sessionOwner() {
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

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => mockAuthSession() }));

// ── Workspace: the 'admin' sidebar branch — the render site in BOTH shells
//    that consults the page registry and therefore reaches renderPageLayout ──
const mockWorkspace = vi.fn();

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => mockWorkspace(),
  WorkspaceProvider: ({ children }: { children: ReactNode }) =>
    el(Fragment, null, children),
}));

function workspaceAdmin(overrides: Record<string, unknown> = {}) {
  mockWorkspace.mockReturnValue({
    activeWorkspace: 'admin',
    setActiveWorkspace: vi.fn(),
    availableWorkspaces: [],
    workspaceScreens: [],
    loading: false,
    sessionToken: null,
    terminalId: null,
    sessionError: null,
    retrySessionToken: vi.fn(),
    ...overrides,
  });
}

// ── The page under test ───────────────────────────────────────────────

const PROBE_ROUTE = 'layout-probe';

type DeclaredLayout = 'fluid' | 'landscape-locked' | 'custom';

/**
 * Register the probe page. `layout` is passed only when DECLARED: the default
 * is the absence of the field (page-registry/index.ts:72-83), and under
 * exactOptionalPropertyTypes an explicit `layout: undefined` is a type error
 * anyway — which is the right encoding, because "absent" is the contract.
 */
function registerProbe(layout?: DeclaredLayout, extra: Record<string, unknown> = {}) {
  registerPage({
    route: PROBE_ROUTE,
    component: () => el('div', { 'data-testid': 'probe-page' }, 'page content'),
    label: 'Layout Probe',
    ...(layout ? { layout } : {}),
    ...extra,
  });
}

/** The marker element for a declared layout, or null. */
function marker(value: string): Element | null {
  return document.querySelector('[data-layout="' + value + '"]');
}

/** The mounted page node. */
function pageNode(): HTMLElement {
  return screen.getByTestId('probe-page');
}

/** The layout's own content container — where an unwrapped page must sit. */
const CONTENT_INNER = 'app-content-inner';

// ── Desktop shell ─────────────────────────────────────────────────────

describe('AppShell — T3 declared-layout render branches', () => {
  beforeEach(() => {
    clearPages();
    clearNavItems();
    sessionOwner();
    workspaceAdmin();
    registerProbe();
    harness.isLandscape = false;
    window.location.hash = '#/' + PROBE_ROUTE;
  });

  afterEach(() => {
    window.location.hash = '';
  });

  it('renders a page with NO declared layout as the page node itself — no marker, no wrapper', async () => {
    await renderWithProviders(el(AppShell, null));
    await waitFor(() => expect(pageNode()).toBeInTheDocument());

    expect(marker('landscape-locked')).toBeNull();
    expect(marker('custom')).toBeNull();
    expect(document.querySelector('.page-rotate-prompt')).toBeNull();
    // "No wrapper" is a DOM claim, not a marker claim: the page is a DIRECT
    // child of the shell's content container. A wrapping div — even one with
    // no data-layout — would move it down a level, which is exactly what the
    // ADR's "keeps this branch a no-op instead of a new DOM layer" forbids.
    expect(pageNode().parentElement?.className).toBe(CONTENT_INNER);
  });

  it('treats an explicit layout="fluid" exactly like the absent default', async () => {
    clearPages();
    registerProbe('fluid');

    await renderWithProviders(el(AppShell, null));
    await waitFor(() => expect(pageNode()).toBeInTheDocument());

    expect(document.querySelector('[data-layout]')).toBeNull();
    expect(document.querySelector('.page-rotate-prompt')).toBeNull();
    expect(document.querySelector('.page-layout-custom')).toBeNull();
    expect(pageNode().parentElement?.className).toBe(CONTENT_INNER);
  });

  it('renders landscape-locked in PORTRAIT as the page PLUS a role=status rotation prompt', async () => {
    clearPages();
    registerProbe('landscape-locked');
    harness.isLandscape = false;

    await renderWithProviders(el(AppShell, null));
    await waitFor(() => expect(pageNode()).toBeInTheDocument());

    const prompt = marker('landscape-locked');
    expect(prompt).not.toBeNull();
    expect(prompt?.className).toBe('page-rotate-prompt');
    expect(prompt?.getAttribute('role')).toBe('status');
    // The prompt is an overlay, never a gate: the page is still mounted and is
    // still the shell's content child — the ADR's "usable portrait fallback".
    expect(pageNode().parentElement?.className).toBe(CONTENT_INNER);
    // And the prompt is a SIBLING of the page, not an ancestor holding it
    // hostage. That inversion is the failure this test exists to catch.
    expect(prompt?.contains(pageNode())).toBe(false);
  });

  it('renders landscape-locked in LANDSCAPE with no prompt at all', async () => {
    clearPages();
    registerProbe('landscape-locked');
    harness.isLandscape = true;

    await renderWithProviders(el(AppShell, null));
    await waitFor(() => expect(pageNode()).toBeInTheDocument());

    expect(document.querySelector('[data-layout]')).toBeNull();
    expect(document.querySelector('.page-rotate-prompt')).toBeNull();
    expect(pageNode().parentElement?.className).toBe(CONTENT_INNER);
  });

  it('renders a layout="custom" page inside the data-layout="custom" wrapper', async () => {
    clearPages();
    registerProbe('custom');

    await renderWithProviders(el(AppShell, null));
    await waitFor(() => expect(pageNode()).toBeInTheDocument());

    const wrapper = marker('custom');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.className).toBe('page-layout-custom');
    expect(wrapper?.contains(pageNode())).toBe(true);
    // The wrapper is the ONLY added DOM layer, and it sits exactly where the
    // page itself would have: directly in the content container.
    expect(wrapper?.parentElement?.className).toBe(CONTENT_INNER);
    expect(document.querySelector('.page-rotate-prompt')).toBeNull();
  });

  it('applies the same contract at the FULLSCREEN render site, not only the sidebar one', async () => {
    // AppShell.tsx has TWO renderPageLayout call sites (the registry
    // fullscreen branch and the AppLayout branch). Drift at either one is a
    // behaviour difference for the same registration.
    clearPages();
    registerProbe('landscape-locked', { fullscreen: true });
    harness.isLandscape = false;

    await renderWithProviders(el(AppShell, null));
    await waitFor(() => expect(pageNode()).toBeInTheDocument());

    expect(marker('landscape-locked')).not.toBeNull();
    expect(pageNode()).toBeInTheDocument();
  });
});

// ── Tablet shell (its own copy of the helper) ─────────────────────────

describe('TabletAppShell — T3 declared-layout render branches', () => {
  /** Register the probe on 'pos' — the tablet shell's initial route. */
  function declare(layout?: DeclaredLayout) {
    registerPage({
      route: 'pos',
      component: () => el('div', { 'data-testid': 'probe-page' }, 'page content'),
      label: 'Layout Probe',
      ...(layout ? { layout } : {}),
    });
  }

  beforeEach(() => {
    clearPages();
    clearNavItems();
    sessionOwner();
    workspaceAdmin({ workspaceScreens: ['pos'] });
    declare();
    harness.isLandscape = false;
  });

  it('renders a page with NO declared layout as the page node itself — no marker, no wrapper', async () => {
    await renderWithProviders(el(TabletAppShell, null));
    await waitFor(() => expect(pageNode()).toBeInTheDocument());

    expect(document.querySelector('[data-layout]')).toBeNull();
    expect(document.querySelector('.page-rotate-prompt')).toBeNull();
    expect(pageNode().parentElement?.className).toBe(CONTENT_INNER);
  });

  it('treats an explicit layout="fluid" exactly like the absent default', async () => {
    declare('fluid');

    await renderWithProviders(el(TabletAppShell, null));
    await waitFor(() => expect(pageNode()).toBeInTheDocument());

    expect(document.querySelector('[data-layout]')).toBeNull();
    expect(document.querySelector('.page-layout-custom')).toBeNull();
    expect(pageNode().parentElement?.className).toBe(CONTENT_INNER);
  });

  it('renders landscape-locked in PORTRAIT as the page PLUS a role=status rotation prompt', async () => {
    declare('landscape-locked');
    harness.isLandscape = false;

    await renderWithProviders(el(TabletAppShell, null));
    await waitFor(() => expect(pageNode()).toBeInTheDocument());

    const prompt = marker('landscape-locked');
    expect(prompt).not.toBeNull();
    expect(prompt?.className).toBe('page-rotate-prompt');
    expect(prompt?.getAttribute('role')).toBe('status');
    expect(pageNode().parentElement?.className).toBe(CONTENT_INNER);
    expect(prompt?.contains(pageNode())).toBe(false);
  });

  it('renders landscape-locked in LANDSCAPE with no prompt at all', async () => {
    declare('landscape-locked');
    harness.isLandscape = true;

    await renderWithProviders(el(TabletAppShell, null));
    await waitFor(() => expect(pageNode()).toBeInTheDocument());

    expect(document.querySelector('[data-layout]')).toBeNull();
    expect(document.querySelector('.page-rotate-prompt')).toBeNull();
    expect(pageNode().parentElement?.className).toBe(CONTENT_INNER);
  });

  it('renders a layout="custom" page inside the data-layout="custom" wrapper', async () => {
    declare('custom');

    await renderWithProviders(el(TabletAppShell, null));
    await waitFor(() => expect(pageNode()).toBeInTheDocument());

    const wrapper = marker('custom');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.className).toBe('page-layout-custom');
    expect(wrapper?.contains(pageNode())).toBe(true);
    expect(wrapper?.parentElement?.className).toBe(CONTENT_INNER);
    expect(document.querySelector('.page-rotate-prompt')).toBeNull();
  });
});
