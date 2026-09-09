//! `useSyncConnection` — lightweight sync server connectivity poller.
//!
//! Polls the cloud sync server's health endpoint every 60 s via the
//! `test_sync_connection` IPC command. Returns a simple state enum so
//! the StatusBar can show a green/red/yellow dot without pulling in
//! the full `useCloudSync` hook (which manages auth, localStorage, and
//! the sync cycle — too heavy for a header indicator).

import { useState, useEffect, useRef } from 'react';
import { testSyncConnection } from '@/api/offline';
import type { ConnectionHealth } from '@/hooks/connectionHealth';

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
}

const POLL_INTERVAL_MS = 60_000;
const RETRY_INTERVAL_MS = 5_000;

/**
 * Poll the cloud sync server health endpoint on mount and every 60 s
 * while connected. Retry every 5 s while disconnected so a Docker server
 * or debug auto-provisioner that becomes ready after the UI can recover
 * without requiring an app restart.
 *
 * Returns `{ state, latencyMs }` suitable for rendering a connection
 * indicator dot in the StatusBar.
 *
 * - `'checking'` — initial state before the first ping resolves.
 * - `'connected'` — last ping succeeded (`ok: true`).
 * - `'disconnected'` — last ping failed (network error or `ok: false`).
 */
export function useSyncConnection(): SyncConnectionStatus {
  const [state, setState] = useState<SyncConnectionState>('checking');
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let timer: number | undefined;

    async function check() {
      let nextDelay = RETRY_INTERVAL_MS;
      try {
        const result = await testSyncConnection();
        if (!mountedRef.current) return;

        if (result.ok) {
          setState('connected');
          setLatencyMs(result.latencyMs);
          nextDelay = POLL_INTERVAL_MS;
        } else {
          setState('disconnected');
          setLatencyMs(null);
        }
      } catch {
        if (!mountedRef.current) return;
        setState('disconnected');
        setLatencyMs(null);
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

  // cause is a constant here — see the field doc. Sync gains a real value
  // when its probe starts reading the health payload instead of the status
  // code, which is the same fix the license probe just had.
  return { state, latencyMs, cause: null };
}
