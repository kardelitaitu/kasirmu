//! Table turn-time bars per bucket with the dashed previous-period line
//! overlay. Extracted byte-for-byte from `TablesCard`'s option builder
//! under the agents-3 interface freeze; the tooltip is localized here
//! because the value it decorates is the chart's own.

import { useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import type { Bucket } from '../analytics-data';
import { alignPrevBuckets } from '../analytics-data';
import { CHART_PREV, CHART_TABLES, CHART_TEXT, chartHeight, echarts } from './chartTheme';

export interface TablesTrendChartProps {
  data: Bucket[];
  prev: Bucket[];
  compare: boolean;
  expanded?: boolean | undefined;
  /** Fluent lookup — minutes unit and series name both come from it. */
  getString: (id: string, args?: Record<string, string>) => string;
}

export function TablesTrendChart({ data, prev, compare, expanded, getString }: TablesTrendChartProps) {
  const option = useMemo(() => (data.length ? ({
    grid: { left: 8, right: 8, top: 12, bottom: 0, containLabel: true },
    tooltip: { trigger: 'axis' as const, valueFormatter: (v: unknown) => getString('analytics-unit-minutes', { n: String(v) }) },
    xAxis: {
      type: 'category' as const, data: data.map((d) => d.label),
      axisLabel: { fontSize: 9, color: CHART_TEXT }, axisLine: { show: false }, axisTick: { show: false },
    },
    yAxis: { type: 'value' as const, show: false },
    series: [
      {
        type: 'bar' as const, data: data.map((d) => d.value),
        itemStyle: { color: CHART_TABLES, borderRadius: [3, 3, 0, 0] }, barWidth: '55%',
      },
      ...(compare && prev.length ? [{
        name: getString('analytics-card-prev'),
        type: 'line' as const, data: alignPrevBuckets(data, prev),
        smooth: true, symbol: 'none',
        itemStyle: { color: CHART_PREV }, lineStyle: { width: 1.5, color: CHART_PREV, type: 'dashed' as const },
      }] : []),
    ],
  }) : null), [data, prev, compare, getString]);
  return <ReactEChartsCore echarts={echarts} option={option!} style={{ height: chartHeight('tables', expanded) }} notMerge />;
}
