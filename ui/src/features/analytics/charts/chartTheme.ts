//! Chart theme for the analytics cards.
//!
//! Extracted from `AnalyticsCardContent.tsx` (R37 analytics-charts split).
//! Holds the echarts registration, the theme-token palette, and the per-card
//! chart heights, so a chart module can import one thing instead of reaching
//! into the card file for colours.
//!
//! The `echarts.use([...])` call below is a side effect and must run exactly
//! once per bundle — it lives here, not in each chart module.

import * as echarts from 'echarts/core';
import { BarChart as EBar, LineChart as ELine, PieChart as EPie } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { readCSSVar } from '@/utils/color';

echarts.use([EBar, ELine, EPie, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

/** The echarts core namespace, pre-registered. Pass to `<ReactEChartsCore echarts={...}>`. */
export { echarts };

/**
 * Resolve one chart colour from its theme token with a hex fallback.
 *
 * echarts paints to canvas, where CSS var() strings never resolve — the
 * value must be concrete by the time it reaches an option. readCSSVar
 * returns the computed token on :root (empty under jsdom/tests), and the
 * fallback keeps the chart's look stable in every environment where the
 * stylesheet is absent. Each fallback is the value this chart shipped
 * before the token pass, so a bare test DOM renders byte-identical output.
 */
export function chartColor(varName: string, fallback: string): string {
  return readCSSVar(varName) ?? fallback;
}

/**
 * Per-card accent colours, read from the theme's semantic tokens (same
 * source every themed surface uses) with the pre-token hexes as fallbacks:
 * indigo→--color-accent, blue→--color-accent-secondary, cyan→--color-info,
 * green→--color-success, amber→--color-warning, red→--color-danger,
 * violet→--color-purple, grey→--color-fg-muted.
 */
export const PALETTE_TOKENS = [
  ['--color-accent', '#4f46e5'],
  ['--color-accent-secondary', '#3b82f6'],
  ['--color-info', '#06b6d4'],
  ['--color-success', '#22c55e'],
  ['--color-warning', '#f59e0b'],
  ['--color-warning-pos', '#f97316'],
  ['--color-danger', '#ef4444'],
  ['--color-purple', '#8b5cf6'],
] as const;

/** The palette as echarts needs it: concrete colour strings. */
export const PALETTE: string[] = PALETTE_TOKENS.map(([varName, fallback]) => chartColor(varName, fallback));

/** Chart line/bar colours that carry one semantic meaning across cards. */
export const CHART_ACCENT = chartColor('--color-accent', '#4f46e5');
export const CHART_PREV = chartColor('--color-fg-muted', '#94a3b8');
export const CHART_BASKET = chartColor('--color-info', '#06b6d4');
export const CHART_INVENTORY = chartColor('--color-success', '#22c55e');
export const CHART_TABLES = chartColor('--color-warning', '#f59e0b');
/** Legend/donut tint for the customers card's returning segment (accent-subtle). */
export const CHART_ACCENT_SOFT = chartColor('--color-accent-subtle', '#c7d2fe');
/** Donut segment separators. The analytics surface is a fixed light card
 *  (AUT-1 scoped tokens in AnalyticsScreen.css), so the border stays the
 *  card's white surface rather than a theme-dependent token. */
export const DONUT_BORDER = '#fff';
/** Axis text — theme-neutral grey, matching the pre-token value. */
export const CHART_TEXT = chartColor('--color-fg-muted', '#94a3b8');

/**
 * Chart height per card, collapsed vs expanded (px). Kept in one place so
 * the layout proportions are tunable without hunting literals across every
 * card component.
 */
export const CHART_HEIGHT: Record<string, { base: number; expanded: number }> = {
  revenue: { base: 104, expanded: 240 },
  aov: { base: 104, expanded: 240 },
  customers: { base: 118, expanded: 210 },
  payments: { base: 84, expanded: 180 },
  category: { base: 118, expanded: 210 },
  inventory: { base: 80, expanded: 170 },
  tables: { base: 104, expanded: 240 },
  basket: { base: 104, expanded: 240 },
  occupancy: { base: 64, expanded: 150 },
};

/** Resolve a card's chart height for its current expanded state. */
export function chartHeight(cardKey: string, expanded?: boolean | undefined): number {
  const h = CHART_HEIGHT[cardKey] ?? CHART_HEIGHT['revenue']!;
  return expanded ? h.expanded : h.base;
}
