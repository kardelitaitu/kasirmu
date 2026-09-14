/**
 * Unit tests for KDS yellow/red SLA threshold clamping logic.
 *
 * Rules (were inline in KdsScreen.tsx; now exported from kdsThresholdMinutes.ts):
 *   Yellow fixed range: 3–30
 *   Red fixed range:    4–60
 *   Invariant:          yellow < red (always)
 *   onChangeYellowThreshold(v) → yellow = clamp(v, 3, min(30, red-1)), red unchanged
 *   onChangeRedThreshold(v)   → red = clamp(v, 4, 60); yellow = min(yellow, red-1)
 *
 * LOAD-BEARING AS OF THIS COMMIT — it used to fail the way
 * KdsStatusAdvance.test.ts:4-8 records: the clamping was re-implemented here
 * as local clampYellow() / applyRedChange() functions, so editing or deleting
 * the production expressions left all 5 cases green. This suite was testing a
 * copy. Both local functions are gone and every assertion now calls the
 * exported production helpers, so a bound changed in kdsThresholdMinutes.ts
 * fails this file by construction.
 *
 * Scope: MINUTES only — the settings-slider clamp. The seconds clamp that
 * decides when a ticket turns yellow/red on the board is
 * hooks/useTicketSla.ts:clampSlaThresholds, already covered by
 * KdsSlaThresholdClamp.test.ts. The two ceilings disagree (30/60 min here vs
 * 840/900 s = 14/15 min there). That is an open product ruling about which
 * clamp wins, deliberately NOT asserted in either direction here: pinning it
 * as-is would ship a red suite, and pinning it as-desired would invent
 * behaviour.
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
} from '@/features/kds/kdsThresholdMinutes';

describe('KDS threshold clamping — 4 core scenarios', () => {
  /**
   * Scenario 1: Yellow INCREASES
   * Fixed range 3–30. Follows user input until capped at red-1.
   * Red never moves.
   */
  it('yellow increases — follows input up to min(30, red-1), red never moves', () => {
    let yellow = 5;
    const red = 10;

    // 5 → 8: passes through (8 < min(30, 9) = 9)
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

  it('yellow increases — high red allows full 3–30 range', () => {
    let yellow = 3;
    const red = 60;

    yellow = clampYellowThreshold(30, red); // min(30, 59, 30) = 30
    expect(yellow).toBe(30);

    yellow = clampYellowThreshold(15, red);
    expect(yellow).toBe(15);
  });

  /**
   * Scenario 2: Yellow DECREASES
   * Follows user input all the way down to floor=3.
   * Red never moves.
   */
  it('yellow decreases — follows input down to min=3, red never moves', () => {
    let yellow = 25;
    const red = 40;

    yellow = clampYellowThreshold(15, red);
    expect(yellow).toBe(15);

    yellow = clampYellowThreshold(5, red);
    expect(yellow).toBe(5);

    yellow = clampYellowThreshold(3, red);
    expect(yellow).toBe(3);

    // Can't go below 3
    yellow = clampYellowThreshold(1, red);
    expect(yellow).toBe(3);

    expect(red).toBe(40);
  });

  /**
   * Scenario 3: Red INCREASES
   * Fixed range 4–60. Red follows user input.
   * Yellow stays where it is (more room created).
   */
  it('red increases — follows input, yellow unchanged (more room)', () => {
    let yellow = 20;
    let red = 30;

    // Red 30 → 45: yellow stays 20 (min(20, 44) = 20)
    red = clampRedThreshold(45);
    yellow = clampYellowFollowingRed(yellow, red);
    expect(red).toBe(45);
    expect(yellow).toBe(20);

    // Red 45 → 60: yellow stays 20 (min(20, 59) = 20)
    red = clampRedThreshold(60);
    yellow = clampYellowFollowingRed(yellow, red);
    expect(red).toBe(60);
    expect(yellow).toBe(20);

    // Now fill the room: yellow 20 → 30
    yellow = clampYellowThreshold(30, red);
    expect(yellow).toBe(30);
  });

  /**
   * Scenario 4: Red DECREASES
   * Red follows user input (min=4).
   * Yellow clamps down if it would violate yellow < red.
   */
  it('red decreases — follows input, yellow clamps to maintain yellow < red', () => {
    let yellow = 25;
    let red = 50;

    // Red 50 → 40: yellow stays 25 (min(25, 39) = 25)
    red = clampRedThreshold(40);
    yellow = clampYellowFollowingRed(yellow, red);
    expect(red).toBe(40);
    expect(yellow).toBe(25);

    // Red 40 → 30: yellow stays 25 (min(25, 29) = 25)
    red = clampRedThreshold(30);
    yellow = clampYellowFollowingRed(yellow, red);
    expect(red).toBe(30);
    expect(yellow).toBe(25);

    // Red 30 → 25: yellow clamps to 24 (min(25, 24) = 24)
    red = clampRedThreshold(25);
    yellow = clampYellowFollowingRed(yellow, red);
    expect(red).toBe(25);
    expect(yellow).toBe(24);

    // Red 25 → 10: yellow clamps to 9 (min(24, 9) = 9)
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
  });
});
