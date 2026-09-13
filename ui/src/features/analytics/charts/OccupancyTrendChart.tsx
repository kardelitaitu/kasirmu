//! Hourly occupancy curve with the dashed previous-period overlay aligned
//! BY HOUR (the backend only returns hours with orders — index alignment
//! would misplot when the hour sets differ, so `alignPrevHourly` lives with
//! the chart that consumes it). Extracted byte-for-byte from
//! `OccupancyCard`'s option builder under the agents-3 interface freeze.

import { useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import type { TableOccupancy } from '../analytics-data';
import { alignPrevHourly } from '../analytics-data';
import { CHART_PREV, CHART_TABLES, CHART_TEXT, chartHeight, echarts } from './chartTheme';

/** Stable empty number list — the original NO_NUMBERS referential default. */
const NO_NUMBERS: number[] = [];

export interface OccupancyTrendChartProps {
  hourly: TableOccupancy['hourly'];
  prevHourly: TableOccupancy['hourly'];
  compare: boolean;
  expanded?: boolean | undefined;
  /** Fluent lookup, so the series name stays translatable. */
  getString: (id: string, args?: Record<string, unknown>) => string;
}

export function OccupancyTrendChart({ hourly, prevHourly, compare, expanded, getString }: OccupancyTrendChartProps) {
  // Align the previous curve by hour — the backend only returns hours with
  // orders, so index alignment would misplot when the hour sets differ.
  const prevPct = compare ? alignPrevHourly(hourly, prevHourly) : NO_NUMBERS;
  const option = useMemo(() => ({
    grid: { left: 8, right: 8, top: 8, bottom: 0, containLabel: true },
    tooltip: { trigger: 'axis' as const, valueFormatter: (v: unknown) => `${v}%` },
    xAxis: {
      type: 'category' as const, data: hourly.map((d) => String(d.hour).padStart(2, '0')),
      axisLabel: { fontSize: 9, color: CHART_TEXT, interval: 1 }, axisLine: { show: false }, axisTick: { show: false },
    },
    yAxis: { type: 'value' as const, show: false, max: 100 },
    series: [
      {
        type: 'line' as const, data: hourly.map((d) => d.pct),
        smooth: true, symbol: 'none', lineStyle: { width: 2, color: CHART_TABLES },
        areaStyle: { opacity: 0.12 }, itemStyle: { color: CHART_TABLES },
      },
      ...(compare && prevHourly.length ? [{
        name: getString('analytics-card-prev'),
        type: 'line' as const, data: prevPct,
        smooth: true, symbol: 'none',
        itemStyle: { color: CHART_PREV }, lineStyle: { width: 1.5, color: CHART_PREV, type: 'dashed' as const },
      }] : []),
    ],
  }), [hourly, prevPct, compare, getString, prevHourly.length]);
  return <ReactEChartsCore echarts={echarts} option={option} style={{ height: chartHeight('occupancy', expanded) }} notMerge />;
}
