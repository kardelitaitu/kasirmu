//! Basket-size bars per bucket with the dashed previous-period line
//! overlay. Extracted byte-for-byte from `BasketCard`'s option builder
//! under the agents-3 interface freeze; the shell keeps the KPI tiles and
//! peak/low insights.

import { useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import type { Bucket } from '../analytics-data';
import { alignPrevBuckets } from '../analytics-data';
import { CHART_BASKET, CHART_PREV, CHART_TEXT, chartHeight, echarts } from './chartTheme';

export interface BasketTrendChartProps {
  data: Bucket[];
  prev: Bucket[];
  compare: boolean;
  expanded?: boolean | undefined;
  /** Fluent lookup, so the series name stays translatable. */
  getString: (id: string, args?: Record<string, string>) => string;
}

export function BasketTrendChart({ data, prev, compare, expanded, getString }: BasketTrendChartProps) {
  const option = useMemo(() => (data.length ? ({
    grid: { left: 8, right: 8, top: 12, bottom: 0, containLabel: true },
    tooltip: { trigger: 'axis' as const },
    xAxis: {
      type: 'category' as const, data: data.map((d) => d.label),
      axisLabel: { fontSize: 9, color: CHART_TEXT }, axisLine: { show: false }, axisTick: { show: false },
    },
    yAxis: { type: 'value' as const, show: false },
    series: [
      {
        type: 'bar' as const, data: data.map((d) => d.value),
        itemStyle: { color: CHART_BASKET, borderRadius: [3, 3, 0, 0] }, barWidth: '55%',
      },
      ...(compare && prev.length ? [{
        name: getString('analytics-card-prev'),
        type: 'line' as const, data: alignPrevBuckets(data, prev),
        smooth: true, symbol: 'none',
        itemStyle: { color: CHART_PREV }, lineStyle: { width: 1.5, color: CHART_PREV, type: 'dashed' as const },
      }] : []),
    ],
  }) : null), [data, prev, compare, getString]);
  return <ReactEChartsCore echarts={echarts} option={option!} style={{ height: chartHeight('basket', expanded) }} notMerge />;
}
