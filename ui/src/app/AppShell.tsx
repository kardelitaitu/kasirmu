import { useState, useEffect, useCallback, useRef, lazy, type ReactNode } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { requiredLocalized } from '@/components';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/Toast';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useIdleTimer } from '@/hooks/useIdleTimer';
import { useWorkspaceNav } from '@/hooks/useWorkspaceNav';
import { useFullscreen } from '@/hooks/useFullscreen';
import { useOrientation } from '@/hooks/useOrientation';
import { isAnyAriaModalOpen, consumeShortcut } from '@/utils/modal-guard';
import { isCommandModifier } from '@/utils/keyboard-modifier';
import AppLayout, { type AppRoute } from './AppLayout';
import { completeSetup, getFirstRunState } from '@/api/settings';
import { getDeviceId } from '@/api/system';
import { useFeatures } from '@/hooks/useFeatures';
import { useTerminalProfile } from '@/hooks/useTerminalProfile';
import { getPage, isPageAccessible, type PageRegistration } from '@/registries/page-registry';
import { recordMark } from '@/utils/perf-metrics';
import PermissionDenied from '@/components/PermissionDenied';
import { ErrorState } from '@/components/ErrorState';
import { LazyBoundary } from '@/components/LazyBoundary';
import { AppBootSplash } from '@/components/AppBootSplash';
import type { WizardState } from '@/features/setup/SetupWizard';
import { toWorkspaceType, type WorkspaceType } from '@/features/settings/workspaceType';
import { getLicenseStatus } from '@/api/license';
import { hasUsers } from '@/api/staff';
import LicenseActivationScreen from '@/features/auth/LicenseActivationScreen';
import CreatePinScreen from '@/features/auth/CreatePinScreen';
import SessionLockScreen from '@/features/auth/SessionLockScreen';
import MemoBanner from '@/features/memo/MemoBanner';
import { Badge, type BadgeVariant } from '@/components/Badge';

// ── PERF-01: workspace/flow screens load on demand ────────────────
// These screens are only reachable after login, so each is code-split
// into its own chunk (Suspense boundary: LazyBoundary at render sites).
const SetupWizard = lazy(() => import('@/features/setup/SetupWizard'));
const StaffLoginScreen = lazy(() => import('@/features/auth/StaffLoginScreen'));
const WorkspaceHome = lazy(() => import('@/features/workspaces/WorkspaceHome'));
const RetailPosScreen = lazy(() => import('@/features/retail/RetailPosScreen'));
const PosScreen = lazy(() => import('@/features/sales/PosScreen'));
const KdsScreen = lazy(() => import('@/features/kds/KdsScreen'));
const WorkspaceSettingsModal = lazy(() => import('@/features/settings/WorkspaceSettingsModal'));

// ── Workspace navigation keyboard shortcuts ───────────────────────
// Escape: return to workspace picker (only when no modal is open).
// Ctrl+Shift+Escape: deliberate EMERGENCY escape — returns to the workspace
// picker even with a modal open, so a stuck overlay can never trap the
// operator. It consumes the event so no other Escape listener reacts to the
// same key (KEY-05); the topmost modal owns plain Escape while it is open.
function useWorkspaceNavShortcuts(active: string | null, onBack: () => void) {
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Ctrl+Shift+Escape (or ⌘+Shift+Escape on macOS) always returns to the
        // picker, bypassing modals.
        if (isCommandModifier(e) && e.shiftKey) {
          consumeShortcut(e);
          onBack();
        } else if (!e.defaultPrevented && !isAnyAriaModalOpen() && active !== 'restaurant-pos') {
          consumeShortcut(e);
          onBack();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [active, onBack]);
}

/**
 * The four licence verdicts the boot gate can hold. `unknown` is deliberately
 * NOT folded into `inactive`: one means "the licence said no", the other means
 * "the licence was never asked". Collapsing the two is what let a transient IPC
 * throw impersonate a decision.
 */
export type LicenseBootState = 'active' | 'grace' | 'inactive' | 'unknown';

