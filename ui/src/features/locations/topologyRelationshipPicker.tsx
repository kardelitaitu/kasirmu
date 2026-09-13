//! Relationship picker popover for the topology editor.
//!
//! When a port drop admits MULTIPLE relationships, the editor opens this
//! dialog to let the user choose one. The picker/connection state stays
//! owned by the editor (its connection reducer + `cancelRelationshipPicker`),
//! and the commit path stays in the editor's `commitWire`; this component
//! owns the popover's DOM ref, focus management, and position clamping, plus
//! the option/cancel buttons.

import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocalization } from '@fluent/react';
import { NODE_HEIGHT } from './nodeTopologyClamp';
import type { TopologyNodeData } from './NodeTopologyEditor';
import type { TopologyPickerState } from './nodeTopologyEditorConnectionState';
import type { WireRelationshipOption } from './topologyCard';

export interface TopologyRelationshipPickerProps {
  /** The open picker's choices and endpoints (owned by the connection reducer). */
  picker: TopologyPickerState;
  /** The target node — the popover's anchor for position clamping. */
  toNode: TopologyNodeData;
  /** Live canvas element for viewport-clamp math (read at layout time). */
  getCanvas: () => HTMLElement | null;
  /** Viewport pan (canvas coords) for anchor projection. */
  pan: { x: number; y: number };
  /** Viewport zoom for anchor projection. */
  zoom: number;
  /** Commit the selected relationship (parent-owned commitWire wrapper). */
  onCommit: (option: WireRelationshipOption) => void;
  /** Cancel the picker and the in-flight connection (parent-owned). */
  onCancel: () => void;
}

/**
 * The relationship-choice dialog. Focuses its first option on open and
 * clamps its own left/top to the viewport on every pan/zoom while open.
 */
export function TopologyRelationshipPicker({
  picker,
  toNode,
  getCanvas,
  pan,
  zoom,
  onCommit,
  onCancel,
}: TopologyRelationshipPickerProps) {
  const { l10n } = useLocalization();
  const pickerRef = useRef<HTMLDivElement | null>(null);

  // Move focus into the picker (first option) when it opens, so keyboard
  // users land on the choice instead of Tab-ing blindly.
  useEffect(() => {
    pickerRef.current?.querySelector<HTMLButtonElement>('.topology-relationship-option')?.focus();
  }, [picker]);

  // Position + clamp the popover. It anchors 12px LEFT of the target node's
  // edge and translates left/up by its own size (CSS translate(-100%,-50%)),
  // so a target flush with the canvas edge would push it off-canvas. The
  // effect OWNS left/top (the JSX renders none) and re-clamps on every
  // pan/zoom while open. offsetWidth/Height are 0 in jsdom, so the fallbacks
  // keep the clamp deterministic in tests.
  useLayoutEffect(() => {
    const el = pickerRef.current;
    const canvas = getCanvas();
    if (!el || !canvas) return;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    const w = el.offsetWidth || 188;
    const h = el.offsetHeight || 160;
    const m = 8;
    const rawLeft = toNode.x * zoom + pan.x - 12;
    const rawTop = toNode.y * zoom + pan.y + NODE_HEIGHT / 2;
    el.style.left = `${Math.min(Math.max(rawLeft, m), Math.max(m, cw - w - m))}px`;
    el.style.top = `${Math.min(Math.max(rawTop, m + h / 2), Math.max(m + h / 2, ch - h / 2 - m))}px`;
  }, [toNode, pan, zoom, getCanvas]);

  return (
    // The popover sits over the canvas; its mousedown must not fall through
    // and start a canvas marquee/pan. Interaction lives in the option
    // buttons, so the dialog itself has no activation handler.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      ref={pickerRef}
      className="topology-relationship-picker"
      role="dialog"
      aria-label={l10n.getString('topology-relationship-picker-title')}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="topology-relationship-picker-title">
        {l10n.getString('topology-relationship-picker-title')}
      </div>
      {picker.options.map((option) => (
        <button
          key={`${option.fromPortId}|${option.toPortId}`}
          type="button"
          className="topology-relationship-option"
          onClick={() => onCommit(option)}
        >
          {l10n.getString(option.labelId)}
        </button>
      ))}
      <button
        type="button"
        className="topology-relationship-cancel"
        onClick={onCancel}
      >
        {l10n.getString('topology-relationship-picker-cancel')}
      </button>
    </div>
  );
}
