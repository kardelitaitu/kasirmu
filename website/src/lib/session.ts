/**
 * Session token access for the account portal (R1 — httpOnly cookie
 * migration). The Worker owns the session cookie on the marketing host
 * (kasir.mu); the browser reads it back same-origin from /__oz/session,
 * so the token never needs to live in XSS-readable sessionStorage in
 * production.
 *
 * Local dev (astro dev, no Worker) has no /__oz/session, so we fall back
 * to the sessionStorage token AuthForm still writes (the v1 mechanism).
 * The Worker-served production path is cookie-first.
 */

/** sessionStorage key AuthForm uses (legacy v1 token storage). */
export const SESSION_STORAGE_KEY = 'oz_session';

/**
 * Resolve the current session token: prefer the httpOnly cookie via the
 * Worker's /__oz/session endpoint, falling back to sessionStorage when the
 * endpoint is absent (no-Worker dev) or returns no token.
 *
 * This is the SINGLE owner of session state. Every call site that needs to
 * know whether a user is signed in — the checkout CTA gate, the header nav,
 * the Midtrans path, the account portal — must go through this (or
 * `hasSession` below) rather than reading sessionStorage directly, so a
 * cookie-only session (sessionStorage cleared, a new tab, another tab) is
 * recognized everywhere. Reading sessionStorage alone was the regression this
 * module exists to prevent.
 */
/** The in-flight session probe, shared so concurrent callers issue ONE request. */
let inflightProbe: Promise<string | null> | null = null;

export async function getSessionToken(): Promise<string | null> {
  // The header resolves the session on load and again on astro:page-load, and
  // the checkout CTA also asks — without this, a single page view fired two or
  // three identical /__oz/session requests. Collapse them into one.
  if (!inflightProbe) {
    inflightProbe = probeSessionToken().finally(() => {
      inflightProbe = null;
    });
  }
  return inflightProbe;
}

async function probeSessionToken(): Promise<string | null> {
  try {
    const res = await fetch('/__oz/session');
    if (res.ok) {
      const body = (await res.json()) as { token?: string | null };
      if (body.token) return body.token;
    }
  } catch {
    // No Worker / network error — fall through to sessionStorage.
  }
  try {
    return window.sessionStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Whether the user is signed in, cookie-first. Async because the httpOnly
 * cookie is not readable from JS — the Worker's /__oz/session endpoint is the
 * only way to see it. Callers must not substitute a synchronous
 * sessionStorage read: that treats a new tab with a valid cookie as signed
 * out (the bug this fixes).
 */
export async function hasSession(): Promise<boolean> {
  // Boolean(), not `!== null`: an empty-string sessionStorage token is not a
  // session (matches the old synchronous `Boolean(sessionStorage.get(...))`).
  return Boolean(await getSessionToken());
}

/** The signed-in email cache key (used for checkout prefill). */
export const EMAIL_STORAGE_KEY = 'oz_email';
