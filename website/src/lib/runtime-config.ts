/**
 * Runtime-overridable site configuration (website-plan.md §5, runbook §8).
 *
 * Astro bakes every PUBLIC_* var into the bundle at build time. The Cloudflare
 * Worker (worker.ts) serves /__oz/runtime-config.js from the `LICENSE_API_URL`
 * [vars] binding so the backend URL can change WITHOUT a rebuild: the layout
 * head loads that script (Base.astro) and this helper reads
 * `window.__OZ_CONFIG__`, falling back to the build-time value when the
 * endpoint is absent (local preview / static hosts).
 */

export interface RuntimeConfig {
  /** License-server web API base URL. */
  licenseApiUrl?: string;
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