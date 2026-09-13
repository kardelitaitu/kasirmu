//! Floating wire-rename overlay for the topology editor canvas
//! (composition C3): the single input the rename hook opens at a wire's
//! midpoint, seeded with the current label.
//!
//! All behavior arrives as props - the overlay owns no state and registers
//! no hooks, so mounting it cannot move the parent's hook order. The null
//! guards (closed hook, missing geometry) are the component's own early
//! returns: they read props, so hoisting them to the call site would leak
//! geometry lookups into the parent. Class names, Fluent ids and the
//! Enter/Escape/blur commit semantics are byte-verbatim from the inline
//! original; the editor suite reaches them directly, so nothing here may
//! rename a selector.
//!
//! wireGeometries arrives by reference (the parent memo Map) - it is read
//! directly, never copied or cloned.

import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { useLocalization } from '@fluent/react';
import { cubicBezier, polylinePoint } from './topologyWireGeometry';

export interface TopologyWireRenameOverlayProps {
  /** The wire id whose rename form is open, or null when closed. */
  renamingWireId: string | null;
  /** Parent's precomputed path geometry, by reference. */
  wireGeometries: ReadonlyMap<string, {
    x1: number; y1: number; x2: number; y2: number;
    dx: number;
    polyline?: Array<[number, number]>;
  }>;
  /** The rename hook's draft state the input is bound to. */
  wireRenameDraft: string;
  setWireRenameDraft: Dispatch<SetStateAction<string>>;
  /** Focus target the rename hook positions (autofocus effect). */
  wireRenameInputRef: RefObject<HTMLInputElement>;
  /** Rename hook's commit (blur / Enter submit). */
  commitWireRename: (wireId: string, fromKeyboard?: boolean) => void;
  cancelWireRename: () => void;
  /** Only getString is needed - the input's aria label. */
  l10n: { getString: ReturnType<typeof useLocalization>['l10n']['getString'] };
}

/** The wire-rename input the editor previously rendered via an inline IIFE. */
export function TopologyWireRenameOverlay({
  renamingWireId,
  wireGeometries,
  wireRenameDraft,
  setWireRenameDraft,
  wireRenameInputRef,
  commitWireRename,
  cancelWireRename,
  l10n,
}: TopologyWireRenameOverlayProps) {
  // Inline wire relabel: a floating input at the wire's midpoint
  // (where a label pill would sit), seeded with the current label.
  if (!renamingWireId) return null;
  const geo = wireGeometries.get(renamingWireId);
  if (!geo) return null;
  const mid = geo.polyline
    ? polylinePoint(geo.polyline, 0.5)
    : {
        x: cubicBezier(0.5, geo.x1, geo.x1 + geo.dx, geo.x2 - geo.dx, geo.x2),
        y: cubicBezier(0.5, geo.y1, geo.y1, geo.y2, geo.y2),
      };
  return (
    <input
      ref={wireRenameInputRef}
      className="wire-rename-input"
      value={wireRenameDraft}
      onChange={(e) => setWireRenameDraft(e.target.value)}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commitWireRename(renamingWireId, true); }
        if (e.key === 'Escape') { e.preventDefault(); cancelWireRename(); }
      }}
      onBlur={() => void commitWireRename(renamingWireId)}
      aria-label={l10n.getString('topology-wire-rename-placeholder')}
      style={{ left: mid.x, top: mid.y }}
    />
  );
}
