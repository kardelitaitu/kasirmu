import { useCallback, useMemo } from 'react';
import { useLocalization, type ReactLocalization } from '@fluent/react';
import Tooltip from '@/app/Tooltip';
import { l10nErrorMessage } from '@/utils/app-error';
import { monthCalendarGrid, DAY_LABEL_KEYS, MONTH_LABEL_KEYS, type HeatCell, type YearlyHeatmapColumn } from './analytics-data';
import type { QueryStatus } from './useAnalyticsQuery';
import type { Granularity } from './utils/dateRangePresets';

interface HeatmapQueryData {
  daily: { date: string; total_minor: number; sale_count: number }[];
  hourly: { day_of_week: number; hour: number; total_minor: number; sale_count: number }[];
  weekly: { week_start: string; total_minor: number; sale_count: number }[];
}

/**
 * Heatmap grid card for the analytics dashboard — extracted from
 * `AnalyticsScreen.tsx` (Phase 4 split). Renders the heatmap grid,
 * the peak/low insight lines, and the intensity scale legend.
 *
 * Receives pre-computed derived data from the parent (the parent owns
 * the query since the export button in the card header also needs
 * `heatmapData` / `heatmapGranularity` / `heatmapRange`).
 */
export function AnalyticsHeatmap({
  granularity,
  range,
  cells,
  peakKey,
  columns,
  multiYear,
  empty,
  status,
  error,
  data,
  fmt,
}: {
  granularity: Granularity;
  range: { from: string; to: string };
  cells: Map<string, HeatCell>;
  peakKey: string | null;
  columns: YearlyHeatmapColumn[];
  multiYear: boolean;
  empty: boolean;
  status: QueryStatus;
  error: unknown;
  data: HeatmapQueryData | null;
  fmt: (minor: number) => string;
}) {
  const { l10n } = useLocalization();

  // ── Localized label helpers ────────────────────────────────────
  const yearlyMonthLabel = useCallback(
    (ym: string): string => {
      const month = Number(ym.slice(5));
      return multiYear
        ? `${ym.slice(5)}/${ym.slice(2, 4)}`
        : l10n.getString(`analytics-month-${MONTH_LABEL_KEYS[month - 1]!}`);
    },
    [multiYear, l10n],
  );

  const heatPeakLabel = useCallback(
    (g: string, key: string): string => {
      if (g === 'weekly') {
        const [dayIdx, hour] = key.split(':');
        const dayKey = DAY_LABEL_KEYS[Number(dayIdx)];
        const day = dayKey ? l10n.getString(dayKey) : '';
        return l10n.getString('analytics-heatmap-hour-tooltip', { day, hour: String(Number(hour)).padStart(2, '0') });
      }
      if (g === 'monthly') {
        return l10n.getString('analytics-heatmap-day-tooltip', { day: key });
      }
      const [ym, week] = key.split(':');
      return l10n.getString('analytics-heatmap-week-tooltip', {
        month: yearlyMonthLabel(ym ?? ''),
        week: String(Number(week) + 1),
      });
    },
    [l10n, yearlyMonthLabel],
  );

  // ── Insight lines ──────────────────────────────────────────────
  const peakCell = useMemo(() => {
    if (!peakKey || !data) return null;
    const cell = cells.get(peakKey);
    return cell ? { key: peakKey, cell } : null;
  }, [peakKey, cells, data]);

  const peakInsight = peakCell
    ? l10n.getString('analytics-heat-busiest', {
        label: heatPeakLabel(granularity, peakCell.key),
        sales: fmt(peakCell.cell.minor),
      })
    : null;

  // Find the quietest cell (lowest revenue) that differs from the busiest.
  const lowInsight = useMemo(() => {
    if (!data) return null;
    let lowKey: string | null = null;
    let lowCell: HeatCell | null = null;
    for (const [k, c] of cells) {
      if (peakKey && k === peakKey) continue;
      if (!lowCell || c.minor < lowCell.minor) {
        lowKey = k;
        lowCell = c;
      }
    }
    if (!lowKey || !lowCell) return null;
    return l10n.getString('analytics-heat-quietest', {
      label: heatPeakLabel(granularity, lowKey),
      sales: fmt(lowCell.minor),
    });
  }, [cells, data, peakKey, l10n, heatPeakLabel, granularity, fmt]);

  // ── Cell render helpers ────────────────────────────────────────
  const heatCellTooltip = useCallback(
    (label: string, cell?: HeatCell): string => {
      if (!cell) return label;
      return l10n.getString('analytics-heat-cell-tooltip', {
        label,
        sales: fmt(cell.minor),
        orders: l10n.getString('analytics-heat-cell-orders', { count: cell.orders }),
      });
    },
    [l10n, fmt],
  );

  const heatCell = useCallback(
    (key: string, label: string, opts?: { reactKey?: string; showLabel?: string }) => {
      const cell = cells.get(key);
      const isPeak = peakKey !== null && key === peakKey;
      const tooltip = heatCellTooltip(label, cell);
      return (
        <Tooltip key={opts?.reactKey ?? key} content={tooltip} position="top" portal showDelay={0}>
          <div
            className={`analytics-heat-cell${isPeak ? ' analytics-heat-cell--peak' : ''}`}
            data-intensity={cell?.level ?? 0}
            role={cell ? 'img' : undefined}
            aria-label={cell ? tooltip : undefined}
          >
            <div className="analytics-heat-block" />
            {opts?.showLabel !== undefined && <span className="analytics-heat-label">{opts.showLabel}</span>}
          </div>
        </Tooltip>
      );
    },
    [cells, peakKey, heatCellTooltip],
  );

  // ── Grid render ────────────────────────────────────────────────
  const renderHeatmap = useCallback(() => {
    const dayLabels = DAY_LABEL_KEYS.map((k) => l10n.getString(k));
    if (granularity === 'weekly') {
      const rows: JSX.Element[] = [
        <div key="header" className="analytics-weekly-row">
          <span className="analytics-heat-label analytics-weekly-day" />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="analytics-heat-label analytics-weekly-hour">
              {String(h).padStart(2, '0')}
            </span>
          ))}
        </div>,
      ];
      dayLabels.forEach((day, di) => {
        rows.push(
          <div key={day} className="analytics-weekly-row">
            <span className="analytics-heat-label analytics-weekly-day">{day}</span>
            {Array.from({ length: 24 }, (_, h) =>
              heatCell(
                `${di}:${h}`,
                l10n.getString('analytics-heatmap-hour-tooltip', { day, hour: String(h).padStart(2, '0') }),
                { reactKey: `${day}-${h}` },
              ),
            )}
          </div>,
        );
      });
      return <div className="analytics-heatmap analytics-heatmap--weekly">{rows}</div>;
    }
    if (granularity === 'monthly') {
      const { leading, days, trailing } = monthCalendarGrid(range.from);
      const cellsList: JSX.Element[] = [];
      for (let i = 0; i < leading; i++) {
        cellsList.push(<div key={`lead-${i}`} className="analytics-heat-cell analytics-heat-cell--empty" />);
      }
      for (let d = 1; d <= days; d++) {
        cellsList.push(heatCell(String(d), l10n.getString('analytics-heatmap-day-tooltip', { day: String(d) }), { showLabel: String(d) }));
      }
      for (let i = 0; i < trailing; i++) {
        cellsList.push(<div key={`trail-${i}`} className="analytics-heat-cell analytics-heat-cell--empty" />);
      }
      return (
        <div className="analytics-heatmap analytics-heatmap--monthly">
          <div className="analytics-monthly-header">
            {dayLabels.map((d) => (
              <span key={d} className="analytics-heat-label">{d}</span>
            ))}
          </div>
          <div className="analytics-monthly-grid">{cellsList}</div>
        </div>
      );
    }
    if (granularity === 'yearly') {
      return (
        <div className="analytics-heatmap analytics-heatmap--yearly">
          {columns.map((col) => {
            const label = yearlyMonthLabel(col.key);
            return (
              <div className="analytics-heat-column" key={col.key}>
                <span className="analytics-heat-label">{label}</span>
                {Array.from({ length: col.cells }, (_, week) =>
                  heatCell(
                    `${col.key}:${week}`,
                    l10n.getString('analytics-heatmap-week-tooltip', { month: label, week: String(week + 1) }),
                  ),
                )}
              </div>
            );
          })}
        </div>
      );
    }
    // Defensive weekday strip for `daily`/`custom` buckets.
    return (
      <div className="analytics-heatmap">
        {dayLabels.map((label, i) => heatCell(String(i), label, { showLabel: label }))}
      </div>
    );
  }, [granularity, range, columns, l10n, heatCell, yearlyMonthLabel]);

  // ── Render ─────────────────────────────────────────────────────
  if (status === 'loading') {
    return (
      <div className="analytics-card-skeleton analytics-heat-skeleton">
        {Array.from({ length: 28 }, (_, i) => (
          <div key={i} className="skeleton-bar skeleton-heat-block" />
        ))}
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="analytics-card-error" role="alert">
        <span className="analytics-card-error-icon" aria-hidden="true">⚠</span>
        <span className="analytics-card-error-text">
          {l10nErrorMessage(error, l10n as ReactLocalization, 'analytics-card-error-load')}
        </span>
      </div>
    );
  }

  if (empty) {
    return (
      <div className="analytics-card-empty" role="status">
        {l10n.getString('analytics-empty-heatmap')}
      </div>
    );
  }

  return (
    <>
      {renderHeatmap()}
      {peakInsight && <p className="analytics-card-insight">{peakInsight}</p>}
      {lowInsight && <p className="analytics-card-insight">{lowInsight}</p>}
      <div className="analytics-heat-scale" role="group" aria-label={l10n.getString('analytics-heat-scale-aria')}>
        <span className="analytics-heat-scale-label">{l10n.getString('analytics-heat-scale-low')}</span>
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="analytics-heat-cell analytics-heat-scale-swatch" data-intensity={i} aria-hidden="true">
            <div className="analytics-heat-block" />
          </span>
        ))}
        <span className="analytics-heat-scale-label">{l10n.getString('analytics-heat-scale-high')}</span>
      </div>
    </>
  );
}