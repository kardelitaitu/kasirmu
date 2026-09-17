// Vite React Refresh: force full remount on HMR to prevent stale
// WorkspaceContext / WorkspaceScopeContext mismatch.
/// @refresh reset
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import {
  listWorkspaces,
  listWorkspaceScreens,
  resolveBootStore,
  type WorkspaceDto,
} from "@/api/workspaces";
import { createSession, destroySession, refreshPickerTicket, switchOrganization as switchOrganizationApi } from "@/api/staff";
import { getDeviceId } from "@/api/system";
import { useAuth } from "@/contexts/AuthContext";
import { requiredLocalized, useToast } from "@/components";
import { errorDetail } from "@/utils/app-error";
import { useLocalization } from "@fluent/react";



// ── Workspace scope context (ADR #4) ────────────────────────────────

/** Resolved workspace scope — derived from the active instance. */
export interface WorkspaceScope {
  storeId: string;
  instanceId: string;
  typeKey: string;
}

/** Exported for test helpers only — always use `useWorkspaceScope` in production code. */
// eslint-disable-next-line react-refresh/only-export-components
export const WorkspaceScopeContext = createContext<WorkspaceScope | null>(null);

/** Access the current workspace scope (storeId, instanceId, typeKey), or null. */
// eslint-disable-next-line react-refresh/only-export-components
export function useWorkspaceScope(): WorkspaceScope | null {
  return useContext(WorkspaceScopeContext);
}

// ── Main workspace context ──────────────────────────────────────────

 
/** Full workspace context value exposed to consumers. */
 
export interface WorkspaceContextValue {
  /** Workspace type key (backward compat). Same as activeInstance?.type_key. */
  activeWorkspace: string | null;
  setActiveWorkspace: (key: string | null) => void;
  /** ADR #4: the full instance DTO, or null when no workspace is active. */
  activeInstance: WorkspaceDto | null;
  /** ADR #4: set the active instance directly (also updates activeWorkspace). */
  setActiveInstance: (instance: WorkspaceDto | null) => void;
  /** @deprecated Alias for activeInstance, kept for backward compat. Use activeInstance instead. */
  availableWorkspaces: WorkspaceDto[];
  workspaceScreens: string[];
  loading: boolean;
  error: string | null;
  retry: () => void;
  /** The most recently active workspace key — persists even after switching back to the picker. */
  lastWorkspace: string | null;
  /** ADR #4 Phase 2b: switch to a different store, clearing workspace and re-resolving. */
  switchStore: (storeId: string) => void;
  /** ADR #4 Phase 2b: the currently resolved store ID. */
  resolvedStoreId: string;
  /** ADR #4 / ADR #7: opaque session token for scoped command authorization. */
  sessionToken: string | null;
  /**
   * Localized copy of the LAST failed create_session attempt, or null while no
   * attempt has failed since the last success. A rejected createSession used to
   * be a console.warn only, which left sessionToken null with nothing on screen
   * to explain why (clock rollback, denied workspace type, expired subscription,
   * invalid signature) while every token-taking command downstream failed or
   * no-opped. AppShell's `bootBadges` element renders this with `retrySessionToken`;
   * the toast is the immediate surface and this is the durable one.
   * Optional so existing test mocks need not override it; the real provider
   * always sets it.
   */
  sessionError?: string | null;
  /**
   * Re-invoke the create_session attempt that failed, for the instance it was
   * attempted with. No-op when no attempt has been made. Optional for the same
   * reason as `sessionError`.
   */
  retrySessionToken?: () => void;
  /** ADR #22: device/terminal ID for hardware-scoped settings. */
  terminalId: string;
  /**
   * ADR #6: Hot-swap the session token to a new user without resetting
   * the active workspace/instance. Used by FastPINOverlay for shared
   * touchscreen operator switching. Destroys the old token and creates
   * a new one with the same scope (storeId, instanceId, typeKey, terminalId)
   * but the new user's identity.
   */
  swapSessionToken: (newUserId: string, newRoleId: string) => Promise<void>;
  /**
   * SaaS-3 L194: display-only label of the Organization (legal entity) the
   * session is currently scoped to. Never used as an auth input. Optional so
   * existing test mocks need not override it; the real provider always sets it.
   */
  orgLabel?: string | null;
  /**
   * SaaS-3 L194: set the pre-login org selection (routing hint) that the next
   * create_session call will carry as org_id. Cleared once the session is minted.
   * Optional for the same reason as orgLabel.
   */
  setPendingOrgId?: (orgId: string | null) => void;
  /**
   * SaaS-3 L194: re-scope the active session to a different Organization
   * (legal entity). Full PIN re-auth; backend invalidates the old token and
   * mints a new one (invalidate-then-mint), then updates token + display label.
   * Optional for the same reason as orgLabel.
   */
  switchOrganization?: (orgId: string, pin: string) => Promise<void>;
}

