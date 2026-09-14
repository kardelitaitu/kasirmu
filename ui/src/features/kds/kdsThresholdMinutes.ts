/**
 * KDS SLA threshold clamping, in MINUTES — the settings-slider domain.
 *
 * Moved verbatim out of KdsScreen.tsx:913-923, where all three expressions
 * lived inline inside the onChangeYellowThreshold / onChangeRedThreshold
 * props. The constants live here now; the screen calls these and keeps no
 * bound of its own. __tests__/KdsThresholdClamp.test.ts imports them, which
 * is what makes that suite load-bearing: a bound changed here fails a test,
 * instead of silently diverging from a copy of the expression.
 *
 * Minutes only. The SECONDS clamp — the rule that decides when a ticket
 * actually turns yellow/red on the board — is a separate rule in
 * hooks/useTicketSla.ts (clampSlaThresholds: yellow 30..840 s, red 60..900 s).
 * The two do not agree on their ceilings: this file permits 30/60 minutes,
 * that one caps at 14/15. That is an open product question about which clamp
 * wins, NOT something to "align" from here.
 */

/** Yellow's fixed range is 3–30 minutes, and it must stay strictly below red. */
export function clampYellowThreshold(v: number, redMin: number): number {
  return Math.max(3, Math.min(v, redMin - 1, 30));
}

/** Red's fixed range is 4–60 minutes. */
export function clampRedThreshold(v: number): number {
  return Math.max(4, Math.min(v, 60));
}

/**
 * After red moves, yellow follows it down but never up: the yellow < red
 * invariant, expressed as the -1 gap. Used with clampRedThreshold's result.
 */
export function clampYellowFollowingRed(yellow: number, redMin: number): number {
  return Math.min(yellow, redMin - 1);
}
