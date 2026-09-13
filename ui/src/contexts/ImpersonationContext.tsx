import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { destroySession } from '@/api/staff';

/**
 * State for an in-flight operator impersonation session.
 *
 * The operator stays logged in as themselves; this context only records the
 * token minted by `impersonate_user_scoped` so the UI can show a persistent
 * "impersonating <user>" banner and stop (revoke) it. The token is scoped to
 * the target user only — the operator's own grants are never merged, so there
 * is no privilege amplification (see S2 ruling #3 / no-amplification invariant).
 */
export interface ActiveImpersonation {
  /** Session token returned by impersonate_user_scoped (target-scoped). */
  token: string;
  /** The impersonated user's id. */
  targetUserId: string;
  /** The impersonated user's display name, for the banner copy. */
  targetDisplayName: string;
}

interface ImpersonationContextValue {
  /** The currently active impersonation, or null when not impersonating. */
  active: ActiveImpersonation | null;
  /** Begin impersonating: record the minted token + target for the banner. */
  start: (token: string, targetUserId: string, targetDisplayName: string) => void;
  /** Stop impersonating: revoke the token, then clear UI state. */
  stop: () => Promise<void>;
}

const ImpersonationContext = createContext<ImpersonationContextValue | null>(null);

export function ImpersonationProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveImpersonation | null>(null);
  // Mirror active into a ref so stop() always revokes the latest token even
  // if it is invoked from a stale render closure.
  const activeRef = useRef<ActiveImpersonation | null>(null);
  activeRef.current = active;

  const start = useCallback((token: string, targetUserId: string, targetDisplayName: string) => {
    setActive({ token, targetUserId, targetDisplayName });
  }, []);

  const stop = useCallback(async () => {
    const current = activeRef.current;
    if (current) {
      try {
        await destroySession(current.token);
      } catch {
        // Revocation is best-effort: the backend TTL also expires the token,
        // and the UI state clears regardless so the banner disappears.
      }
    }
    setActive(null);
  }, []);

  const value = useMemo<ImpersonationContextValue>(
    () => ({ active, start, stop }),
    [active, start, stop],
  );

  return <ImpersonationContext.Provider value={value}>{children}</ImpersonationContext.Provider>;
}

export function useImpersonation(): ImpersonationContextValue {
  const ctx = useContext(ImpersonationContext);
  if (!ctx) {
    throw new Error('useImpersonation must be used within an ImpersonationProvider');
  }
  return ctx;
}
