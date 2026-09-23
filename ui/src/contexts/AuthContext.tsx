/* eslint-disable react-refresh/only-export-components */
// Vite React Refresh: force full remount on HMR to prevent stale
// AuthContext mismatch.
/// @refresh reset
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { staffLogin, type LoginSessionDto } from "@/api/staff";
import { classifyRetry, plainErrorMessage, USER_ERROR_FALLBACKS } from "@/utils/app-error";

// ── Types ───────────────────────────────────────────────────────────

export interface AuthState {
  /** The currently logged-in user's session, or null if not logged in. */
  session: LoginSessionDto | null;
  /**
   * Short-lived picker ticket (audit-open-findings) minted at login.
   *
   * Consumed by the pre-session workspace picker (`listWorkspaces` /
   * `listWorkspaceScreens`) until `createSession` returns the opaque
   * session token. Cleared on logout and replaced on hot-swap.
   */
  pickerTicket: string | null;
  /** Whether a login attempt is in progress. */
  loading: boolean;
  /** Error message from the last failed login attempt. */
  error: string | null;
}

export interface AuthContextValue extends AuthState {
  /** Attempt to log in with username and PIN. */
  login: (username: string, pin: string) => Promise<void>;
  /** Log out the current user. */
  logout: () => void;
  /** Clear any login error. */
  clearError: () => void;
  /** Whether the current user has manager-level access or higher. */
  isManager: boolean;
  /** Whether the current user has owner-level access. */
  isOwner: boolean;
  /**
   * ADR #6: Hot-swap the session to a different user without triggering
   * the full login/logout lifecycle (no workspace reset). Used by
   * FastPINOverlay for shared touchscreen operator switching.
   *
   * `pickerTicket` is the fresh ticket from the hot-swap login; pass it
   * when available so the picker stays bound to the new user (audit-open-findings).
   */
  swapSession: (session: LoginSessionDto, pickerTicket?: string) => void;
  /**
   * ADR #6: Replace the picker ticket without changing the session.
   * Used by WorkspaceContext when refreshing a stale picker ticket.
   */
  updatePickerTicket?: (ticket: string) => void;
}

// ── Context ─────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

// ── Provider ────────────────────────────────────────────────────────

interface AuthProviderProps {
  children: ReactNode;
  /** Called when the user successfully logs in. Can be used to dismiss the login screen. */
  onLogin?: () => void;
}

/**
 * Turn a failed `staff_login` into copy the merchant may read.
 *
 * Two kinds of failure arrive here and they must not be confused:
 *
 * - An INTENDED refusal from the server ("Invalid credentials", a rate-limit
 *   sentence). That text is written for the user and is what the login screen
 *   has always shown — the E2E suite asserts it verbatim.
 * - A TRANSPORT failure. On a flaky connection that is an untyped `Error` whose
 *   message is internal ("network down", or a Rust error string). Rendering it
 *   leaked internals to the cashier: measured 2026-09-23, the PIN step showed
 *   the literal text "network down" where "check your connection" belonged.
 *
 * `classifyRetry` is the existing owner of exactly this distinction and is
 * already tested against this vocabulary, so the split is delegated to it rather
 * than re-deriving a keyword list here. A retryable transport failure gets the
 * shared user-safe copy; anything else keeps the server's own message, because
 * that is the copy the login screen is designed around.
 */
function loginErrorMessage(err: unknown): string {
  if (classifyRetry(err) === 'retryable') {
    return USER_ERROR_FALLBACKS['app-error-offline'] ?? 'You appear to be offline. Check your connection and try again.';
  }
  const stated = (err as Record<string, unknown> | null)?.['message'];
  if (typeof stated === 'string' && stated.trim() !== '') return stated;
  return plainErrorMessage(err, "Login failed");
}
/**
 * Provides authentication state and login/logout actions to the app.
 *
 * Wrap this around the app shell. Before the user logs in, show the
 * StaffLoginScreen. After login, the session is available via `useAuth()`.
 */
export function AuthProvider({ children, onLogin }: AuthProviderProps) {
  const [session, setSession] = useState<LoginSessionDto | null>(null);
  const [pickerTicket, setPickerTicket] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);

  const login = useCallback(
    async (username: string, pin: string) => {
      if (submittingRef.current) return;
      submittingRef.current = true;
      setLoading(true);
      setError(null);
      try {
        const result = await staffLogin({ username, pin });
        setSession(result.session);
        setPickerTicket(result.picker_ticket);
        try { sessionStorage.setItem('current-username', username); } catch { /* ignore */ }
        onLogin?.();
      } catch (err) {
        setError(loginErrorMessage(err));
      } finally {
        setLoading(false);
        submittingRef.current = false;
      }
    },
    [onLogin],
  );

  const logout = useCallback(() => {
    setSession(null);
    setPickerTicket(null);
    setError(null);
    try { sessionStorage.removeItem('current-username'); } catch { /* ignore */ }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  /**
   * ADR #6: Replace the current session with a new user's session
   * without triggering the login flow (no loading/error reset, no onLogin).
   * This is the hot-swap path used by FastPINOverlay.
   *
   * audit-open-findings: the picker ticket is replaced alongside the session so the
   * pre-session picker stays bound to the freshly-authenticated user.
   */
  const swapSession = useCallback((newSession: LoginSessionDto, newPickerTicket?: string) => {
    setSession(newSession);
    setPickerTicket(newPickerTicket ?? null);
    setError(null);
  }, []);

  const updatePickerTicket = useCallback((ticket: string) => {
    setPickerTicket(ticket);
  }, []);

  // The backend returns display names from the seeded roles ("Owner",
  // "Manager", "Staff"), while older clients and tests may provide the
  // stable lowercase role keys. Normalize once so authorization-sensitive UI
  // gates behave identically for either representation.
  const normalizedRoleName = session?.role_name.trim().toLowerCase();
  // Management-level gate (0048): owner/admin/manager only. Staff is a
  // checkout-operations role and must NOT reach void, refund, price
  // override, audit export, or full settings — the backend denies those
  // (sales:void / sales:refund / sales:override_price / audit:export are
  // not in the Staff preset), so the buttons must be hidden too.
  const isManager =
    normalizedRoleName === "manager" ||
    normalizedRoleName === "owner" ||
    normalizedRoleName === "admin" ||
    normalizedRoleName === "role-manager" ||
    normalizedRoleName === "role-owner" ||
    normalizedRoleName === "role-admin";
  const isOwner =
    normalizedRoleName === "owner" ||
    normalizedRoleName === "role-owner";

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      pickerTicket,
      loading,
      error,
      login,
      logout,
      clearError,
      swapSession,
      updatePickerTicket,
      isManager,
      isOwner,
    }),
    [
      session,
      pickerTicket,
      loading,
      error,
      login,
      logout,
      clearError,
      swapSession,
      updatePickerTicket,
      isManager,
      isOwner,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ── Hook ────────────────────────────────────────────────────────────

/**
 * Access the current authentication state and login/logout actions.
 *
 * @example
 * ```tsx
 * const { session, login, logout, isManager } = useAuth();
 * if (!session) return <StaffLoginScreen />;
 * ```
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an <AuthProvider>");
  }
  return ctx;
}
