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
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('@/utils/logged-invoke', () => ({
  loggedInvoke: (...args: unknown[]) => mockInvoke(...args),
}));

import {
  getDailyRevenue,
  getWeeklyRevenue,
  getMonthlyRevenue,
  getTopProducts,
  getCategoryPopularity,
  getCategoryForecast,
  getCategoryPopularityTrend,
  getHourlyHeatmap,
  getLowStockAlerts,
  getCategoryBreakdown,
  getPaymentMethodBreakdown,
  getVoidedSalesSummary,
  getVoidedItems,
  getBasketSize,
  getBasketSizeTrend,
  getCustomerSplit,
  getDiscountsSummary,
  getInventoryTurnover,
  getInventoryTrend,
  getTableTurnover,
  getHourlyOccupancy,
  getMenuEngineering,
  getSaleLineMarginsScoped,
  buildCustomReport,
} from '@/api/reports';

describe('reports.ts API contract', () => {
  const TOKEN = 'tok_report';
  const START = '2026-01-01';
  const END = '2026-01-31';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Functions with signature (startDate, endDate, sessionToken)
  it('getDailyRevenue calls correct command', async () => {
    mockInvoke.mockResolvedValue([]);
    await getDailyRevenue(START, END, TOKEN);
    expect(mockInvoke).toHaveBeenCalledWith('get_daily_revenue_scoped', {
      sessionToken: TOKEN,
      startDate: START,
      endDate: END,
    });
  });

  it('getWeeklyRevenue calls correct command', async () => {
    mockInvoke.mockResolvedValue([]);
    await getWeeklyRevenue(START, END, TOKEN);
    expect(mockInvoke).toHaveBeenCalledWith('get_weekly_revenue_scoped', {
      sessionToken: TOKEN,
      startDate: START,
      endDate: END,
    });
  });

  it('getMonthlyRevenue calls correct command', async () => {
    mockInvoke.mockResolvedValue([]);
    await getMonthlyRevenue(START, END, TOKEN);
    expect(mockInvoke).toHaveBeenCalledWith('get_monthly_revenue_scoped', {
      sessionToken: TOKEN,
      startDate: START,
      endDate: END,
    });
  });

  it('getTopProducts calls correct command', async () => {
    mockInvoke.mockResolvedValue([]);
    await getTopProducts(START, END, 10, TOKEN);
    expect(mockInvoke).toHaveBeenCalledWith('get_top_products_scoped', {
      sessionToken: TOKEN,
      startDate: START,
      endDate: END,
      limit: 10,
      orderBy: 'revenue',
    });
  });

  it('getHourlyHeatmap calls correct command', async () => {
    mockInvoke.mockResolvedValue([]);
    await getHourlyHeatmap(START, END, TOKEN);
    expect(mockInvoke).toHaveBeenCalledWith('get_hourly_heatmap_scoped', {
      sessionToken: TOKEN,
      startDate: START,
      endDate: END,
    });
  });

  it('getCategoryBreakdown calls correct command', async () => {
    mockInvoke.mockResolvedValue([]);
    await getCategoryBreakdown(START, END, TOKEN);
    expect(mockInvoke).toHaveBeenCalledWith('get_category_breakdown_scoped', {
      sessionToken: TOKEN,
      startDate: START,
      endDate: END,
    });
  });

  it('getPaymentMethodBreakdown calls correct command', async () => {
    mockInvoke.mockResolvedValue([]);
    await getPaymentMethodBreakdown(START, END, TOKEN);
    expect(mockInvoke).toHaveBeenCalledWith('get_payment_method_breakdown_scoped', {
      sessionToken: TOKEN,
      startDate: START,
      endDate: END,
    });
  });

  it('getVoidedSalesSummary calls correct command', async () => {
    mockInvoke.mockResolvedValue({});
    await getVoidedSalesSummary(START, END, TOKEN);
    expect(mockInvoke).toHaveBeenCalledWith('get_voided_sales_summary_scoped', {
      sessionToken: TOKEN,
      startDate: START,
      endDate: END,
    });
  });

  it('getVoidedItems calls correct command', async () => {
    mockInvoke.mockResolvedValue([]);
    await getVoidedItems(START, END, TOKEN);
    expect(mockInvoke).toHaveBeenCalledWith('get_voided_items_scoped', {
      sessionToken: TOKEN,
      startDate: START,
      endDate: END,
      limit: 5,
    });
  });

  it('getBasketSize calls correct command', async () => {
    mockInvoke.mockResolvedValue({});
    await getBasketSize(START, END, TOKEN);
    expect(mockInvoke).toHaveBeenCalledWith('get_basket_size_scoped', {
      sessionToken: TOKEN,
      startDate: START,
      endDate: END,
    });
  });

  it('getBasketSizeTrend calls correct command', async () => {
    mockInvoke.mockResolvedValue([]);
    await getBasketSizeTrend(START, END, TOKEN);
    expect(mockInvoke).toHaveBeenCalledWith('get_basket_size_trend_scoped', {
      sessionToken: TOKEN,
      startDate: START,
      endDate: END,
    });
  });

  it('getCustomerSplit calls correct command', async () => {
    mockInvoke.mockResolvedValue({});
    await getCustomerSplit(START, END, TOKEN);
    expect(mockInvoke).toHaveBeenCalledWith('get_customer_split_scoped', {
      sessionToken: TOKEN,
      startDate: START,
      endDate: END,
    });
  });

  it('getDiscountsSummary calls correct command', async () => {
    mockInvoke.mockResolvedValue({});
    await getDiscountsSummary(START, END, TOKEN);
    expect(mockInvoke).toHaveBeenCalledWith('get_discounts_summary_scoped', {
      sessionToken: TOKEN,
      startDate: START,
      endDate: END,
    });
  });

  it('getInventoryTurnover calls correct command', async () => {
    mockInvoke.mockResolvedValue({});
    await getInventoryTurnover(START, END, TOKEN, 'loc-1');
    expect(mockInvoke).toHaveBeenCalledWith('get_inventory_turnover_scoped', {
      sessionToken: TOKEN,
      startDate: START,
      endDate: END,
      locationId: 'loc-1',
    });
  });

  it('getInventoryTrend calls correct command', async () => {
    mockInvoke.mockResolvedValue([]);
    await getInventoryTrend(START, END, TOKEN);
    expect(mockInvoke).toHaveBeenCalledWith('get_inventory_trend_scoped', {
      sessionToken: TOKEN,
      startDate: START,
      endDate: END,
    });
  });

  it('getTableTurnover calls correct command', async () => {
    mockInvoke.mockResolvedValue([]);
    await getTableTurnover(START, END, TOKEN);
    expect(mockInvoke).toHaveBeenCalledWith('get_table_turnover_scoped', {
      sessionToken: TOKEN,
      startDate: START,
      endDate: END,
    });
  });

  it('getHourlyOccupancy calls correct command', async () => {
    mockInvoke.mockResolvedValue([]);
    await getHourlyOccupancy(START, END, TOKEN);
    expect(mockInvoke).toHaveBeenCalledWith('get_hourly_occupancy_scoped', {
      sessionToken: TOKEN,
      startDate: START,
      endDate: END,
    });
  });

  it('getMenuEngineering calls correct command', async () => {
    mockInvoke.mockResolvedValue({});
    await getMenuEngineering(START, END, TOKEN);
    expect(mockInvoke).toHaveBeenCalledWith('get_menu_engineering_scoped', {
      sessionToken: TOKEN,
      startDate: START,
      endDate: END,
    });
  });

  // Functions with different signatures
  it('getCategoryPopularity calls correct command (sessionToken only)', async () => {
    mockInvoke.mockResolvedValue([]);
    await getCategoryPopularity(TOKEN);
    expect(mockInvoke).toHaveBeenCalledWith('get_category_popularity_scoped', {
      sessionToken: TOKEN,
      topPerCategory: 3,
    });
  });

  it('getCategoryForecast calls correct command with granularity', async () => {
    mockInvoke.mockResolvedValue([]);
    await getCategoryForecast(TOKEN, START, END, 'daily');
    expect(mockInvoke).toHaveBeenCalledWith('get_category_forecast_scoped', {
      sessionToken: TOKEN,
      startDate: START,
      endDate: END,
      granularity: 'daily',
      topCategories: 5,
    });
  });

  it('getCategoryPopularityTrend calls correct command with granularity', async () => {
    mockInvoke.mockResolvedValue([]);
    await getCategoryPopularityTrend(TOKEN, START, END, 'weekly');
    expect(mockInvoke).toHaveBeenCalledWith('get_category_popularity_trend_scoped', {
      sessionToken: TOKEN,
      startDate: START,
      endDate: END,
      granularity: 'weekly',
      topCategories: 5,
    });
  });

  it('getLowStockAlerts calls correct command', async () => {
    mockInvoke.mockResolvedValue([]);
    await getLowStockAlerts(10, TOKEN);
    expect(mockInvoke).toHaveBeenCalledWith('get_low_stock_alerts_scoped', {
      sessionToken: TOKEN,
      threshold: 10,
    });
  });

  it('getSaleLineMarginsScoped calls correct command', async () => {
    mockInvoke.mockResolvedValue([]);
    await getSaleLineMarginsScoped(TOKEN, 'sale-123');
    expect(mockInvoke).toHaveBeenCalledWith('get_sale_line_margins_scoped', {
      sessionToken: TOKEN,
      saleId: 'sale-123',
    });
  });

  it('buildCustomReport calls correct command', async () => {
    const request = { dataset: 'sales', columns: ['date', 'revenue'], start_date: START, end_date: END };
    mockInvoke.mockResolvedValue({ rows: [], columns: [] });
    await buildCustomReport(request, TOKEN);
    expect(mockInvoke).toHaveBeenCalledWith('build_custom_report_scoped', {
      sessionToken: TOKEN,
      request,
    });
  });

  it('propagates errors from backend', async () => {
    mockInvoke.mockRejectedValue(new Error('backend error'));
    await expect(getDailyRevenue(START, END, TOKEN)).rejects.toThrow('backend error');
  });

  it('passes return type through', async () => {
    const data = [{ date: '2026-01-01', revenue: 1000 }];
    mockInvoke.mockResolvedValue(data);
    const result = await getDailyRevenue(START, END, TOKEN);
    expect(result).toEqual(data);
  });
});
