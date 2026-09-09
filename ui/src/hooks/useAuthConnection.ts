//! `useAuthConnection` — lightweight auth server connectivity poller.
//!
//! Polls the license server's `/api/health` endpoint via the `test_auth_connection`
//! IPC command (Rust-side HTTP, no CORS). Returns a simple state enum so the
//! StatusBar can show a green/red/yellow dot without pulling in the full
//! license-activation machinery.
//!
//! Mirrors `useSyncConnection` so both indicators use the same polling pattern.

import { useState, useEffect, useRef } from 'react';
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
}

const POLL_INTERVAL_MS = 60_000;
const RETRY_INTERVAL_MS = 5_000;

/**
 * Poll the auth server's health endpoint on mount and every 60 s while
 * connected. Retry every 5 s while disconnected so the login screen can
 * recover when the server becomes reachable again.
 *
 * Returns `{ state, latencyMs }` suitable for rendering a connection
 * indicator in the StatusBar.
 *
 * - `'checking'` — initial state before the first ping resolves.
 * - `'connected'` — last ping succeeded (`ok: true`).
 * - `'disconnected'` — last ping failed (network error or `ok: false`).
 */
export function useAuthConnection(): AuthConnectionStatus {
  const [state, setState] = useState<AuthConnectionState>('checking');
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [cause, setCause] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let timer: number | undefined;

    async function check() {
      let nextDelay = RETRY_INTERVAL_MS;
      try {
        const result = await testAuthConnection();
        if (!mountedRef.current) return;

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
        if (!mountedRef.current) return;
        setState('disconnected');
        setLatencyMs(null);
        setCause(null);
      }

      if (mountedRef.current) {
        timer = window.setTimeout(check, nextDelay);
      }
    }

    // Initial check immediately.
    void check();

    return () => {
      mountedRef.current = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  return { state, latencyMs, cause };
}