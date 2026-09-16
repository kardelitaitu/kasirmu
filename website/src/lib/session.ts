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
 */
export async function getSessionToken(): Promise<string | null> {
  try {
    const res = await fetch('/__oz/session');
    if (res.ok) {
      const body = (await res.json()) as { token?: string };
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

/** The signed-in email cache key (used for checkout prefill). */
export const EMAIL_STORAGE_KEY = 'oz_email';
