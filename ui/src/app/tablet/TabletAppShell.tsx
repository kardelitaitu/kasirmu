import { useState, useEffect, useCallback, useRef, lazy, type ReactNode } from 'react';
import { Localized } from '@fluent/react';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import TabletAppLayout from './TabletAppLayout';
import { readBootGate } from '@/utils/boot-retry';
import { useFeatures } from '@/hooks/useFeatures';
import { getPage, isPageAccessible, type PageRegistration } from '@/registries/page-registry';
import PermissionDenied from '@/components/PermissionDenied';
import { LazyBoundary } from '@/components/LazyBoundary';
import { AppBootSplash } from '@/components/AppBootSplash';
import MemoBanner from '@/features/memo/MemoBanner';
import { isAnyAriaModalOpen, consumeShortcut } from '@/utils/modal-guard';
import { useOrientation } from '@/hooks/useOrientation';
import { toWorkspaceType, type WorkspaceType } from '@/features/settings/workspaceType';

// ── PERF-01: workspace/flow screens load on demand ────────────────
const ProvisioningFlow = lazy(() => import('@/features/setup/ProvisioningFlow'));
const StaffLoginScreen = lazy(() => import('@/features/auth/StaffLoginScreen'));
const CreatePinScreen = lazy(() => import('@/features/auth/CreatePinScreen'));
const SessionLockScreen = lazy(() => import('@/features/auth/SessionLockScreen'));
const WorkspaceHome = lazy(() => import('@/features/workspaces/WorkspaceHome'));
const RetailPosScreen = lazy(() => import('@/features/retail/RetailPosScreen'));
const PosScreen = lazy(() => import('@/features/sales/PosScreen'));
const KdsScreen = lazy(() => import('@/features/kds/KdsScreen'));
const WorkspaceSettingsModal = lazy(() => import('@/features/settings/WorkspaceSettingsModal'));

/**
 * Apply a page's registry-declared `layout` to the rendered page (ADR-0001 Slice
 * 1). Deliberately a second copy of the desktop shell's helper rather than an
 * import: it is the consumer the ADR's T4 check looks for, and a test can pin
 * each shell's own render tree without a shared module's behaviour moving under
 * both. Keep the two in step when the contract changes.
 *
 * - absent / 'fluid' — the page adapts to the space it is given; the page node
 *   itself is returned, so this branch adds no DOM.
 * - 'landscape-locked' — render the page plus a rotation prompt while the
 *   MEASURED viewport is portrait, as an overlay only. There is no lock to
 *   request (see the shell comment above): the page stays mounted and usable in
 *   either orientation, which is the usable portrait fallback the contract asks
 *   for.
 * - 'custom' — the page owns its layout; wrap it in the `data-layout="custom"`
 *   marker CSS keys off instead of reaching into the page's contract.
 */
function renderPageLayout(
  page: ReactNode,
  layout: PageRegistration['layout'],
  isLandscape: boolean,
): ReactNode {
  if (layout === 'landscape-locked' && !isLandscape) {
    return (
      <>
        {page}
        <div className="page-rotate-prompt" data-layout="landscape-locked" role="status">
          <Localized id="layout-rotate-to-landscape">
            <p>Rotate your device to landscape for the full layout.</p>
          </Localized>
        </div>
      </>
    );
  }
  if (layout === 'custom') {
    return (
      <div className="page-layout-custom" data-layout="custom">
        {page}
      </div>
    );
  }
  return page;
}

/**
 * Tablet-optimised application shell.
 *
 * ADR #4 Phase 3b: Uses WorkspaceContext for device-bound auto-boot
 * and dynamic tab bar from workspace_type_screens. Falls back to
 * workspace picker when no instance is selected.
 */
