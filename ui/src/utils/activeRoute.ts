/**
 * A minimal pub/sub for "which route is the shell currently showing".
 *
 * WHY THIS EXISTS — measured 2026-10-07: the tablet shell navigates tools by
 * React state (`TabletAppShell.tsx` `setCurrentRoute`), NOT by
 * `location.hash` — only the settings hub and deep links change the hash.
 * The full-page error boundary therefore could not see tool-to-tool
 * navigation and kept a caught error until the 30s auto-reload fired, which
 * on Android is a full process reload that logs the user out.
 *
 * Shells publish here (`setActiveRoute`); `AppProviders` subscribes through
 * `useSyncExternalStore` and feeds the value into the boundary's
 * `resetKeys`, so navigation recovers the boundary in place. The hash stays
 * a separate reset key because the settings hub and deep links move the
 * hash without going through a shell.
 *
 * The snapshot is a cached string, not a fresh literal, so identity is
 * stable across reads — `useSyncExternalStore` treats a new object as a
 * change on every render.
 */

let current = '';
const listeners = new Set<() => void>();

/** Publish the route a shell has navigated to. No-op when unchanged. */
export function setActiveRoute(route: string): void {
  if (route === current) return;
  current = route;
  for (const listener of listeners) listener();
}

/** Current route. Stable identity for the same value (React snapshot rule). */
export function getActiveRoute(): string {
  return current;
}

/** Subscribe to route changes. Returns the unsubscribe function. */
export function subscribeActiveRoute(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
