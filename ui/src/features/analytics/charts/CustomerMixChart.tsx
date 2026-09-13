//! New-vs-returning customer donut. Extracted byte-for-byte from
//! `CustomersCard`'s option builder under the agents-3 interface freeze;
//! the card keeps the Legend, the KPI row and the new-share insight.
//! Primitives rather than the split row: the card has already reduced it,
//! and the donut's data is exactly those two counts.

import { useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import { CHART_ACCENT, CHART_ACCENT_SOFT, DONUT_BORDER, chartHeight, echarts } from './chartTheme';

export interface CustomerMixChartProps {
  newCount: number;
  returningCount: number;
  expanded?: boolean | undefined;
  /** Fluent lookup, so the segment names stay translatable. */
  getString: (id: string, args?: Record<string, string>) => string;
}

export function CustomerMixChart({ newCount, returningCount, expanded, getString }: CustomerMixChartProps) {
  // The original guarded on `split ? ... : null`; the card returns early
  // while split is null, so the guard was dead at the render site and the
  // donut builds unconditionally here.
  const option = useMemo(() => ({
    tooltip: { trigger: 'item' as const },
    series: [{
      type: 'pie' as const, radius: ['58%', '82%'], center: ['50%', '50%'],
      itemStyle: { borderRadius: 4, borderColor: DONUT_BORDER, borderWidth: 2 },
      label: { show: false }, emphasis: { scaleSize: 4 },
      data: [
        { value: newCount, name: getString('analytics-card-customers-new'), itemStyle: { color: CHART_ACCENT } },
        { value: returningCount, name: getString('analytics-card-customers-returning'), itemStyle: { color: CHART_ACCENT_SOFT } },
      ],
    }],
  }), [newCount, returningCount, getString]);
  return <ReactEChartsCore echarts={echarts} option={option!} style={{ height: chartHeight('customers', expanded) }} notMerge />;
}
