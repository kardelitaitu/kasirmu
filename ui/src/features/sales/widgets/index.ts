/**
 * Sales Widgets — register reporting dashboard widgets with the
 * WidgetRegistry so they can be rendered dynamically on the
 * reporting dashboard page.
 */
import { lazy } from 'react';
import { registerWidget } from '@/platform/ui/widget-registry';

// PERF-01: each widget is lazy-loaded so its chunk only downloads when
// the reporting dashboard renders it (chart libs stay out of the entry).
const DailyTotalWidget = lazy(() => import('./DailyTotalWidget'));
const SalesByHourWidget = lazy(() => import('./SalesByHourWidget'));
const RevenueLineChartWidget = lazy(() => import('./RevenueLineChartWidget'));
const CategoryPieChartWidget = lazy(() => import('./CategoryPieChartWidget'));
const HourlyHeatmapWidget = lazy(() => import('./HourlyHeatmapWidget'));

export {
  DailyTotalWidget,
  SalesByHourWidget,
  RevenueLineChartWidget,
  CategoryPieChartWidget,
  HourlyHeatmapWidget,
};

/**
 * Register all sales reporting widgets with the platform.
 * Called once from App.tsx during app initialisation.
 */
export function registerSalesWidgets(): void {
  registerWidget({
    id: 'daily-total',
    component: DailyTotalWidget,
    title: 'Daily Summary',
    feature: 'simple-retail',
    width: 2,
    // export_daily_summary_scoped enforces permissions::REPORTS_EXPORT
    // (tablet-client src/commands/history.rs:365). Declaring it here is what lets
    // the host filter the tile instead of the tile defending itself.
    requiredPermission: 'reports:export',
  });

  registerWidget({
    id: 'sales-by-hour',
    component: SalesByHourWidget,
    title: 'Sales by Hour',
    feature: 'simple-retail',
    width: 2,
    height: 2,
    // export_sales_by_hour_scoped enforces permissions::REPORTS_EXPORT
    // (tablet-client src/commands/history.rs:389).
    requiredPermission: 'reports:export',
  });

  // CORRECTED (48540aee0 shipped the opposite claim): these three commands ARE
  // gated. Each one calls resolve_report_scope(&state, &session_token,
  // permissions::REPORTS_VIEW) seven lines into its body —
  // get_daily_revenue_scoped reports.rs:103 → :109, get_hourly_heatmap_scoped
  // :261 → :267, get_category_breakdown_scoped :293 → :299. The old comment
  // reported "no permission" because it grepped for require_permission_for_user
  // (2 calls in this file) and never looked at resolve_report_scope (25 calls):
  // a grep for one spelling of the gate vocabulary, not a census of it.
  registerWidget({
    id: 'revenue-line-chart',
    component: RevenueLineChartWidget,
    title: 'Revenue (14d)',
    feature: 'simple-retail',
    width: 2,
    // Mirrors reports.rs:109 (permissions::REPORTS_VIEW). Arming it changes who
    // can see the tile: nobody — the backend already refused the call. It changes
    // what a refused session sees: RevenueLineChartWidget.tsx catches the
    // rejection and renders an error card (its `if (error)` branch), which reads
    // as a broken tile; the host's refusal slot renders Access Denied instead.
    requiredPermission: 'reports:view',
  });

  registerWidget({
    id: 'category-pie-chart',
    component: CategoryPieChartWidget,
    title: 'By Category',
    feature: 'simple-retail',
    width: 1,
    // Mirrors reports.rs:299 (permissions::REPORTS_VIEW); see the note above.
    requiredPermission: 'reports:view',
  });

  registerWidget({
    id: 'hourly-heatmap',
    component: HourlyHeatmapWidget,
    title: 'Busiest Hours',
    feature: 'simple-retail',
    width: 1,
    // Mirrors reports.rs:267 (permissions::REPORTS_VIEW); see the note above.
    requiredPermission: 'reports:view',
  });
}
