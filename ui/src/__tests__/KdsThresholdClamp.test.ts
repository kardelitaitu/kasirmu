/**
 * Unit tests for KDS yellow/red SLA threshold clamping logic.
 *
 * Rules (were inline in KdsScreen.tsx; now exported from kdsThresholdMinutes.ts):
 *   Yellow fixed range: 3–YELLOW_MAX_MIN (=14 min, derived from the engine ceiling)
 *   Red fixed range:    4–RED_MAX_MIN    (=15 min, derived from the engine ceiling)
 *   Invariant:          yellow < red (always)
 *   onChangeYellowThreshold(v) → yellow = clamp(v, 3, min(red-1, YELLOW_MAX_MIN)), red unchanged
 *   onChangeRedThreshold(v)   → red = clamp(v, 4, RED_MAX_MIN); yellow = min(yellow, red-1)
 *
 * LOAD-BEARING AS OF THIS COMMIT — it used to fail the way
 * KdsStatusAdvance.test.ts:4-8 records: the clamping was re-implemented here
 * as local clampYellow() / applyRedChange() functions, so editing or deleting
 * the production expressions left all 5 cases green. This suite was testing a
 * copy. Both local functions are gone and every assertion now calls the
 * exported production helpers, so a bound changed in kdsThresholdMinutes.ts
 * fails this file by construction.
 *
 * Scope: MINUTES — the settings-slider clamp. The seconds clamp that
 * decides when a ticket turns yellow/red on the board is
 * hooks/useTicketSla.ts:clampSlaThresholds, already covered by
 * KdsSlaThresholdClamp.test.ts. Until 2026-09-15 the two ceilings disagreed
 * (30/60 min offered here vs 840/900 s = 14/15 min honored there) and that
 * gap was filed as an open product ruling. RULING 2026-09-15 (lane owner):
 * the engine wins; the minute ceilings now DERIVE from SLA_YELLOW_MAX_SEC /
 * SLA_RED_MAX_SEC, and the third describe block below asserts the agreement
 * for every reachable input, replacing the old "deliberately NOT asserted"
 * stance with a pin.
 */

// Added in this commit: the file shipped in be6f8cce with NO imports at all, using
// describe/it/expect as if they were globals. They are not -- vitest globals are not
// enabled in this project's config -- so `tsc --noEmit` reported 36 errors (TS2582
// "Cannot find name 'describe'" and friends) and the branch was red on arrival. Vitest
// itself still ran the file, because its runner injects those names, which is why the
// breakage was invisible to `npm run test` and only the type check caught it.
import { describe, expect, it } from 'vitest';
import {
  clampYellowThreshold,
  clampRedThreshold,
  clampYellowFollowingRed,
  YELLOW_MAX_MIN,
  RED_MAX_MIN,
} from '@/features/kds/kdsThresholdMinutes';
import { clampSlaThresholds, RED_URGENT } from '@/features/kds/hooks/useTicketSla';

