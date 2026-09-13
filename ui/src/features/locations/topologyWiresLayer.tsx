//! Wire layer for the topology editor canvas (composition C6-d): the
//! node-wires svg — arrowhead marker defs, one TopologyWireGroup per wire
//! (geometry memo lookup with early null), and the connection preview line.
//!
//! All behavior arrives as props - the layer owns no state and registers no
//! hooks, and is NOT memoized (plain function renders 1:1 where the inline
//! block sat; the editor suite pins the wire-group render identity and the
//! churn itself, so no wrapper may add memoization or new callbacks). The
//! inline original rendered the svg unconditionally (markers + preview live
//! even with zero wires), so there is deliberately no early return. JSX is
//! byte-verbatim from the inline block - class names, the arrow markers and
//! the wire-hitbox element tree inside TopologyWireGroup are reached by the
//! editor suite directly. No extra DOM wrapper, no css import.
//!
//! Parent memos (wireGeometries, svgBounds) arrive by reference and are read
//! directly - never copied or cloned. EMPTY_ERRORS stays the editor's
//! module-local constant and travels as the emptyErrors prop (ruling 7):
//! the layer must not export or re-declare it.

import type { Dispatch, MouseEvent as ReactMouseEvent, SetStateAction } from 'react';
import type { useLocalization } from '@fluent/react';
import type { TopologyWireData } from './nodeTopologyEditorTypes';
import type { TopologyValidationError } from './topologyContract';
import { TopologyWireGroup } from './topologyWireGroup';

export interface TopologyWiresLayerProps {
  /** The parent's wires (full list; the map body stays verbatim). */
  wires: TopologyWireData[];
  /** Parent's precomputed path geometry, by reference. */
  wireGeometries: ReadonlyMap<string, {
    x1: number; y1: number; x2: number; y2: number;
    dx: number;
    pathD: string;
    polyline?: Array<[number, number]>;
  }>;
  /** SVG cover bounds (the parent's bounds memo, by reference). */
  svgBounds: { width: number; height: number };
  /** Interaction mirrors (hover brightens, selected turns info-blue). */
  hoveredWireId: string | null;
  selectedWireId: string | null;
  /** Hover-focus wiring set, or null outside focus mode (dim gate). */
  hoverConnections: Set<string> | null;
  /** The hovered card's id (hover-focus mode anchor). */
  hoveredNodeId: string | null;
  /** The parent's live validation readout (only byWire is consumed). */
  liveValidation: { byWire: ReadonlyMap<string, TopologyValidationError[]> };
  /** The editor's module-local EMPTY_ERRORS (ruling 7 - passed, not moved). */
  emptyErrors: TopologyValidationError[];
  /** Connection preview line while a connect drag is active, or null. */
  wirePreviewLine: { d: string } | null;
  /** Only getString is needed (wire tooltip label). */
  l10n: { getString: ReturnType<typeof useLocalization>['l10n']['getString'] };
  /** Hover + interaction handlers, passed through unwrapped (no new
   *  useCallback - the memo suite pins the parent's churn itself). */
  onHoverWire: Dispatch<SetStateAction<string | null>>;
  onWireClick: (e: { stopPropagation(): void }, wireId: string) => void;
  onOpenWireMenu: (e: ReactMouseEvent, wireId: string) => void;
  onStartGhostBend: (e: ReactMouseEvent, wireId: string, segmentIndex: number, mx: number, my: number) => void;
  onStartBendDrag: (e: ReactMouseEvent, wireId: string, index: number, bx: number, by: number) => void;
  onRemoveBend: (wireId: string, index: number) => void;
}

/** The wires svg the editor previously rendered inline. */
export function TopologyWiresLayer({
  wires,
  wireGeometries,
  svgBounds,
  hoveredWireId,
  selectedWireId,
  hoverConnections,
  hoveredNodeId,
  liveValidation,
  emptyErrors,
  wirePreviewLine,
  l10n,
  onHoverWire,
  onWireClick,
  onOpenWireMenu,
  onStartGhostBend,
  onStartBendDrag,
  onRemoveBend,
}: TopologyWiresLayerProps) {
  return (
    <svg className="node-wires-svg" style={{ width: svgBounds.width, height: svgBounds.height }}>
      <defs>
        <marker
          id="arrow-end"
          viewBox="0 0 6 6"
          refX="5"
          refY="3"
          markerWidth="4"
          markerHeight="4"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 6 3 L 0 6 z" fill="var(--color-accent, #5a9fd4)" />
        </marker>

        <marker
          id="arrow-start"
          viewBox="0 0 6 6"
          refX="5"
          refY="3"
          markerWidth="4"
          markerHeight="4"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 6 3 L 0 6 z" fill="var(--color-accent, #5a9fd4)" />
        </marker>
      </defs>

      {wires.map((wire) => {
        const geo = wireGeometries.get(wire.id);
        if (!geo) return null;
        return (
          <TopologyWireGroup
            key={wire.id}
            wire={wire}
            x1={geo.x1}
            y1={geo.y1}
            x2={geo.x2}
            y2={geo.y2}
            dx={geo.dx}
            pathD={geo.pathD}
            polyline={geo.polyline}
            errors={liveValidation.byWire.get(wire.id) ?? emptyErrors}
            selected={selectedWireId === wire.id}
            dimmed={hoverConnections !== null
              && wire.fromNodeId !== hoveredNodeId
              && wire.toNodeId !== hoveredNodeId}
            hovered={hoveredWireId === wire.id}
            l10n={l10n}
            onHoverWire={onHoverWire}
            onWireClick={onWireClick}
            onOpenWireMenu={onOpenWireMenu}
            onStartGhostBend={onStartGhostBend}
            onStartBendDrag={onStartBendDrag}
            onRemoveBend={onRemoveBend}
          />
        );
      })}

      {wirePreviewLine && (
        <path d={wirePreviewLine.d} className="wire-path" opacity="0.5" pointerEvents="none" />
      )}
    </svg>
  );
}
