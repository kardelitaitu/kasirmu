/**
 * Midtrans Snap.js integration for the Indonesian checkout path (ADR #39
 * D1). The id-locale pricing button and account dashboard request a snap
 * token from the license server (POST /api/v1/midtrans/snap — session
 * authed, register-first like Paddle), then load Snap.js lazily and call
 * snap.pay(token). The license server embeds the buyer email in
 * custom_field2, which the webhook reads to attach the subscription to the
 * tenant (apps/license-server/midtrans_webhook.go).
 *
 * Completion signaling mirrors the Paddle flow: snap.pay's onSuccess fires
 * when the payment succeeds, onClose when the overlay closes — callers
 * poll /me afterwards because the webhook provisions asynchronously (see
 * AccountView).
 *
 * Checkout is register-first (website-plan.md §5): the pricing button
 * redirects to /login until a session exists; this module never opens
 * without one.
 */

import { licenseApiUrl } from '../lib/runtime-config';
import { getSessionToken } from '../lib/session';

declare global {
  interface Window {
    snap?: {
      pay: (
        token: string,
        opts?: {
          onSuccess?: (result: unknown) => void;
          onPending?: (result: unknown) => void;
          onError?: (result: unknown) => void;
          onClose?: () => void;
        },
      ) => void;
    };
  }
}

/** Called once when the Snap overlay closes, with whether the payment succeeded. */
export type OnSnapClosed = (completed: boolean) => void;

/**
 * Load the Snap.js script once, resolving when window.snap is ready. On a
 * script error the element is removed and the promise rejects — the next
 * call then creates a fresh script and retries (same pattern as paddle.ts).
 */
export function loadSnap(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.snap) {
      resolve();
      return;
    }
    const existing = document.getElementById('midtrans-snap-js') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => {
        existing.remove();
        reject(new Error('snap failed to load'));
      });
      return;
    }
    const script = document.createElement('script');
    script.id = 'midtrans-snap-js';
    script.src = 'https://app.midtrans.com/snap/snap.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      reject(new Error('snap failed to load'));
    };
    document.head.appendChild(script);
  });
}

/**
 * Open the Snap overlay for a tier + billing period (+ optional vertical
 * bundle, C3.2). Requests the snap token from the license server with the
 * register-first session token, then hands it to snap.pay. The bundle rides
 * in the request and is echoed back as custom_field4 so the webhook mints
 * the bundle-widened quota block. When the overlay closes, `onClosed` is
 * called with whether the payment succeeded. Signature mirrors
 * openPaddleCheckout: the callback stays the 3rd argument so existing
 * callers that pass it positionally are unaffected.
 */
export async function openMidtransCheckout(
  tierKey: string,
  period: 'monthly' | 'yearly',
  onClosed?: OnSnapClosed,
  bundle?: string,
): Promise<void> {
  // Cookie-first via the single session owner (session.ts): a signed-in user
  // whose sessionStorage is empty (new tab, cookie-only login) must still be
  // able to open the Midtrans overlay. Reading sessionStorage directly here
  // made the id-locale checkout fail outright for those users.
  const token = await getSessionToken();
  // Resolved per call, NOT at module scope. `licenseApiUrl()` reads
  // window.__OZ_CONFIG__, which /__oz/runtime-config.js can assign *after* this
  // module has been evaluated (the script is deferred); a module-scope capture
  // then freezes the pre-config answer (undefined) and the click throws
  // 'midtrans not configured' without issuing a request. MEASURED 2026-09-23 on
  // a build of this tree with the config script delayed 1s: the account
  // dashboard rendered correctly and this button sent nothing, while the same
  // build with the config present POSTed to the runtime host.
  const api = licenseApiUrl();
  if (!token || !api) throw new Error('midtrans not configured');
  const res = await fetch(`${api}/api/v1/midtrans/snap`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ tier_key: tierKey, period, bundle }),
  });
  if (!res.ok) throw new Error('snap token request failed');
  const data = (await res.json()) as { token: string; redirect_url?: string };
  if (!data.token) throw new Error('snap returned no token');

  await loadSnap();
  if (!window.snap) throw new Error('snap unavailable');

  let completed = false;
  window.snap.pay(data.token, {
    onSuccess: () => {
      completed = true;
    },
    onError: () => {
      completed = false;
    },
    onClose: () => {
      if (onClosed) onClosed(completed);
    },
  });
}
