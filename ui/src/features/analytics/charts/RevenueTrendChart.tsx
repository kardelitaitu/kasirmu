//! Revenue trend: current-period line + area, with the optional dashed
//! previous-period overlay (compare mode). Extracted byte-for-byte from
//! `RevenueCard`'s option builder under the agents-3 interface freeze;
//! the card keeps loading/error states, KPI row and the chart wrapper.

import { useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import type { Bucket } from '../analytics-data';
import { alignPrevBuckets } from '../analytics-data';
import { CHART_ACCENT, CHART_PREV, CHART_TEXT, chartHeight, echarts } from './chartTheme';

export interface RevenueTrendChartProps {
  data: Bucket[];
  prev: Bucket[];
  compare: boolean;
  expanded?: boolean | undefined;
  /** Minor-unit formatter, from the card's useMoney(). */
  fmt: (minor: number) => string;
  /** Fluent lookup, so the series names stay translatable. */
  getString: (id: string, args?: Record<string, unknown>) => string;
}

export function RevenueTrendChart({ data, prev, compare, expanded, fmt, getString }: RevenueTrendChartProps) {
  const option = useMemo(() => (data ? ({
    grid: { left: 8, right: 8, top: 12, bottom: 0, containLabel: true },
    tooltip: { trigger: 'axis' as const, valueFormatter: (v: unknown) => fmt(Number(v)) },
    xAxis: {
      type: 'category' as const, data: data.map((d) => d.label),
      axisLabel: { fontSize: 9, color: CHART_TEXT }, axisLine: { show: false }, axisTick: { show: false },
    },
    yAxis: { type: 'value' as const, show: false },
    series: [
      {
        name: getString('analytics-card-revenue'),
        type: 'line' as const, data: data.map((d) => d.value),
        smooth: true, symbol: 'circle', symbolSize: 4,
        itemStyle: { color: CHART_ACCENT }, areaStyle: { opacity: 0.12 }, lineStyle: { width: 2 },
      },
      ...(compare && prev.length ? [{
        name: getString('analytics-card-prev'),
        type: 'line' as const, data: alignPrevBuckets(data, prev),
        smooth: true, symbol: 'none',
        itemStyle: { color: CHART_PREV }, lineStyle: { width: 1.5, color: CHART_PREV, type: 'dashed' as const },
      }] : []),
    ],
  }) : null), [data, prev, compare, fmt, getString]);
  return <ReactEChartsCore echarts={echarts} option={option!} style={{ height: chartHeight('revenue', expanded) }} notMerge />;
}