export default function TabletAppShell() {
  // Orientation is handled in CSS, not here.
  //
  // This shell used to call `useOrientation('landscape-primary')` to "lock to
  // landscape on tablet devices". That request cannot be enforced in the
  // Android WebView — `screen.orientation.lock` is absent, so the hook reports
  // `supported: false` and the call is a silent no-op. Measured 2026-09-20: the
  // same installed build rendered at 1200x1920 (portrait) and then 1920x1200
  // (landscape), so the app rotates freely. The request was never a guarantee,
  // and believing it is exactly why neither `tablet.css` nor `SetupWizard.css`
  // contained a single orientation rule.
  //
  // Layout now branches on `@media (orientation: landscape)` in those sheets,
  // so a rotation re-lays-out without a React re-render. `useOrientation`
  // remains the mechanism for a STRUCTURAL orientation need — choosing a
  // different component tree, or a column count CSS cannot express — and this
  // shell still calls it only to READ `orientation.isLandscape` for a page's
  // declared `layout` (ADR-0001 Slice 1) — a structural need the registry makes
  // reviewable data. It still never requests a lock. If a descendant develops a
  // structural need of its own, call the hook there; do not re-add a lock.
  //
  // If the product decision is landscape-ONLY, the enforceable mechanism is the
  // Android manifest (`android:screenOrientation="sensorLandscape"` on
  // `.MainActivity`), not the Web API.

  // The page-declared layout (ADR-0001 Slice 1) is read from the registry at the
  // render site below; this is the measured viewport it is judged against, called
  // unconditionally because hooks may not sit behind the early returns.
  const { orientation } = useOrientation();

  const [loading, setLoading] = useState(true);
  const [hasCompletedSetup, setHasCompletedSetup] = useState(false);
  // null = UNKNOWN. Mirrors AppShell's hasAnyUsers: `false` is the value that
  // opens CreatePinScreen, so a failed/absent has_users read must stay null
  // and fall through to staff login — an unavailable capability is never
  // reported as the positive assertion "this store has no users".
  const [hasAnyUsers, setHasAnyUsers] = useState<boolean | null>(null);
  const [currentRoute, setCurrentRoute] = useState('pos');
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const { enabled, loaded: featuresLoaded } = useFeatures();
  const { session } = useAuth();
  // ADR #4 Phase 3b: use WorkspaceContext for device-bound auto-boot.
  const {
    activeWorkspace,
    workspaceScreens,
    terminalId,
  } = useWorkspace();

  // Navigate to workspace-appropriate route on selection.
  const prevWorkspaceRef = useRef(activeWorkspace);
  useEffect(() => {
    if (prevWorkspaceRef.current !== undefined && prevWorkspaceRef.current !== activeWorkspace) {
      const workspaceRoute: Record<string, string> = {
        'restaurant-pos': 'pos',
        'store-pos': 'pos',
        kds: 'kds',
        warehouse: 'products',
        admin: 'settings',
      };
      setCurrentRoute(workspaceRoute[activeWorkspace ?? ''] ?? 'pos');
    }
    prevWorkspaceRef.current = activeWorkspace;
  }, [activeWorkspace]);

  // ── F10 opens the WorkspaceSettingsModal — parity with the desktop shell ──
  // Mirrors AppShell.tsx:~377. Without this the tablet had no keyboard route
  // into workspace settings at all: RetailFnBar prints an "F10 / Options"
  // hint, but RetailPosScreen deliberately does not handle the key itself
  // (RetailPosScreen.tsx:1378) because the desktop shell owns it — and no
  // shell owned it here. Guarded by isAnyAriaModalOpen so the shortcut cannot
  // stack a second modal on top of one that is already open.
  useEffect(() => {
    if (!activeWorkspace) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F10') {
        e.preventDefault();
        if (!isAnyAriaModalOpen()) {
          consumeShortcut(e);
          setSettingsModalOpen((p) => !p);
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [activeWorkspace]);

  // On mount, check if setup was already completed and whether any staff
  // account exists. readBootGate runs the two reads in parallel with
  // independent verdicts — one read's failure cannot forge the other's.
  // Both reads are wrapped in the lost-response retry (boot-retry.ts): on
  // Android, invokes issued while the backend is still initialising can be
  // answered into the void (Rust resolves; the response never reaches the
  // WebView), and without re-issuing the gate hung on the splash forever on
  // a fresh install. Measured 2026-09-20 on a pm-clear'd tablet.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [setupRes, usersRes] = await readBootGate();
      if (cancelled) return;
      // A failed first-run read pins to `false` (the provisioning flow) — pinned
      // by TabletAppShell.test.tsx as the safer failure direction: on a device
      // whose provisioning state is unknown, the flow is the only route forward.
      // ADR #56 §2.1: the row replaces the `setup.completed` boolean, so there is
      // no flag a failed read could forge in the other direction either.
      setHasCompletedSetup(setupRes.ok ? setupRes.value.state === 'provisioned' : false);
      // Same unknown-is-not-no-users discipline as AppShell: a failed read
      // leaves hasAnyUsers at null, which falls through to staff login.
      // Only an answered `false` opens the owner bootstrap screen.
      setHasAnyUsers(usersRes.ok ? usersRes.value.has_users : null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const userRole = session?.role_name ?? '';
  const userPermissions = session?.permissions;

  // ── Shared settings modal, built once and dropped into every branch ──
  // Same shape as AppShell: the card comes from the active workspace, and a
  // type_key with no card (admin, inventory) renders nothing rather than
  // defaulting to the wrong one.
  const workspaceType: WorkspaceType | null = toWorkspaceType(activeWorkspace);
  const settingsModal = settingsModalOpen && workspaceType ? (
    <LazyBoundary>
      <WorkspaceSettingsModal
        open={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
        workspaceType={workspaceType}
        terminalId={terminalId}
      />
    </LazyBoundary>
  ) : null;

  const handleNavigate = useCallback((route: string) => {
    const target = getPage(route);
    if (target && !isPageAccessible(target, userRole, userPermissions)) {
      const accessiblePages = ['pos', 'products', 'sales-history', 'sales-dashboard'];
      const fallback = accessiblePages.find((r) => {
        const p = getPage(r);
        return p && isPageAccessible(p, userRole, userPermissions);
      }) ?? 'products';
      setCurrentRoute(fallback);
      return;
    }
    setCurrentRoute(route);
  }, [userRole, userPermissions]);

  // ── Session lock: the shell owns the lock screen; screens only ask for it ──
  // Same `app:lock` contract as AppShell.tsx (the restaurant sidebar's "Lock
  // Terminal" and DevToolbar fire it). With no listener here a tablet lock
  // would lock nothing — worse than the logout it replaced, because the
  // terminal would keep showing the open cart to whoever walks up.
  useEffect(() => {
    const handler = () => { if (session) setIsLocked(true); };
    window.addEventListener('app:lock', handler);
    return () => window.removeEventListener('app:lock', handler);
  }, [session]);

  const handleUnlock = useCallback(() => {
    setIsLocked(false);
  }, []);

  // The lock screen takes precedence over every branch, exactly as the desktop
  // shell does: a locked terminal renders nothing else.
  if (isLocked && session) {
    return (
      <LazyBoundary>
        <SessionLockScreen onUnlock={handleUnlock} />
      </LazyBoundary>
    );
  }

  if (loading) {
    // Branded boot splash (stage 2) — mirrors the desktop shell gate
    // and the static stage-1 splash from index.mobile.html.
    return <AppBootSplash />;
  }

  // ── First-run provisioning runs BEFORE the login gate (ADR #41 §2.1, ADR #56 §2.3) ──
  // ADR #41 §2.1's "State A: New / Uninitialized Device" says the application
  // boots directly into onboarding and authentication happens *inside* it.
  // ADR #56 §2.3 keeps that ordering and narrows what it asks: the flow is
  // store type -> owner -> one transaction, because onboarding must end at a
  // WORKING terminal rather than a configured one.
  //
  // Safe pre-login: provisioning runs before any session exists BY DESIGN. A
  // `local` install creates its own owner (§2.4), so the command that writes
  // it cannot require a session — the same property the wizard's commands had.
  //
  // The desktop AppShell keeps this after `!session`, and must: it runs two
  // earlier pre-login gates the tablet historically could not — `!bootAllowed`
  // (licence activation) and `hasUsers === false` (owner bootstrap). Licence
  // activation remains desktop-only; owner bootstrap is now part of
  // provisioning on BOTH shells (§2.2), which is what removes the
  // "completed wizard with zero users" dead end this comment used to record.
  //
  // Known consequence, recorded so it is not rediscovered as a bug: the mount
  // read's catch sets `hasCompletedSetup = false`, so a FAILED first-run read
  // reaches the provisioning flow BEFORE login rather than after it. On a
  // genuinely fresh device that flow is the only route forward, whereas login
  // would be a dead end; and because the answer is a ROW rather than a flag,
  // an unreadable database cannot forge "already provisioned" either. The
  // tablet's catch is pinned by two tests in TabletAppShell.test.tsx — a
  // rejecting read with a session and a rejecting read without one — so
  // changing it is a decision, not a cleanup.
  if (!hasCompletedSetup) {
    return (
      <LazyBoundary>
        <ProvisioningFlow onProvisioned={() => setHasCompletedSetup(true)} />
      </LazyBoundary>
    );
  }

  if (!session) {
    // Owner bootstrap (mirrors the desktop AppShell's hasUsers === false branch).
    //
    // ADR #56 §2.2 made the owner part of the provisioning transaction, so on a
    // provisioned terminal this branch should be UNREACHABLE — the flow above
    // cannot set `hasCompletedSetup` without also creating the owner. It is kept
    // deliberately:
    //
    // - it is the recoverable path for a terminal provisioned by an older
    //   build, whose owner was created by this screen rather than by
    //   `provision_device`, and
    // - `hasAnyUsers === false` is an ANSWERED read, so reaching here means the
    //   store really has no users and a login could never succeed.
    //
    // `null` (read failed / command absent) stays on login — unknown is not
    // "no users".
    if (hasAnyUsers === false) {
      return (
        <LazyBoundary>
          <CreatePinScreen
            onCreated={() => {
              setHasAnyUsers(true);
              // After bootstrap, the user is auto-logged-in by
              // CreatePinScreen via swapSession — no further action needed.
            }}
          />
        </LazyBoundary>
      );
    }
    return (
      <LazyBoundary>
        <StaffLoginScreen />
      </LazyBoundary>
    );
  }

  // ADR #4 Phase 3b: Workspace routing — same pattern as desktop AppShell.
  // If no workspace is active, show the picker. Fullscreen types render
  // directly. Sidebar types use TabletAppLayout with dynamic tabs.

  if (!activeWorkspace) {
    return (
      <div className="workspace-home-wrapper">
        <MemoBanner />
        <LazyBoundary>
          <WorkspaceHome />
        </LazyBoundary>
      </div>
    );
  }

  // Fullscreen workspaces — render without the tab bar.
  if (activeWorkspace === 'restaurant-pos') {
    return (
      <div className="workspace-fullscreen">
        <MemoBanner />
        <LazyBoundary>
          <PosScreen onNavigate={handleNavigate} />
        </LazyBoundary>
        {settingsModal}
      </div>
    );
  }

  if (activeWorkspace === 'store-pos') {
    return (
      <div className="workspace-fullscreen">
        <MemoBanner />
        <LazyBoundary>
          <RetailPosScreen onNavigate={handleNavigate} />
        </LazyBoundary>
        {settingsModal}
      </div>
    );
  }

  if (activeWorkspace === 'kds') {
    return (
      <>
        <MemoBanner kds />
        <div className="workspace-fullscreen">
          <LazyBoundary>
            <KdsScreen />
          </LazyBoundary>
          {settingsModal}
        </div>
      </>
    );
  }

  // Sidebar-type workspaces (inventory, admin) — use TabletAppLayout
  // with a dynamic bottom tab bar from workspace_type_screens.
  const pageRegistration = getPage(currentRoute);
  const PageComponent = pageRegistration?.component ?? null;
  const pageDenied = pageRegistration && !isPageAccessible(pageRegistration, userRole, userPermissions);

  return (
    <TabletAppLayout
      route={currentRoute}
      onNavigate={handleNavigate}
      {...(featuresLoaded
        ? { enabledFeatures: enabled, userRole, ...(userPermissions && { permissions: userPermissions }) }
        : { userRole, ...(userPermissions && { permissions: userPermissions }) })}
      workspaceScreens={workspaceScreens}
    >
      {pageDenied ? (
        <PermissionDenied
          action={pageRegistration?.label ?? ''}
          requiredRole={pageRegistration?.requiredRole ?? ''}
          requiredPermission={pageRegistration?.requiredPermission}
        />
      ) : PageComponent ? (
        renderPageLayout(
          <LazyBoundary>
            <PageComponent />
          </LazyBoundary>,
          pageRegistration!.layout,
          orientation.isLandscape,
        )
      ) : null}
      {/* The modal portals itself, so it does not matter which branch hosts it. */}
      {settingsModal}
    </TabletAppLayout>
  );
}
