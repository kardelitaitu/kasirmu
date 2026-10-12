/**
 * @vitest-environment node
 *
 * This file's import graph is free of browser globals (no render, no
 * `document`/`window`/`localStorage`), so it does not need a jsdom window. Vitest
 * spawns a fresh jsdom per test FILE, which measured ~0.4-0.9s each; under the node
 * environment the same files report `environment: 0ms`.
 *
 * Do not copy this directive onto a file that renders or touches browser state —
 * it will fail with "document is not defined" rather than silently degrade.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (command: string, args?: Record<string, unknown>) => mockInvoke(command, args),
}));

import {
  getDailyRevenue,
  getWeeklyRevenue,
  getMonthlyRevenue,
  getTopProducts,
  getHourlyHeatmap,
  getLowStockAlerts,
  getCategoryBreakdown,
  getCategoryPopularity,
  getCategoryPopularityTrend,
  getCategoryForecast,
  getMenuEngineering,
  buildCustomReport,
} from '@/api/reports';

describe('reports.ts scoped IPC contract', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue([]);
  });

  it('passes the session token to every aggregate command', async () => {
    await getDailyRevenue('2026-07-01', '2026-07-31', 'session-1');
    await getWeeklyRevenue('2026-07-01', '2026-07-31', 'session-1');
    await getMonthlyRevenue('2026-07-01', '2026-07-31', 'session-1');
    await getTopProducts('2026-07-01', '2026-07-31', 10, 'session-1');
    await getHourlyHeatmap('2026-07-01', '2026-07-31', 'session-1');
    await getLowStockAlerts(5, 'session-1');
    await getCategoryBreakdown('2026-07-01', '2026-07-31', 'session-1');
    await getCategoryPopularity('session-1', 3);
    await getCategoryPopularityTrend('session-1', '2026-07-01', '2026-07-31', 'daily', 5);
    await getCategoryForecast('session-1', '2026-07-01', '2026-07-31', 'daily', 5);

    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'get_daily_revenue_scoped', {
      sessionToken: 'session-1',
      startDate: '2026-07-01',
      endDate: '2026-07-31',
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(4, 'get_top_products_scoped', {
      sessionToken: 'session-1',
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      limit: 10,
      orderBy: 'revenue',
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(6, 'get_low_stock_alerts_scoped', {
      sessionToken: 'session-1',
      threshold: 5,
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(7, 'get_category_breakdown_scoped', {
      sessionToken: 'session-1',
      startDate: '2026-07-01',
      endDate: '2026-07-31',
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(8, 'get_category_popularity_scoped', {
      sessionToken: 'session-1',
      topPerCategory: 3,
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(9, 'get_category_popularity_trend_scoped', {
      sessionToken: 'session-1',
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      granularity: 'daily',
      topCategories: 5,
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(10, 'get_category_forecast_scoped', {
      sessionToken: 'session-1',
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      granularity: 'daily',
      topCategories: 5,
    });
  });

  it('uses scoped commands for menu engineering and custom exports', async () => {
    mockInvoke.mockResolvedValueOnce({ rows: [], median_volume: 0, median_margin: 0 });
    mockInvoke.mockResolvedValueOnce({ columns: [], rows: [] });

    await getMenuEngineering('2026-07-01', '2026-07-31', 'session-2');
    await buildCustomReport(
      { dataset: 'sales', columns: ['id'], start_date: null, end_date: null },
      'session-2',
    );

    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'get_menu_engineering_scoped', {
      sessionToken: 'session-2',
      startDate: '2026-07-01',
      endDate: '2026-07-31',
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, 'build_custom_report_scoped', {
      sessionToken: 'session-2',
      request: { dataset: 'sales', columns: ['id'], start_date: null, end_date: null },
    });
  });
});
