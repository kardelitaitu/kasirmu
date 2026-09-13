//! Inventory units-sold line with the dashed previous-period overlay.
//! Extracted byte-for-byte from `InventoryCard`'s option builder under the
//! agents-3 interface freeze; the shell keeps the turnover/days/SKU tiles —
//! the trend rows are already mapped to buckets by the card.

import { useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import type { Bucket } from '../analytics-data';
import { alignPrevBuckets } from '../analytics-data';
import { CHART_INVENTORY, CHART_PREV, CHART_TEXT, chartHeight, echarts } from './chartTheme';

export interface InventoryTrendChartProps {
  data: Bucket[];
  prev: Bucket[];
  compare: boolean;
  expanded?: boolean | undefined;
  /** Fluent lookup, so the series name stays translatable. */
  getString: (id: string, args?: Record<string, string>) => string;
}

export function InventoryTrendChart({ data, prev, compare, expanded, getString }: InventoryTrendChartProps) {
  const option = useMemo(() => (data.length ? ({
    grid: { left: 8, right: 8, top: 10, bottom: 0, containLabel: true },
    tooltip: { trigger: 'axis' as const },
    xAxis: {
      type: 'category' as const, data: data.map((d) => d.label),
      axisLabel: { fontSize: 9, color: CHART_TEXT }, axisLine: { show: false }, axisTick: { show: false },
    },
    yAxis: { type: 'value' as const, show: false },
    series: [
      {
        type: 'line' as const, data: data.map((d) => d.value),
        smooth: true, symbol: 'none', lineStyle: { width: 2, color: CHART_INVENTORY },
        areaStyle: { opacity: 0.12 }, itemStyle: { color: CHART_INVENTORY },
      },
      ...(compare && prev.length ? [{
        name: getString('analytics-card-prev'),
        type: 'line' as const, data: alignPrevBuckets(data, prev),
        smooth: true, symbol: 'none',
        itemStyle: { color: CHART_PREV }, lineStyle: { width: 1.5, color: CHART_PREV, type: 'dashed' as const },
      }] : []),
    ],
  }) : null), [data, prev, compare, getString]);
  return <ReactEChartsCore echarts={echarts} option={option!} style={{ height: chartHeight('inventory', expanded) }} notMerge />;
}
