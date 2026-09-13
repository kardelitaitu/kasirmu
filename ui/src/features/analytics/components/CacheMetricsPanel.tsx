//! Debug TTL-cache chip + per-key hit/miss/expiry/eviction table.
//! Extracted verbatim from `AnalyticsScreen.tsx` (JSX-shell split,
//! slice 1). Reads `analyticsDataCache.metrics()` at render time; the
//! screen's 1 s `metricsTick` interval lives where the popover state
//! lives, so open-state refreshes re-render this panel with it.

import type { RefObject } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { analyticsDataCache } from '../analytics-cache';
import { shortCacheLabel } from '../utils/analyticsExport';

export interface CacheMetricsPanelProps {
  open: boolean;
  onToggle: () => void;
  onClear: () => void;
  chipRef: RefObject<HTMLButtonElement>;
  popoverRef: RefObject<HTMLDivElement>;
}

export function CacheMetricsPanel({ open, onToggle, onClear, chipRef, popoverRef }: CacheMetricsPanelProps) {
  const { l10n } = useLocalization();
  return (
    <div className="analytics-cache-metrics">
      <button
        type="button"
        ref={chipRef}
        className={`analytics-cache-chip${open ? ' analytics-cache-chip--open' : ''}`}
        onClick={onToggle}
        aria-expanded={open}
        aria-label={l10n.getString('analytics-cache-metrics-aria')}
        title={l10n.getString('analytics-cache-metrics-aria')}
      >
        <span className="analytics-cache-chip-dot" aria-hidden="true" />
        <Localized id="analytics-cache-chip"><span>cache</span></Localized>
        <span className="analytics-cache-chip-rate">
          {(() => {
            const { totals } = analyticsDataCache.metrics();
            return totals.hitRate === null ? '–' : `${Math.round(totals.hitRate * 100)}%`;
          })()}
        </span>
      </button>
      {open && (
        <div ref={popoverRef} className="analytics-cache-popover" role="dialog" aria-label={l10n.getString('analytics-cache-metrics-aria')}>
          <div className="analytics-cache-popover-head">
            <div className="analytics-cache-popover-meta">
              <h3 className="analytics-cache-popover-title">
                <Localized id="analytics-cache-popover-title"><span>Cache metrics</span></Localized>
              </h3>
              {(() => {
                const { totals } = analyticsDataCache.metrics();
                const rate = totals.hitRate === null ? '–' : `${Math.round(totals.hitRate * 100)}%`;
                return (
                  <span className="analytics-cache-popover-summary">
                    <Localized
                      id="analytics-cache-summary"
                      vars={{
                        rate,
                        hits: String(totals.hits),
                        misses: String(totals.misses),
                        expiries: String(totals.expiries),
                      }}
                    >
                      <span>{rate} · {totals.hits} hits · {totals.misses} misses · {totals.expiries} expired</span>
                    </Localized>
                  </span>
                );
              })()}
            </div>
            <button
              type="button"
              className="analytics-cache-clear-btn"
              onClick={onClear}
              aria-label={l10n.getString('analytics-cache-clear-aria')}
              title={l10n.getString('analytics-cache-clear-aria')}
            >
              <Localized id="analytics-cache-clear"><span>Clear cache</span></Localized>
            </button>
          </div>
          <table className="analytics-cache-table">
            <thead>
              <tr>
                <th><Localized id="analytics-cache-col-key"><span>key</span></Localized></th>
                <th><Localized id="analytics-cache-col-hits"><span>hits</span></Localized></th>
                <th><Localized id="analytics-cache-col-misses"><span>misses</span></Localized></th>
                <th><Localized id="analytics-cache-col-expiries"><span>expired</span></Localized></th>
                <th><Localized id="analytics-cache-col-evictions"><span>evicted</span></Localized></th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const { perKey } = analyticsDataCache.metrics();
                const rows = [...perKey.entries()].sort((a, b) => {
                  const readsB = b[1].hits + b[1].misses + b[1].expiries;
                  const readsA = a[1].hits + a[1].misses + a[1].expiries;
                  return readsB - readsA;
                });
                if (rows.length === 0) {
                  return (
                    <tr>
                      <td colSpan={5} className="analytics-cache-empty">
                        <Localized id="analytics-cache-empty"><span>No queries yet</span></Localized>
                      </td>
                    </tr>
                  );
                }
                return rows.map(([key, m]) => (
                  <tr key={key} title={key}>
                    <td className="analytics-cache-key">{shortCacheLabel(key)}</td>
                    <td>{m.hits}</td>
                    <td>{m.misses}</td>
                    <td>{m.expiries}</td>
                    <td>{m.evictions}</td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
