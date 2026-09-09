//! Alignment toolbar for the topology editor (composition C5): the floating
//! action bar shown when 2+ nodes are selected, positioned over the
//! selection bounds. The actions and glyphs come from the shared
//! topologyAlignGlyph module - reused via import, never duplicated.
//!
//! All behavior arrives as props - the bar owns no state and registers no
//! hooks, so mounting it cannot move the parent's hook order. Class names,
//! roles and Fluent ids are byte-verbatim from the inline original; the
//! editor suite reaches them directly, so nothing here may rename a
//! selector.

import type { useLocalization } from '@fluent/react';
import { AlignGlyph, ALIGN_ACTIONS, type AlignMode } from './topologyAlignGlyph';

/** The selection bounds memo's shape (2+ nodes); null below the threshold. */
export interface TopologySelectionBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface TopologyAlignBarProps {
  /** The selection-bounds memo; the bar renders only when non-null. */
  selectionBounds: TopologySelectionBounds;
  /** The parent's align executor, keyed by glyph action. */
  applyAlign: (mode: AlignMode) => void;
  /** Viewport transform - the bar floats over the canvas at canvas scale. */
  pan: { x: number; y: number };
  zoom: number;
  /** Only getString is needed - toolbar aria label and per-action labels. */
  l10n: { getString: ReturnType<typeof useLocalization>['l10n']['getString'] };
}

/** The align bar the editor previously rendered inline. */
export function TopologyAlignBar({
  selectionBounds,
  applyAlign,
  pan,
  zoom,
  l10n,
}: TopologyAlignBarProps) {
  return (
    <div
      className="topology-align-toolbar"
      role="toolbar"
      aria-label={l10n.getString('topology-align-aria')}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        left: ((selectionBounds.minX + selectionBounds.maxX) / 2) * zoom + pan.x,
        top: selectionBounds.minY * zoom + pan.y,
      }}
    >
      {ALIGN_ACTIONS.map((a, i) => (
        <span key={a.mode} className="topology-align-slot">
          {i === 6 && <span className="topology-align-divider" aria-hidden="true" />}
          <button
            type="button"
            className="topology-align-btn"
            aria-label={l10n.getString(a.ariaId)}
            title={l10n.getString(a.ariaId)}
            onClick={() => applyAlign(a.mode)}
          >
            <AlignGlyph mode={a.mode} />
          </button>
        </span>
      ))}
    </div>
  );
}
