import { Localized, useLocalization } from '@fluent/react';
import { MinusIcon, PlusIcon } from './NodeTopologyIcons';

/**
 * Floating canvas zoom controls — extracted from `NodeTopologyEditor.tsx`
 * (Phase 4b split). The bottom-right cluster: zoom out / level picker with
 * slider / zoom in / Fit All / Reset View / minimap toggle. Presentational:
 * every value and callback is a prop.
 */

export interface TopologyCanvasZoomControlsProps {
  l10n: ReturnType<typeof useLocalization>['l10n'];
  zoom: number;
  zoomPickerOpen: boolean;
  onToggleZoomPicker: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onSliderChange: (zoom: number) => void;
  onZoomToFit: () => void;
  onResetView: () => void;
  minimapVisible: boolean;
  onToggleMinimap: () => void;
}

export function TopologyCanvasZoomControls({
  l10n,
  zoom,
  zoomPickerOpen,
  onToggleZoomPicker,
  onZoomOut,
  onZoomIn,
  onSliderChange,
  onZoomToFit,
  onResetView,
  minimapVisible,
  onToggleMinimap,
}: TopologyCanvasZoomControlsProps) {
  return (
    <div
      className="canvas-zoom-controls"
      role="toolbar"
      aria-label={l10n.getString('topology-canvas-aria-label')}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="canvas-zoom-btn"
        aria-label={l10n.getString('topology-zoom-out')}
        onClick={onZoomOut}
      >
        <MinusIcon size={14} />
      </button>
      <div className="canvas-zoom-picker">
        <button
          type="button"
          className="canvas-zoom-level"
          aria-label={l10n.getString('topology-zoom-level-aria', { count: Math.round(zoom * 100) })}
          aria-expanded={zoomPickerOpen}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onToggleZoomPicker}
        >
          {Math.round(zoom * 100)}%
        </button>
        {zoomPickerOpen && (
          <div
            className="canvas-zoom-slider-pop"
            role="group"
            aria-label={l10n.getString('topology-zoom-slider-aria')}
          >
            <input
              type="range"
              min={40}
              max={200}
              step={5}
              value={Math.round(zoom * 100)}
              onChange={(e) => onSliderChange(Number(e.target.value) / 100)}
              onMouseDown={(e) => e.stopPropagation()}
              aria-label={l10n.getString('topology-zoom-slider-aria')}
            />
            <span className="canvas-zoom-slider-value" aria-hidden="true">{Math.round(zoom * 100)}%</span>
          </div>
        )}
      </div>
      <button
        type="button"
        className="canvas-zoom-btn"
        aria-label={l10n.getString('topology-zoom-in')}
        onClick={onZoomIn}
      >
        <PlusIcon size={14} />
      </button>
      <span className="canvas-zoom-divider" aria-hidden="true" />
      <button type="button" className="canvas-zoom-btn canvas-zoom-action" onClick={onZoomToFit}>
        <Localized id="topology-fit-all">Fit All</Localized>
      </button>
      <button type="button" className="canvas-zoom-btn canvas-zoom-action" onClick={onResetView}>
        <Localized id="topology-reset-view">Reset View</Localized>
      </button>
      <button
        type="button"
        className="canvas-zoom-btn canvas-zoom-action"
        aria-pressed={minimapVisible}
        onClick={onToggleMinimap}
      >
        <Localized id={minimapVisible ? 'topology-minimap-hide' : 'topology-minimap-show'}>
          {minimapVisible ? 'Hide Minimap' : 'Show Minimap'}
        </Localized>
      </button>
    </div>
  );
}
