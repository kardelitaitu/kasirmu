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

  // The three tiles below deliberately carry no `requiredPermission`: their
  // commands resolve a session but check no permission at all
  // (get_daily_revenue_scoped, get_hourly_heatmap_scoped and
  // get_category_breakdown_scoped — tablet-client src/commands/reports.rs:103,
  // :261, :293; zero require_permission_for_user between them), so there is
  // nothing for the host to mirror. If one of those ever gains a check, this
  // field is already the way to say so.
  registerWidget({
    id: 'revenue-line-chart',
    component: RevenueLineChartWidget,
    title: 'Revenue (14d)',
    feature: 'simple-retail',
    width: 2,
  });

  registerWidget({
    id: 'category-pie-chart',
    component: CategoryPieChartWidget,
    title: 'By Category',
    feature: 'simple-retail',
    width: 1,
  });

  registerWidget({
    id: 'hourly-heatmap',
    component: HourlyHeatmapWidget,
    title: 'Busiest Hours',
    feature: 'simple-retail',
    width: 1,
  });
}
