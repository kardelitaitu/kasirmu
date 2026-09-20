//! `useAuthConnection` — lightweight auth server connectivity poller.
//!
//! Polls the auth server's health endpoint over IPC (Rust-side HTTP, no CORS) and
//! returns a simple state enum so the StatusBar can show a green/red/yellow dot
//! without pulling in any activation machinery.
//!
//! The probe is capability-aware: it is chosen ONCE, before the first call, from the
//! shell that is running (see `isTabletShell`). The tablet build registers no licence
//! commands at all, so `test_auth_connection` is rejected by the IPC boundary there
//! and would leave the pill blinking UNKNOWN forever; the tablet therefore probes
//! `test_sync_connection`, which the mobile shell registers, and reports the real
//! answer. Desktop is unchanged and still calls `test_auth_connection`.
//!
//! Mirrors `useSyncConnection` so both indicators use the same polling pattern,
//! and exposes `retryNow` — the user-triggered re-probe the service-health
//! contracts box (todo-global-saas-3.md) asks for, wired to the status-bar pill.

import { useState, useEffect, useRef, useCallback } from 'react';
import { testAuthConnection, type AuthPingResult } from '@/api/license';
import { testSyncConnection, type PingResult } from '@/api/offline';
import { fromWireHealth, type ConnectionHealth } from '@/hooks/connectionHealth';
import { isUnaskableCommandError } from '@/utils/app-error';
import { isTabletShell } from '@/utils/shellKind';

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
 * What either probe answers. The auth probe carries the server's own health
 * reading; the tablet's sync probe is a plain reachability ping. Both shapes
 * are read only through the fields they actually declare, so a ping that
 * sends no `state` falls back to its reachability answer instead of a health
 * reading nobody measured.
 */
type ProbeResult = AuthPingResult | PingResult;

/** Shell-aware probe: picked before the first call, never after a failure. */
type Probe = () => Promise<ProbeResult>;

/**
 * Poll the auth server's health endpoint on mount and every 60 s while
 * connected. Retry every 5 s while disconnected so the login screen can
 * recover when the server becomes reachable again.
 *
 * Returns `{ state, latencyMs, cause, retryNow }` suitable for rendering a
 * connection indicator in the StatusBar.
 *
 * - `'checking'` — UNKNOWN: the state before the first ping resolves, and also
 *   the TERMINAL state when a probe cannot ask at all (the command is not
 *   registered here, so no ping was ever sent). Not re-polled; the two cases
 *   share a tone deliberately — neither is a claim about the server. Tablet
 *   probes a command the tablet shell does register, so it resolves instead.
 * - `'connected'` — last ping succeeded (`ok: true`).
 * - `'disconnected'` — a ping ran and failed (network error or `ok: false`).
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

    // The probe is chosen HERE, before any call — not from a failure. The
    // tablet shell registers no licence commands, so `test_auth_connection`
    // cannot run there and would leave the pill UNKNOWN forever; the tablet
    // asks the sync probe the mobile shell does register. Desktop is
    // untouched. Read once at mount: the shell is set before render and a
    // bundle cannot become another bundle.
    const probe: Probe = isTabletShell() ? testSyncConnection : testAuthConnection;

    async function check() {
      const seq = bumpProbe();
      let nextDelay = RETRY_INTERVAL_MS;
      try {
        const result = await probe();
        if (!mountedRef.current || seq !== probeSeqRef.current) return;

        // A degraded server answers, so it is reachable: keep the normal
        // poll cadence rather than dropping to the 5 s retry loop, which
        // would have the client hammering a server that is already talking
        // to us and just wants its database fixed.
        // Only the auth payload declares a health reading. The tablet's ping
        // sends neither field, and reading them off a shape that never had
        // them would invent health — so it falls through `fromWireHealth`'s
        // own default: the reachability answer, which is what it measured.
        const wireState = 'state' in result ? result.state : undefined;
        const wireCause = 'cause' in result ? result.cause : undefined;
        const health = fromWireHealth(wireState, result.ok);
        setState(health);
        setCause(health === 'degraded' ? (wireCause ?? null) : null);
        if (health === 'disconnected') {
          setLatencyMs(null);
        } else {
          setLatencyMs(result.latencyMs);
        }
        nextDelay = result.ok || health === 'degraded' ? POLL_INTERVAL_MS : RETRY_INTERVAL_MS;
      } catch (err) {
        if (!mountedRef.current || seq !== probeSeqRef.current) return;

        // TWO different facts arrive through this catch and only one of them is
        // an outage. On a shell that never registered the command — the tablet
        // registers no license commands at all, which is why the probe above
        // never routes `testAuthConnection` there — `testAuthConnection` is
        // rejected by the IPC boundary before a request exists, so
        // `disconnected` there is a claim about a server we never reached: it
        // paints the pill red forever and the 5 s band below re-issued the same
        // impossible call each cycle, every one of them costing a real failed
        // invoke, one `emitIpcError` and one `recordIpcTiming` sample for a
        // probe that cannot run. `isUnaskableCommandError` asks `classifyRetry`
        // first — its `not found` branch already says re-asking cannot change
        // this — so the class is the registry miss alone and the verdict has one
        // owner. It lands on the union's UNKNOWN, whose tone is not red, with
        // nothing measured to report, and returns BEFORE the re-arm: a missing
        // capability is a property of the binary, not a condition that recovers
        // on a timer. `retryNow` still re-probes on demand, so a build that
        // gains the command is picked up without a reload. A throw that is not
        // this class — a real transport failure — falls through to the outage
        // branch below and keeps both the red pill and the 5 s band.
        if (isUnaskableCommandError(err)) {
          setState('checking');
          setLatencyMs(null);
          setCause(null);
          return;
        }

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
