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
  /** Non-null while loading gates the card; kept in deps like the original. */
  splitLoaded: boolean;
  expanded?: boolean | undefined;
  /** Fluent lookup, so the segment names stay translatable. */
  getString: (id: string, args?: Record<string, unknown>) => string;
}

export function CustomerMixChart({ newCount, returningCount, splitLoaded, expanded, getString }: CustomerMixChartProps) {
  const option = useMemo(() => (splitLoaded ? ({
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
  }) : null), [newCount, returningCount, getString, splitLoaded]);
  return <ReactEChartsCore echarts={echarts} option={option!} style={{ height: chartHeight('customers', expanded) }} notMerge />;
}
