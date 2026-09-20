/**
 * Resolve a post-login `?next=` target, accepting only same-origin paths.
 *
 * Two layers, because either alone is insufficient:
 *
 * 1. STRUCTURAL — the URL parser strips tab/CR/LF and converts a backslash to a
 *    slash before parsing, so `/[backslash]evil.com` and `/<tab>/evil.com` both become
 *    `//evil.com`. A guard that only tested `!startsWith('//')` returned those
 *    verbatim. Rejecting every one of those characters anywhere in the path
 *    holds even when no origin is available to compare against (a test harness,
 *    an SSR pass), which is why it is checked first and unconditionally.
 * 2. ORIGIN — when a base origin is known, the resolved URL must stay on it.
 *    This is the layer that catches shapes nobody enumerated.
 *
 * The caller navigates to the value this RETURNS, never to the raw input.
 */

/** A usable origin from a URL string, or null when there is nothing to compare against. */
function usableOrigin(value: string | undefined): string | null {
  if (!value || value === 'null') return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function sameOriginPath(
  raw: string | null | undefined,
  fallback: string,
  base?: string,
): string {
  if (!raw || !raw.startsWith('/')) return fallback;
  if (raw.startsWith('//')) return fallback;
  // eslint-disable-next-line no-control-regex -- these ARE the characters the URL parser strips
  if (/[\\\t\n\r]/.test(raw.slice(1))) return fallback;

  const baseOrigin =
    usableOrigin(base) ??
    (typeof window !== 'undefined' ? usableOrigin(window.location?.origin) : null);
  // No origin to compare against: the structural checks above already prove this
  // cannot leave the origin, so the path itself is the answer.
  if (!baseOrigin) return raw;

  try {
    const resolved = new URL(raw, baseOrigin);
    if (resolved.origin !== baseOrigin) return fallback;
    return resolved.pathname + resolved.search + resolved.hash;
  } catch {
    return fallback;
  }
}
