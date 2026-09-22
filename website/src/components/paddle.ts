/**
 * Shared Paddle.js (v2) integration for the marketing site. Loads the v2
 * SDK lazily, initializes it with the build-time client token, and opens
 * the checkout overlay. Used by both the pricing-page button and the
 * account dashboard's subscribe section.
 *
 * v2 API: Paddle.Environment.set(...) then Paddle.Initialize({ token })
 * then Paddle.Checkout.open({ items, customer, customData }). NOTE: the
 * legacy URL (https://cdn.paddle.com/paddle/paddle.js) serves the v1 SDK
 * whose Setup/Checkout signatures differ — only the /v2/ URL works with
 * this code. The environment must be set via Paddle.Environment.set()
 * BEFORE Initialize — the current SDK rejects an `environment` option in
 * Initialize and defaults to production when Environment.set is never
 * called (a sandbox token + sandbox price then fail the checkout with
 * "Something went wrong").
 *
 * Checkout is register-first (website-plan.md §5): the pricing button
 * redirects to /login until a session exists, and customData.email is the
 * account email the webhook reads to attach the subscription to the
 * tenant (apps/license-server/paddle_webhook.go).
 *
 * Completion signaling: the current v2 SDK's Paddle.Checkout.open() does
 * NOT return a checkout object (no checkout.close(cb) available), so the
 * reliable completion signal is the global eventCallback passed to
 * Paddle.Initialize() — which can only be called once per page. The
 * callback is registered on the first initialize and fans out to the
 * per-open listener below: `checkout.completed` marks the checkout
 * successful, `checkout.closed` fires the onClosed listener with that
 * result (callers use it to refresh the dashboard, see AccountView).
 */

import { licenseApiUrl } from '../lib/runtime-config';
import { getSessionToken } from '../lib/session';

/** Event payload handed to Paddle.Initialize's eventCallback (v2). */
export interface PaddleEvent {
  name: string;
  data?: Record<string, unknown>;
}

declare global {
  interface Window {
    /** C4.1: A/B test variant for analytics attribution (e.g. 'pro_price'). */
    __ab_variant?: string;
    Paddle?: {
      Environment: { set: (env: 'sandbox' | 'production') => void };
      Initialize: (opts: { token: string; eventCallback?: (event: PaddleEvent) => void }) => void;
      Checkout: {
        open: (opts: {
          items: { priceId: string; quantity: number }[];
          customer?: { email: string };
          customData?: Record<string, string>;
        }) => void;
      };
    };
  }
}

/** Called once when the overlay closes, with whether the purchase completed. */
export type OnCheckoutClosed = (completed: boolean) => void;

// Module-level checkout state: only one overlay can be open at a time, and
// the SDK's eventCallback is registered on the first (one-shot) Initialize.
// `checkout.completed` fires on a successful payment; `checkout.closed`
// fires when the overlay closes (success screen dismissed or cancelled).
let checkoutCompleted = false;
let checkoutClosedListener: OnCheckoutClosed | null = null;
// Paddle.Initialize registers the one-shot eventCallback (v2) and must
// run once per page — re-initializing on a second checkout open is not
// supported. Environment.set stays idempotent and re-runs every open.
let initialized = false;

/** Registered with Paddle.Initialize on the first call; fans events out. */
function paddleEventCallback(event: PaddleEvent): void {
  if (event.name === 'checkout.completed') {
    checkoutCompleted = true;
    return;
  }
  if (event.name === 'checkout.closed') {
    const listener = checkoutClosedListener;
    checkoutClosedListener = null;
    if (listener) listener(checkoutCompleted);
  }
}

const TOKEN = import.meta.env.PUBLIC_PADDLE_CLIENT_TOKEN as string | undefined;
const ENVIRONMENT =
  (import.meta.env.PUBLIC_PADDLE_ENVIRONMENT as string | undefined) === 'sandbox' ? 'sandbox' : 'production';
const API = licenseApiUrl();

/** sessionStorage keys shared with AuthForm / AccountView. */
export const SESSION_KEY = 'oz_session';
export const EMAIL_KEY = 'oz_email';

/**
 * Placeholder ids (`pri_placeholder_…`) are used in the pricing content
 * until the real Paddle prices exist. Treat them as "no checkout": a real
 * client token + a fake price id would open the overlay and fail with a
 * Paddle error instead of the graceful mailto fallback.
 */
