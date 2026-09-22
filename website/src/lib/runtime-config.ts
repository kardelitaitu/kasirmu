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
  // An unset PUBLIC_* var reaches the client as the literal string
  // "__PUBLIC_LICENSE_API_URL__", not as undefined: Astro substitutes the
  // placeholder at build time and, with no value to substitute, the
  // placeholder itself ships. Returning it handed callers a truthy URL they
  // then fetched against — AccountView's `!api` guard never fired and the
  // dashboard showed a generic fetch error instead of the not-configured
  // notice. Treat it as unset.
  return placeholderAsUnset(import.meta.env.PUBLIC_LICENSE_API_URL as string | undefined);
}

/**
 * Astro's unresolved PUBLIC_* placeholder (e.g. `__PUBLIC_LICENSE_API_URL__`)
 * means the variable was not set at build time. Undefined lets callers fall
 * back to their not-configured state.
 */
function placeholderAsUnset(value: string | undefined): string | undefined {
  return value && /^__PUBLIC_.*__$/.test(value) ? undefined : value;
}