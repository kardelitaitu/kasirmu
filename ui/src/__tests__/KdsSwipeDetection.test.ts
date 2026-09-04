// Unit tests for swipe detection — the pure logic that determines
// whether a touch gesture qualifies as a horizontal swipe.

import { describe, it, expect } from 'vitest';

interface TouchPoint { x: number; y: number; time: number; }

/** Pure swipe detection logic extracted from useSwipe onTouchEnd. */
function detectSwipe(
  start: TouchPoint,
  end: TouchPoint,
  options: { minDistance?: number; maxTimeMs?: number } = {},
): 'left' | 'right' | null {
  const { minDistance = 50, maxTimeMs = 300 } = options;
  const dt = end.time - start.time;
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const distance = Math.abs(deltaX);

  if (distance > Math.abs(deltaY) && distance > minDistance && dt <= maxTimeMs) {
    if (deltaX > 0) return 'right';
    if (deltaX < 0) return 'left';
  }
  return null;
}

describe('detectSwipe', () => {
  // ── Valid swipes ────────────────────────────────────────────────

  it('detects right swipe', () => {
    expect(detectSwipe({ x: 100, y: 200, time: 0 }, { x: 200, y: 200, time: 100 })).toBe('right');
  });

  it('detects left swipe', () => {
    expect(detectSwipe({ x: 200, y: 200, time: 0 }, { x: 100, y: 200, time: 100 })).toBe('left');
  });

  it('detects right swipe with slight vertical movement', () => {
    expect(detectSwipe({ x: 100, y: 200, time: 0 }, { x: 200, y: 210, time: 100 })).toBe('right');
  });

  // ── Too short ───────────────────────────────────────────────────

  it('rejects swipe shorter than minDistance', () => {
    expect(detectSwipe({ x: 100, y: 200, time: 0 }, { x: 140, y: 200, time: 100 })).toBeNull();
  });

  it('rejects swipe at exactly minDistance (must be >)', () => {
    expect(detectSwipe({ x: 100, y: 200, time: 0 }, { x: 150, y: 200, time: 100 })).toBeNull();
  });

  it('accepts swipe just over minDistance', () => {
    expect(detectSwipe({ x: 100, y: 200, time: 0 }, { x: 151, y: 200, time: 100 })).toBe('right');
  });

  // ── Too slow ────────────────────────────────────────────────────

  it('rejects swipe slower than maxTimeMs', () => {
    expect(detectSwipe({ x: 100, y: 200, time: 0 }, { x: 200, y: 200, time: 301 })).toBeNull();
  });

  it('accepts swipe at exactly maxTimeMs', () => {
    expect(detectSwipe({ x: 100, y: 200, time: 0 }, { x: 200, y: 200, time: 300 })).toBe('right');
  });

  // ── More vertical than horizontal ───────────────────────────────

  it('rejects vertical swipe (more vertical than horizontal)', () => {
    expect(detectSwipe({ x: 100, y: 100, time: 0 }, { x: 120, y: 200, time: 100 })).toBeNull();
  });

  it('rejects 45-degree diagonal (equal X and Y)', () => {
    expect(detectSwipe({ x: 100, y: 100, time: 0 }, { x: 200, y: 200, time: 100 })).toBeNull();
  });

  // ── Custom options ──────────────────────────────────────────────

  it('respects custom minDistance', () => {
    const opts = { minDistance: 10 };
    expect(detectSwipe({ x: 100, y: 200, time: 0 }, { x: 115, y: 200, time: 50 }, opts)).toBe('right');
  });

  it('respects custom maxTimeMs', () => {
    const opts = { maxTimeMs: 500 };
    expect(detectSwipe({ x: 100, y: 200, time: 0 }, { x: 200, y: 200, time: 400 }, opts)).toBe('right');
  });

  // ── Edge cases ──────────────────────────────────────────────────

  it('same start and end → null', () => {
    expect(detectSwipe({ x: 100, y: 200, time: 0 }, { x: 100, y: 200, time: 0 })).toBeNull();
  });

  it('zero time delta → null (too short distance)', () => {
    expect(detectSwipe({ x: 100, y: 200, time: 0 }, { x: 100, y: 200, time: 0 })).toBeNull();
  });
});