export function isPlaceholderPriceId(priceId: string | undefined): boolean {
  return Boolean(priceId && priceId.startsWith('pri_placeholder_'));
}

/** True when a client token is configured at build time (checkout can open). */
export function isPaddleConfigured(): boolean {
  return Boolean(TOKEN);
}

/**
 * Load the v2 SDK script once, resolving when window.Paddle is ready.
 *
 * A failed script element never fires another event, so on error the element
 * is removed and the promise rejects — the next call then creates a fresh
 * script and retries, instead of hanging forever on a dead element (a
 * transient CDN/network failure would otherwise leave the checkout button
 * spinning on '…' until reload).
 */
export function loadPaddle(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Paddle) {
      resolve();
      return;
    }
    const existing = document.getElementById('paddle-js') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => {
        existing.remove();
        reject(new Error('paddle failed to load'));
      });
      return;
    }
    const script = document.createElement('script');
    script.id = 'paddle-js';
    script.src = 'https://cdn.paddle.com/paddle/v2/paddle.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      reject(new Error('paddle failed to load'));
    };
    document.head.appendChild(script);
  });
}

/**
 * Open the sandbox/live checkout overlay for a price id, prefilled with
 * the customer's account email (customData.email is what the webhook
 * reads to attach the subscription to the tenant). An optional vertical
 * bundle (C3.2) rides custom_data.bundle — the webhook cross-checks it
 * against the price's bundle segment and mints the widened quota block.
 * When the overlay closes, `onClosed` is called with whether the purchase
 * completed (checkout.completed fired before checkout.closed).
 */
export async function openPaddleCheckout(
  priceId: string,
  email: string,
  onClosed?: OnCheckoutClosed,
  bundle?: string,
): Promise<void> {
  if (!TOKEN) throw new Error('paddle not configured');
  await loadPaddle();
  if (!window.Paddle) throw new Error('paddle unavailable');
  // v2 requires the environment to be set explicitly BEFORE Initialize;
  // otherwise it defaults to production and a sandbox token + sandbox
  // price fail the checkout with "Something went wrong".
  window.Paddle.Environment.set(ENVIRONMENT);
  checkoutCompleted = false;
  checkoutClosedListener = onClosed ?? null;
  if (!initialized) {
    window.Paddle.Initialize({ token: TOKEN, eventCallback: paddleEventCallback });
    initialized = true;
  }
  window.Paddle.Checkout.open({
    items: [{ priceId, quantity: 1 }],
    customer: { email },
    customData: bundle ? { email, bundle } : { email },
  });
}

/**
 * Clear the full local session: the token AND the cached email. The
 * email cache must die with the token — otherwise the next account on
 * the same browser would get the previous user's email prefilled in
 * checkout, attaching the subscription to the wrong tenant (the
 * webhook reads customData.email).
 */
export function clearSession(): void {
  try {
    window.sessionStorage.removeItem(SESSION_KEY);
    window.sessionStorage.removeItem(EMAIL_KEY);
  } catch {
    // Storage unavailable (private mode) — nothing to clear.
  }
}

/**
 * Whether the user is signed in, cookie-first.
 *
 * Re-exported from session.ts — the SINGLE owner of session state — so every
 * caller (the checkout CTA gate, the header nav) resolves the same way. Never
 * read sessionStorage here: it is per-tab, so a session that lives only in the
 * httpOnly cookie (a new tab, or another tab after login) would be reported as
 * signed out.
 */
export { hasSession } from '../lib/session';

/**
 * The signed-in user's email: cached in sessionStorage (set by AuthForm
 * after verify), else fetched from /me. Returns null when not signed in
 * or the API is unreachable.
 *
 * R1: the token is resolved cookie-first via getSessionToken (the Worker's
 * /__oz/session httpOnly cookie, falling back to sessionStorage for
 * no-Worker dev), so a cookie-signed-in session — where sessionStorage may
 * have been cleared — still resolves the email for checkout prefill.
 */
export async function getSessionEmail(): Promise<string | null> {
  try {
    const cached = window.sessionStorage.getItem(EMAIL_KEY);
    if (cached) return cached;
    const token = await getSessionToken();
    if (!token || !API) return null;
    const res = await fetch(`${API}/api/v1/web/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { tenant?: { email?: string } };
    const email = data.tenant?.email ?? null;
    if (email) window.sessionStorage.setItem(EMAIL_KEY, email);
    return email;
  } catch {
    return null;
  }
}
