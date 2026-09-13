//! Category distribution donut for ONE currency — the per-currency tab
//! strip is shell behaviour pinned by REP-06a tests and stays in
//! `cards/CategoryCard.tsx`; this module only ever sees the selected tab's
//! names/percentages. Extracted byte-for-byte from `CategoryCard`'s option
//! builder under the agents-3 interface freeze.

import { useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import { DONUT_BORDER, PALETTE, chartHeight, echarts } from './chartTheme';

export interface CategoryDistributionChartProps {
  names: string[];
  pcts: number[];
  expanded?: boolean | undefined;
}

export function CategoryDistributionChart({ names, pcts, expanded }: CategoryDistributionChartProps) {
  const option = useMemo(() => (names.length ? ({
    tooltip: { trigger: 'item' as const },
    series: [{
      type: 'pie' as const, radius: ['58%', '82%'], center: ['50%', '50%'],
      itemStyle: { borderRadius: 4, borderColor: DONUT_BORDER, borderWidth: 2 },
      label: { show: false }, emphasis: { scaleSize: 4 },
      data: names.map((n, i) => ({ value: pcts[i], name: n, itemStyle: { color: PALETTE[i % PALETTE.length] } })),
    }],
  }) : null), [names, pcts]);
  return <ReactEChartsCore echarts={echarts} option={option!} style={{ height: chartHeight('category', expanded) }} notMerge />;
}
