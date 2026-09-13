//! Low-stock alert list. Extracted verbatim from
//! `AnalyticsCardContent.tsx` (agents-2 Phase 2.2). Prop exception: takes
//! only `{ q, title, expanded }` — no compare — because the alert list is
//! a live snapshot; a period baseline would diff it against itself.

import { useLocalization } from '@fluent/react';
import { type AnalyticsQuery, type LowStockAlert } from '../analytics-data';
import { exportLowStockCsv } from '../utils/analyticsCardCsv';
import { CRITICAL_STOCK_LEVEL } from './shared/constants';
import { CardEmpty, CardError, CardLoading } from './shared/CardStates';
import { ExportCsvButton } from './shared/ExportCsvButton';
import { Kpi } from './shared/Kpi';
import { Visual } from './shared/Visual';
import { useCardData } from './shared/useCardData';
import { useMoney } from './shared/useMoney';

export function LowStockCard({ q, title, expanded }: { q: AnalyticsQuery; title: string; expanded?: boolean | undefined }) {
  const { l10n } = useLocalization();
  const { fmt } = useMoney();
  // Low-stock alerts are a live inventory snapshot with no time-bounded
  // history, so a period-over-period baseline would diff the snapshot
  // against itself (a spurious 0.0% chip). Load through the plain
  // single-window hook and never render a compare delta.
  const { data: alerts, error } = useCardData<LowStockAlert[]>('low-stock', q);
  if (error) return <CardError error={error} />;
  if (!alerts) return <CardLoading />;
  if (alerts.length === 0) return <CardEmpty message={l10n.getString('analytics-empty-low-stock')} />;
  const rows = alerts.map((a) => ({
    name: a.name,
    stock: a.current_qty,
    reorder: Math.max(0, a.threshold - a.current_qty),
    cost: a.cost_minor,
  }));
  const restockCost = rows.reduce((s, r) => s + r.reorder * r.cost, 0);
  const criticalCount = rows.filter((r) => r.stock <= CRITICAL_STOCK_LEVEL).length;
  // Collapsed cards cap the alert list; expanding reveals every alert.
  const shown = expanded ? rows : rows.slice(0, 5);
  return (
    <Visual>
      <div className="analytics-kpi-tiles">
        <Kpi value={fmt(restockCost)} label={l10n.getString('analytics-card-low-stock-restock')} tone="bad" />
        <Kpi value={String(rows.length)} label={l10n.getString('analytics-card-low-stock-items')} />
        <Kpi value={String(criticalCount)} label={l10n.getString('analytics-card-low-stock-critical')} tone="bad" />
      </div>
      <div className="analytics-kpi-actions analytics-card-insight">
        <ExportCsvButton ariaLabel={l10n.getString('analytics-export-low-stock-aria')} onClick={() => exportLowStockCsv(alerts, q.from, q.to, fmt, (id) => l10n.getString(id))} />
      </div>
      <ul className="analytics-alert-list" aria-label={title}>
        {shown.map((r, i) => {
          const critical = r.stock <= CRITICAL_STOCK_LEVEL;
          return (
            <li key={`${r.name}-${i}`} className="analytics-alert-row">
              <span className={`analytics-alert-dot${critical ? ' analytics-alert-dot--critical' : ' analytics-alert-dot--warn'}`} />
              <span className="analytics-alert-name">{r.name}</span>
              <span className="analytics-alert-count">{r.stock} {l10n.getString('analytics-card-low-stock-left')}</span>
              <span className="analytics-alert-reorder">{l10n.getString('analytics-card-low-stock-order', { n: r.reorder })}</span>
            </li>
          );
        })}
      </ul>
    </Visual>
  );
}
