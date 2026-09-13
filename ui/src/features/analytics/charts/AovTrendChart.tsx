//! AOV trend: per-bucket average-order-value line + area with the dashed
//! previous-period overlay. Extracted byte-for-byte from `AovCard`'s option
//! builder under the agents-3 interface freeze. Like its sibling revenue
//! chart it keeps the buckets.length guard — an empty bucket list renders
//! an empty option exactly as before (referential-stability NO_BUCKETS is
//! supplied by the shell, never by a fresh [] here).

import { useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import type { Bucket } from '../analytics-data';
import { alignPrevBuckets } from '../analytics-data';
import { CHART_ACCENT, CHART_PREV, CHART_TEXT, chartHeight, echarts } from './chartTheme';

export interface AovTrendChartProps {
  buckets: Bucket[];
  prevBuckets: Bucket[];
  compare: boolean;
  expanded?: boolean | undefined;
  /** Minor-unit formatter, from the card's useMoney(). */
  fmt: (minor: number) => string;
  /** Fluent lookup, so the series names stay translatable. */
  getString: (id: string, args?: Record<string, unknown>) => string;
}

export function AovTrendChart({ buckets, prevBuckets, compare, expanded, fmt, getString }: AovTrendChartProps) {
  const option = useMemo(() => (buckets.length ? ({
    grid: { left: 8, right: 8, top: 12, bottom: 0, containLabel: true },
    tooltip: { trigger: 'axis' as const, valueFormatter: (v: unknown) => fmt(Number(v)) },
    xAxis: {
      type: 'category' as const, data: buckets.map((d) => d.label),
      axisLabel: { fontSize: 9, color: CHART_TEXT }, axisLine: { show: false }, axisTick: { show: false },
    },
    yAxis: { type: 'value' as const, show: false },
    series: [
      {
        type: 'line' as const, data: buckets.map((d) => d.value),
        smooth: true, symbol: 'circle', symbolSize: 4,
        itemStyle: { color: CHART_ACCENT }, areaStyle: { opacity: 0.12 }, lineStyle: { width: 2 },
      },
      ...(compare && prevBuckets.length ? [{
        name: getString('analytics-card-prev'),
        type: 'line' as const, data: alignPrevBuckets(buckets, prevBuckets),
        smooth: true, symbol: 'none',
        itemStyle: { color: CHART_PREV }, lineStyle: { width: 1.5, color: CHART_PREV, type: 'dashed' as const },
      }] : []),
    ],
  }) : null), [buckets, prevBuckets, compare, fmt, getString]);
  return <ReactEChartsCore echarts={echarts} option={option!} style={{ height: chartHeight('aov', expanded) }} notMerge />;
}
