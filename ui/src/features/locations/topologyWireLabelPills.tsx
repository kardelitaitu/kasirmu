//! Wire-label pills for the topology editor canvas (composition C7): the
//! permanent label button at each wire's midpoint (the same point the
//! rename input anchors to). Clicking opens the rename editor - the wire
//! itself stays the direction-cycle affordance, so the pill must not cycle.
//!
//! All behavior arrives as props - the layer owns no state and registers no
//! hooks, and is NOT memoized (plain function renders 1:1 where the inline
//! block sat). The visibility + rename + geometry guards read props, so
//! they travel INSIDE the component (the call site renders unconditionally).
//! JSX is byte-verbatim from the inline block - class names, the title
//! tooltip and the click/rename semantics are reached by the editor suite
//! directly. Per-item locals (geo, mid, isDimmed, rStyle, tooltip) stay
//! inside the map body. No extra DOM wrapper (bare fragment), no css import.
//!
//! relationshipStyle / wireDisplayLabel arrive by reference (the parent's
//! own helpers) - never copied or re-implemented. The C3 record noted the
//! editor kept polylinePoint/cubicBezier FOR this block; with the block
//! moved, their editor imports are dropped (the rename overlay imports its
//! own).

import type { TopologyWireData } from './nodeTopologyEditorTypes';
import type { SemanticRelationshipType } from './topologyContract';
import { cubicBezier, polylinePoint } from './topologyWireGeometry';

export interface TopologyWireLabelPillsProps {
  /** The parent's wires (full list; the map body stays verbatim). */
  wires: TopologyWireData[];
  /** Pills render only while the labels toggle is on. */
  wireLabelsVisible: boolean;
  /** Parent's precomputed path geometry, by reference. */
  wireGeometries: ReadonlyMap<string, {
    x1: number; y1: number; x2: number; y2: number;
    dx: number;
    pathD: string;
    polyline?: Array<[number, number]>;
  }>;
  /** Parent's node lookup for endpoint names (by reference). */
  nodeMap: ReadonlyMap<string, { name: string }>;
  /** Hover-focus wiring set, or null outside focus mode (dim gate). */
  hoverConnections: Set<string> | null;
  /** The hovered card's id (hover-focus mode anchor). */
  hoveredNodeId: string | null;
  /** The wire id whose rename input is open (its pill is hidden). */
  renamingWireId: string | null;
  /** Relationship color/icon/label lookup (parent useCallback, by ref). */
  relationshipStyle: (type?: SemanticRelationshipType) => { color: string; icon: string; label: string };
  /** Endpoint-name label the pills share with the context menu title. */
  wireDisplayLabel: (wire: TopologyWireData) => string;
  /** Click selects the wire; then the rename editor opens. */
  onSelectWire: (id: string) => void;
  onStartWireRename: (wireId: string) => void;
}

/** The wire-label pills the editor previously rendered inline. */
export function TopologyWireLabelPills({
  wires,
  wireLabelsVisible,
  wireGeometries,
  nodeMap,
  hoverConnections,
  hoveredNodeId,
  renamingWireId,
  relationshipStyle,
  wireDisplayLabel,
  onSelectWire,
  onStartWireRename,
}: TopologyWireLabelPillsProps) {
  if (!wireLabelsVisible) return null;
  return (
    <>
      {wires.map((wire) => {
        // Permanent label pill at the wire's midpoint (the same point
        // the rename input anchors to). Clicking opens the rename
        // editor — the wire itself stays the direction-cycle
        // affordance, so the pill must not cycle. Hidden while the
        // wire's own rename input is open (it replaces the pill).
        if (renamingWireId === wire.id) return null;
        const geo = wireGeometries.get(wire.id);
        if (!geo) return null;
        const mid = geo.polyline
          ? polylinePoint(geo.polyline, 0.5)
          : {
              x: cubicBezier(0.5, geo.x1, geo.x1 + geo.dx, geo.x2 - geo.dx, geo.x2),
              y: cubicBezier(0.5, geo.y1, geo.y1, geo.y2, geo.y2),
            };
        const isDimmed = hoverConnections !== null
          && wire.fromNodeId !== hoveredNodeId
          && wire.toNodeId !== hoveredNodeId;
        const rStyle = relationshipStyle(wire.relationshipType);
        const fromName = nodeMap.get(wire.fromNodeId)?.name ?? '';
        const toName = nodeMap.get(wire.toNodeId)?.name ?? '';
        const tooltip = `${rStyle.icon} ${rStyle.label}: ${fromName} → ${toName}`;
        return (
          <button
            key={wire.id}
            type="button"
            className={`wire-label-pill${isDimmed ? ' wire-label-pill-dimmed' : ''}`}
            style={{ left: mid.x, top: mid.y }}
            title={tooltip}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onSelectWire(wire.id);
              onStartWireRename(wire.id);
            }}
          >
            <span className="wire-label-badge" style={{ backgroundColor: rStyle.color }} />
            <span className="wire-label-text-content">{wireDisplayLabel(wire)}</span>
          </button>
        );
      })}
    </>
  );
}
