//! AREA 2 toolbar: workspace selector row, granularity pills + inline
//! custom-date range, and the actions row (compare / collapse-all /
//! refresh / zoom-slot). Extracted from `AnalyticsScreen.tsx`
//! (agents-4 slice 3b) as pure layout: every composed side effect —
//! the workspace switch resetting granularity, the `customTouched`
//! marker on date edits, the toasts riding compare/collapse/refresh —
//! stays composed by the screen and arrives as one callback. The zoom
//! cluster enters as a slot so `ZoomControls`' thirteen props never
//! re-thread through here.

import type { ReactNode } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { GRANULARITIES, type Granularity, type WorkspaceView } from '../utils/dateRangePresets';

export interface AnalyticsToolbarProps {
  workspaceView: WorkspaceView;
  workspaceLabel: (view: WorkspaceView) => string;
  /** The screen composes the weekly-reset + collapse-restore there. */
  onSelectWorkspace: (view: WorkspaceView) => void;
  granularity: Granularity;
  onSelectGranularity: (g: Granularity) => void;
  customFrom: string;
  customTo: string;
  /** Screens compose the customTouched marker with the setter. */
  onCustomFrom: (value: string) => void;
  onCustomTo: (value: string) => void;
  onApplyPreset: (days: number) => void;
  compare: boolean;
  onToggleCompare: () => void;
  allCollapsed: boolean;
  onToggleAllCollapsed: () => void;
  onRefresh: () => void;
  zoomSlot: ReactNode;
}

export function AnalyticsToolbar({
  workspaceView,
  workspaceLabel,
  onSelectWorkspace,
  granularity,
  onSelectGranularity,
  customFrom,
  customTo,
  onCustomFrom,
  onCustomTo,
  onApplyPreset,
  compare,
  onToggleCompare,
  allCollapsed,
  onToggleAllCollapsed,
  onRefresh,
  zoomSlot,
}: AnalyticsToolbarProps) {
  const { l10n } = useLocalization();
  return (
    <>
      {/* Row 1 — workspace selector */}
      <div className="analytics-menu-row">
        <select
          className="analytics-workspace-select-input"
          value={workspaceView}
          onChange={(e) => onSelectWorkspace(e.target.value as WorkspaceView)}
          aria-label={l10n.getString('analytics-workspace-select-aria')}
        >
          <option value="retail">{workspaceLabel('retail')}</option>
          <option value="restaurant">{workspaceLabel('restaurant')}</option>
        </select>
      </div>

      {/* Row 2 — granularity pill buttons + custom date range inline */}
      <div className="analytics-menu-row">
        <div
          className="analytics-granularity"
          role="radiogroup"
          aria-label={l10n.getString('analytics-granularity-aria')}
        >
          {GRANULARITIES.map((g) => (
            <button
              key={g}
              type="button"
              className={`analytics-granularity-btn${granularity === g ? ' analytics-granularity-btn--active' : ''}`}
              onClick={() => onSelectGranularity(g)}
              role="radio"
              aria-checked={granularity === g}
              title={`${l10n.getString(`analytics-granularity-${g}`)} (${GRANULARITIES.indexOf(g) + 1})`}
            >
              <Localized id={`analytics-granularity-${g}`}>
                <span>{g}</span>
              </Localized>
            </button>
          ))}
        </div>

        {granularity === 'custom' && (
          <>
            <div className="analytics-custom-range">
              <label className="analytics-custom-field">
                <Localized id="analytics-custom-from">
                  <span className="analytics-custom-label">From</span>
                </Localized>
                <input
                  type="date"
                  className="analytics-custom-input"
                  value={customFrom}
                  max={customTo}
                  onChange={(e) => onCustomFrom(e.target.value)}
                  aria-label={l10n.getString('analytics-custom-from')}
                />
              </label>
              <span className="analytics-custom-sep">—</span>
              <label className="analytics-custom-field">
                <Localized id="analytics-custom-to">
                  <span className="analytics-custom-label">To</span>
                </Localized>
                <input
                  type="date"
                  className="analytics-custom-input"
                  value={customTo}
                  min={customFrom}
                  onChange={(e) => onCustomTo(e.target.value)}
                  aria-label={l10n.getString('analytics-custom-to')}
                />
              </label>
            </div>
            <div className="analytics-custom-presets" role="group" aria-label={l10n.getString('analytics-range-presets-aria')}>
              {[7, 30, 90, 365].map((days) => (
                <button
                  key={days}
                  type="button"
                  className="analytics-preset-chip"
                  onClick={() => onApplyPreset(days)}
                  aria-label={l10n.getString(`analytics-range-preset-${days}d`)}
                >
                  {l10n.getString(`analytics-range-preset-${days}d`)}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Action buttons — collapse, refresh, zoom out, zoom in */}
        <div className="analytics-actions">
          <button
            type="button"
            className={`analytics-action-btn${compare ? ' analytics-action-btn--active' : ''}`}
            onClick={onToggleCompare}
            aria-pressed={compare}
            aria-label={l10n.getString(compare ? 'analytics-compare-off-aria' : 'analytics-compare-on-aria')}
            title={l10n.getString(compare ? 'analytics-compare-off-aria' : 'analytics-compare-on-aria')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
              <path d="M3 7h13" />
              <path d="M3 12h9" />
              <path d="M3 17h5" />
              <polyline points="18 4 22 8 18 12" />
              <polyline points="14 12 18 16 14 20" />
            </svg>
          </button>
          <button
            type="button"
            className={`analytics-action-btn${allCollapsed ? ' analytics-action-btn--active' : ''}`}
            onClick={onToggleAllCollapsed}
            aria-label={l10n.getString(allCollapsed ? 'analytics-action-expand-all-aria' : 'analytics-action-collapse-all-aria')}
            title={l10n.getString(allCollapsed ? 'analytics-action-expand-all-aria' : 'analytics-action-collapse-all-aria')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
              {allCollapsed ? (
                <>
                  <path d="M4 14h16" />
                  <path d="M4 18h16" />
                  <path d="M4 6l4 4 4-4" />
                </>
              ) : (
                <>
                  <path d="M4 6h16" />
                  <path d="M4 10h16" />
                  <path d="M4 14l4 4 4-4" />
                </>
              )}
            </svg>
          </button>
          <button
            type="button"
            className="analytics-action-btn"
            onClick={onRefresh}
            aria-label={l10n.getString('analytics-action-refresh-aria')}
            title={l10n.getString('analytics-action-refresh-aria')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
          {zoomSlot}
        </div>
      </div>
    </>
  );
}
