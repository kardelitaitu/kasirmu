//! Compare-mode ghost layer for the topology editor canvas (composition
//! C6-b): the other branch's ghost cards at their saved positions, plus the
//! stub-wire SVG hinting at their connections.
//!
//! All behavior arrives as props - the layer owns no state and registers no
//! hooks, and is NOT memoized (plain function renders 1:1 where the inline
//! block sat). The empty guard is the component's own early return (it
//! reads the ghosts prop). The Round 158 rationale comment travels with the
//! JSX, byte-verbatim; the editor suite reaches the selectors directly, so
//! nothing here may rename one. No extra DOM wrapper, no css import.

import type { GhostPlacement, GhostWireStub } from './topologyBranchCompare';

export interface TopologyGhostLayerProps {
  /** Laid-out ghost placements from the compare hook's memo. */
  laidOutGhosts: GhostPlacement[];
  /** Card-edge stub lines hinting at the ghosts' wiring. */
  ghostStubs: GhostWireStub[];
  /** While a pan gesture is active the entrance animation is suppressed. */
  panGestureActive: boolean;
  /** Stub-SVG cover bounds (ghost extents + margin, parent memo). */
  stubSvgBounds: { width: number; height: number };
}

/** The compare ghost layer the editor previously rendered inline. */
export function TopologyGhostLayer({
  laidOutGhosts,
  ghostStubs,
  panGestureActive,
  stubSvgBounds,
}: TopologyGhostLayerProps) {
  if (laidOutGhosts.length === 0) return null;
  return (
    // Round 158: the compare panel's spatial diff. Other-only
    // workspaces render as ghost cards at their SAVED positions in
    // the other branch's diagram — a spatial hint of what that
    // location has that this one does not. Decorative: pointer-
    // events-none and aria-hidden, so the ghost never steals
    // clicks, hover, or focus from a card below.
    <div
      className={
        panGestureActive
          ? 'topology-overlay-ghost-layer'
          : 'topology-overlay-ghost-layer topology-ghosts-animate'
      }
      aria-hidden="true"
    >
      {ghostStubs.length > 0 && (
        <svg
          className="topology-overlay-stub-layer"
          style={{ width: stubSvgBounds.width, height: stubSvgBounds.height }}
        >
          {ghostStubs.map((s) => (
            <line
              key={s.id}
              className="topology-overlay-stub"
              x1={s.x1}
              y1={s.y1}
              x2={s.x2}
              y2={s.y2}
            />
          ))}
        </svg>
      )}
      {laidOutGhosts.map((g) => (
        <div
          key={g.id}
          className="topology-overlay-ghost"
          data-overlay-node-id={g.id}
          aria-hidden="true"
          style={{ transform: `translate(${g.x}px, ${g.y}px)` }}
        >
          <span className="topology-overlay-ghost-name">{g.name}</span>
        </div>
      ))}
    </div>
  );
}
