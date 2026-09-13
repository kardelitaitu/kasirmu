//! `useAuthConnection` — lightweight auth server connectivity poller.
//!
//! Polls the license server's `/api/health` endpoint via the `test_auth_connection`
//! IPC command (Rust-side HTTP, no CORS). Returns a simple state enum so the
//! StatusBar can show a green/red/yellow dot without pulling in the full
//! license-activation machinery.
//!
//! Mirrors `useSyncConnection` so both indicators use the same polling pattern,
//! and exposes `retryNow` — the user-triggered re-probe the service-health
//! contracts box (todo-global-saas-3.md) asks for, wired to the status-bar pill.

import { useState, useEffect, useRef, useCallback } from 'react';
import { testAuthConnection } from '@/api/license';
import { fromWireHealth, type ConnectionHealth } from '@/hooks/connectionHealth';

/**
 * Connection state to the auth server. An alias onto the shared vocabulary
 * rather than a second copy of it — this union and `SyncConnectionState` were
 * written out identically twice, which is how a state ends up handled in one
 * indicator and missed in the next.
 */
export type AuthConnectionState = ConnectionHealth;

/**
 * Return type of the `useAuthConnection` hook.
 */
export interface AuthConnectionStatus {
  /** Current connectivity state. */
  state: AuthConnectionState;
  /** Round-trip latency in milliseconds, or null if unknown/offline. */
  latencyMs: number | null;
  /**
   * What the server named as broken when `state` is `'degraded'`, or null.
   * Surfaced verbatim from the health payload: it is the server's own
   * subsystem label, not something the client should translate into a guess.
   */
  cause: string | null;
  /**
   * Re-probe immediately instead of waiting for the next scheduled poll.
   * A pending in-flight probe's result is discarded in favour of the fresh
   * one, so a click can never double-apply. No-op after unmount.
   */
  retryNow: () => void;
}

const POLL_INTERVAL_MS = 60_000;
const RETRY_INTERVAL_MS = 5_000;

/**
 * Poll the auth server's health endpoint on mount and every 60 s while
 * connected. Retry every 5 s while disconnected so the login screen can
 * recover when the server becomes reachable again.
 *
 * Returns `{ state, latencyMs, cause, retryNow }` suitable for rendering a
 * connection indicator in the StatusBar.
 *
 * - `'checking'` — initial state before the first ping resolves.
 * - `'connected'` — last ping succeeded (`ok: true`).
 * - `'disconnected'` — last ping failed (network error or `ok: false`).
 * - `'degraded'` — the server answered but named a broken subsystem.
 */
export function useAuthConnection(): AuthConnectionStatus {
  const [state, setState] = useState<AuthConnectionState>('checking');
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [cause, setCause] = useState<string | null>(null);
  const mountedRef = useRef(true);

  // Manual retry: bumping the sequence supersedes whatever the previous
  // probe was about to schedule — the stale timer it arms is recognized by
  // its sequence number and dropped, so clicking Retry during the 5 s backoff
  // re-probes now instead of stacking a second loop.
  const probeSeqRef = useRef(0);
  const bumpProbe = useCallback(() => {
    probeSeqRef.current += 1;
    return probeSeqRef.current;
  }, []);
  const checkRef = useRef<(() => void) | null>(null);

  const timerRef = useRef<number | undefined>(undefined);

  const retryNow = useCallback(() => {
    if (!mountedRef.current) return;
    bumpProbe();
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    checkRef.current?.();
  }, [bumpProbe]);

  useEffect(() => {
    mountedRef.current = true;

    async function check() {
      const seq = bumpProbe();
      let nextDelay = RETRY_INTERVAL_MS;
      try {
        const result = await testAuthConnection();
        if (!mountedRef.current || seq !== probeSeqRef.current) return;

        // A degraded server answers, so it is reachable: keep the normal
        // poll cadence rather than dropping to the 5 s retry loop, which
        // would have the client hammering a server that is already talking
        // to us and just wants its database fixed.
        const health = fromWireHealth(result.state, result.ok);
        setState(health);
        setCause(health === 'degraded' ? (result.cause ?? null) : null);
        if (health === 'disconnected') {
          setLatencyMs(null);
        } else {
          setLatencyMs(result.latencyMs);
        }
        nextDelay = result.ok || health === 'degraded' ? POLL_INTERVAL_MS : RETRY_INTERVAL_MS;
      } catch {
        if (!mountedRef.current || seq !== probeSeqRef.current) return;
        setState('disconnected');
        setLatencyMs(null);
        setCause(null);
      }

      if (mountedRef.current && seq === probeSeqRef.current) {
        timerRef.current = window.setTimeout(check, nextDelay);
      }
    }

    checkRef.current = check;

    // Initial check immediately.
    void check();

    return () => {
      mountedRef.current = false;
      checkRef.current = null;
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    };
  }, [bumpProbe]);

  return { state, latencyMs, cause, retryNow };
}
