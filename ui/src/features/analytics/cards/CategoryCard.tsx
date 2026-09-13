//! Category breakdown card with the REP-06a per-currency tab strip.
//! Extracted from `AnalyticsCardContent.tsx` (agents-2 Phase 2.3). The
//! tab strip is SHELL behaviour (pinned by four tests) — only the pie
//! moved, to `charts/CategoryDistributionChart`, which receives just the
//! selected currency's rows.

import { useMemo, useState } from 'react';
import { useLocalization } from '@fluent/react';
import { useCurrency } from '@/contexts/CurrencyContext';
import { periodDelta, type AnalyticsQuery, type CategoryBreakdownRow } from '../analytics-data';
import { exportCategoryCsv } from '../utils/analyticsCardCsv';
import { CategoryDistributionChart } from '../charts/CategoryDistributionChart';
import { PALETTE } from '../charts/chartTheme';
import { CardEmpty, CardError, CardLoading } from './shared/CardStates';
import { DeltaChip } from './shared/DeltaChip';
import { ExportCsvButton } from './shared/ExportCsvButton';
import { Kpi } from './shared/Kpi';
import { Legend } from './shared/Legend';
import { Visual } from './shared/Visual';
import { useCardDataCompare } from './shared/useCardData';
import { useMoney } from './shared/useMoney';

export function CategoryCard({ q, title, expanded, compare }: { q: AnalyticsQuery; title: string; expanded?: boolean | undefined; compare?: boolean | undefined }) {
  const { l10n } = useLocalization();
  const { fmtIn } = useMoney();
  const { currency: displayCurrency } = useCurrency();
  const { data: rows, prev: prevRows, error } = useCardDataCompare<CategoryBreakdownRow[]>('category', q, compare ?? false);
  // REP-06a: one pie PER CURRENCY. The backend normalizes percentages
  // within each currency, and minor units across currencies are not
  // area-comparable (IDR ×10⁴ dwarfs USD) — mixing them in one pie was
  // the visual lie. Tabs appear only when the range spans currencies;
  // the display currency picks the default tab.
  const currencies = useMemo(() => {
    const seen: string[] = [];
    for (const r of rows ?? []) if (!seen.includes(r.currency)) seen.push(r.currency);
    return seen;
  }, [rows]);
  const [tab, setTab] = useState<string | null>(null);
  const active =
    tab !== null && currencies.includes(tab)
      ? tab
      : currencies.includes(displayCurrency)
        ? displayCurrency
        : currencies[0] ?? null;
  const visible = useMemo(
    () => (rows ?? []).filter((r) => r.currency === active),
    [rows, active],
  );
  const { names, pcts } = useMemo(() => {
    if (!visible.length) return { names: [] as string[], pcts: [] as number[] };
    return {
      names: visible.map((r) => r.category_name).slice(0, 8),
      pcts: visible.map((r) => Math.round(r.percentage)).slice(0, 8),
    };
  }, [visible]);
  const topName = pcts.length ? names[pcts.indexOf(Math.max(...pcts))] : '';
  const total = visible.reduce((s, r) => s + r.total_minor, 0);
  const prevTotal = prevRows
    ? prevRows.filter((r) => r.currency === active).reduce((s, r) => s + r.total_minor, 0)
    : 0;
  const delta = compare ? periodDelta(total, prevTotal) : null;
  if (error) return <CardError error={error} />;
  if (!rows) return <CardLoading />;
  if (rows.length === 0) return <CardEmpty message={l10n.getString('analytics-empty-generic')} />;
  return (
    <Visual className="analytics-card-visual--split">
      {currencies.length > 1 && (
        <div className="analytics-granularity" role="group" aria-label={l10n.getString('analytics-category-currency-aria')}>
          {currencies.map((c) => (
            <button
              key={c}
              type="button"
              className={`analytics-granularity-btn${c === active ? ' analytics-granularity-btn--active' : ''}`}
              aria-pressed={c === active}
              onClick={() => setTab(c)}
            >
              {c}
            </button>
          ))}
        </div>
      )}
      <div className="analytics-kpi-row">
        {topName && <Kpi value={topName} label={l10n.getString('analytics-card-category-top')} />}
        <div className="analytics-kpi-actions">
          {delta !== null && <DeltaChip value={delta} compare={compare === true} />}
          <ExportCsvButton ariaLabel={l10n.getString('analytics-export-category-aria')} onClick={() => exportCategoryCsv(rows, q.from, q.to, fmtIn, (id) => l10n.getString(id))} />
        </div>
      </div>
      <div className="analytics-card-chart analytics-card-chart--donut" role="img" aria-label={title}>
        <CategoryDistributionChart names={names} pcts={pcts} expanded={expanded} />
      </div>
      <Legend items={names.map((n, i) => ({ name: n, value: `${pcts[i]}%`, color: PALETTE[i % PALETTE.length]! }))} />
    </Visual>
  );
}
