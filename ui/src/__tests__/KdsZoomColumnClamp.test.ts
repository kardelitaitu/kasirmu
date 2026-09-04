// Unit tests for zoom and column count clamping — the pure boundary
// logic used by the KDS hamburger panel stepper buttons.

import { describe, it, expect } from 'vitest';

/** Same zoom clamping as KdsHamburgerPanel. */
function clampZoom(zoom: number, direction: 'in' | 'out' | 'reset'): number {
  if (direction === 'reset') return 100;
  return direction === 'out'
    ? Math.max(50, zoom - 10)
    : Math.min(200, zoom + 10);
}

/** Same column clamping as KdsHamburgerPanel. */
function clampColumns(cols: number, direction: 'in' | 'out' | 'reset'): number {
  if (direction === 'reset') return 0;
  return direction === 'out'
    ? Math.max(1, cols - 1)
    : cols + 1;
}

describe('clampZoom', () => {
  it('reset always returns 100', () => {
    expect(clampZoom(50, 'reset')).toBe(100);
    expect(clampZoom(100, 'reset')).toBe(100);
    expect(clampZoom(200, 'reset')).toBe(100);
  });

  it('zoom out decreases by 10', () => {
    expect(clampZoom(100, 'out')).toBe(90);
    expect(clampZoom(80, 'out')).toBe(70);
  });

  it('zoom out clamps at 50', () => {
    expect(clampZoom(50, 'out')).toBe(50);
    expect(clampZoom(55, 'out')).toBe(50);
    expect(clampZoom(60, 'out')).toBe(50);
  });

  it('zoom in increases by 10', () => {
    expect(clampZoom(100, 'in')).toBe(110);
    expect(clampZoom(150, 'in')).toBe(160);
  });

  it('zoom in clamps at 200', () => {
    expect(clampZoom(200, 'in')).toBe(200);
    expect(clampZoom(195, 'in')).toBe(200);
    expect(clampZoom(190, 'in')).toBe(200);
  });

  it('bidirectional from 100', () => {
    let z = 100;
    z = clampZoom(z, 'out');
    expect(z).toBe(90);
    z = clampZoom(z, 'in');
    expect(z).toBe(100);
  });
});

describe('clampColumns', () => {
  it('reset returns 0 (auto)', () => {
    expect(clampColumns(3, 'reset')).toBe(0);
    expect(clampColumns(0, 'reset')).toBe(0);
  });

  it('column out decreases by 1', () => {
    expect(clampColumns(3, 'out')).toBe(2);
    expect(clampColumns(5, 'out')).toBe(4);
  });

  it('column out clamps at 1', () => {
    expect(clampColumns(1, 'out')).toBe(1);
  });

  it('column in increases by 1 (no ceiling)', () => {
    expect(clampColumns(3, 'in')).toBe(4);
    expect(clampColumns(5, 'in')).toBe(6);
    expect(clampColumns(10, 'in')).toBe(11);
  });

  it('column in from 0 (auto) goes to 1', () => {
    expect(clampColumns(0, 'in')).toBe(1);
  });

  it('bidirectional from 3', () => {
    let c = 3;
    c = clampColumns(c, 'out');
    expect(c).toBe(2);
    c = clampColumns(c, 'in');
    expect(c).toBe(3);
  });
});
