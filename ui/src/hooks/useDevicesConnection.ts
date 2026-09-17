//! `useDevicesConnection` — device-connectivity status for the status bar.
//!
//! Probes `discover_hardware_scoped` (USB enumeration over kasirmu-hal) and folds
//! the answer into the shared `ConnectionHealth` vocabulary. This is the
//! ServiceKind::DeviceConnectivity slice of the service-health contracts box
//! (todo-global-saas-3.md): a device-side answer, not a placeholder. The full
//! device list stays in Settings → Devices & Connectivity; this pill only
//! answers "can the till see its hardware right now".

import { useCallback, useEffect, useRef, useState } from 'react';
import { discoverHardwareScoped } from '@/api/hardware';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import type { ConnectionHealth } from '@/hooks/connectionHealth';

/** Device-connectivity status in the shared health vocabulary. */
export interface DevicesConnectionStatus {
  /** Whether the device bus is answering and reporting hardware. */
  state: ConnectionHealth;
  /**
   * Always null today: enumeration is not a timed round-trip. Carried so all
   * four status-bar probes render from one shape (StatusBar).
   */
  latencyMs: number | null;
  /** Always null: enumeration is binary, there is no named subsystem cause. */
  cause: string | null;
  /** Device count from the last successful probe (0 while checking). */
  devices: number;
  /** Re-probe immediately; same contract as `useAuthConnection`. */
  retryNow: () => void;
}

const POLL_INTERVAL_MS = 60_000;

/**
 * Poll USB device enumeration every 60 s while a workspace session token is
 * available (ADR #7: the command is scoped). Any device answering reads
 * `connected`; an empty bus reads `disconnected` — a till that cannot see a
 * single device is a real operator problem, not an idle-green one. A failed
 * or pre-session probe keeps `checking`: the UI never claims an outage it
 * did not observe. The effect re-runs when the token appears, so the pill
 * wakes up on its own after login.
 *
 * Mirrors `useAuthConnection`'s manual-retry contract so every status-bar
 * pill behaves the same way when an operator clicks it.
 */
export function useDevicesConnection(): DevicesConnectionStatus {
  const { sessionToken } = useWorkspace();
  const [state, setState] = useState<ConnectionHealth>('checking');
  const [devices, setDevices] = useState(0);
  const mountedRef = useRef(true);

  // Same sequence-guarded retry as useAuthConnection — see the comment there.
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
      if (!sessionToken) {
        // Pre-session (login / lock screens): no scoped token to probe with.
        // Stays `checking`; the effect re-runs when the token appears.
        if (mountedRef.current && seq === probeSeqRef.current) {
          timerRef.current = window.setTimeout(check, POLL_INTERVAL_MS);
        }
        return;
      }
      try {
        const list = await discoverHardwareScoped(sessionToken);
        if (!mountedRef.current || seq !== probeSeqRef.current) return;
        setDevices(list.length);
        setState(list.length > 0 ? 'connected' : 'disconnected');
      } catch {
        // Unscoped/no-session rejection (ADR #7) or a transport failure keeps
        // the previous reading; the poll keeps its cadence below.
        if (!mountedRef.current || seq !== probeSeqRef.current) return;
      }

      if (mountedRef.current && seq === probeSeqRef.current) {
        timerRef.current = window.setTimeout(check, POLL_INTERVAL_MS);
      }
    }

    checkRef.current = check;
    void check();

    return () => {
      mountedRef.current = false;
      checkRef.current = null;
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    };
  }, [sessionToken, bumpProbe]);

  return { state, latencyMs: null, cause: null, devices, retryNow };
}