/** One settled boot read: `ok: false` records UNKNOWN — never a borrowed fact. */
type BootRead<T> = { ok: true; value: T } | { ok: false };

/**
 * Await `read` and tag it as answered-or-unknown. Every boot IPC gets its OWN
 * `settle`, so a throw from one call cannot forge another call's answer — the
 * behaviour this replaces was one try/catch around a Promise.all whose catch
 * wrote BOTH licence-active and setup-complete.
 */
async function settle<T>(label: string, read: Promise<T>): Promise<BootRead<T>> {
  try {
    return { ok: true, value: await read };
  } catch (err) {
    console.error(`[boot] ${label} read failed — recording unknown:`, err);
    return { ok: false };
  }
}

/**
 * Application shell — handles setup wizard flow, auth gates,
 * and renders the main AppLayout with registry-based page routing.
 */
export default function AppShell() {
  const { l10n } = useLocalization();
  const [loading, setLoading] = useState(true);
  // ── Boot gate: AVAILABILITY is a different fact from the LICENCE VERDICT ──
  // `bootAllowed` answers "may this install reach the rest of the app";
  // `licenseState` answers "what did the licence actually say". Keeping them
  // apart is the whole fix: a pass bought by a completed-setup read can no
  // longer be reported as "the licence is valid", and a call that never
  // answered can no longer be reported as either.
  const [bootAllowed, setBootAllowed] = useState(false);
  const [licenseState, setLicenseState] = useState<LicenseBootState>('unknown');
  const [licenseMessage, setLicenseMessage] = useState<string | null>(null);
  // null = UNKNOWN. `false` is the value that opens CreatePinScreen, so an
  // unanswered has_users must stay null and fall through to staff login.
  const [hasAnyUsers, setHasAnyUsers] = useState<boolean | null>(null);
  const [setupKnownComplete, setSetupKnownComplete] = useState(false);
  const [licenseError, setLicenseError] = useState<string | null>(null);
  const [currentRoute, setCurrentRoute] = useState<AppRoute>('products');
  const { enabled, loaded: featuresLoaded } = useFeatures();
  const { session } = useAuth();
  const { activeWorkspace, sessionToken, terminalId, sessionError, retrySessionToken } = useWorkspace();
  const { goToWorkspacePicker } = useWorkspaceNav();
  const { isKdsKiosk } = useTerminalProfile(sessionToken ?? undefined);
  const { addToast } = useToast();
  // Stable ref so the mount effect below can call addToast without
  // listing it as a dependency (which would cause the effect to re-run
  // whenever the toast context re-creates its callback reference, resetting
  // bootAllowed back to false mid-flow).
  const addToastRef = useRef(addToast);
  addToastRef.current = addToast;

  const [isLocked, setIsLocked] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);

  useIdleTimer(() => {
    if (session) {
      setIsLocked(true);
    } else if (activeWorkspace) {
      goToWorkspacePicker();
    }
  });

  // `app:lock` is how a screen asks for a session lock without owning the lock
  // state: the restaurant sidebar's "Lock Terminal" fires it, and DevToolbar's
  // "Lock" button fires it to exercise this screen.
  useEffect(() => {
    const handler = () => { if (session) setIsLocked(true); };
    window.addEventListener('app:lock', handler);
    return () => window.removeEventListener('app:lock', handler);
  }, [session]);

  const handleUnlock = useCallback(() => {
    setIsLocked(false);
  }, []);

  // On mount, ask the backend three questions — and record honestly whether
  // each one ANSWERED. addToastRef (not addToast) is used so this effect runs
  // exactly once and cannot be re-triggered by a reference change in the toast
  // context.
  //
  // Decision logic:
  //   • Fresh install (setup not completed, no accounts): the licence gate
  //     applies. A licence that is not active and not in grace → ActivationFlow
  //     (activate licence + create owner account).
  //   • Existing install (setup read SUCCEEDED and said completed): always let
  //     the user through — the historical "never nag a paying install into a
  //     second owner account the backend rejects" pass. The verdict then
  //     surfaces as a non-blocking badge + toast, never as a forced re-activation.
  //   • A call that threw is recorded as UNKNOWN. It never writes true into the
  //     licence or the setup flag; unknown blocks only when nothing else proves
  //     the install is not fresh.
  //   • Dev mode (import.meta.env.DEV): the dev-only bypass below, untouched.
  //
  // Why the throw paths are the shape they are (measured, so this is not
  // re-litigated later): the realistic ways the boot IPC throws are (a) a global
  // SQLite that cannot read the settings table at all (corrupt / locked /
  // pre-migration) — which rejects BOTH reads and has_users too, (b) a UI bundle
  // newer than the binary (command unregistered), (c) any non-Tauri context. A
  // MISSING settings key is not one of them (Settings::get returns Ok(None) →
  // status 'missing', the gate holds), nor is a contended global lock
  // (crates/kasirmu-bridge/src/ctx.rs:378-381 is infallible — the splash hangs
  // instead), and the error-shaped licence verdicts (ClockTampered,
  // InvalidSignature, Expired-past-grace, Missing) all arrive as
  // Ok(is_active:false), so a fresh install stays gated against them. The trust
  // decision itself lives in the bridge (crates/kasirmu-bridge/src/auth.rs:611-621 is
  // the only pre-activation gate and the IPC is callable from any surface); this
  // effect decides only what the shell renders.
  useEffect(() => {
    // ── Dev-mode bypass ────────────────────────────────────────
    // In Vite dev mode, the Rust backend may not have been rebuilt
    // with the debug_assertions fix, causing a stale Missing/Expired
    // status and an annoying toast on every F5. Skip the IPC call
    // entirely and assume the license is valid.
    if (import.meta.env.DEV) {
      // Out of scope for the boot-gate fix: dev-only, no IPC at all, so these
      // writes are a stated dev decision, not a forged read. Renamed only.
      setSetupKnownComplete(true);
      setBootAllowed(true);
      setLicenseState('active');
      setLoading(false);
      // PERF-06: time-to-shell marker — app shell became interactive.
      recordMark('oz:shell-ready');
      // Check if any users exist so we can show CreatePinScreen
      // for first-run bootstrapping even in dev mode. This read goes through the
      // SAME `settle` as its production siblings, because an empty catch is not a
      // degraded-state surface: on a shell whose command list is shorter than
      // desktop's the call rejects, and `.catch(() => {})` recorded that failure
      // nowhere — not a log, not a toast, not a badge. A read that can never
      // answer then looked exactly like a read still in flight, and "which of the
      // two is it" was unanswerable from outside. `settle` writes the failure to
      // the console under its own `[boot] has_users` label and returns
      // `{ ok: false }`, which leaves `hasAnyUsers` at null — the explicit
      // UNKNOWN that the badge below renders — so an unavailable capability is
      // never reported as the positive assertion "this store has no users", the
      // value that would open CreatePinScreen.
      settle('has_users', hasUsers()).then((res) => {
        if (res.ok) setHasAnyUsers(res.value.has_users);
      });
      return;
    }

    let cancelled = false;
    (async () => {
      // No shared catch: each read settles on its own, so one failure cannot
      // forge the other two's answers. An unexpected throw out of the block
      // below now leaves bootAllowed=false (fail-closed) and still clears the
      // splash in `finally`.
      try {
        const [licenseRes, setupRes, usersRes] = await Promise.all([
          settle('get_license_status', getLicenseStatus()),
          settle(
            'get_first_run_state',
            getDeviceId().then((terminalId) => getFirstRunState(terminalId)),
          ),
          settle('has_users', hasUsers()),
        ]);
        if (cancelled) return;

        // ── has_users: unknown is not "no users" ─────────────────────
        // A rejection leaves null. `false` is the value that opens
        // CreatePinScreen, so writing it from a failed call would hand out
        // first-run owner bootstrap on an answer the call could not produce.
        // null falls through to StaffLoginScreen (see the !session branch).
        if (usersRes.ok) setHasAnyUsers(usersRes.value.has_users);

        // ── provisioning: true ONLY from a read that answered `provisioned` ──
        // ADR #56 §2.1: the row replaces the `setup.completed` boolean. A failed
        // read leaves the state unprovisioned, which routes to the first-run
        // flow rather than forging "already set up" — and because the answer is
        // a row rather than a flag, an unreadable database cannot invent one.
        const setupCompleted = setupRes.ok && setupRes.value.state === 'provisioned';
        if (setupCompleted) setSetupKnownComplete(true);

        // ── the licence verdict (the truth claim) ────────────────────
        let state: LicenseBootState = 'unknown';
        if (licenseRes.ok) {
          const s = licenseRes.value;
          if (s.status === 'gracePeriod') state = 'grace';
          else if (s.isActive) state = 'active';
          else state = 'inactive';
          setLicenseMessage(s.message);
        }
        setLicenseState(state);

        // ── availability (the decision) — real evidence only ─────────
        //   (a) the licence itself said usable, or
        //   (b) the setup read SUCCEEDED and said completed — the historical
        //       pass, kept exactly so no existing install newly loses access,
        //   (c) accounts exist — the same conclusion, from a call that worked,
        //       for an install whose settings read is the one that failed.
        // Nothing else can set it, and no branch derives it from a throw.
        const licenceUsable =
          licenseRes.ok && (licenseRes.value.isActive || licenseRes.value.status === 'gracePeriod');
        const installExisting = usersRes.ok && usersRes.value.has_users;
        setBootAllowed(licenceUsable || setupCompleted || installExisting);

        // ── surface the verdict (toasts; the badge is in the render below) ──
        if (state === 'grace' && licenseRes.ok) {
          addToastRef.current({ type: 'warning', message: licenseRes.value.message ?? 'License is in grace period.' });
        } else if (!licenseRes.ok) {
          addToastRef.current({ type: 'error', message: 'Could not verify license status. Check your connection.' });
        } else if (state === 'inactive') {
          if (setupCompleted || installExisting) {
            addToastRef.current({ type: 'warning', message: licenseRes.value.message ?? 'License is inactive. Please renew from Settings.' });
          } else if (licenseRes.value.status !== 'missing') {
            setLicenseError(licenseRes.value.message);
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          // PERF-06: time-to-shell marker — app shell became interactive.
          recordMark('oz:shell-ready');
        }
      }
    })();
    return () => { cancelled = true; };

  }, []); // run once on mount — addToastRef keeps the callback current

  // Navigate to workspace-appropriate route on selection.
  // When a hash-based shortcut route is present (e.g. from the workspace
  // home screen's Analytics / Reports cards), respect it instead of the
  // workspace default.
  const prevWorkspaceRef = useRef(activeWorkspace);
  useEffect(() => {
    if (prevWorkspaceRef.current !== undefined && prevWorkspaceRef.current !== activeWorkspace) {
      const hashRoute = window.location.hash.replace('#/', '');
      if (hashRoute && getPage(hashRoute)) {
        setCurrentRoute(hashRoute);
        // Clear the hash after consuming it so it does not persist and
        // override the workspace default on subsequent workspace switches.
        // (WorkspaceHome's Analytics/Reports shortcuts set the hash before
        // switching workspaces — this prevents a stale hash from hijacking
        // the next admin workspace open.)
        window.location.hash = '';
      } else {
        const workspaceRoute: Record<string, string> = {
          'restaurant-pos': 'sales',
          'store-pos': 'products',
          kds: 'kds',
          warehouse: 'warehouse',
          admin: 'settings',
        };
        setCurrentRoute(workspaceRoute[activeWorkspace ?? ''] ?? 'products');
      }
    }
    prevWorkspaceRef.current = activeWorkspace;
  }, [activeWorkspace]);

  // ── Hash-based routing for e2e tests ─────────────────────────
  // The e2e suite navigates via window.location.hash (see helpers.ts
  // navigateTo). Listen for hashchange and map #/route to registered
  // page routes so the AppShell React state stays in sync.
  useEffect(() => {
    const syncFromHash = () => {
      const raw = window.location.hash.replace('#/', '');
      if (!raw) return;
      // Cross-page deep links may carry a sub-section query — the settings
      // hub reads its section out of the same hash
      // (`#/settings/topology?branch=<id>` from the Locations dashboard's
      // Configure topology action), so strip the query before matching the
      // registered page route.
      const route = raw.split('?')[0]!;
      // Settings sub-sections (`#/settings/<section>…`) are not page routes
      // themselves — the settings hub is, and SettingsPage validates the
      // section against KEPT_SECTIONS (a stale one leaves the hub on its
      // default). Syncing the prefix route here is what makes the deep link
      // work when the user is ALREADY on the admin workspace but on another
      // page (e.g. Locations → Configure topology): the hashchange fires,
      // no workspace switch happens, and without this sync the shell would
      // keep rendering the old page while SettingsPage — not yet mounted —
      // had no listener to read the hash. When the hub IS already mounted
      // this is a no-op (same route) and its own hashchange listener
      // applies the section.
      if (getPage(route)) {
        setCurrentRoute(route);
      } else if (route.startsWith('settings/')) {
        if (getPage('settings')) {
          setCurrentRoute('settings');
        }
      }
    };
    // Sync once on mount so #/route bookmarks / direct nav work.
    syncFromHash();
    window.addEventListener('hashchange', syncFromHash);
    return () => window.removeEventListener('hashchange', syncFromHash);
  }, []);

  const handleComplete = useCallback(async (state: WizardState) => {
    await completeSetup({
      preset: state.preset ?? 'custom',
      features: Object.keys(state.features).filter(
        (k) => state.features[k],
      ),
      default_currency: state.default_currency,
    });
    setSetupKnownComplete(true);
  }, []);

  /**
   * Called when the activation flow finishes (license activated + owner
   * account created). The activation flow has already written the owner and
   * the licence, so this only reflects that locally — it no longer writes a
   * dismissal flag.
   */
  const handleActivationComplete = useCallback(() => {
    // Real evidence this time: the activation flow only calls back after
    // activateLicense succeeded, so the licence flag is earned, not assumed.
    setSetupKnownComplete(true);
    setBootAllowed(true);
    setLicenseState('active');
  }, []);

  // ── 4b: F10 opens the WorkspaceSettingsModal across all workspace screens ─
  useEffect(() => {
    if (!activeWorkspace) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F10') {
        e.preventDefault();
        // Don't open if a modal is already active (e.g., a nested modal).
        if (!isAnyAriaModalOpen()) {
          consumeShortcut(e);
          setSettingsModalOpen((p) => !p);
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [activeWorkspace]);

  // Map active workspace to the modal's WorkspaceType. Null for keys with no
  // card (admin, inventory, unknown) — the modal is then not rendered at all.
  const workspaceType: WorkspaceType | null = toWorkspaceType(activeWorkspace);

  // Shared settings modal extracted once to avoid duplicating JSX across 6+ branches.
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

  // ── Persistent, NON-blocking boot verdict badges ─────────────────
  // The gate above decides availability; these state what is true, so an
  // install let through on a completed-setup answer while its licence is
  // inactive/unknown — or one whose has_users never answered — shows that
  // fact instead of hiding it in a one-shot toast.
  const bootBadges = (
    <>
      {/* Durable session-token failure surface: the toast raised at the
          moment of failure expires, and an operator left with no session
          token then sees nothing explaining it. Read as `sessionError ?`,
          not as a guaranteed field: it is optional on the context type,
          so absent must mean no banner rather than a crash. */}
      {sessionError ? (
        <ErrorState
          title={requiredLocalized(l10n, 'workspace-session-token-error')}
          message={sessionError}
          {...(retrySessionToken ? { onRetry: retrySessionToken } : {})}
        />
      ) : null}
      <BootStatusBadges
        licenseState={licenseState}
        licenseMessage={licenseMessage}
        usersUnknown={hasAnyUsers === null && !session}
      />
    </>
  );

  // ── F11 toggles fullscreen across all workpaces ───────────────
  // KEY-01: the retail POS (store-pos) assigns F11 to Quick Return, so the
  // global fullscreen binding is disabled there — F11 has exactly one owner
  // per workspace. (Fullscreen stays reachable via the WorkspaceHome button.)
  useFullscreen(
    (isFullscreen) => {
      addToast({
        type: 'info',
        message: isFullscreen
          ? requiredLocalized(l10n, 'fullscreen-enabled')
          : requiredLocalized(l10n, 'fullscreen-disabled'),
      });
    },
    { enabled: activeWorkspace !== 'store-pos' },
  );

  // ── Page-declared layout (ADR-0001 Slice 1) ───────────────────
  //
  // The registry records what a page structurally needs; the shell is the one
  // place that reads it. Called unconditionally here — hooks may not sit behind
  // the early returns above, and the value it feeds is read further down at the
  // registry render site.
  //
  // No lock request: `landscape-locked` is a declaration that the page needs the
  // landscape tree, not a promise the host can keep (the Android WebView ignores
  // `screen.orientation.lock` — see TabletAppShell). The rotation prompt is
  // therefore derived from the MEASURED viewport, and the portrait fallback
  // renders either way.
  const { orientation } = useOrientation();

  // ── Escape key navigates back to workspace picker ────────────

  const handleBackToPicker = useCallback(() => {
    goToWorkspacePicker();
  }, [goToWorkspacePicker]);

  useWorkspaceNavShortcuts(activeWorkspace, handleBackToPicker);

  const userRole = session?.role_name ?? '';
  const userPermissions = session?.permissions;

  const handleNavigate = useCallback((route: AppRoute) => {
    const target = getPage(route);
    if (target && !isPageAccessible(target, userRole, userPermissions)) {
      const accessiblePages = ['sales', 'products', 'sales-history', 'sales-dashboard'];
      const fallback = accessiblePages.find((r) => {
        const p = getPage(r);
        return p && isPageAccessible(p, userRole, userPermissions);
      }) ?? 'products';
      setCurrentRoute(fallback);
      return;
    }
    setCurrentRoute(route);
  }, [userRole, userPermissions]);

  // P12-4: Session lock screen takes precedence over all other views.
  // Memo surface (owner ruling 2026-09-08): the banner is app-wide EXCEPT the
  // login and lock screens — a locked terminal must not display ops memos to
  // anyone standing at it. (This mount previously cited the memo spec's
  // session-alive reasoning; the ruling supersedes it.)
  if (isLocked && session) {
    return <SessionLockScreen onUnlock={handleUnlock} />;
  }

  if (loading) {
    // Branded boot splash (stage 2) — visually continues the static
    // stage-1 splash from index.html while the license + setup IPC
    // round-trips resolve. Replaces the former bare-text gate.
    return <AppBootSplash />;
  }

  if (!bootAllowed) {
    return (
      <ActivationFlow
        initialError={licenseError}
        onComplete={handleActivationComplete}
      />
    );
  }

  if (!session) {
    // First-run: no user accounts exist yet — show the owner bootstrap
    // screen so the user can create the first admin account. When the
    // hasUsers check is still loading (null), fall through to the login
    // screen — the bootstrap call will fail with a clear error if the
    // DB is truly empty.
    if (hasAnyUsers === false) {
      return (
        <>
          {bootBadges}
          <CreatePinScreen
            onCreated={() => {
              setHasAnyUsers(true);
              // After bootstrap, the user is auto-logged-in by
              // CreatePinScreen via swapSession — no further action needed.
            }}
          />
        </>
      );
    }
    return (
      <>
        {bootBadges}
        <LazyBoundary>
          <StaffLoginScreen />
        </LazyBoundary>
      </>
    );
  }

  if (!setupKnownComplete) {
    return (
      <>
        {bootBadges}
        <LazyBoundary>
          <SetupWizard onComplete={handleComplete} onSkip={() => setSetupKnownComplete(false)} onLaunch={() => setSetupKnownComplete(true)} />
        </LazyBoundary>
      </>
    );
  }

  // ── KDS Kiosk — force KDS route, hide header, no workspace picker ──
  if (isKdsKiosk) {
    return (
      <>
        <MemoBanner kds />
        {bootBadges}
        <div className="workspace-fullscreen">
          <div className="kds-workspace">
            <LazyBoundary>
              <KdsScreen />
            </LazyBoundary>
          </div>
        </div>
        {settingsModal}
      </>
    );
  }

  if (!activeWorkspace) {
    return (
      <div className="workspace-home-wrapper">
        <MemoBanner />
        {bootBadges}
        <LazyBoundary>
          <WorkspaceHome />
        </LazyBoundary>
      </div>
    );
  }

  // Render the current page from the registry, or null if not found.
  const pageRegistration = getPage(currentRoute);
  const PageComponent = pageRegistration?.component ?? null;
  const pageDenied = pageRegistration && !isPageAccessible(pageRegistration, userRole, userPermissions);

  // Workspace fullscreen — restaurant POS hides the sidebar.
  // KDS is a separate workspace screen, navigated to via the chef button in PosScreen.
  if (activeWorkspace === 'restaurant-pos') {
    if (currentRoute === 'kds') {
      return (
        <>
          <MemoBanner kds />
          {bootBadges}
          <div className="workspace-fullscreen">
            <div className="kds-workspace">
              <div className="kds-workspace-header">
                { }
                <button
                  className="kds-workspace-back"
                  onClick={() => handleNavigate('sales')}
                >
                  <Localized id="back">
                    <span>&larr; Back</span>
                  </Localized>
                </button>
              </div>
              <LazyBoundary>
                <KdsScreen />
              </LazyBoundary>
            </div>
          </div>
          {settingsModal}
        </>
      );
    }
    return (
      <>
        <MemoBanner />
        {bootBadges}
        <div className="workspace-fullscreen">
          <LazyBoundary>
            <PosScreen onNavigate={handleNavigate} />
          </LazyBoundary>
        </div>
        {settingsModal}
      </>
    );
  }

  // Workspace fullscreen — retail POS with its own layout.
  // KDS is a separate workspace screen, navigated to via F12 or function bar.
  if (activeWorkspace === 'store-pos') {
    if (currentRoute === 'kds') {
      return (
        <>
          <MemoBanner kds />
          {bootBadges}
          <div className="workspace-fullscreen">
            <div className="kds-workspace">
              <div className="kds-workspace-header">
                { }
                <button
                  className="kds-workspace-back"
                  onClick={() => handleNavigate('products')}
                >
                  <Localized id="back">
                    <span>&larr; Back</span>
                  </Localized>
                </button>
              </div>
              <LazyBoundary>
                <KdsScreen />
              </LazyBoundary>
            </div>
          </div>
          {settingsModal}
        </>
      );
    }
    return (
      <>
        <MemoBanner />
        {bootBadges}
        <div className="workspace-fullscreen">
          <LazyBoundary>
            <RetailPosScreen onNavigate={handleNavigate} />
          </LazyBoundary>
        </div>
        {settingsModal}
      </>
    );
  }

  // Fullscreen workspace — KDS.
  if (activeWorkspace === 'kds') {
    return (
      <>
        <MemoBanner kds />
        {bootBadges}
        <div className="workspace-fullscreen">
          <LazyBoundary>
            <KdsScreen />
          </LazyBoundary>
        </div>
        {settingsModal}
      </>
    );
  }

  // Fullscreen pages render without the AppLayout wrapper. The memo banner
  // follows them — EXCEPT the customer-facing kiosk, where memos are internal
  // staff communication that must not display to customers (owner ruling
  // 2026-09-08: banner everywhere except login + lock + kiosk).
  if (pageRegistration?.fullscreen) {
    if (pageDenied) {
      return (
        <PermissionDenied
          action={pageRegistration!.label}
          requiredRole={pageRegistration!.requiredRole!}
          requiredPermission={pageRegistration!.requiredPermission}
        />
      );
    }
    const isCustomerKiosk = currentRoute === 'kiosk';
    return PageComponent ? (
      <>
        {!isCustomerKiosk && <MemoBanner />}
        {bootBadges}
        {renderPageLayout(
          <LazyBoundary>
            <PageComponent />
          </LazyBoundary>,
          pageRegistration.layout,
          orientation.isLandscape,
        )}
      </>
    ) : null;
  }

  return (
    <>
      {bootBadges}
      <AppLayout
        route={currentRoute}
        onNavigate={handleNavigate}
        sessionToken={sessionToken}
        {...(featuresLoaded
          ? { enabledFeatures: enabled, userRole, ...(userPermissions && { permissions: userPermissions }) }
          : { userRole, ...(userPermissions && { permissions: userPermissions }) })}
      >
        {pageDenied ? (
          <PermissionDenied
            action={pageRegistration!.label}
            requiredRole={pageRegistration!.requiredRole!}
            requiredPermission={pageRegistration!.requiredPermission}
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
      </AppLayout>
      {settingsModal}
    </>
  );
}

/**
 * Apply a page's registry-declared `layout` to the rendered page (ADR-0001, tier
 * T3). The registry records the structural need; this is the consumer T4 checks
 * for. Both shells call it, so one registration behaves the same on either.
 *
 * - absent / 'fluid' — the page adapts to the space it is given (T2 container
 *   queries). Returning the page node itself, not a wrapper around it, is what
 *   keeps this branch a no-op instead of a new DOM layer.
 * - 'landscape-locked' — the page needs a different structural tree in landscape.
 *   The shell cannot enforce orientation (the Android WebView has no
 *   `screen.orientation.lock`), so this renders the same page plus a rotation
 *   prompt, and only while the MEASURED viewport is portrait: a prompt that
 *   cannot clear would be worse than no prompt. The page stays mounted and usable
 *   either way — the prompt is an overlay, never a gate.
 * - 'custom' — the page owns its layout contract outside T1/T2, so the shell
 *   renders it as-is inside the `data-layout="custom"` marker CSS keys off
 *   instead of reaching into the page's own contract.
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
 * Manages the license-activation → owner-PIN-creation flow locally
 * so that the parent (AppShell) does not need to synchronise two
 * state variables across the transition boundary.
 */
function ActivationFlow({
  initialError,
  onComplete,
}: {
  initialError: string | null;
  onComplete: () => void;
}) {
  const [step, setStep] = useState<'activate' | 'bootstrap'>('activate');

  if (step === 'activate') {
    return (
      <LicenseActivationScreen
        initialError={initialError}
        onActivated={() => setStep('bootstrap')}
      />
    );
  }

  return <CreatePinScreen onCreated={onComplete} />;
}

/**
 * Non-blocking badges that state the boot verdicts the gate had to decide
 * around: an unknown/inactive licence and an unanswered has_users. They are
 * the visible half of the rule "an unknown answer is not a false fact" — the
 * shell keeps working (compat: an existing install must not lose access) but
 * never claims the licence is fine.
 */
function BootStatusBadges({
  licenseState,
  licenseMessage,
  usersUnknown,
}: {
  licenseState: LicenseBootState;
  licenseMessage: string | null;
  usersUnknown: boolean;
}) {
  const { l10n } = useLocalization();
  const badges: { key: string; text: string; variant: BadgeVariant }[] = [];
  if (licenseState === 'unknown') {
    badges.push({ key: 'license-unknown', text: requiredLocalized(l10n, 'settings-license-load-failed'), variant: 'warning' });
  } else if (licenseState === 'inactive') {
    badges.push({
      key: 'license-inactive',
      text: licenseMessage ?? requiredLocalized(l10n, 'settings-license-live-inactive'),
      variant: 'danger',
    });
  }
  if (usersUnknown) {
    badges.push({ key: 'users-unknown', text: requiredLocalized(l10n, 'staff-error-load'), variant: 'warning' });
  }
  if (badges.length === 0) return null;
  return (
    <div className="boot-status-badges" data-testid="boot-status-badges" role="status">
      {badges.map((b) => (
        <Badge key={b.key} variant={b.variant} size="sm" data-testid={`boot-badge-${b.key}`}>
          {b.text}
        </Badge>
      ))}
    </div>
  );
}
