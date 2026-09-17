import { useState, useEffect } from 'react';
import { getGatewayStatus } from '@/api/gateway';

/** Describes a payment gateway's connection state. */
export interface GatewayStatus {
  name: string;
  configured: boolean;
  online: boolean;
}

/** The one gateway this probe reports. */
const GATEWAY_NAME = 'Stripe';

/** How often to re-read the server-side computation. */
const POLL_INTERVAL_MS = 60_000;

/**
 * Poll the payment-gateway status on mount and every 60 s.
 * Returns the gateway name, configuration state, and online status.
 *
 * Reads the booleans the backend already computes (`gateway_status`, through
 * `getGatewayStatus`) — never the credential itself. This hook used to ask
 * `get_setting('stripe.api_key')`, and that read is refused: `stripe.api_key`
 * is on `SECRET_KEY_DENY_LIST`, so the read door answers `Ok(None)` before it
 * touches the table (`run_get_setting` in both shells —
 * apps/mobile-tauri/src/commands/settings.rs, and crates/kasirmu-bridge/src/settings.rs
 * for the desktop lane). `Ok(None)` is not an error, so the call SUCCEEDED with
 * `null` and this indicator read `configured:false, online:false` forever, on
 * every device, including one holding a live Stripe key. Its consumer renders
 * the gateway pill only when `configured` is true
 * (ui/src/app/StatusBar.tsx), so the whole segment has been absent
 * from the status bar since the day it shipped. The Rust door is correct and
 * unchanged; this file was asking it for something it must never hand over.
 *
 * A failed read keeps the previous reading — the rule `usePaymentConnection`
 * documents two files away: a broken probe is not evidence the gateway went
 * away, and inventing an outage would hide a working pill. The next poll
 * retries, so a transient IPC failure costs one refresh cycle, not the
 * indicator.
 */
export function useGatewayStatus(): GatewayStatus {
  const [status, setStatus] = useState<GatewayStatus>({
    name: GATEWAY_NAME,
    configured: false,
    online: false,
  });

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const list = await getGatewayStatus();
        if (cancelled) return;
        // The gateway this probe is ABOUT, not "any gateway": a device with
        // Square configured and Stripe not must not light the Stripe pill.
        const entry = list.find((g) => g.name.toLowerCase().includes('stripe'));
        setStatus({
          name: GATEWAY_NAME,
          configured: entry?.configured ?? false,
          online: entry?.online ?? false,
        });
      } catch {
        // No setStatus on purpose — see the doc comment above.
      }
    }

    check();
    const interval = setInterval(check, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return status;
}