/** Exported for test helpers only — always use `useWorkspace` in production code. */
// eslint-disable-next-line react-refresh/only-export-components
export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

/** Default store ID for Phase 1 (single-store mode).
 *  ADR #4 Phase 3: Replaced by dynamic resolution via resolveBootStore().
 *  Kept as fallback when boot resolution fails. */
const DEFAULT_STORE_ID = "default";

/**
 * Provides workspace state to the entire app tree.
 *
 * Loads available workspaces on mount, resolves the boot store via
 * ADR #4 Phase 3, manages the active workspace/instance selection,
 * creates session tokens (ADR #4 / ADR #7), and supports hot-swap
 * session token switching (ADR #6).
 */
/**
 * Stable stand-in for `useAuth().updatePickerTicket` on shells that do not expose it.
 *
 * Declared at module scope so the identity never changes. Written inline as `?? (() => {})` it
 * produced a fresh function on every render, which is why the two hooks that call it could not list
 * it as a dependency without re-firing forever -- eslint reported the omission and the omission was
 * load-bearing. A module constant removes the reason it had to be omitted.
 */
const PICKER_TICKET_NOOP = (_ticket: string) => {};

/**
 * Toast queue accessor that tolerates a missing `<ToastProvider>` ancestor.
 *
 * In production the provider sits above this one (see `contexts/AppProviders.tsx`,
 * nesting order 7. ToastProvider -> 8. WorkspaceProvider), so the queue is always
 * available here. Test harnesses that render `WorkspaceProvider` standalone do not
 * mount it, and `useToast()` throws when its context is absent - which would turn
 * an unrelated assertion into a mount failure. `useToast` throws *after* its own
 * `useContext` call, so wrapping it cannot reorder hooks.
 */
function useToastIfAvailable(): ReturnType<typeof useToast> | null {
  try {
    return useToast();
  } catch {
    return null;
  }
}

/**
 * A rejected `destroy_session` is the one logout failure nobody could see.
 *
 * Every site below still clears the LOCAL token right afterwards -- the operator's
 * screen goes to the picker either way -- so when the server-side teardown fails the
 * UI says "logged out" while that session can still be live on the server. On a
 * shared POS terminal the next person at the till inherits it.
 *
 * Nothing else is safe to do from here: a retry would re-destroy a token this client
 * has already let go of, and a UI state would have to answer a question this lane has
 * not decided (does a half-teardown block navigation?). So the requirement is only
 * that the failure is OBSERVABLE.
 *
 * Same MESSAGE shape as every other diagnostic in this file --
 * `"WorkspaceContext: <what failed>", err`, the form used by the four degraded reads
 * ("failed to list workspaces", "picker-ticket refresh failed", "failed to create
 * session token", "boot store resolution failed") -- with `where` naming which
 * teardown broke, but one LEVEL LOUDER: those four
 * warn because a read came back short and the app still knows its own state. This one
 * means the client believes it is signed out while the server session may not be, which
 * on a shared till becomes the next operator's problem -- so it goes to
 * `console.error` and does not share a volume with "failed to list workspaces".
 */
