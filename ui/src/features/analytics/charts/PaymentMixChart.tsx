//! Payment-mix stacked bar (single row, one segment per method, percentages
//! largest-remainder-rounded to 100 by the card). Extracted byte-for-byte
//! from `PaymentsCard`'s option builder under the agents-3 interface freeze;
//! the shell keeps `largestRemainderPcts`, the segs derivation and the
//! Legend — the chart receives the finished segments.

import { useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import { PALETTE, chartHeight, echarts } from './chartTheme';

export interface PaymentSeg {
  key: string;
  name: string;
  pct: number;
}

export interface PaymentMixChartProps {
  segs: PaymentSeg[];
  pcts: number[];
  expanded?: boolean | undefined;
  /** Fluent lookup, so the category axis label stays translatable. */
  getString: (id: string, args?: Record<string, unknown>) => string;
}

export function PaymentMixChart({ segs, pcts, expanded, getString }: PaymentMixChartProps) {
  const option = useMemo(() => (segs.length ? ({
    grid: { left: 8, right: 8, top: 8, bottom: 0, containLabel: true },
    tooltip: { trigger: 'axis' as const, axisPointer: { type: 'shadow' as const }, valueFormatter: (v: unknown) => `${v}%` },
    xAxis: { type: 'value' as const, show: false },
    yAxis: { type: 'category' as const, data: [getString('analytics-card-payments')], show: false },
    series: segs.map((s, i) => ({
      name: s.name, type: 'bar' as const, stack: 'total', barWidth: 16,
      itemStyle: {
        color: PALETTE[i % PALETTE.length],
        borderRadius: i === segs.length - 1 ? [0, 4, 4, 0] : 0,
      },
      data: [pcts[i]],
    })),
  }) : null), [segs, pcts, getString]);
  return <ReactEChartsCore echarts={echarts} option={option!} style={{ height: chartHeight('payments', expanded) }} notMerge />;
}
