/**
 * Pure helpers for the topology editor's touch gestures (pointer parity).
 * Kept free of React/DOM so the pinch math is unit-testable in isolation —
 * the component wires these into its pointer handlers.
 */

/** Movement (px) a single touch must exceed before it becomes a drag/pan
 *  instead of a tap. */
export const TOUCH_DRAG_THRESHOLD = 8;

/** Zoom clamp — mirrors the wheel/button zoom range. */
export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 2.0;

export interface PinchTransformState {
  zoom: number;
  pan: { x: number; y: number };
}

/** Two-finger pinch + pan in one transform: scale the zoom by the
 *  finger-distance ratio (clamped to the zoom range) while keeping the
 *  canvas point that sat under the ORIGINAL midpoint under the CURRENT
 *  midpoint — the standard "zoom about the pinch center" math, so the
 *  content under the fingers never slides away mid-pinch. A degenerate
 *  zero start distance is a no-op. */
export function pinchTransform(
  prev: PinchTransformState,
  mid0: { x: number; y: number },
  dist0: number,
  mid1: { x: number; y: number },
  dist1: number,
): PinchTransformState {
  if (dist0 <= 0) return prev;
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev.zoom * (dist1 / dist0)));
  const ratio = zoom / prev.zoom;
  return {
    zoom,
    pan: {
      x: mid1.x - (mid0.x - prev.pan.x) * ratio,
      y: mid1.y - (mid0.y - prev.pan.y) * ratio,
    },
  };
}
