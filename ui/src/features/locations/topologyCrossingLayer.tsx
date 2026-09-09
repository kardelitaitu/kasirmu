//! Wire-crossing overlay for the topology editor canvas (composition
//! C6-c): the under-card segments of wires that cross a card they do not
//! connect to, drawn on top so the wire reads as continuous, mirroring the
//! base wire's hover/selection/dim states (Round 146/151).
//!
//! All behavior arrives as props - the layer owns no state and registers no
//! hooks, and is NOT memoized (plain function renders 1:1 where the inline
//! block sat). The empty guard is the component's own early return (it
//! reads the paths prop). The Round 146 rationale comment travels with the
//! JSX byte-verbatim, and the Round 151 comment stays inside the map body.
//! No extra DOM wrapper (the svg returns directly), no css import.
//! wireUnderCardPaths arrives by reference (the parent memo Map) - read
//! directly, never copied or cloned.

import type { TopologyWireData } from './nodeTopologyEditorTypes';

export interface TopologyCrossingLayerProps {
  /** The parent's wires (full list; per-path lookups stay in the map body). */
  wires: TopologyWireData[];
  /** Wire id -> under-card path d-attribute (the parent's memo, by reference). */
  wireUnderCardPaths: ReadonlyMap<string, string>;
  /** SVG cover bounds (the parent's bounds memo, by reference). */
  svgBounds: { width: number; height: number };
  /** Interaction mirrors: hover brightens, selected turns info-blue. */
  hoveredWireId: string | null;
  selectedWireId: string | null;
  /** Hover-focus wiring set, or null outside focus mode (dim gate). */
  hoverConnections: Set<string> | null;
  /** The hovered card's id (hover-focus mode anchor). */
  hoveredNodeId: string | null;
}

/** The crossing overlay the editor previously rendered inline. */
export function TopologyCrossingLayer({
  wires,
  wireUnderCardPaths,
  svgBounds,
  hoveredWireId,
  selectedWireId,
  hoverConnections,
  hoveredNodeId,
}: TopologyCrossingLayerProps) {
  if (wireUnderCardPaths.size === 0) return null;
  return (
    <svg className="node-wires-crossing" style={{ width: svgBounds.width, height: svgBounds.height }}>
      {[...wireUnderCardPaths.entries()].map(([wireId, d]) => {
        // Round 151: the overlay must mirror the base wire's
        // interaction states (hover brightens, selected turns
        // info-blue, hover-focus mode dims) or the wire visibly
        // splits again the moment the user interacts with it —
        // the exact continuity defect round 146 fixed, but on
        // hover/selection instead of the static render.
        const crossingWire = wires.find((w) => w.id === wireId);
        const dimmed = hoverConnections !== null
          && (crossingWire === undefined
            || (crossingWire.fromNodeId !== hoveredNodeId
              && crossingWire.toNodeId !== hoveredNodeId));
        const cls = [
          hoveredWireId === wireId ? 'node-wires-crossing-hover' : null,
          selectedWireId === wireId ? 'node-wires-crossing-selected' : null,
          dimmed ? 'node-wires-crossing-dimmed' : null,
        ].filter(Boolean).join(' ') || undefined;
        return <path key={wireId} d={d} className={cls} pointerEvents="none" />;
      })}
    </svg>
  );
}
