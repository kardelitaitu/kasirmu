//! `usePaymentConnection` — payment service status for the status bar.
//!
//! Reads the payment-gateway configuration the backend already computes
//! (`gateway_status`; UI-1 keeps the booleans server-side so raw credentials
//! never reach the renderer) and folds it into the shared `ConnectionHealth`
//! vocabulary, so the payment pill renders from the same states as auth and
//! sync. This is the ServiceKind::Payment slice of the service-health
//! contracts box (todo-global-saas-3.md): the EDC-terminal handshake itself
//! has no pollable IPC surface yet, and this hook is deliberately the place
//! that gap is named instead of hidden.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getGatewayStatus } from '@/api/gateway';
import type { ConnectionHealth } from '@/hooks/connectionHealth';

/** Payment-service status in the shared health vocabulary. */
export interface PaymentConnectionStatus {
  /** Overall payment service health derived from gateway configuration. */
  state: ConnectionHealth;
  /**
   * Always null today: a configuration probe measures no round-trip.
   * Carried so all four status-bar probes render from one shape (StatusBar).
   */
  latencyMs: number | null;
  /** Always null: configuration probes carry no named subsystem cause. */
  cause: string | null;
  /** Number of payment gateways configured on this device. */
  gateways: number;
  /** Re-probe immediately; same contract as `useAuthConnection`. */
  retryNow: () => void;
}

const POLL_INTERVAL_MS = 60_000;

/**
 * Poll the payment-gateway status on mount and every 60 s. At least one
 * configured gateway reads `connected`; none reads `disconnected` — a
 * payment service with zero gateways cannot take a card payment, so green
 * there would lie. A failed read keeps the previous reading: a broken config
 * lookup is not evidence the service is down, and inventing an outage would
 * paint the pill red for a problem the till does not have.
 *
 * Mirrors `useAuthConnection`'s manual-retry contract so every status-bar
 * pill behaves the same way when an operator clicks it.
 */
export function usePaymentConnection(): PaymentConnectionStatus {
  const [state, setState] = useState<ConnectionHealth>('checking');
  const [gateways, setGateways] = useState(0);
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
      try {
        const list = await getGatewayStatus();
        if (!mountedRef.current || seq !== probeSeqRef.current) return;
        const configured = list.filter((g) => g.configured).length;
        setGateways(configured);
        setState(configured > 0 ? 'connected' : 'disconnected');
      } catch {
        // Unmount or a newer manual retry superseded this probe; the last
        // reading stands either way. The poll keeps its cadence below.
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
  }, [bumpProbe]);

  return { state, latencyMs: null, cause: null, gateways, retryNow };
}
