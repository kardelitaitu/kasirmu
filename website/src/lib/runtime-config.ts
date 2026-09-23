/**
 * Runtime-overridable site configuration (website-plan.md §5, runbook §8).
 *
 * Astro bakes every PUBLIC_* var into the bundle at build time. The Cloudflare
 * Worker (worker.ts) serves /__oz/runtime-config.js from the `LICENSE_API_URL`
 * [vars] binding so the backend URL can change WITHOUT a rebuild: the layout
 * head loads that script (SiteHead.astro) and this helper reads
 * `window.__OZ_CONFIG__`, falling back to the build-time value when the
 * endpoint is absent (local preview / static hosts).
 *
 * Reading is not enough on its own: an island hydrates as soon as its module
 * arrives, which can be BEFORE a slow config response lands, and a plain read
 * at render time then sees nothing and never learns better. The script
 * therefore announces itself (`RUNTIME_CONFIG_EVENT`) and
 * [onRuntimeConfigArrived] lets a caller hear about the URL it missed.
 */

export interface RuntimeConfig {
  /** License-server web API base URL. */
  licenseApiUrl?: string;
  /**
   * Where the support contact form posts, or null when the deployment has no
   * contact route (the Worker sends `null` when its own path is unavailable).
   * Null is meaningful, not absent: the form then offers its mailto fallback
   * rather than POSTing into a 404.
   */
  contactEndpoint?: string | null;
}

declare global {
  interface Window {
    __OZ_CONFIG__?: RuntimeConfig;
  }
}

/**
 * The license-server API base URL: the runtime value (served by the Worker)
 * wins, then the build-time PUBLIC_LICENSE_API_URL. Returns undefined when
 * neither is set — the auth pages render a "not configured" state instead of
 * failing. Safe during the Astro build (Node has no `window`), where the
 * build-time value is used.
 */
export function licenseApiUrl(): string | undefined {
  if (typeof window !== 'undefined' && window.__OZ_CONFIG__?.licenseApiUrl) {
    return window.__OZ_CONFIG__.licenseApiUrl;
  }
  // MEASURED 2026-09-23 against `astro build` on this toolchain: a var that is
  // genuinely absent is substituted as `void 0`, and one set to the empty
  // string as `""` — both falsy, so the not-configured path below works with
  // or without the guard. A truthy `__PUBLIC_*__` value reaches the client
  // only if a deployment bakes the literal placeholder into the var (a copied
  // template value); returning it would hand callers a base URL that is not a
  // backend, `!api` would never fire, and the page would fetch the placeholder
  // itself. The normalization is defensive for that input, not a repair of
  // Astro's own substitution.
  return placeholderAsUnset(import.meta.env.PUBLIC_LICENSE_API_URL as string | undefined);
}

/**
 * A literal `__PUBLIC_*__` value (the shape an unresolved template leaves
 * behind) is not a backend URL. Undefined lets callers fall back to their
 * not-configured state instead of fetching the placeholder as a base.
 */
function placeholderAsUnset(value: string | undefined): string | undefined {
  return value && /^__PUBLIC_.*__$/.test(value) ? undefined : value;
}

/**
 * The event `/__oz/runtime-config.js` dispatches once it has assigned
 * `window.__OZ_CONFIG__` — the contract between the config script and every
 * client that reads it late. Both producers in this repo emit it (worker.ts
 * in production, serve-local.mjs locally) and `worker.test.ts` fails if the
 * Worker's body stops naming this exact event.
 */
export const RUNTIME_CONFIG_EVENT = 'oz:runtime-config';

/**
 * Call `cb` with the API base URL whenever one is known — including one that
 * was already set when this was called.
 *
 * Why this exists: [licenseApiUrl] is a plain read, and an island that
 * rendered before `/__oz/runtime-config.js` finished has no way to learn that
 * the value appeared. In a browser this left `/en/account` and the auth
 * islands showing their not-configured notice, with zero requests, until a
 * manual reload, whenever the config response took about a second (measured
 * 2026-09-23). The config script dispatches `RUNTIME_CONFIG_EVENT` after it
 * sets the global, and callers re-render on it.
 *
 * Bounded by construction: there is no timer and nothing to poll. A
 * deployment that never supplies a config never dispatches the event, so the
 * caller's not-configured state simply stands; a config that supplies no URL
 * (`LICENSE_API_URL` unset in the Worker, which sends `null`) fires the event
 * but reports nothing, because there is no URL to report.
 *
 * Returns an unsubscribe function.
 */
export function onRuntimeConfigArrived(cb: (url: string) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const report = () => {
    const url = window.__OZ_CONFIG__?.licenseApiUrl;
    if (url) cb(url);
  };
  window.addEventListener(RUNTIME_CONFIG_EVENT, report);
  // The event is missed by anyone subscribing after it fired, and "after" can
  // mean the few milliseconds between the caller's render and this call.
  report();
  return () => window.removeEventListener(RUNTIME_CONFIG_EVENT, report);
}