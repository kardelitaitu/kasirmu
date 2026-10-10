// ui/src/features/sales/posScreenUtils.ts
//
// Pure utilities extracted from PosScreen.tsx for testability.
//
// EVERYTHING HERE IS NOW A RE-EXPORT. This file used to hold its own copies of
// the cart-width bounds, `clampCartWidth` and `lineThumbnail` — a second set of
// definitions that could drift from the real ones. It did: when the width floor
// moved from 320 to 400 (see the sweep in utils/cartCalculations.ts), this copy
// kept 320 and kept the comment claiming 320 "keeps qty controls and line text
// legible", which was measured false. Nothing in the app imported this module,
// so the stale copy was invisible — it survived only because a test imported it,
// and that test asserted the OLD number and failed, which is the only reason the
// duplication surfaced at all.
//
// The single source is utils/cartCalculations.ts. Keep it that way: add new
// widths or geometry there and re-export here if a name is still imported.

export {
  CART_WIDTH_MIN,
  CART_WIDTH_DEFAULT,
  CART_WIDTH_MAX_CAP,
  clampCartWidth,
  lineThumbnail,
} from './utils/cartCalculations';

/**
 * Split an elapsed duration (ms) into whole hours + minutes, floored.
 * Used for the live shift timer in the cart header.
 *
 * Defined here rather than re-exported: this is the only home it has, so it is
 * not a duplicate and has nothing to drift from.
 */
export function elapsedHoursMinutes(sinceMs: number, nowMs: number): { h: number; m: number } {
  const totalMinutes = Math.max(0, Math.floor((nowMs - sinceMs) / 60_000));
  return { h: Math.floor(totalMinutes / 60), m: totalMinutes % 60 };
}
