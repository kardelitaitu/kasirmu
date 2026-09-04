/**
 * Unit tests for KDS yellow/red SLA threshold clamping logic.
 *
 * Rules (from KdsScreen.tsx):
 *   Yellow fixed range: 3–30
 *   Red fixed range:    4–60
 *   Invariant:          yellow < red (always)
 *   onChangeYellowThreshold(v) → yellow = clamp(v, 3, min(30, red-1)), red unchanged
 *   onChangeRedThreshold(v)   → red = clamp(v, 4, 60); yellow = min(yellow, red-1)
 */

/** Simulate the clamping logic from KdsScreen.tsx. */
function clampYellow(v: number, red: number) {
  return Math.max(3, Math.min(v, red - 1, 30));
}

function applyRedChange(newRed: number, yellow: number) {
  const red = Math.max(4, Math.min(newRed, 60));
  return { red, yellow: Math.min(yellow, red - 1) };
}

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
    yellow = clampYellow(8, red);
    expect(yellow).toBe(8);

    // 8 → 9: hits red-1 cap
    yellow = clampYellow(9, red);
    expect(yellow).toBe(9);

    // 9 → 15: clamped to 9
    yellow = clampYellow(15, red);
    expect(yellow).toBe(9);

    // 9 → 30: still clamped to 9
    yellow = clampYellow(30, red);
    expect(yellow).toBe(9);

    // 9 → 3: drops to floor
    yellow = clampYellow(3, red);
    expect(yellow).toBe(3);

    // Red unchanged throughout
    expect(red).toBe(10);
  });

  it('yellow increases — high red allows full 3–30 range', () => {
    let yellow = 3;
    const red = 60;

    yellow = clampYellow(30, red); // min(30, 59, 30) = 30
    expect(yellow).toBe(30);

    yellow = clampYellow(15, red);
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

    yellow = clampYellow(15, red);
    expect(yellow).toBe(15);

    yellow = clampYellow(5, red);
    expect(yellow).toBe(5);

    yellow = clampYellow(3, red);
    expect(yellow).toBe(3);

    // Can't go below 3
    yellow = clampYellow(1, red);
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
    const r45 = applyRedChange(45, yellow);
    red = r45.red;
    yellow = r45.yellow;
    expect(red).toBe(45);
    expect(yellow).toBe(20);

    // Red 45 → 60: yellow stays 20 (min(20, 59) = 20)
    const r60 = applyRedChange(60, yellow);
    red = r60.red;
    yellow = r60.yellow;
    expect(red).toBe(60);
    expect(yellow).toBe(20);

    // Now fill the room: yellow 20 → 30
    yellow = clampYellow(30, red);
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
    const r40 = applyRedChange(40, yellow);
    red = r40.red;
    yellow = r40.yellow;
    expect(red).toBe(40);
    expect(yellow).toBe(25);

    // Red 40 → 30: yellow stays 25 (min(25, 29) = 25)
    const r30 = applyRedChange(30, yellow);
    red = r30.red;
    yellow = r30.yellow;
    expect(red).toBe(30);
    expect(yellow).toBe(25);

    // Red 30 → 25: yellow clamps to 24 (min(25, 24) = 24)
    const r25 = applyRedChange(25, yellow);
    red = r25.red;
    yellow = r25.yellow;
    expect(red).toBe(25);
    expect(yellow).toBe(24);

    // Red 25 → 10: yellow clamps to 9 (min(24, 9) = 9)
    const r10 = applyRedChange(10, yellow);
    red = r10.red;
    yellow = r10.yellow;
    expect(red).toBe(10);
    expect(yellow).toBe(9);

    // Red 10 → 5: yellow clamps to 4 (min(9, 4) = 4)
    const r5 = applyRedChange(5, yellow);
    red = r5.red;
    yellow = r5.yellow;
    expect(red).toBe(5);
    expect(yellow).toBe(4);

    // Red 5 → 4: yellow clamps to 3 (min(4, 3) = 3)
    const r4 = applyRedChange(4, yellow);
    red = r4.red;
    yellow = r4.yellow;
    expect(red).toBe(4);
    expect(yellow).toBe(3);
  });
});