function reportTeardownFailure(where: string, err: unknown): void {
  console.error(
    `WorkspaceContext: server-side session teardown failed (${where}) -- the local token was cleared but the server session may still be live`,
    err,
  );
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { session, pickerTicket, updatePickerTicket } = useAuth();
  // Localized copy for the error state. WorkspaceProvider mounts inside
  // LocaleProvider (see contexts/AppProviders.tsx), so l10n is available.
  const { l10n } = useLocalization();
  const updatePickerTicketFn = updatePickerTicket ?? PICKER_TICKET_NOOP;
  // swapSessionToken is deliberately dependency-free (see its `[], // stable — reads from refs`),
  // so every value it reads has to arrive through a ref or the closure goes stale. `pickerTicket`
  // did not, and with no prior session token swapSessionToken passed the captured ticket straight to
  // createSession -- the previous cashier's ticket, which is the exact thing the comment above that
  // call warns against. Mirroring sessionTokenRef above makes the "reads from refs" claim true.
  const pickerTicketRef = useRef(pickerTicket);
  pickerTicketRef.current = pickerTicket;
  // Standalone state — not derived from activeInstance, so it works
  // even before availableWorkspaces is loaded (no race condition).
  const [activeWorkspace, setActiveWorkspace] = useState<string | null>(null);
  const [activeInstance, setActiveInstance] = useState<WorkspaceDto | null>(
    null,
  );
  const [availableWorkspaces, setAvailableWorkspaces] = useState<
    WorkspaceDto[]
  >([]);
  const [workspaceScreens, setWorkspaceScreensState] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);


  // ADR #4 Phase 3: Dynamically resolved store ID from device binding or primary store.
  const [resolvedStoreId, setResolvedStoreId] =
    useState<string>(DEFAULT_STORE_ID);

  // ADR #4 / ADR #7: Opaque session token created by create_session command.
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const sessionTokenRef = useRef(sessionToken);
  sessionTokenRef.current = sessionToken;

  // Bumped by `retrySessionToken` to re-fire the token-creation effect.
  const [tokenAttemptNonce, setTokenAttemptNonce] = useState(0);
  // Operator-visible failure state for the create_session attempt, plus the
  // instance the last attempt was made for (what `retrySessionToken` re-plays).
  const [sessionError, setSessionError] = useState<string | null>(null);
  const sessionAttemptRef = useRef<WorkspaceDto | null>(null);
  // l10n and the toast queue are read through refs so the callbacks below stay
  // dependency-light: switching locale must not re-fire the token effect and
  // re-mint a live session.
  const l10nRef = useRef(l10n);
  l10nRef.current = l10n;
  const toast = useToastIfAvailable();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  // SaaS-3 L194: display-only label of the Organization (legal entity) the
  // active session is scoped to. Never used as an auth input.
  const [orgLabel, setOrgLabel] = useState<string | null>(null);
  // SaaS-3 L194: pre-login org selection (routing hint) carried into the next
  // create_session call. Cleared once the session is minted.
  const [pendingOrgId, setPendingOrgId] = useState<string | null>(null);
  const pendingOrgIdRef = useRef(pendingOrgId);
  pendingOrgIdRef.current = pendingOrgId;

  // ADR #22: Device/terminal ID resolved once on mount.
  const [terminalId, setTerminalId] = useState('');
  useEffect(() => {
    getDeviceId().then(setTerminalId).catch(() => setTerminalId(''));
  }, []);

  // ADR #6: Stable ref for the active instance so swapSessionToken
  // can read it without depending on the state (keeps the callback
  // reference stable).
  const activeInstanceRef = useRef(activeInstance);
  activeInstanceRef.current = activeInstance;

  // ADR #6: Guard to prevent the token-creation effect from also
  // creating a token during a hot-swap (swapSessionToken handles it).
  const isHotSwappingRef = useRef(false);

  // Reset workspace selection on login/logout so the user always
  // sees the workspace picker after authentication.
  // Uses a ref for sessionToken to avoid the effect re-firing when
  // sessionToken changes (which would clear the workspace immediately
  // after selection).
  //
  // ADR #6: Only reset on null↔non-null transitions (login/logout),
  // not on value-to-value changes (hot-swap via FastPINOverlay).
  const prevSessionRef = useRef(session);
  useEffect(() => {
    const prev = prevSessionRef.current;
    prevSessionRef.current = session;

    // Hot-swap: session changed from one user to another — don't reset.
    if (prev && session) return;

    // Fresh login (null → session) or logout (session → null): reset.
    setActiveWorkspace(null);
    setActiveInstance(null);
    const token = sessionTokenRef.current;
    if (token) {
      destroySession(token).catch((err) =>
        reportTeardownFailure("login/logout reset", err),
      );
      setSessionToken(null);
    }
  }, [session]);

  // Sync activeInstance from activeWorkspace whenever the list changes
  // or the key changes. This handles the race condition where
  // setActiveWorkspace is called before the async list resolves.
  useEffect(() => {
    if (activeWorkspace && availableWorkspaces.length > 0) {
      const instance = availableWorkspaces.find(
        (i) => i.type_key === activeWorkspace,
      );
      setActiveInstance(instance ?? null);
    } else if (!activeWorkspace) {
      setActiveInstance(null);
    }
  }, [activeWorkspace, availableWorkspaces]);

  // ── Shared workspace-fetching logic ─────────────────────────────────

  const fetchWorkspaces = useCallback(
    async (storeId: string, cancelled: () => boolean) => {
      // audit-open-findings: the picker ticket binds the caller server-side; the
      // backend derives the real role from the ticket, so the UI never
      // sends a role/user claim that could be forged.
      if (!pickerTicket) return;
      try {
        // Only registered workspace instances are shown on the home screen —
        // an empty list from the server means there is nothing to show, so
        // the picker renders its empty state instead of demo data.
        const workspaces = await listWorkspaces(pickerTicket, storeId);
        if (!cancelled()) {
          setAvailableWorkspaces(workspaces);
          setError(null);
        }
      } catch (err) {
        if (!cancelled()) {
          console.warn(
            "WorkspaceContext: failed to list workspaces",
            err,
          );
          setAvailableWorkspaces([]);
          setError(
            requiredLocalized(l10n, 'workspace-home-error-desc'),
          );
        }
      }
    },
    [pickerTicket, l10n],
  );

  // ADR #4 Phase 2b: Switch to a different store.
  // Destroys the current session token, clears workspace, re-resolves for new store.
  // Uses sessionTokenRef to keep the callback reference stable.
  const switchStore = useCallback(
    (storeId: string) => {
      const token = sessionTokenRef.current;
      if (token) {
        destroySession(token).catch((err) =>
          reportTeardownFailure("switchStore", err),
        );
        setSessionToken(null);
      }
      setActiveWorkspace(null);
      setActiveInstance(null);
      setWorkspaceScreensState([]);
      setResolvedStoreId(storeId);
      setLoading(true);
      setError(null);
      fetchWorkspaces(storeId, () => false).finally(() => setLoading(false));
    },
    [fetchWorkspaces],
  );

  // ADR #6: Hot-swap the session token to a new user without resetting
  // the workspace. Used by FastPINOverlay for shared touchscreen
  // operator switching.
  //
  // Destroys the old token and creates a new one with the same scope
  // (storeId, instanceId, typeKey, terminalId) but the new user's
  // identity. The active workspace and instance are preserved.
  //
  // Sets isHotSwappingRef to prevent the [activeInstance, session]
  // effect from also creating a token during the swap (race condition).
  const swapSessionToken = useCallback(
    async (newUserId: string, newRoleId: string) => {
      const instance = activeInstanceRef.current;
      if (!instance) return;

      isHotSwappingRef.current = true;
      try {
        // Refresh the picker ticket using the old session before
        // destroying it — the hot-swap user needs a fresh ticket
        // bound to THEIR identity (not the previous user's).
        let ticket = pickerTicketRef.current ?? "";
        const prev = sessionTokenRef.current;
        if (prev) {
          try {
            const refreshed = await refreshPickerTicket(prev);
            ticket = refreshed.picker_ticket;
            updatePickerTicketFn(ticket);
          } catch (err) {
            // Refresh failed — use the existing ticket, which is the LOGIN-TIME one:
            // `pickerTicketRef.current` above holds the ticket minted at staff_login, and
            // its TTL is five minutes (crates/kasirmu-bridge/src/auth.rs, PICKER_TICKET_TTL_SECS,
            // which is why this call exists at all). So a silent fallback here can hand
            // create_session a ticket that has already aged out.
            //
            // The catch used to be empty, and that is how the defect below survived six
            // rounds of green tests: this shell had no `refresh_picker_ticket` command until
            // 683c9f2b9, so every hot-swap on a tablet threw into this branch and looked
            // exactly like a healthy swap. The suite even documents the blind spot from its
            // own side (ui/src/__tests__/WorkspaceContext.test.tsx:209-213).
            console.warn(
              "WorkspaceContext: picker-ticket refresh failed, reusing the login-time ticket",
              err,
            );
          }

          await destroySession(prev).catch((err) =>
            reportTeardownFailure("swapSessionToken", err),
          );
          setSessionToken(null);
        }

        // Create a new token with the same scope but new user.
        const result = await createSession({
          user_id: newUserId,
          role_id: newRoleId,
          store_id: instance.store_id,
          instance_id: instance.instance_id,
          type_key: instance.type_key,
          terminal_id: await getDeviceId().catch(() => ""),
          picker_ticket: ticket,
        });

        setSessionToken(result.session_token);
      } finally {
        isHotSwappingRef.current = false;
      }
    },
    // Stable in practice: `updatePickerTicketFn` is either AuthContext's own
    // useCallback(..., []) or the module-scope noop, so listing it cannot re-fire this.
    [updatePickerTicketFn],
  );

  // SaaS-3 L194: switch the active Organization (legal entity) WITHOUT
  // tearing down the workspace. The backend invalidates the old token and
  // mints a new one (invalidate-then-mint), re-derives tenant authority from
  // the user assignment (fail-closed), and re-runs tenant integrity. The
  // workspace (store/instance) is unchanged — org is orthogonal to it under
  // the single-tenant-DB model — so we only swap the token and display label.
  //
  // Requires a FULL PIN re-auth (no credential carryover). The backend has
  // already invalidated the old token by the time the new one is returned, so
  // we do not call destroySession here.
  const switchOrganization = useCallback(
    async (orgId: string, pin: string) => {
      const token = sessionTokenRef.current;
      if (!token) return;
      const result = await switchOrganizationApi({
        sessionToken: token,
        orgId,
        pin,
      });
      setOrgLabel(result.context.orgLabel ?? null);
      setSessionToken(result.session_token);
    },
    [],
  );

  // A rejected create_session has to reach the operator, not just the console.
  // The toast is the immediate surface; `sessionError` is the durable one, read
  // by the desktop shell's `bootBadges` element. The tablet shell has no
  // bootBadges slot, so it renders neither — and stays silent after the toast.
  const reportSessionTokenFailure = useCallback((err: unknown) => {
    const message = requiredLocalized(
      l10nRef.current,
      'workspace-session-token-error',
    );
    setSessionError(message);
    // The backend reason (clock rollback / denied workspace type / expired
    // subscription / bad signature) under the error toast's Show detail
    // toggle, via the ERR-06 normalizer: it contributes the typed
    // `kind`/`subKind` code and only a redacted server line, so no raw Rust
    // string (unlocalized, possibly carrying internals) reaches the UI.
    const detail = errorDetail(err);
    toastRef.current?.addToast({
      type: 'error',
      message,
      ...(detail ? { detail } : {}),
    });
    console.warn("WorkspaceContext: failed to create session token", err);
  }, []);

  // ADR #4 Phase 3: Resolve the boot store first, then load workspaces.
  // This is called once on mount (or when the picker ticket changes).
  useEffect(() => {
    if (!pickerTicket) {
      setAvailableWorkspaces([]);
      setWorkspaceScreensState([]);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function boot() {
      setLoading(true);
      setError(null);

      // Step 1: Resolve the store from device binding or primary store.
      let storeId = DEFAULT_STORE_ID;
      try {
        // ADR #4 Phase 3: pass the device id so a bound terminal
        // auto-boots into its store+instance instead of the primary.
        const deviceId = await getDeviceId().catch(() => "");
        const resolution = await resolveBootStore(deviceId || undefined);
        storeId = resolution.store_id || DEFAULT_STORE_ID;
        if (!cancelled) {
          setResolvedStoreId(storeId);
        }
      } catch (err) {
        console.warn(
          "WorkspaceContext: boot store resolution failed, using default",
          err,
        );
        if (!cancelled) {
          setResolvedStoreId(DEFAULT_STORE_ID);
        }
      }

      // Step 2: Load workspace instances for the resolved store.
      await fetchWorkspaces(storeId, () => cancelled);

      if (!cancelled) {
        setLoading(false);
      }
    }

    boot();

    return () => {
      cancelled = true;
    };
  }, [pickerTicket, fetchWorkspaces]);

  useEffect(() => {
    let cancelled = false;
    if (!activeInstance) {
      setWorkspaceScreensState([]);
      return;
    }
    // audit-open-findings: the picker ticket binds the caller server-side — the screen
    // list is only readable by a genuinely-authenticated user.
    listWorkspaceScreens(
      pickerTicket ?? "",
      activeInstance.type_key,
      activeInstance.store_id,
    )
      .then((screens) => {
        if (cancelled) return;
        if (screens.length > 0) {
          setWorkspaceScreensState(screens.map((s) => s.screen_key));
        } else {
          setWorkspaceScreensState([]);
        }
      })
      .catch(() => {
        if (!cancelled) setWorkspaceScreensState([]);
      });
    return () => { cancelled = true; };
  }, [activeInstance, pickerTicket]);

  const [lastWorkspace, setLastWorkspace] = useState<string | null>(null);

  // ADR #4 / ADR #7: Create a session token when an instance is activated.
  // This effect fires after activeInstance changes (set by handleSetActiveInstance
  // or the useEffect that syncs from activeWorkspace).
  //
  // Settings/admin shell fallback: the topology editor, stores dashboard,
  // and offline-queue header make scoped commands without an active POS
  // workspace instance. When an authenticated user has no activeInstance,
  // mint a session scoped to the resolved store's admin instance so those
  // screens work. Activating a POS workspace afterwards re-runs this
  // effect and replaces the token (the refresh branch below).
  //
  // ADR #6: Skips token creation when isHotSwappingRef is set, because
  // swapSessionToken handles token lifecycle during a hot-swap.
  useEffect(() => {
    if (!session?.user_id) return;
    if (isHotSwappingRef.current) return; // ADR #6: swapSessionToken handles this

    // Active POS workspace first; otherwise the admin instance of the
    // resolved store (list_workspaces is picker-ticket verified, so the
    // instance id is trustworthy).
    const tokenInstance =
      activeInstance ??
      availableWorkspaces.find((i) => i.type_key === 'admin') ??
      null;
    if (!tokenInstance) return;

    // Remembered so a retry knows WHICH instance to re-mint, and so
    // `retrySessionToken` can be a no-op before anything was attempted.
    sessionAttemptRef.current = tokenInstance;

    let cancelled = false;

    // Resolve device ID for terminal binding (ADR #7), then refresh
    // the picker ticket and create session.
    (async () => {
      const deviceId = await getDeviceId().catch(() => "");
      if (cancelled) return;

      // ADR #6 re-entry: if a previous session exists (user pressed
      // Back from KDS), refresh the picker ticket BEFORE destroying
      // the old session. The ticket has a 5-minute TTL; if the user
      // spent longer than that at the workspace picker, the original
      // ticket from login is stale. The refresh re-mints a fresh
      // ticket using the still-valid session token.
      let ticket = pickerTicket ?? "";
      const prevToken = sessionTokenRef.current;
      if (prevToken) {
        try {
          const refreshed = await refreshPickerTicket(prevToken);
          ticket = refreshed.picker_ticket;
          updatePickerTicketFn(ticket);
        } catch {
          // Refresh failed (session expired?) — proceed with the
          // original ticket; createSession will reject if it's stale.
        }
      }

      if (cancelled) return;

      // Destroy any previous token before creating a new one.
      if (prevToken) {
        destroySession(prevToken).catch((err) =>
          reportTeardownFailure("token re-mint", err),
        );
        setSessionToken(null);
      }

      createSession({
        user_id: session.user_id,
        role_id: session.role_id,
        store_id: tokenInstance.store_id,
        instance_id: tokenInstance.instance_id,
        type_key: tokenInstance.type_key,
        terminal_id: deviceId,
        picker_ticket: ticket,
        ...(pendingOrgIdRef.current ? { org_id: pendingOrgIdRef.current } : {}),
      })
        .then((result) => {
          if (!cancelled) {
            setSessionToken(result.session_token);
            setOrgLabel(result.context.orgLabel ?? null);
            setPendingOrgId(null);
            setSessionError(null);
          }
        })
        .catch((err) => {
          if (!cancelled) {
            reportSessionTokenFailure(err);
          }
        });
    })();

    return () => {
      cancelled = true;
    };
  // tokenAttemptNonce is the retry lever: bumping it re-runs this effect over
  // the same instance, which is exactly what a retry must do (re-resolve the
  // device id, refresh the picker ticket, destroy the stale token, re-mint).
  }, [activeInstance, session, availableWorkspaces, pickerTicket, updatePickerTicketFn, tokenAttemptNonce, reportSessionTokenFailure]);

  // Retry lever for a failed create_session. Bumping the nonce re-fires the
  // effect above; the remembered instance is what makes the replay targeted,
  // and its absence (nothing ever attempted) makes this a no-op.
  const retrySessionToken = useCallback(() => {
    if (!sessionAttemptRef.current) return;
    setSessionError(null);
    setTokenAttemptNonce((n) => n + 1);
  }, []);


  // Backward-compat: sets the type_key string directly.
  // lastWorkspace persists even when returning to the workspace picker
  // (key === null) so the last-used card keeps its active indicator —
  // matching the interface contract above. It is cleared only on a fresh
  // login/logout: the reset effect also calls setActiveInstance(null),
  // which routes through handleSetActiveInstance and clears it.
  const handleSetActive = useCallback((key: string | null) => {
    if (key) setLastWorkspace(key);
    setActiveWorkspace(key);
    // activeInstance syncs via useEffect above
  }, []);

  // ADR #4: set active instance directly.
  // Always updates lastWorkspace — even with null — so the active
  // card visual is cleared when returning to the workspace picker.
  const handleSetActiveInstance = useCallback(
    (instance: WorkspaceDto | null) => {
      if (instance) {
        setActiveWorkspace(instance.type_key);
        setLastWorkspace(instance.type_key);
      } else {
        setActiveWorkspace(null);
        setLastWorkspace(null);
      }
      setActiveInstance(instance);
    },
    [],
  );

  const retry = useCallback(() => {
    if (!pickerTicket) return;
    setLoading(true);
    setError(null);
    fetchWorkspaces(resolvedStoreId, () => false).finally(() =>
      setLoading(false),
    );
  }, [pickerTicket, resolvedStoreId, fetchWorkspaces]);

  // Derived scope from active instance
  const scope: WorkspaceScope | null = useMemo(
    () =>
      activeInstance
        ? {
            storeId: activeInstance.store_id,
            instanceId: activeInstance.instance_id,
            typeKey: activeInstance.type_key,
          }
        : null,
    [activeInstance],
  );

  // Memoized so a provider re-render that changes none of these fields
  // (any state churn outside this list) hands consumers the SAME value
  // object and skips their re-render. Every function captured here is
  // useCallback-stable: handleSetActive/handleSetActiveInstance ([]),
  // retry ([pickerTicket, resolvedStoreId, fetchWorkspaces]),
  // switchStore ([fetchWorkspaces]), swapSessionToken
  // ([updatePickerTicketFn] — stable per the comment at its deps), and
  // retrySessionToken ([] — it reads only refs and a state setter).
  const value = useMemo(
    () => ({
      activeWorkspace,
      setActiveWorkspace: handleSetActive,
      activeInstance,
      setActiveInstance: handleSetActiveInstance,
      availableWorkspaces,
      workspaceScreens,
      loading,
      error,
      retry,
      lastWorkspace,
      switchStore,
      resolvedStoreId,
      sessionToken,
      swapSessionToken,
      terminalId,
      orgLabel,
      setPendingOrgId,
      switchOrganization,
      sessionError,
      retrySessionToken,
    }),
    [
      activeWorkspace,
      handleSetActive,
      activeInstance,
      handleSetActiveInstance,
      availableWorkspaces,
      workspaceScreens,
      loading,
      error,
      retry,
      lastWorkspace,
      switchStore,
      resolvedStoreId,
      sessionToken,
      swapSessionToken,
      terminalId,
      orgLabel,
      setPendingOrgId,
      switchOrganization,
      sessionError,
      retrySessionToken,
    ],
  );

  return (
    <WorkspaceScopeContext.Provider value={scope}>
      <WorkspaceContext.Provider value={value}>
        {children}
      </WorkspaceContext.Provider>
    </WorkspaceScopeContext.Provider>
  );
}

/** Access the workspace context. Must be used within a `<WorkspaceProvider>`. */
// eslint-disable-next-line react-refresh/only-export-components
export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx)
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  return ctx;
}
