//! Pure analytics range, granularity and zoom helpers.
//!
//! Extracted verbatim from `AnalyticsScreen.tsx` (R37 analytics-query split).
//! Nothing here touches React or the DOM — these are the functions the screen
//! and its tests reason about, kept out of the component module so the screen
//! file carries only its own wiring.
//!
//! `AnalyticsScreen.tsx` re-exports every symbol below for backwards
//! compatibility with `AnalyticsScreen.test.tsx` and
//! `dynamicFluentFamilies.test.ts`; drop those re-exports only once both test
//! files import from here directly.

import { rangeForGranularity } from '../analytics-data';

export type WorkspaceView = 'retail' | 'restaurant';
export type Granularity = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';

// Re-export the calendar helper so the analytics test suite can import it
// from the screen module (the heatmap card owns its own copy of the helper
// via analytics-data; this keeps the existing test import working).
export { monthCalendarGrid } from '../analytics-data';

// `daily` was removed from the selector: every card mapped it to `weekly`,
// so the two buttons rendered identical data. A short custom range still
// auto-buckets as daily (see bucketGranularity), but the selector no longer
// offers daily as a global view.
/**
 * The granularities the selector actually renders — the domain for the
 * `analytics-granularity-${g}` template-built message ids.
 *
 * Exported so `dynamicFluentFamilies.test.ts` can assert every one resolves
 * in BOTH bundles. Note this is deliberately narrower than the `Granularity`
 * union, which also admits `'daily'`: that value reaches
 * `rangeForGranularity()` and the query cache but no selector button, so
 * `analytics-granularity-daily` does not exist. Adding `'daily'` to this
 * array without adding the key would render a blank button label — a
 * template-built id is invisible to scripts/verify-bundle-parity.py, so this
 * array plus that test is the only guard.
 */
export const GRANULARITIES: Granularity[] = ['weekly', 'monthly', 'yearly', 'custom'];

export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 1.6;
export const ZOOM_STEP = 0.2;

/**
 * Only one card may be expanded at a time.
 * - clicking the expanded card restores it (`current` → `null`)
 * - expanding when nothing is open sets the new card (`null` → `cid`)
 * - expanding another card while one is open is ignored
 */
export const nextExpandedKey = (current: string | null, cid: string): string | null => {
  if (current === cid) return null;
  if (current === null) return cid;
  return current;
}

/**
 * Scale factor that enlarges `content` to fill `available` without
 * overflowing either axis, capped at `max`. Returns 1 when the sizes
 * are unknown (e.g. layout not yet measured).
 */
export const smartScale = (
  available: { w: number; h: number },
  content: { w: number; h: number },
  max = 4,
): number => {
  if (available.w <= 0 || available.h <= 0 || content.w <= 0 || content.h <= 0) return 1;
  return Math.max(1, Math.min(max, Math.min(available.w / content.w, available.h / content.h)));
}

/**
 * Effective granularity for a card after applying its per-card remap.
 * Cards default to respecting the global selector; a card with a
 * `granularityMap` entry for the current granularity overrides it (e.g.
 * mapping `daily` to `weekly` when a card has no daily layout).
 */
export const cardGranularity = (
  card: { granularityMap?: Partial<Record<Granularity, Granularity>> },
  g: Granularity,
): Granularity => {
  return card.granularityMap?.[g] ?? g;
}

/**
 * Date range for a card, derived from its *effective* granularity (after
 * the per-card remap) so a card that remaps e.g. weekly → monthly also
 * gets the matching window instead of the global selector's window.
 */
export const cardRange = (
  card: { granularityMap?: Partial<Record<Granularity, Granularity>> },
  g: Granularity,
  customFrom: string,
  customTo: string,
  storeTz?: string | null,
): { from: string; to: string } => {
  // A custom range is user-selected — never let a granularity remap
  // replace it with a derived window (a card that derives its grid from the
  // custom span still queries the chosen dates).
  if (g === 'custom') return { from: customFrom, to: customTo };
  return rangeForGranularity(cardGranularity(card, g), customFrom, customTo, storeTz);
}

/** Number of days in the current month (28–31). */
export const daysInCurrentMonth = (): number => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
}
