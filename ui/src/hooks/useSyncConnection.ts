//! `useSyncConnection` — lightweight sync server connectivity poller.
//!
//! Polls the cloud sync server's health endpoint every 60 s via the
//! `test_sync_connection` IPC command. Returns a simple state enum so
//! the StatusBar can show a green/red/yellow dot without pulling in
//! the full `useCloudSync` hook (which manages auth, localStorage, and
//! the sync cycle — too heavy for a header indicator).
//!
//! Exposes `retryNow` — the user-triggered re-probe the service-health
//! contracts box (todo-global-saas-3.md) asks for, mirroring the
//! useAuthConnection implementation so all four status-bar pills share
//! one retry contract.

import { useState, useEffect, useRef, useCallback } from 'react';
import { testSyncConnection } from '@/api/offline';
import { isSyncUnconfigured, type ConnectionHealth } from '@/hooks/connectionHealth';

/**
 * Connection state to the cloud sync server. An alias onto the shared
 * vocabulary — this union and `AuthConnectionState` were written out
 * identically twice, and the duplication is why a new state would have to be
 * handled in each copy separately.
 */
export type SyncConnectionState = ConnectionHealth;

/**
 * Return type of the `useSyncConnection` hook.
 *
 * SYNC-12: the hook is deliberately presentation-agnostic — it exposes only
 * raw state and latency, never user-visible label strings. Renderers
 * (StatusBar, login screens) localize at the boundary via Fluent keys, so
 * no hardcoded English (`Checking…` / `Disconnected`) can leak here.
 */
export interface SyncConnectionStatus {
  /** Current connectivity state. */
  state: SyncConnectionState;
  /** Round-trip latency in milliseconds, or null if unknown/offline. */
  latencyMs: number | null;
  /**
   * Always null for sync today. The sync probe reduces the server's answer to
   * a status code and never reads the health payload, so there is no named
   * cause to report. Carrying the field keeps both indicators rendering from
   * one shape, and its emptiness marks the gap instead of hiding it.
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
 * Poll the cloud sync server health endpoint on mount and every 60 s
 * while connected. Retry every 5 s while disconnected so a Docker server
 * or debug auto-provisioner that becomes ready after the UI can recover
 * without requiring an app restart.
 *
 * Returns `{ state, latencyMs, cause, retryNow }` suitable for rendering a
 * connection indicator dot in the StatusBar.
 *
 * - `'checking'` — initial state before the first ping resolves.
 * - `'connected'` — last ping succeeded (`ok: true`).
 * - `'unconfigured'` — the probe ran and answered "No server URL configured":
 *   this device has never been pointed at a sync server, so there is nothing
 *   to be reachable or unreachable. Distinct from `'disconnected'` because
 *   the fix is a different one (configure sync) and the fault is not a fault.
 * - `'disconnected'` — a ping ran and failed (network error or `ok: false`
 *   with a configured server).
 */
export function useSyncConnection(): SyncConnectionStatus {
  const [state, setState] = useState<SyncConnectionState>('checking');
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const mountedRef = useRef(true);

  // Manual retry: bumping the sequence supersedes whatever the previous
  // probe was about to schedule — the stale timer it arms is recognized by
  // its sequence number and dropped, and the pending poll timer is cancelled,
  // so clicking Retry during the backoff re-probes now instead of stacking a
  // second loop. Same contract as useAuthConnection.
  const probeSeqRef = useRef(0);
  const bumpProbe = useCallback(() => {
    probeSeqRef.current += 1;
    return probeSeqRef.current;
  }, []);
  const timerRef = useRef<number | undefined>(undefined);
  const checkRef = useRef<(() => void) | null>(null);

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
        const result = await testSyncConnection();
        if (!mountedRef.current || seq !== probeSeqRef.current) return;

        if (result.ok) {
          setState('connected');
          setLatencyMs(result.latencyMs);
          nextDelay = POLL_INTERVAL_MS;
        } else if (isSyncUnconfigured(result.status, result.ok)) {
          // The probe distinguishes these two answers; the UI used to throw
          // that away. Keep the 5 s cadence: a bootstrap flow that writes the
          // URL while the app is open is exactly the recovery this loop is
          // for, and it costs nothing when no such flow ever runs.
          setState('unconfigured');
          setLatencyMs(null);
        } else {
          setState('disconnected');
          setLatencyMs(null);
        }
      } catch {
        if (!mountedRef.current || seq !== probeSeqRef.current) return;
        setState('disconnected');
        setLatencyMs(null);
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

  // cause is a constant here — see the field doc. Sync gains a real value
  // when its probe starts reading the health payload instead of the status
  // code, which is the same fix the license probe just had.
  return { state, latencyMs, cause: null, retryNow };
}
