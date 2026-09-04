// Unit tests for KDS settings value conversions — the pure mappings
// between UI slider values (minutes) and internal thresholds (seconds),
// and the density→compact class determination.

import { describe, it, expect } from 'vitest';

/** Same conversion as KdsScreen.tsx slaThresholds useMemo. */
function toSlaThresholds(yellowMin: number, redMin: number) {
  return {
    yellowAtSec: yellowMin * 60,
    redAtSec: redMin * 60,
  };
}

/** Same compact class logic as KdsScreen.tsx. */
function compactClass(density: number): string {
  return density <= 2 ? 'kds--compact' : '';
}

/** Same density clamping as KdsHamburgerPanel buttons. */
function clampDensity(density: number, direction: 'up' | 'down'): number {
  return direction === 'down'
    ? Math.max(1, density - 1)
    : Math.min(5, density + 1);
}

describe('toSlaThresholds', () => {
  it('converts default thresholds (5 min / 10 min)', () => {
    const t = toSlaThresholds(5, 10);
    expect(t.yellowAtSec).toBe(300);
    expect(t.redAtSec).toBe(600);
  });

  it('converts minimum thresholds (3 min / 4 min)', () => {
    const t = toSlaThresholds(3, 4);
    expect(t.yellowAtSec).toBe(180);
    expect(t.redAtSec).toBe(240);
  });

  it('converts maximum thresholds (30 min / 60 min)', () => {
    const t = toSlaThresholds(30, 60);
    expect(t.yellowAtSec).toBe(1800);
    expect(t.redAtSec).toBe(3600);
  });

  it('converts 1 min / 2 min', () => {
    const t = toSlaThresholds(1, 2);
    expect(t.yellowAtSec).toBe(60);
    expect(t.redAtSec).toBe(120);
  });

  it('converts 0 min (edge case)', () => {
    const t = toSlaThresholds(0, 0);
    expect(t.yellowAtSec).toBe(0);
    expect(t.redAtSec).toBe(0);
  });
});

describe('compactClass', () => {
  it('density 1 → compact', () => {
    expect(compactClass(1)).toBe('kds--compact');
  });

  it('density 2 → compact', () => {
    expect(compactClass(2)).toBe('kds--compact');
  });

  it('density 3 → not compact', () => {
    expect(compactClass(3)).toBe('');
  });

  it('density 4 → not compact', () => {
    expect(compactClass(4)).toBe('');
  });

  it('density 5 → not compact', () => {
    expect(compactClass(5)).toBe('');
  });
});

describe('clampDensity', () => {
  it('decrease from 3 → 2', () => {
    expect(clampDensity(3, 'down')).toBe(2);
  });

  it('decrease from 1 → 1 (floor)', () => {
    expect(clampDensity(1, 'down')).toBe(1);
  });

  it('decrease from 2 → 1', () => {
    expect(clampDensity(2, 'down')).toBe(1);
  });

  it('increase from 3 → 4', () => {
    expect(clampDensity(3, 'up')).toBe(4);
  });

  it('increase from 5 → 5 (ceiling)', () => {
    expect(clampDensity(5, 'up')).toBe(5);
  });

  it('increase from 4 → 5', () => {
    expect(clampDensity(4, 'up')).toBe(5);
  });
});
