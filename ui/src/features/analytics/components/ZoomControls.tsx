//! Toolbar zoom cluster: out / badge+slider popover / in, plus the
//! keyboard-shortcuts button and its popover. Extracted verbatim from
//! `AnalyticsScreen.tsx` (JSX-shell split, slice 1). The two open/close
//! booleans and the four refs stay with the screen because the outside-
//! click and Escape handlers there own them; this component renders and
//! reports intent only. The SHORTCUTS list moved with its sole consumer.

import type { RefObject } from 'react';
import { useLocalization } from '@fluent/react';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from '../utils/dateRangePresets';
/** Keyboard shortcut metadata — drives the help popover (moved with it;
 *  the measured single consumer was the popover, while the screen's
 *  keydown handler mirrors these keys in its own branches). */
const SHORTCUTS: { keys: string; labelKey: string }[] = [
  { keys: '1–4',    labelKey: 'analytics-shortcuts-granularity' },
  { keys: 'R',      labelKey: 'analytics-shortcuts-refresh' },
  { keys: '+ / −',  labelKey: 'analytics-shortcuts-zoom' },
  { keys: '0',      labelKey: 'analytics-shortcuts-zoom-reset' },
  { keys: 'C',      labelKey: 'analytics-shortcuts-collapse' },
  { keys: 'Esc',    labelKey: 'analytics-shortcuts-close' },
];

export interface ZoomControlsProps {
  zoomLevel: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onZoomReset: () => void;
  onZoomLevelChange: (level: number) => void;
  zoomPopoverOpen: boolean;
  onToggleZoomPopover: () => void;
  shortcutsOpen: boolean;
  onToggleShortcuts: () => void;
  /** Anchor for the open-state close-on-outside-click logic (screen-owned). */
  zoomBadgeRef: RefObject<HTMLButtonElement>;
  zoomPopoverRef: RefObject<HTMLDivElement>;
  shortcutsButtonRef: RefObject<HTMLButtonElement>;
  shortcutsPopoverRef: RefObject<HTMLDivElement>;
}

export function ZoomControls({
  zoomLevel,
  onZoomOut,
  onZoomIn,
  onZoomReset,
  onZoomLevelChange,
  zoomPopoverOpen,
  onToggleZoomPopover,
  shortcutsOpen,
  onToggleShortcuts,
  zoomBadgeRef,
  zoomPopoverRef,
  shortcutsButtonRef,
  shortcutsPopoverRef,
}: ZoomControlsProps) {
  const { l10n } = useLocalization();
  return (
    <>
      <button
        type="button"
        className="analytics-action-btn"
        onClick={onZoomOut}
        disabled={zoomLevel <= ZOOM_MIN}
        aria-label={l10n.getString('analytics-action-zoom-out-aria')}
        title={l10n.getString('analytics-action-zoom-out-aria')}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
          <line x1="8" y1="11" x2="14" y2="11" />
        </svg>
      </button>
      <button
        type="button"
        ref={zoomBadgeRef}
        className="analytics-zoom-badge"
        onClick={onToggleZoomPopover}
        aria-label={l10n.getString('analytics-zoom-slider-aria')}
        title={l10n.getString('analytics-zoom-slider-aria')}
      >
        {Math.round(zoomLevel * 100)}%
      </button>
      {zoomPopoverOpen && (
        <div ref={zoomPopoverRef} className="analytics-zoom-popover" role="dialog" aria-label={l10n.getString('analytics-zoom-slider-aria')}>
          <input
            type="range"
            className="analytics-zoom-slider"
            min={ZOOM_MIN * 100}
            max={ZOOM_MAX * 100}
            step={ZOOM_STEP * 100}
            value={Math.round(zoomLevel * 100)}
            onChange={(e) => onZoomLevelChange(Number(e.target.value) / 100)}
            aria-label={l10n.getString('analytics-zoom-slider-aria')}
          />
          <span className="analytics-zoom-popover-value">{Math.round(zoomLevel * 100)}%</span>
          <button
            type="button"
            className="analytics-zoom-reset-btn"
            onClick={onZoomReset}
          >
            {l10n.getString('analytics-action-zoom-reset-aria')}
          </button>
        </div>
      )}
      <button
        type="button"
        className="analytics-action-btn"
        onClick={onZoomIn}
        disabled={zoomLevel >= ZOOM_MAX}
        aria-label={l10n.getString('analytics-action-zoom-in-aria')}
        title={l10n.getString('analytics-action-zoom-in-aria')}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
          <line x1="11" y1="8" x2="11" y2="14" />
          <line x1="8" y1="11" x2="14" y2="11" />
        </svg>
      </button>
      <button
        type="button"
        ref={shortcutsButtonRef}
        className="analytics-action-btn"
        onClick={onToggleShortcuts}
        aria-label={l10n.getString('analytics-shortcuts-aria')}
        title={l10n.getString('analytics-shortcuts-aria')}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </button>

      {shortcutsOpen && (
        <div ref={shortcutsPopoverRef} className="analytics-shortcuts-popover" role="dialog" aria-label={l10n.getString('analytics-shortcuts-title')}>
          <h3 className="analytics-shortcuts-title">{l10n.getString('analytics-shortcuts-title')}</h3>
          <ul className="analytics-shortcuts-list">
            {SHORTCUTS.map((s) => (
              <li key={s.labelKey} className="analytics-shortcuts-item">
                <kbd className="analytics-shortcuts-keys">{s.keys}</kbd>
                <span>{l10n.getString(s.labelKey)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
