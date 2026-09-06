import { describe, it, expect } from 'vitest';
import { pinchTransform, MIN_ZOOM, MAX_ZOOM } from '../features/locations/nodeTopologyTouch';

describe('pinchTransform (two-finger pinch + pan math)', () => {
  it('zooms toward the fingers, keeping the pinch midpoint fixed', () => {
    // Start: zoom 1, pan (0,0), fingers at (100,100) + (140,100) → mid (120,100), dist 40.
    // Fingers spread to dist 60 with the SAME midpoint → zoom 1.5.
    const out = pinchTransform(
      { zoom: 1, pan: { x: 0, y: 0 } },
      { x: 120, y: 100 },
      40,
      { x: 120, y: 100 },
      60,
    );
    expect(out.zoom).toBeCloseTo(1.5, 5);
    // The canvas point under the old midpoint must sit under the new midpoint:
    // (mid − pan')/zoom' === (mid − pan)/zoom.
    const canvasX = (120 - out.pan.x) / out.zoom;
    const canvasY = (100 - out.pan.y) / out.zoom;
    expect(canvasX).toBeCloseTo(120, 5);
    expect(canvasY).toBeCloseTo(100, 5);
  });

  it('two-finger pan moves the midpoint without zooming', () => {
    const out = pinchTransform(
      { zoom: 1, pan: { x: 0, y: 0 } },
      { x: 120, y: 100 },
      40,
      { x: 140, y: 110 },
      40,
    );
    expect(out.zoom).toBe(1);
    expect(out.pan.x).toBe(20);
    expect(out.pan.y).toBe(10);
  });

  it('clamps the zoom to the 40%..200% range', () => {
    const zoomedIn = pinchTransform(
      { zoom: 1, pan: { x: 0, y: 0 } },
      { x: 100, y: 100 },
      10,
      { x: 100, y: 100 },
      100,
    );
    expect(zoomedIn.zoom).toBe(MAX_ZOOM);

    const zoomedOut = pinchTransform(
      { zoom: 1, pan: { x: 0, y: 0 } },
      { x: 100, y: 100 },
      100,
      { x: 100, y: 100 },
      10,
    );
    expect(zoomedOut.zoom).toBe(MIN_ZOOM);
  });

  it('degenerate zero distance is a no-op', () => {
    const prev = { zoom: 1.2, pan: { x: 30, y: -40 } };
    const out = pinchTransform(prev, { x: 100, y: 100 }, 0, { x: 100, y: 100 }, 40);
    expect(out).toEqual(prev);
  });
});
