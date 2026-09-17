import { Suspense, type ReactNode } from 'react';
import { Localized } from '@/components/Localized';

/**
 * Shared Suspense boundary for lazy-loaded screens and widgets
 * (PERF-01 route-level code splitting).
 *
 * Wraps children in a <Suspense> with a lightweight fallback so a
 * lazy chunk that is still fetching renders a neutral "Loading…"
 * state instead of throwing. Pass a custom `fallback` (e.g. a
 * skeleton grid) when the lazy content has a richer loading state.
 */
export function LazyBoundary({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return (
    <Suspense
      fallback={
        fallback ?? (
          <div className="lazy-boundary" role="status" aria-live="polite" aria-busy="true">
            <span className="lazy-boundary__spinner" aria-hidden="true" />
            <Localized id="shared-loading">Loading&hellip;</Localized>
          </div>
        )
      }
    >
      {children}
    </Suspense>
  );
}