describe('KDS threshold clamping — 4 core scenarios', () => {
  /**
   * Scenario 1: Yellow INCREASES
   * Fixed range 3–14. Follows user input until capped at min(14, red-1).
   * Red never moves.
   */
  it('yellow increases — follows input up to min(YELLOW_MAX_MIN, red-1), red never moves', () => {
    let yellow = 5;
    const red = 10;

    // 5 → 8: passes through (8 < min(14, 9) = 9)
    yellow = clampYellowThreshold(8, red);
    expect(yellow).toBe(8);

    // 8 → 9: hits red-1 cap
    yellow = clampYellowThreshold(9, red);
    expect(yellow).toBe(9);

    // 9 → 15: clamped to 9
    yellow = clampYellowThreshold(15, red);
    expect(yellow).toBe(9);

    // 9 → 30: still clamped to 9
    yellow = clampYellowThreshold(30, red);
    expect(yellow).toBe(9);

    // 9 → 3: drops to floor
    yellow = clampYellowThreshold(3, red);
    expect(yellow).toBe(3);

    // Red unchanged throughout
    expect(red).toBe(10);
  });

  it('yellow increases — even a maximal red caps yellow at the engine ceiling 14, not 30', () => {
    let yellow = 3;
    const red = clampRedThreshold(120); // input far above the ceiling → 15
    expect(red).toBe(RED_MAX_MIN);

    yellow = clampYellowThreshold(30, red); // min(30, 14, 14) = 14 — the old 30-cap is GONE
    expect(yellow).toBe(YELLOW_MAX_MIN);

    yellow = clampYellowThreshold(15, red); // min(15, 14, 14) = 14
    expect(yellow).toBe(YELLOW_MAX_MIN);

    // 13 still passes through: the range below the ceiling is undisturbed
    yellow = clampYellowThreshold(13, red);
    expect(yellow).toBe(13);
  });

  /**
   * Scenario 2: Yellow DECREASES
   * Follows user input all the way down to floor=3.
   * Red never moves.
   */
  it('yellow decreases — follows input down to min=3, red never moves', () => {
    let yellow = YELLOW_MAX_MIN;
    const red = RED_MAX_MIN;

    yellow = clampYellowThreshold(15, red);
    expect(yellow).toBe(YELLOW_MAX_MIN);

    yellow = clampYellowThreshold(5, red);
    expect(yellow).toBe(5);

    yellow = clampYellowThreshold(3, red);
    expect(yellow).toBe(3);

    // Can't go below 3
    yellow = clampYellowThreshold(1, red);
    expect(yellow).toBe(3);

    expect(red).toBe(RED_MAX_MIN);
  });

  /**
   * Scenario 3: Red INCREASES
   * Fixed range 4–15. Red follows user input up to the ceiling.
   * Yellow stays where it is (more room created).
   */
  it('red increases — follows input up to the ceiling, yellow unchanged (more room)', () => {
    let yellow = 8;
    let red = clampRedThreshold(10);

    // Red 10 → 12: yellow stays 8 (min(8, 11) = 8)
    red = clampRedThreshold(12);
    yellow = clampYellowFollowingRed(yellow, red);
    expect(red).toBe(12);
    expect(yellow).toBe(8);

    // Red 12 → 15: yellow stays 8 (min(8, 14) = 8)
    red = clampRedThreshold(15);
    yellow = clampYellowFollowingRed(yellow, red);
    expect(red).toBe(15);
    expect(yellow).toBe(8);

    // An input above the ceiling lands ON it — this is the ruled behavior:
    // the offer stops where the engine stops, instead of 45 silently
    // becoming 15 behind the user's back.
    red = clampRedThreshold(45);
    expect(red).toBe(RED_MAX_MIN);

    // Fill the room: yellow rises to the ceiling but not past it
    yellow = clampYellowThreshold(20, red);
    expect(yellow).toBe(YELLOW_MAX_MIN);
  });

  /**
   * Scenario 4: Red DECREASES
   * Red follows user input (min=4, max=15).
   * Yellow clamps down if it would violate yellow < red.
   */
  it('red decreases — follows input, yellow clamps to maintain yellow < red', () => {
    let yellow = 13;
    let red = RED_MAX_MIN;

    // Red 15 → 10: yellow clamps to 9 (min(13, 9) = 9)
    red = clampRedThreshold(10);
    yellow = clampYellowFollowingRed(yellow, red);
    expect(red).toBe(10);
    expect(yellow).toBe(9);

    // Red 10 → 5: yellow clamps to 4 (min(9, 4) = 4)
    red = clampRedThreshold(5);
    yellow = clampYellowFollowingRed(yellow, red);
    expect(red).toBe(5);
    expect(yellow).toBe(4);

    // Red 5 → 4: yellow clamps to 3 (min(4, 3) = 3)
    red = clampRedThreshold(4);
    yellow = clampYellowFollowingRed(yellow, red);
    expect(red).toBe(4);
    expect(yellow).toBe(3);

    // Can't go below 4
    red = clampRedThreshold(1);
    expect(red).toBe(4);
  });
});

/**
 * CROSS-SURFACE AGREEMENT — the pin the filed finding asked for.
 *
 * RULING 2026-09-15 (lane owner): the settings UI must not offer any minute
 * value the board engine will silently override. The UI minute ceilings in
 * kdsThresholdMinutes.ts derive from the hook seconds ceilings, and those
 * derive from RED_URGENT — one ladder of truth. These cases make the
 * agreement load-bearing: if either clamp moves without the other, or a
 * literal ceiling is re-hardcoded on one side, a case here goes red.
 *
 * Method, per the finding's own wording ("pins UI-minutes x 60 against the
 * hook's output for the same setting"): for every reachable raw minute value,
 * whatever the UI clamp hands back must pass through clampSlaThresholds
 * UNTOUCHED — the engine must never have work to do that the UI did not
 * already do.
 */
describe('KDS threshold clamping — cross-surface agreement (UI minutes × 60 == hook seconds)', () => {
  it('every UI-clamped red passes the seconds clamp untouched, for all raw minutes 1..120', () => {
    for (let m = 1; m <= 120; m++) {
      const uiMin = clampRedThreshold(m);
      const hook = clampSlaThresholds({ yellowAtSec: 300, redAtSec: uiMin * 60 });
      expect(hook.redAtSec, `raw ${m} min: UI said ${uiMin} min, engine overrode to ${hook.redAtSec / 60} min`).toBe(uiMin * 60);
    }
  });

  it('every UI-clamped yellow passes the seconds clamp untouched, for all raw minutes 1..120', () => {
    for (let m = 1; m <= 120; m++) {
      for (const rawRed of [4, 5, 8, 10, 12, 15, 20, 30, 60, 120]) {
        const redMin = clampRedThreshold(rawRed);
        const uiMin = clampYellowThreshold(m, redMin);
        const hook = clampSlaThresholds({ yellowAtSec: uiMin * 60, redAtSec: redMin * 60 });
        expect(hook.yellowAtSec, `raw ${m} min vs red ${rawRed}: UI said ${uiMin} min, engine overrode to ${hook.yellowAtSec / 60} min`).toBe(uiMin * 60);
      }
    }
  });

  it('the engine ceiling is exactly reachable from the UI, not merely enforced by it', () => {
    // The widest values the UI can produce are the widest the engine honors —
    // agreement in both directions: no silent override AND no unreachable headroom.
    expect(clampRedThreshold(10_000) * 60).toBe(RED_URGENT);
    expect(clampYellowThreshold(10_000, 10_000) * 60).toBe(RED_URGENT - 60);
  });
});
