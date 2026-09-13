/**
 * Memoized topology wire group.
 *
 * Extracted from the editor's inline `wires.map` render so a hover or
 * selection change re-renders ONLY the affected wire. Like the node card,
 * every prop must be referentially stable across unrelated renders — the
 * geometry objects come from a useMemo'd Map, and the handlers are stable
 * useCallbacks.
 */

import { memo, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import type { ReactLocalization } from '@fluent/react';
import type { TopologyWireData } from './NodeTopologyEditor';
import type { TopologyValidationError } from './topologyContract';


export interface TopologyWireGroupProps {
  wire: TopologyWireData;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  dx: number;
  pathD: string;
  polyline: Array<[number, number]> | undefined;
  selected: boolean;
  dimmed: boolean;
  hovered: boolean;
  /** Wire-scoped validation errors (e.g. warehouse-at-capacity). Must be a
   *  referentially stable array per wire — the editor passes a Map lookup. */
  errors: TopologyValidationError[];
  l10n: Pick<ReactLocalization, 'getString'>;
  onHoverWire: Dispatch<SetStateAction<string | null>>;
  onWireClick: (e: { stopPropagation(): void }, wireId: string) => void;
  onOpenWireMenu: (e: React.MouseEvent, wireId: string) => void;
  onStartGhostBend: (e: React.MouseEvent, wireId: string, segmentIndex: number, mx: number, my: number) => void;
  onStartBendDrag: (e: React.MouseEvent, wireId: string, index: number, bx: number, by: number) => void;
  onRemoveBend: (wireId: string, index: number) => void;
}

function TopologyWireGroupImpl({
  wire,
  x1,
  y1,
  x2,
  y2,
  pathD,
  polyline,
  selected,
  dimmed,
  hovered,
  errors,
  l10n,
  onHoverWire,
  onWireClick,
  onOpenWireMenu,
  onStartGhostBend,
  onStartBendDrag,
  onRemoveBend,
}: TopologyWireGroupProps): ReactNode {
  // Native SVG tooltip: the wire's label surfaces on hover instead of a
  // permanent canvas pill.
  const wireTooltip = [
    (wire.label || '').trim(),
    l10n.getString('topology-wire-toggle-hint'),
  ].filter(Boolean).join(' — ');

  return (
    <g
      className={`wire-group ${selected ? 'wire-selected' : ''}${dimmed ? ' wire-dimmed' : ''}`}
      onMouseEnter={() => onHoverWire(wire.id)}
      onMouseLeave={() => onHoverWire((prev) => (prev === wire.id ? null : prev))}
    >
      <path
        d={pathD}
        className="wire-hitbox"
        data-wire-id={wire.id}
        role="button"
        tabIndex={0}
        aria-label={l10n.getString('topology-wire-toggle-aria')}
        onClick={(e) => onWireClick(e, wire.id)}
        onContextMenu={(e) => onOpenWireMenu(e, wire.id)}
        onKeyDown={(e) => {
          // Keyboard parity: Enter/Space cycle the direction exactly like a
          // click (and select the wire).
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            onWireClick(e, wire.id);
          }
        }}
      >
        <title>{wireTooltip}</title>
      </path>

      {/* Explicit endpoint dot ensures the wire always starts exactly at the
          port socket center, regardless of SVG renderer quirks with
          stroke-dasharray at path boundaries. */}
      <circle cx={x1} cy={y1} r="1.5" className="wire-end-dot" />

      <path
        d={pathD}
        className={`wire-path ${wire.direction}`}
        data-direction={wire.direction}
        markerEnd={wire.direction === 'reverse' ? undefined : 'url(#arrow-end)'}
        markerStart={
          wire.direction === 'reverse'
            ? 'url(#arrow-start)'
            : wire.direction === 'two-way'
              ? 'url(#arrow-start)'
              : undefined
        }
      />

      {/* Wire-scoped validation marker: a warning badge at the wire's
          midpoint when this wire carries an error (warehouse-at-capacity
          and friends). Click/keyboard parity matches the hitbox so the
          marker never blocks wire interaction — it selects/cycles the wire
          exactly like a click on the line. The message surfaces as a native
          SVG tooltip. */}
      {errors.length > 0 && (() => {
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        return (
          <g
            className="wire-validation-marker"
            role="button"
            tabIndex={0}
            aria-label={l10n.getString(errors[0]!.messageId)}
            onClick={(e) => onWireClick(e, wire.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                onWireClick(e, wire.id);
              }
            }}
          >
            <title>{l10n.getString(errors[0]!.messageId)}</title>
            <circle cx={mx} cy={my} r="7" />
            <text x={mx} y={my} className="wire-validation-marker-text">!</text>
          </g>
        );
      })()}

      {/* Bend editing affordances: a midpoint ghost per segment that creates
          a bend when dragged — revealed on hover (discoverability) and
          selection; plus a draggable handle per EXISTING bend, which renders
          on selection only so hover stays light. The ghost set derives from
          the drawn geometry (polyline when bent, else the two endpoints). */}
      {(selected || hovered) && (() => {
        const pts: Array<[number, number]> = polyline ?? [[x1, y1], [x2, y2]];
        const ghosts: Array<{ x: number; y: number; seg: number }> = [];
        for (let i = 0; i < pts.length - 1; i++) {
          ghosts.push({
            x: (pts[i]![0] + pts[i + 1]![0]) / 2,
            y: (pts[i]![1] + pts[i + 1]![1]) / 2,
            seg: i,
          });
        }
        return (
          <>
            {ghosts.map((g) => (
              <circle
                key={`g${g.seg}`}
                className="wire-bend-ghost"
                data-wire-id={wire.id}
                data-segment-index={g.seg}
                cx={g.x}
                cy={g.y}
                r={5}
                onMouseDown={(e) => onStartGhostBend(e, wire.id, g.seg, g.x, g.y)}
              />
            ))}
          </>
        );
      })()}
      {selected && (wire.bends ?? []).map((b, i) => (
        <circle
          key={`b${i}`}
          className="wire-bend-handle"
          data-wire-id={wire.id}
          data-bend-index={i}
          cx={b.x}
          cy={b.y}
          r={6}
          onMouseDown={(e) => onStartBendDrag(e, wire.id, i, b.x, b.y)}
          onDoubleClick={(e) => {
            e.stopPropagation();
            onRemoveBend(wire.id, i);
          }}
        />
      ))}
    </g>
  );
}

export const TopologyWireGroup = memo(TopologyWireGroupImpl);
