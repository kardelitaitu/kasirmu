import { useState, useEffect, useCallback, useRef, lazy } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useOrientation } from '@/hooks/useOrientation';
import TabletAppLayout from './TabletAppLayout';
import { completeSetup, dismissSetupWizard, getSetupStatus } from '@/api/settings';
import { useFeatures } from '@/hooks/useFeatures';
import { getPage, isPageAccessible } from '@/registries/page-registry';
import PermissionDenied from '@/components/PermissionDenied';
import { LazyBoundary } from '@/components/LazyBoundary';
import { AppBootSplash } from '@/components/AppBootSplash';
import MemoBanner from '@/features/memo/MemoBanner';
import type { WizardState } from '@/features/setup/SetupWizard';
import { isAnyAriaModalOpen, consumeShortcut } from '@/utils/modal-guard';
import { toWorkspaceType, type WorkspaceType } from '@/features/settings/workspaceType';

// ── PERF-01: workspace/flow screens load on demand ────────────────
const SetupWizard = lazy(() => import('@/features/setup/SetupWizard'));
const StaffLoginScreen = lazy(() => import('@/features/auth/StaffLoginScreen'));
const SessionLockScreen = lazy(() => import('@/features/auth/SessionLockScreen'));
const WorkspaceHome = lazy(() => import('@/features/workspaces/WorkspaceHome'));
const RetailPosScreen = lazy(() => import('@/features/retail/RetailPosScreen'));
const PosScreen = lazy(() => import('@/features/sales/PosScreen'));
const KdsScreen = lazy(() => import('@/features/kds/KdsScreen'));
const WorkspaceSettingsModal = lazy(() => import('@/features/settings/WorkspaceSettingsModal'));

/**
 * Tablet-optimised application shell.
 *
 * ADR #4 Phase 3b: Uses WorkspaceContext for device-bound auto-boot
 * and dynamic tab bar from workspace_type_screens. Falls back to
 * workspace picker when no instance is selected.
 */
export default function TabletAppShell() {
  // P14-3: Lock to landscape-primary on tablet devices. Only need the
  // side effect (locking the screen + listening for orientation changes).
  // Consume `orientation.isLandscape` from the hook return if a screen
  // needs to reflow its layout on rotation.
  useOrientation('landscape-primary');

  const [loading, setLoading] = useState(true);
  const [hasCompletedSetup, setHasCompletedSetup] = useState(false);
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

  // On mount, check if setup was already completed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await getSetupStatus();
        if (!cancelled) {
          setHasCompletedSetup(status.completed);
        }
      } catch {
        if (!cancelled) {
          setHasCompletedSetup(false);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
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

  const handleComplete = useCallback(async (state: WizardState) => {
    await completeSetup({
      preset: state.preset ?? 'custom',
      features: Object.keys(state.features).filter(
        (k) => state.features[k],
      ),
      default_currency: state.default_currency,
    });
    setHasCompletedSetup(true);
  }, []);

  const handleSkip = useCallback(() => {
    dismissSetupWizard().catch(console.error);
    setHasCompletedSetup(true);
  }, []);

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
    // and the static stage-1 splash from index.tablet.html.
    return <AppBootSplash />;
  }

  if (!session) {
    return (
      <LazyBoundary>
        <StaffLoginScreen />
      </LazyBoundary>
    );
  }

  if (!hasCompletedSetup) {
    return (
      <LazyBoundary>
        <SetupWizard onComplete={handleComplete} onSkip={handleSkip} onLaunch={() => setHasCompletedSetup(true)} />
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
        <LazyBoundary>
          <PageComponent />
        </LazyBoundary>
      ) : null}
      {/* The modal portals itself, so it does not matter which branch hosts it. */}
      {settingsModal}
    </TabletAppLayout>
  );
}
