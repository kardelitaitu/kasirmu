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
 * hooks/useTicketSla.ts (clampSlaThresholds: yellow 30..SLA_YELLOW_MAX_SEC,
 * red 60..SLA_RED_MAX_SEC).
 *
 * RULING 2026-09-15 (lane owner), resolving the disagreement this file used
 * to record as an open product question: the ENGINE ceiling wins, and the
 * minute ceilings below DERIVE from it rather than being written as
 * literals. The settings UI can therefore no longer offer any value the
 * board engine would silently override — a saved red is honored to the
 * second. The cross-surface cases in KdsThresholdClamp.test.ts pin the
 * agreement: change RED_URGENT and both clamps move together (still
 * agreeing); hardcode either side and those cases go red.
 */

import { SLA_RED_MAX_SEC, SLA_YELLOW_MAX_SEC } from './hooks/useTicketSla';

/**
 * Highest yellow the UI may offer, in minutes (SLA_YELLOW_MAX_SEC / 60 = 14).
 * Derived from the engine ceiling — do not replace with a literal.
 */
export const YELLOW_MAX_MIN = SLA_YELLOW_MAX_SEC / 60;

/**
 * Highest red the UI may offer, in minutes (SLA_RED_MAX_SEC / 60 = 15).
 * Derived from the engine ceiling — do not replace with a literal.
 */
export const RED_MAX_MIN = SLA_RED_MAX_SEC / 60;

/** Yellow's fixed range is 3–YELLOW_MAX_MIN minutes, and it must stay strictly below red. */
export function clampYellowThreshold(v: number, redMin: number): number {
  return Math.max(3, Math.min(v, redMin - 1, YELLOW_MAX_MIN));
}

/** Red's fixed range is 4–RED_MAX_MIN minutes. */
export function clampRedThreshold(v: number): number {
  return Math.max(4, Math.min(v, RED_MAX_MIN));
}

/**
 * After red moves, yellow follows it down but never up: the yellow < red
 * invariant, expressed as the -1 gap. Used with clampRedThreshold's result.
 */
export function clampYellowFollowingRed(yellow: number, redMin: number): number {
  return Math.min(yellow, redMin - 1);
}
