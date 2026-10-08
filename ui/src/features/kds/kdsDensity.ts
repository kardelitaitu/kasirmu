/**
 * KDS display-density arithmetic — the column-count domain the settings panel
 * and the compact-class rule both read.
 *
 * WHY THIS FILE EXISTS. Three expressions lived inline, and a suite asserted
 * copies of all three:
 *   KdsHamburgerPanel.tsx:315  Math.max(1, settings.density - 1)
 *   KdsHamburgerPanel.tsx:317  Math.min(5, settings.density + 1)
 *   KdsMainContent.tsx:132     settings.density <= 2 ? ' kds--compact' : ''
 * __tests__/KdsSettingsConversions.test.ts retyped clampDensity and
 * compactClass to test them, because production had no name to import — and a
 * copy is invisible to a name-matching detector precisely because there is
 * nothing to collide with. The same reasoning is already recorded in
 * hooks/useTicketSla.ts:66-90 and kdsThresholdMinutes.ts, which were extracted
 * the same way for the SLA thresholds. Naming the expressions is what makes the
 * existing cases load-bearing: change a bound here and they fail, instead of
 * both sides drifting apart in silence.
 *
 * The literals are unchanged from the inline sites. The one shape worth noting is
 * that compactClass() returns the class WITH ITS LEADING SPACE, exactly as the
 * inline template did, so the call site interpolates it straight after
 * 'kds-content-wrap' with no separator of its own. The two disabled= conditions
 * are named separately (isDensityAtMin/Max) rather than derived from stepDensity,
 * because that is how they were written inline — this is an extraction, not a
 * behaviour change.
 */

/** Fewest columns the board may show. */
export const DENSITY_MIN = 1;

/** Most columns the board may show. */
export const DENSITY_MAX = 5;

/**
 * Density at or below which the board switches to its compact layout.
 *
 * 2 rather than 1: the compact class exists for the cramped end of the range,
 * and the CSS it selects (.kds--compact .kds-ticket and friends, KdsScreen.css)
 * is written for a two-column board.
 */
export const DENSITY_COMPACT_AT = 2;

/** The class appended to .kds-content-wrap when density is at or below
 *  DENSITY_COMPACT_AT, or '' otherwise. Returns a LEADING space when present,
 *  so a caller can interpolate it directly after the base class without
 *  writing the separator itself — the exact shape the inline site used. */
export function compactClass(density: number): string {
  return density <= DENSITY_COMPACT_AT ? ' kds--compact' : '';
}

/**
 * Step the density one place, clamped to the legal range.
 *
 * `direction` is the literal 'up' | 'down' the two stepper buttons pass;
 * 'down' decreases. Out-of-range inputs clamp rather than throw, which is what
 * the Math.max/min pair did.
 */
export function stepDensity(density: number, direction: 'up' | 'down'): number {
  return direction === 'down'
    ? Math.max(DENSITY_MIN, density - 1)
    : Math.min(DENSITY_MAX, density + 1);
}

/** True when a further 'down' step would be a no-op — the − button's disabled= rule. */
export function isDensityAtMin(density: number): boolean {
  return density <= DENSITY_MIN;
}

/** True when a further 'up' step would be a no-op — the + button's disabled= rule. */
export function isDensityAtMax(density: number): boolean {
  return density >= DENSITY_MAX;
}
