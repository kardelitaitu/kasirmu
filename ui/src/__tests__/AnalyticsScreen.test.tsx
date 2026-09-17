import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import {
  assertCaseDiscriminates,
  discriminatingStoreZone,
  expectedStoreDay,
} from '@/__tests__/test-utils/storeZoneCase';
import { withFluent, withFluentLocale } from '@/locales/test-utils';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import analyticsFtl from '@/locales/analytics.ftl?raw';
import subscriptionFtl from '@/locales/subscription.ftl?raw';
import analyticsIdFtl from '@/locales/analytics.id.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import reportsFtl from '@/locales/reports.ftl?raw';
import reportsIdFtl from '@/locales/reports.id.ftl?raw';
import { downloadCsv } from '@/utils/export-csv';

// --- mocks ---

vi.mock('echarts-for-react/lib/core', () => ({
  default: (props: Record<string, unknown>) => {
    // Drop the chart-only props so React doesn't warn about unknown DOM
    // attributes (notMerge, option, …) on the placeholder div.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { option, notMerge, lazyUpdate, onEvents, onChartReady, theme, ...rest } = props;
    return React.createElement('div', { ...rest, 'data-testid': 'echarts-mock' });
  },
}));

vi.mock('echarts/core', () => ({
  use: vi.fn(),
  init: vi.fn(() => ({ setOption: vi.fn(), dispose: vi.fn(), resize: vi.fn(), getOption: vi.fn(() => ({})), on: vi.fn(), off: vi.fn(), clear: vi.fn(), isDisposed: vi.fn(() => false), getWidth: vi.fn(() => 0), getHeight: vi.fn(() => 0), getDom: vi.fn(() => document.createElement('div')), showLoading: vi.fn(), hideLoading: vi.fn(), getDataURL: vi.fn(() => '') })),
  getInstanceByDom: vi.fn(() => null),
  dispose: vi.fn(),
  graphic: { LinearGradient: vi.fn() },
}));

vi.mock('echarts/charts', () => ({ BarChart: {}, LineChart: {}, PieChart: {}, HeatmapChart: {} }));
vi.mock('echarts/components', () => ({ GridComponent: {}, TooltipComponent: {}, LegendComponent: {}, VisualMapComponent: {} }));
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }));
vi.mock('@/utils/export-csv', () => ({ downloadCsv: vi.fn() }));

// The analytics screen renders one Tooltip per heat cell (168 in the weekly
// grid). Mock it to a passthrough that stamps the resolved content onto the
// trigger cell, so tests assert the wiring without paying for 168 portals or
// re-testing the shared Tooltip's hover timing (covered by Tooltip.test.tsx).
vi.mock('@/app/Tooltip', () => ({
  default: ({ content, children }: { content: React.ReactNode; children: React.ReactElement }) =>
    React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
      'data-tooltip-content': typeof content === 'string' ? content : undefined,
    }),
}));

const mockGoToPicker = vi.fn();
vi.mock('@/hooks/useWorkspaceNav', () => ({
  useWorkspaceNav: () => ({ goToWorkspacePicker: mockGoToPicker }),
}));

// R36-05 (parity with DashboardScreen): AnalyticsScreen fetches the primary store
// to anchor its derived ranges to the store's zone (REP-03). Before this mock the
// call hit real invoke, rejected, and the component silently fell back to UTC -- so
// the store-zone path looked green while never being exercised. The session token
// from the global WorkspaceContext stub is truthy ('mock-session-token'), so the
// fetch really does fire in every test here; only its result was being dropped.
const mockGetPrimaryLocationScoped = vi.fn();
vi.mock('@/api/locations', () => ({
  getPrimaryLocationScoped: (...args: unknown[]) => mockGetPrimaryLocationScoped(...args),
}));

// AnalyticsCardContent (rendered inside each card) formats money via
// useCurrency — provide the same stub the other screen tests use.
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ currency: 'USD', setCurrency: vi.fn(), loading: false }),
}));

// The global WorkspaceContext stub (test-setup.ts) returns a safe no-instance
// default. Tests that need instances override it with
// vi.mocked(useWorkspace).mockReturnValue(...); restore the default after
// every test so the override never leaks into later tests.
afterEach(() => {
  vi.mocked(useWorkspace).mockImplementation(() => ({
    activeWorkspace: null,
    setActiveWorkspace: vi.fn(),
    activeInstance: null,
    setActiveInstance: vi.fn(),
    availableWorkspaces: [],
    workspaceScreens: [],
    loading: false,
    error: null,
    retry: vi.fn(),
    lastWorkspace: null,
    switchStore: vi.fn(),
    resolvedStoreId: 'default',
    sessionToken: 'mock-session-token',
    terminalId: 'mock-terminal',
    swapSessionToken: vi.fn(() => Promise.resolve()),
  }));
});

// ── Real-data IPC mocks ─────────────────────────────────────────────
// The cards now load through the scoped reporting commands. jsdom has no
// Tauri backend, so mock the API modules with deterministic rows that
// produce the asserted labels (KPIs, ranked lists, alert rows, charts).
// Revenue mocks anchor rows to the queried range — the loaders zero-fill
// the range's buckets, so an off-range fixed date would render a $0 card.
const dailyRevenueRow = (date: string) => ({
  date, total_minor: 1250000, currency: 'USD', sale_count: 12, cogs_minor: 500000, gross_profit_minor: 750000, gross_margin_percent: 60,
});
const mockGetDailyRevenue = vi.fn((startDate?: string, _endDate?: string, _token?: string) => Promise.resolve([dailyRevenueRow(startDate ?? '2026-07-27')]));
const mockGetWeeklyRevenue = vi.fn((startDate?: string, _endDate?: string, _token?: string) => Promise.resolve([
  { week_start: startDate ?? '2026-07-21', total_minor: 8500000, currency: 'USD', sale_count: 65, cogs_minor: 3400000, gross_profit_minor: 5100000, gross_margin_percent: 60 },
]));
const mockGetMonthlyRevenue = vi.fn((startDate?: string, _endDate?: string, _token?: string) => Promise.resolve([
  { month: (startDate ?? '2026-07').slice(0, 7), total_minor: 35000000, currency: 'USD', sale_count: 280, cogs_minor: 14000000, gross_profit_minor: 21000000, gross_margin_percent: 60 },
]));
const mockGetTopProducts = vi.fn(() => Promise.resolve([
  { product_id: 'p1', sku: 'SKU-001', name: 'Espresso', total_qty: 45, total_minor: 90000, cogs_minor: 30000, gross_profit_minor: 60000, gross_margin_percent: 66.7 },
  { product_id: 'p2', sku: 'SKU-002', name: 'Latte', total_qty: 38, total_minor: 95000, cogs_minor: 30000, gross_profit_minor: 65000, gross_margin_percent: 68.4 },
]));
const mockGetHourlyHeatmap = vi.fn(() => Promise.resolve([
  { currency: 'USD', day_of_week: 1, hour: 10, total_minor: 350000, sale_count: 3 },
  { currency: 'USD', day_of_week: 2, hour: 11, total_minor: 400000, sale_count: 4 },
]));
const mockGetLowStockAlerts = vi.fn(() => Promise.resolve([
  { product_id: 'lo1', sku: 'SKU-LO1', name: 'Milk', current_qty: 3, threshold: 10, currency: 'USD', price_minor: 1500, cost_minor: 900 },
  { product_id: 'lo2', sku: 'SKU-LO2', name: 'Beans', current_qty: 7, threshold: 12, currency: 'USD', price_minor: 2500, cost_minor: 1400 },
  { product_id: 'lo3', sku: 'SKU-LO3', name: 'Syrup', current_qty: 2, threshold: 8, currency: 'USD', price_minor: 1800, cost_minor: 1000 },
  { product_id: 'lo4', sku: 'SKU-LO4', name: 'Cups', current_qty: 20, threshold: 25, currency: 'USD', price_minor: 300, cost_minor: 150 },
  { product_id: 'lo5', sku: 'SKU-LO5', name: 'Oat Milk', current_qty: 4, threshold: 10, currency: 'USD', price_minor: 1200, cost_minor: 700 },
  { product_id: 'lo6', sku: 'SKU-LO6', name: 'Filter Paper', current_qty: 9, threshold: 12, currency: 'USD', price_minor: 400, cost_minor: 200 },
]));
const mockGetCategoryBreakdown = vi.fn(() => Promise.resolve([
  // REP-06: report rows carry their own currency (the Rust DTO always
  // populates it) — fmtIn throws without it.
  { category_id: 'cat1', category_name: 'Beverages', total_minor: 500000, currency: 'USD', sale_count: 40, percentage: 55 },
  { category_id: 'cat2', category_name: 'Food', total_minor: 300000, currency: 'USD', sale_count: 25, percentage: 33 },
]));
// Per-day basket-size rows: 100 total sales, weighted avg 2.5 items/order
// — a real trend for the basket chart, not a flat range average.
// Range-anchored to the queried week (see the daysAfter helper above).
const mockGetBasketSizeTrend = vi.fn((startDate?: string, _endDate?: string, _token?: string) => {
  const base = startDate ?? '2026-08-03';
  const d = (n: number) => daysAfter(base, n);
  return Promise.resolve([
    { date: d(0), sale_count: 15, avg_line_count: 2.4 },
    { date: d(1), sale_count: 18, avg_line_count: 2.8 },
    { date: d(2), sale_count: 12, avg_line_count: 2.2 },
    { date: d(3), sale_count: 14, avg_line_count: 2.5 },
    { date: d(4), sale_count: 16, avg_line_count: 2.6 },
    { date: d(5), sale_count: 13, avg_line_count: 2.3 },
    { date: d(6), sale_count: 12, avg_line_count: 2.5 },
  ]);
});
const mockGetCustomerSplit = vi.fn(() => Promise.resolve({ new_count: 30, returning_count: 70 }));
const mockGetPaymentMethodBreakdown = vi.fn(() => Promise.resolve([
  { payment_method: 'cash', total_minor: 600000, sale_count: 30 },
  { payment_method: 'card', total_minor: 900000, sale_count: 45 },
]));
const mockGetDiscountsSummary = vi.fn(() => Promise.resolve({
  sale_count: 100, discounted_sale_count: 12, share_percent: 12.5,
  codes: [{ label: 'WELCOME10', redeemed_count: 8 }, { label: 'HAPPYHOUR', redeemed_count: 4 }],
}));
const mockGetVoidedSalesSummary = vi.fn(() => Promise.resolve([{ currency: 'USD', void_count: 3, void_total_minor: 45000 }]));
const mockGetVoidedItems = vi.fn(() => Promise.resolve([
  { name: 'Cold Brew', qty: 2 },
  { name: 'Croissant', qty: 1 },
]));
const mockGetInventoryTurnover = vi.fn(() => Promise.resolve({ units_sold: 500, stock_on_hand: 120, sku_count: 24, range_days: 30 }));
// Range-anchored: the loaders zero-fill against the queried window, so an
// off-range fixed date would be dropped (rendering an all-zero chart).
const daysAfter = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** ISO Monday of the current local week — matches `weekStartKey` in the loader. */
const isoLocalMonday = () => {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
};
const mockGetInventoryTrend = vi.fn((startDate?: string, _endDate?: string, _token?: string) => Promise.resolve([
  { date: startDate ?? '2026-07-21', units_sold: 15 },
  { date: daysAfter(startDate ?? '2026-07-21', 1), units_sold: 18 },
]));
// Restaurant table turnover: 3 days of completed table orders.
// Turns of 20/30/25 → average turn minutes of 72/48/58 (1440 ÷ turns).
// Range-anchored to the queried week (like mockGetInventoryTrend) so the
// rows always land inside the zero-filled axis — a fixed date here would
// drift out of the weekly window and render an all-zero chart.
const mockGetTableTurnover = vi.fn((startDate?: string, _endDate?: string, _token?: string) =>
  Promise.resolve([
    { date: startDate ?? '2026-08-10', table_orders: 20 },
    { date: daysAfter(startDate ?? '2026-08-10', 1), table_orders: 30 },
    { date: daysAfter(startDate ?? '2026-08-10', 2), table_orders: 25 },
  ]));
// Real hourly table activity for the occupancy curve — twin-peak shape
// (lunch ≈ 12:00, dinner ≈ 19:00), so the derived peak hour is 19.
const mockGetHourlyOccupancy = vi.fn(() => Promise.resolve([
  { hour: 8, table_orders: 6 },
  { hour: 12, table_orders: 40 },
  { hour: 13, table_orders: 32 },
  { hour: 18, table_orders: 38 },
  { hour: 19, table_orders: 60 },
  { hour: 20, table_orders: 44 },
]));
const mockGetMenuEngineering = vi.fn(() => Promise.resolve({
  rows: [{ product_id: 'm1', sku: 'SKU-M1', name: 'Pasta', total_volume: 50, unit_price_minor: 10000, unit_cost_minor: 4000, margin_per_unit: 6000, total_margin_minor: 300000, total_revenue_minor: 500000 }],
  median_volume: 25,
  median_margin: 5000,
}));

vi.mock('@/api/reports', () => ({
  // Args MUST forward to the vi.fn so range-anchored rows (zero-fill)
  // and any arg-asserting test see the real query window.
  getDailyRevenue: (startDate: string, endDate: string, token: string) => mockGetDailyRevenue(startDate, endDate, token),
  getWeeklyRevenue: (startDate: string, endDate: string, token: string) => mockGetWeeklyRevenue(startDate, endDate, token),
  getMonthlyRevenue: (startDate: string, endDate: string, token: string) => mockGetMonthlyRevenue(startDate, endDate, token),
  getTopProducts: () => mockGetTopProducts(),
  getHourlyHeatmap: () => mockGetHourlyHeatmap(),
  getLowStockAlerts: () => mockGetLowStockAlerts(),
  getCategoryBreakdown: () => mockGetCategoryBreakdown(),
  getMenuEngineering: () => mockGetMenuEngineering(),
  getBasketSizeTrend: (startDate: string, endDate: string, token: string) => mockGetBasketSizeTrend(startDate, endDate, token),
  getCustomerSplit: () => mockGetCustomerSplit(),
  getPaymentMethodBreakdown: () => mockGetPaymentMethodBreakdown(),
  getDiscountsSummary: () => mockGetDiscountsSummary(),
  getVoidedSalesSummary: () => mockGetVoidedSalesSummary(),
  getVoidedItems: () => mockGetVoidedItems(),
  getInventoryTurnover: () => mockGetInventoryTurnover(),
  getInventoryTrend: (startDate: string, endDate: string, token: string) => mockGetInventoryTrend(startDate, endDate, token),
  getTableTurnover: (startDate: string, endDate: string, token: string) => mockGetTableTurnover(startDate, endDate, token),
  getHourlyOccupancy: () => mockGetHourlyOccupancy(),
}));

const mockGetStaffAnalyticsScoped = vi.fn(() => Promise.resolve([
  { user_id: 'u1', display_name: 'Arya', shift_count: 10, closed_shift_count: 8, shift_sales_minor: 200000, sale_count: 40, sale_total_minor: 600000 },
  { user_id: 'u2', display_name: 'Budi', shift_count: 9, closed_shift_count: 7, shift_sales_minor: 180000, sale_count: 35, sale_total_minor: 520000 },
  { user_id: 'u3', display_name: 'Citra', shift_count: 8, closed_shift_count: 7, shift_sales_minor: 150000, sale_count: 30, sale_total_minor: 450000 },
  { user_id: 'u4', display_name: 'Dewi', shift_count: 7, closed_shift_count: 5, shift_sales_minor: 120000, sale_count: 22, sale_total_minor: 340000 },
  { user_id: 'u5', display_name: 'Eka', shift_count: 6, closed_shift_count: 4, shift_sales_minor: 90000, sale_count: 18, sale_total_minor: 260000 },
  { user_id: 'u6', display_name: 'Fajar', shift_count: 5, closed_shift_count: 3, shift_sales_minor: 70000, sale_count: 14, sale_total_minor: 200000 },
]));

vi.mock('@/api/analytics', () => ({
  getStaffAnalyticsScoped: () => mockGetStaffAnalyticsScoped(),
}));

// Live floor-plan snapshot for the restaurant occupancy card: 2 of 4
// active tables occupied → 50% real occupancy rate.
const mockListTablesScoped = vi.fn(() => Promise.resolve([
  { id: 'table-01', name: 'Table 1', capacity: 4, pos_x: 10, pos_y: 10, shape: 'circle', width: 8, height: 8, status: 'occupied', active_sale_id: 'sale-1', section: 'Indoor', active: true, sort_order: 1 },
  { id: 'table-02', name: 'Table 2', capacity: 4, pos_x: 30, pos_y: 10, shape: 'circle', width: 8, height: 8, status: 'occupied', active_sale_id: 'sale-2', section: 'Indoor', active: true, sort_order: 2 },
  { id: 'table-03', name: 'Table 3', capacity: 2, pos_x: 50, pos_y: 10, shape: 'circle', width: 8, height: 8, status: 'available', active_sale_id: null, section: 'Indoor', active: true, sort_order: 3 },
  { id: 'table-04', name: 'Table 4', capacity: 6, pos_x: 70, pos_y: 10, shape: 'circle', width: 8, height: 8, status: 'available', active_sale_id: null, section: 'Patio', active: true, sort_order: 4 },
]));

vi.mock('@/api/tables', () => ({
  listTablesScoped: () => mockListTablesScoped(),
}));

import AnalyticsScreen from '@/features/analytics/AnalyticsScreen';
import { nextExpandedKey, daysInCurrentMonth, monthCalendarGrid, smartScale, cardGranularity, cardRange } from '@/features/analytics/utils/dateRangePresets';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { makeSubscriptionCaps } from '@/__tests__/test-utils/mocks/subscriptionCaps';
import { yearlyHeatmapColumns, rangeForGranularity, isoToday } from '@/features/analytics/analytics-data';
import { analyticsDataCache, clearAnalyticsCache } from '@/features/analytics/analytics-cache';
import { registerAnalyticsFeature } from '@/features/analytics/register';
import { registerStaffFeature } from '@/features/staff/register';
import { getEnabledPages, clearPages, hasGrantedPermission } from '@/platform/ui/page-registry';
import { getNavItems, clearNavItems } from '@/platform/ui/menu-registry';

// ────────────────────────────────────────────────────────────────────
// Layout shell tests
// ────────────────────────────────────────────────────────────────────

describe('AnalyticsScreen layout shell', () => {
  beforeEach(() => {
    mockGoToPicker.mockReset();
    // These three are created with a non-empty default implementation, and the
    // empty-states test overrides that default unconditionally rather than for
    // one call. mockReset restores the vi.fn(impl) original, which keeps the
    // override from leaking into the tests that assert on the seeded rows.
    mockGetLowStockAlerts.mockReset();
    mockGetTopProducts.mockReset();
    mockGetHourlyHeatmap.mockReset();
    // Default to a rejected store fetch so every pre-existing test keeps the
    // behaviour it was written against (storeTz stays null → UTC fallback).
    // Only the anchoring tests below resolve it, which keeps the new mock from
    // silently changing the dates 60+ existing assertions depend on.
    mockGetPrimaryLocationScoped.mockReset();
    mockGetPrimaryLocationScoped.mockRejectedValue(new Error('no store in this test'));
    localStorage.clear();
    // The analytics cache is a module-level singleton — wipe it so each
    // test starts from a cold cache (otherwise the daily/retail query
    // from a previous test would be served as a fresh hit).
    clearAnalyticsCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Fire any pending recalculation timer instantly and let the mock IPC
   * promises resolve (advanceTimersByTimeAsync flushes microtasks between
   * timers, so the async card data lands before the next assertion). Only
   * meaningful when fake timers are enabled (the tests that need it call
   * `vi.useFakeTimers()`).
   */
  const flushRecalc = async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
  };

  it('renders the three-area layout structure', () => {
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    // Area 1 — header with back button and title
    expect(screen.getByRole('button', { name: 'Back to home' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Analytics' })).toBeTruthy();
    expect(screen.getByText('Sales, products, and staff performance')).toBeTruthy();
  });

  it('renders the workspace selector defaulting to Retail', () => {
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    const select = screen.getByRole('combobox', { name: 'Select workspace type' });
    expect(select).toBeTruthy();
    expect((select as HTMLSelectElement).value).toBe('retail');
  });

  it('labels the selector options with the real workspace names', () => {
    vi.mocked(useWorkspace).mockReturnValue({
      ...useWorkspace(),
      availableWorkspaces: [
        { instance_id: 'i-store', type_key: 'store-pos', store_id: 'default', store_name: 'Main Store', purpose_key: 'general', name: 'Store POS', description: 'Point of Sale', icon: 'store', layout_mode: 'fullscreen', colour: null, is_default: false },
        { instance_id: 'i-resto', type_key: 'restaurant-pos', store_id: 'default', store_name: 'Main Store', purpose_key: 'general', name: 'Restaurant POS', description: 'Table service', icon: 'restaurant', layout_mode: 'fullscreen', colour: null, is_default: false },
      ],
    });
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    const select = screen.getByRole('combobox', { name: 'Select workspace type' }) as HTMLSelectElement;
    const retailOption = select.querySelector('option[value="retail"]');
    const restaurantOption = select.querySelector('option[value="restaurant"]');
    expect(retailOption?.textContent).toBe('Store POS');
    expect(restaurantOption?.textContent).toBe('Restaurant POS');
  });

  it('defaults to Restaurant view when the active instance is a restaurant POS', () => {
    vi.mocked(useWorkspace).mockReturnValue({
      ...useWorkspace(),
      activeInstance: { instance_id: 'i-resto', type_key: 'restaurant-pos', store_id: 'default', store_name: 'Main Store', purpose_key: 'general', name: 'Restaurant POS', description: 'Table service', icon: 'restaurant', layout_mode: 'fullscreen', colour: null, is_default: false },
    });
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    const select = screen.getByRole('combobox', { name: 'Select workspace type' }) as HTMLSelectElement;
    expect(select.value).toBe('restaurant');
  });

  it('renders all four granularity buttons with weekly active by default', () => {
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    const weekly = screen.getByRole('radio', { name: 'Weekly' });
    const monthly = screen.getByRole('radio', { name: 'Monthly' });
    const yearly = screen.getByRole('radio', { name: 'Yearly' });
    const custom = screen.getByRole('radio', { name: 'Custom' });

    expect(weekly).toBeTruthy();
    expect(monthly).toBeTruthy();
    expect(yearly).toBeTruthy();
    expect(custom).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Daily' })).toBeNull();
    expect(weekly.getAttribute('aria-checked')).toBe('true');
  });

  it('activates a different granularity on click', async () => {
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    const monthly = screen.getByRole('radio', { name: 'Monthly' });
    await userEvent.click(monthly);
    expect(monthly.getAttribute('aria-checked')).toBe('true');

    // Weekly should no longer be active
    const weekly = screen.getByRole('radio', { name: 'Weekly' });
    expect(weekly.getAttribute('aria-checked')).toBe('false');
  });

  it('switches workspace and resets granularity to weekly', async () => {
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    // Click monthly first
    const monthly = screen.getByRole('radio', { name: 'Monthly' });
    await userEvent.click(monthly);
    expect(monthly.getAttribute('aria-checked')).toBe('true');

    // Switch to restaurant — should reset to weekly
    const select = screen.getByRole('combobox', { name: 'Select workspace type' });
    await userEvent.selectOptions(select, 'restaurant');
    expect((select as HTMLSelectElement).value).toBe('restaurant');

    const weekly = screen.getByRole('radio', { name: 'Weekly' });
    expect(weekly.getAttribute('aria-checked')).toBe('true');
  });

  it('back button calls goToWorkspacePicker', async () => {
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    const backBtn = screen.getByRole('button', { name: 'Back to home' });
    await userEvent.click(backBtn);
    expect(mockGoToPicker).toHaveBeenCalledTimes(1);
  });

  it('shows the custom date range popup when Custom granularity is selected', async () => {
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    // Before clicking Custom, the date pickers should not be visible
    expect(screen.queryByLabelText('From')).toBeNull();
    expect(screen.queryByLabelText('To')).toBeNull();

    // Click Custom
    const custom = screen.getByRole('radio', { name: 'Custom' });
    await userEvent.click(custom);

    // Now the date pickers appear
    expect(screen.getByLabelText('From')).toBeTruthy();
    expect(screen.getByLabelText('To')).toBeTruthy();
  });

  it('renders refresh, zoom out, and zoom in action buttons', () => {
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    expect(screen.getByRole('button', { name: 'Refresh data' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeTruthy();
  });

  it('zooms the main grid in and out without affecting title or menu', async () => {
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    const grid = document.querySelector('.analytics-grid') as HTMLElement;
    expect(grid.style.zoom).toBe('1');

    const zoomIn = screen.getByRole('button', { name: 'Zoom in' });
    await userEvent.click(zoomIn);
    expect(grid.style.zoom).toBe('1.2');

    const zoomOut = screen.getByRole('button', { name: 'Zoom out' });
    await userEvent.click(zoomOut);
    await userEvent.click(zoomOut);
    expect(grid.style.zoom).toBe('0.8');
  });

  it('shows a zoom badge that opens a slider popover and resets zoom', () => {
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    const grid = document.querySelector('.analytics-grid') as HTMLElement;
    const badge = screen.getByRole('button', { name: 'Zoom level' });
    expect(badge.textContent).toBe('100%');

    // Open the slider popover and drag to 120%
    fireEvent.click(badge);
    const slider = screen.getByRole('slider', { name: 'Zoom level' });
    fireEvent.change(slider, { target: { value: '120' } });
    expect(grid.style.zoom).toBe('1.2');
    expect(badge.textContent).toBe('120%');

    // Reset from inside the popover
    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom to 100%' }));
    expect(badge.textContent).toBe('100%');
    expect(grid.style.zoom).toBe('1');
  });

  it('disables zoom buttons at their limits', () => {
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    const zoomOut = screen.getByRole('button', { name: 'Zoom out' }) as HTMLButtonElement;
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement;

    // At 100%, zoom out is enabled, zoom in is not yet at the max
    expect(zoomOut.disabled).toBe(false);
    expect(zoomIn.disabled).toBe(false);

    // Zoom out to the floor (0.6) — button becomes disabled
    for (let i = 0; i < 10; i++) fireEvent.click(zoomOut);
    expect(zoomOut.disabled).toBe(true);

    // Zoom in back to the ceiling (1.6) — button becomes disabled
    for (let i = 0; i < 10; i++) fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(zoomIn.disabled).toBe(true);
  });

  it('shows the view status bar with card count and workspace', () => {
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    expect(screen.getByText('13 cards')).toBeTruthy();
    // Status shows workspace · granularity (scoped to the status bar)
    const status = document.querySelector('.analytics-status');
    expect(status?.textContent).toContain('Retail');
    expect(status?.textContent).toContain('Weekly');
  });

  it('toggles the TTL cache metrics readout in the status bar', async () => {
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    // The chip is present and shows a hit rate (or dash before reads).
    const chip = screen.getByRole('button', { name: 'TTL cache metrics' });
    expect(chip).toBeTruthy();

    // No popover until opened.
    expect(screen.queryByRole('dialog', { name: 'TTL cache metrics' })).toBeNull();

    fireEvent.click(chip);
    const popover = screen.getByRole('dialog', { name: 'TTL cache metrics' });
    expect(popover).toBeTruthy();

    // The summary line renders the totals placeholder.
    expect(popover.textContent).toContain('Cache metrics');
    expect(popover.textContent).toContain('key');
    expect(popover.textContent).toContain('hits');

    // Toggle closes it again.
    fireEvent.click(screen.getByRole('button', { name: 'TTL cache metrics' }));
    expect(screen.queryByRole('dialog', { name: 'TTL cache metrics' })).toBeNull();
  });

  it('clears the cache from the metrics popover', () => {
    // Seed the shared cache with a query first.
    analyticsDataCache.set('card:revenue:retail:daily', { seed: true });

    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    fireEvent.click(screen.getByRole('button', { name: 'TTL cache metrics' }));
    const popover = screen.getByRole('dialog', { name: 'TTL cache metrics' });
    // The seeded key appears in the per-key table (via its short label).
    expect(popover.textContent).toContain('revenue');

    const clearBtn = screen.getByRole('button', { name: 'Clear the analytics cache' });
    fireEvent.click(clearBtn);

    // Cache is wiped: the seeded row disappears and cards refetch
    // (fresh misses appear — proving the old entries were really gone).
    expect(popover.textContent).not.toContain('revenue');
    expect(analyticsDataCache.get('card:revenue:retail:daily')).toBeUndefined();
    expect(analyticsDataCache.metrics().totals).toMatchObject({ hits: 0, expiries: 0 });
    expect(analyticsDataCache.metrics().totals.misses).toBeGreaterThan(0);
  });

  it('opens the command palette with Ctrl+K and runs a filtered action', () => {
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('dialog', { name: 'Quick actions' })).toBeTruthy();

    // Filter to granularity items
    fireEvent.change(screen.getByRole('textbox', { name: 'Search actions…' }), { target: { value: 'month' } });
    fireEvent.keyDown(window, { key: 'Enter' });

    // Monthly became active and the palette closed
    expect(screen.getByRole('radio', { name: 'Monthly' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('dialog', { name: 'Quick actions' })).toBeNull();
  });

  it('switches workspace from the command palette', () => {
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.change(screen.getByRole('textbox', { name: 'Search actions…' }), { target: { value: 'restaurant' } });
    fireEvent.keyDown(window, { key: 'Enter' });

    const select = screen.getByRole('combobox', { name: 'Select workspace type' }) as HTMLSelectElement;
    expect(select.value).toBe('restaurant');
    expect(screen.queryByRole('dialog', { name: 'Quick actions' })).toBeNull();
  });

  it('closes the palette with Escape and keeps shortcuts dormant while open', () => {
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('dialog', { name: 'Quick actions' })).toBeTruthy();

    // Shortcuts are ignored while the palette is open
    fireEvent.keyDown(window, { key: '3' });
    expect(screen.getByRole('radio', { name: 'Monthly' }).getAttribute('aria-checked')).toBe('false');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Quick actions' })).toBeNull();
  });

  it('handles keyboard shortcuts for granularity and escape', () => {
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    // '2' selects Monthly (weekly=1, monthly=2, yearly=3, custom=4)
    fireEvent.keyDown(window, { key: '2' });
    expect(screen.getByRole('radio', { name: 'Monthly' }).getAttribute('aria-checked')).toBe('true');

    // Escape closes the shortcuts popover if open
    fireEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ignores keyboard shortcuts while typing in an input', () => {
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    fireEvent.click(screen.getByRole('radio', { name: 'Custom' }));
    const from = screen.getByLabelText('From') as HTMLInputElement;

    // Typing digits inside the date input must not switch granularity
    fireEvent.keyDown(from, { key: '2' });
    expect(screen.getByRole('radio', { name: 'Weekly' }).getAttribute('aria-checked')).toBe('false');
  });

  it('opens the shortcuts help popover and closes it', () => {
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/Time range/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows a reset-layout button after reordering and restores defaults', () => {
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    expect(screen.queryByRole('button', { name: 'Reset layout' })).toBeNull();

    // Reorder: drag Heat Map onto Staff Performance
    const cards = () => [...document.querySelectorAll('.analytics-card')];
    const heat = cards()[0]!;
    const staff = cards().find((c) => c.querySelector('.analytics-card-title')?.textContent === 'Staff Performance')!;
    fireEvent.dragStart(heat.querySelector('.analytics-card-header')!);
    fireEvent.dragOver(staff);
    fireEvent.drop(staff);
    fireEvent.dragEnd(heat.querySelector('.analytics-card-header')!);

    expect(screen.getByRole('button', { name: 'Reset layout' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Reset layout' }));
    expect(screen.queryByRole('button', { name: 'Reset layout' })).toBeNull();
    expect(cards()[0]!.querySelector('.analytics-card-title')?.textContent).toBe('Heat Map');
  });

  it('moves a card up and down from its options menu', () => {
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    const titles = () => [...document.querySelectorAll('.analytics-card-title')].map((t) => t.textContent);
    expect(titles()[0]).toBe('Heat Map');

    // Open the menu on the first card and move it down
    fireEvent.click(screen.getAllByRole('button', { name: 'Card options' })[0]!);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));
    expect(titles()[0]).toBe('Revenue Overview');
    expect(titles()[1]).toBe('Heat Map');

    // Move it back up
    fireEvent.click(screen.getAllByRole('button', { name: 'Card options' })[1]!);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move up' }));
    expect(titles()[0]).toBe('Heat Map');
  });

  it('collapses a single card from its options menu', () => {
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    expect(document.querySelectorAll('.analytics-card--collapsed').length).toBe(0);

    fireEvent.click(screen.getAllByRole('button', { name: 'Card options' })[0]!);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Collapse card' }));
    expect(document.querySelectorAll('.analytics-card--collapsed').length).toBe(1);

    fireEvent.click(screen.getAllByRole('button', { name: 'Card options' })[0]!);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show card' }));
    expect(document.querySelectorAll('.analytics-card--collapsed').length).toBe(0);
  });

  it('reorders cards by drag and persists the layout', () => {
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    // First card is the wide Heat Map (spans 2 columns)
    const cards = () => [...document.querySelectorAll('.analytics-card')];
    const titles = () => cards().map((c) => c.querySelector('.analytics-card-title')?.textContent);
    expect(titles()[0]).toBe('Heat Map');

    // Drag Revenue Overview onto Staff Performance's slot
    const heat = cards()[0]!;
    const staff = cards().find((c) => c.querySelector('.analytics-card-title')?.textContent === 'Staff Performance')!;
    fireEvent.dragStart(heat.querySelector('.analytics-card-header')!);
    fireEvent.dragOver(staff);
    fireEvent.drop(staff);
    fireEvent.dragEnd(heat.querySelector('.analytics-card-header')!);

    // Order changed: Staff Performance moved before Heat Map
    expect(titles().indexOf('Staff Performance')).toBeLessThan(titles().indexOf('Heat Map'));

    // Layout persisted to localStorage
    const saved = JSON.parse(localStorage.getItem('oz-analytics-card-order-retail')!);
    expect(saved.indexOf('staff-shared')).toBeLessThan(saved.indexOf('heatmap-shared'));
  });

  // ── R36-05: the quick presets anchor to the STORE, not the host ──────
  // Expected values are computed with explicit UTC arithmetic via
  // test-utils/storeZoneCase rather than by calling isoDaysAgo, so the
  // assertion stays independent of the code under test. This test previously
  // read `expect(from.value).toBe(isoDaysAgo(6))` while the preset itself sets
  // `from` to `isoDaysAgo(days - 1, storeTz)` -- both sides called the same
  // helper, so a wrong isoDaysAgo could never be caught here. That is the
  // R36-01 defect class, and the sibling screen tests (Dashboard, SalesReport,
  // CustomReport, MenuEngineering) all avoid it deliberately.
  // scripts/check-tz-invariance.py replays this file under four host zones; if
  // the range ever depended on the device calendar these would diverge.
  it('applies quick range presets to the custom date pickers', () => {
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    fireEvent.click(screen.getByRole('radio', { name: 'Custom' }));
    const from = screen.getByLabelText('From') as HTMLInputElement;
    const to = screen.getByLabelText('To') as HTMLInputElement;

    fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));

    // No store profile resolved (the default mock rejects), so the anchor is
    // FALLBACK_STORE_TZ -- UTC, the same value the schema column defaults to.
    const UTC_CASE = { offset: 'UTC', hours: 0 };
    expect(from.value).toBe(expectedStoreDay(UTC_CASE, 6));
    expect(to.value).toBe(expectedStoreDay(UTC_CASE, 0));
  });

  it('anchors the custom-range presets to the primary store timezone (R36-05)', async () => {
    // The offset is chosen so its calendar day provably differs from UTC at the
    // moment the test runs -- a hardcoded +14:00 is vacuous for ten hours a day.
    const zone = discriminatingStoreZone();
    assertCaseDiscriminates(zone);
    mockGetPrimaryLocationScoped.mockResolvedValue({
      id: 'store-a', name: 'Store A', timezone: zone.offset,
    });

    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);
    await waitFor(() => expect(mockGetPrimaryLocationScoped).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('radio', { name: 'Custom' }));
    const from = screen.getByLabelText('From') as HTMLInputElement;
    const to = screen.getByLabelText('To') as HTMLInputElement;

    fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));

    await waitFor(() => {
      expect(to.value).toBe(expectedStoreDay(zone, 0));
      expect(from.value).toBe(expectedStoreDay(zone, 6));
    });
    // The store must actually have been consulted -- otherwise storeTz stayed
    // null and these values would be the UTC fallback, which for a ±10/±14
    // offset is a different day and so would have failed above anyway.
    expect(mockGetPrimaryLocationScoped).toHaveBeenCalled();
  });

  it('collapses all card bodies with the toggle and restores them', () => {
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    expect(document.querySelectorAll('.analytics-card--collapsed').length).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: 'Collapse all cards' }));
    expect(document.querySelectorAll('.analytics-card--collapsed').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Expand all cards' }));
    expect(document.querySelectorAll('.analytics-card--collapsed').length).toBe(0);
  });

  it('shows the custom range in the status bar', () => {
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    fireEvent.click(screen.getByRole('radio', { name: 'Custom' }));

    const from = screen.getByLabelText('From') as HTMLInputElement;
    const to = screen.getByLabelText('To') as HTMLInputElement;
    expect(from.value).toBeTruthy();
    expect(screen.getByText(`${from.value} – ${to.value}`)).toBeTruthy();
  });

  it('shows a toast on actions and auto-dismisses it', () => {
    vi.useFakeTimers();
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    // Zoom in, then open the popover and reset — reset shows a toast
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom level' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom to 100%' }));
    expect(screen.getByText('Zoom reset to 100%')).toBeTruthy();

    // After its lifetime the toast fades out (exiting class) before unmounting.
    act(() => { vi.advanceTimersByTime(2600); });
    expect(screen.getByText('Zoom reset to 100%')).toHaveClass('analytics-toast--exiting');
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.queryByText('Zoom reset to 100%')).toBeNull();
  });

  it('shows a layout-saved toast when cards are reordered', () => {
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    const cards = () => [...document.querySelectorAll('.analytics-card')];
    const heat = cards()[0]!;
    const staff = cards().find((c) => c.querySelector('.analytics-card-title')?.textContent === 'Staff Performance')!;
    fireEvent.dragStart(heat.querySelector('.analytics-card-header')!);
    fireEvent.dragOver(staff);
    fireEvent.drop(staff);
    fireEvent.dragEnd(heat.querySelector('.analytics-card-header')!);

    expect(screen.getByText('Layout saved')).toBeTruthy();
  });

  it('sits flush below the menu and fills as the main area scrolls', async () => {
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    // The bar is a sibling between the menu and the main area — directly
    // below the menu with no wrapper or gap between them.
    const bar = document.querySelector('.analytics-scroll-progress') as HTMLElement;
    expect(bar.previousElementSibling).toBe(document.querySelector('nav.analytics-menu'));
    expect(bar.nextElementSibling).toBe(document.querySelector('main.analytics-main'));
    expect(bar.style.width).toBe('0%');

    const main = document.querySelector('.analytics-main') as HTMLElement;
    // Halfway: scrollHeight - clientHeight = 1000, scrollTop = 500
    Object.defineProperty(main, 'scrollHeight', { value: 1600, configurable: true });
    Object.defineProperty(main, 'clientHeight', { value: 600, configurable: true });
    Object.defineProperty(main, 'scrollTop', { value: 500, configurable: true });
    fireEvent.scroll(main);
    await waitFor(() => expect(bar.style.width).toBe('50%'));
  });

  it('shows the scroll-to-top button after scrolling the main area', async () => {
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    const main = document.querySelector('.analytics-main') as HTMLElement;
    expect(screen.queryByRole('button', { name: 'Back to top' })).toBeNull();

    // Scroll the main area down past the threshold
    Object.defineProperty(main, 'scrollTop', { value: 400, configurable: true });
    fireEvent.scroll(main);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Back to top' })).toBeTruthy());

    // Scroll back up — button hides
    Object.defineProperty(main, 'scrollTop', { value: 0, configurable: true });
    fireEvent.scroll(main);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Back to top' })).toBeNull());
  });

  it('renders a smart heatmap that changes buckets with granularity', async () => {
    vi.useFakeTimers();
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    const heatmap = () => document.querySelector('.analytics-heatmap');
    const cellCount = () => heatmap()?.querySelectorAll('.analytics-heat-cell').length ?? 0;

    // Skip the initial recalculation skeleton instantly
    await flushRecalc();

    // Default: weekly → 7 day rows × 24 hour columns
    expect(cellCount()).toBe(168);
    expect(heatmap()?.querySelectorAll('.analytics-weekly-row').length).toBe(8); // header + 7 days

    // Monthly → real calendar: day 1 starts on its actual weekday,
    // empty cells pad the first/last rows to complete weeks
    fireEvent.click(screen.getByRole('radio', { name: 'Monthly' }));
    await flushRecalc();
    const filled = heatmap()?.querySelectorAll('.analytics-heat-cell[data-intensity]').length ?? 0;
    const total = cellCount();
    expect(filled).toBe(daysInCurrentMonth());
    expect(filled).toBeGreaterThanOrEqual(28);
    expect(filled).toBeLessThanOrEqual(31);
    expect(total % 7).toBe(0); // complete calendar weeks

    // Yearly → one column per month in the query range (Jan → today), each
    // with the month's Monday weeks (4–5 rows): the frame follows the
    // range, never the current year's full 12 columns.
    fireEvent.click(screen.getByRole('radio', { name: 'Yearly' }));
    await flushRecalc();
    const today = isoToday();
    const yearlyCols = yearlyHeatmapColumns(`${today.slice(0, 4)}-01-01`, today);
    const yearlyCells = yearlyCols.reduce((a, c) => a + c.cells, 0);
    expect(cellCount()).toBe(yearlyCells);
    expect(heatmap()?.querySelectorAll('.analytics-heat-column').length).toBe(yearlyCols.length);
  });

  it('renders the monthly calendar for a single-month custom range', async () => {
    vi.useFakeTimers();
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);
    await flushRecalc();

    fireEvent.click(screen.getByRole('radio', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-07-31' } });
    await flushRecalc();

    // A range inside one calendar month renders that month's calendar grid.
    expect(document.querySelector('.analytics-heatmap--monthly')).toBeTruthy();
  });

  it('renders yearly columns for a long custom range', async () => {
    vi.useFakeTimers();
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);
    await flushRecalc();

    fireEvent.click(screen.getByRole('radio', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2025-01-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2025-12-31' } });
    await flushRecalc();

    // A long range renders one column per month (yearly grid).
    expect(document.querySelector('.analytics-heatmap--yearly')).toBeTruthy();
  });

  it('renders localized day and month labels in the heatmap', async () => {
    vi.useFakeTimers();
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);
    await flushRecalc();

    // Weekly grid: Monday-first day abbreviations come from reports.ftl,
    // not hardcoded English.
    expect(screen.getAllByText('Mon').length).toBeGreaterThan(0);

    // Yearly: single-year ranges render the localized month abbreviation
    // (analytics-month-*) for the current month's column header.
    fireEvent.click(screen.getByRole('radio', { name: 'Yearly' }));
    await flushRecalc();
    const monthAbbr = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][new Date().getMonth()]!;
    expect(screen.getAllByText(monthAbbr).length).toBeGreaterThan(0);
  });

  it('marks the busiest cell and renders a Busiest insight line', async () => {
    vi.useFakeTimers();
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);
    await flushRecalc();

    // Tuesday 11:00 is the strongest mock slot (400000 minor) → level 4 + ring.
    const peakCells = document.querySelectorAll('.analytics-heat-cell--peak');
    expect(peakCells.length).toBe(1);
    expect(peakCells[0]?.getAttribute('data-intensity')).toBe('4');

    // The takeaway line names the slot; its value follows the active locale.
    expect(screen.getByText(/Busiest:/)).toBeTruthy();
    expect(screen.getByText(/Tue 11:00/)).toBeTruthy();
  });

  it('shows a quietest-time insight line alongside the busiest', async () => {
    vi.useFakeTimers();
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);
    await flushRecalc();

    // Two distinct active slots → both the busiest and quietest lines render.
    expect(screen.getByText(/Quietest:/)).toBeTruthy();
    expect(screen.getByText(/Mon 10:00/)).toBeTruthy();
  });

  it('shows revenue and order count in each heat cell tooltip', async () => {
    vi.useFakeTimers();
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);
    await flushRecalc();

    // The busiest cell (Tue 11:00) wires its value into the styled tooltip.
    const peak = document.querySelector('.analytics-heat-cell--peak');
    const tip = peak?.getAttribute('data-tooltip-content') ?? '';
    expect(tip).toContain('Tue 11:00');
    expect(tip).toContain('4 orders');
    expect(tip).toMatch(/\$/);

    // A zero-activity cell keeps the label-only tooltip (no $0 / 0 orders noise).
    const firstCell = document.querySelectorAll('.analytics-heat-cell')[0] as HTMLElement | undefined;
    expect(firstCell?.getAttribute('data-tooltip-content') ?? '').not.toContain('orders');
  });

  it('renders designed content in the non-heatmap cards', async () => {
    vi.useFakeTimers();
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);
    await flushRecalc();

    // Real-data cards load through the mock — only demo-only cards
    // (restaurant tables/occupancy) carry the demo chip, so retail shows none
    expect(screen.queryAllByText('Demo data').length).toBe(0);

    // Revenue card: total-revenue KPI + a chart carrying the card title
    expect(screen.getByText('Total revenue')).toBeTruthy();
    expect(screen.getAllByLabelText('Revenue Overview').length).toBeGreaterThan(0);

    // Staff card: ranked list from the staff-analytics mock rows
    expect(document.querySelectorAll('.analytics-rank-row').length).toBeGreaterThanOrEqual(4);

    // Low-stock card: the compact grid caps at five mock alert rows with
    // remaining counts, restock-cost tile, and a reorder chip per row
    expect(document.querySelectorAll('.analytics-alert-row').length).toBe(5);
    expect(screen.getAllByText(/\d+ left/).length).toBe(5);
    expect(screen.getByText('Est. restock cost')).toBeTruthy();
    expect(screen.getAllByText(/Order \d+/).length).toBe(5);

    // Refunds card: KPI tiles from the voided-sales summary plus the
    // ranked voided-items list (shares the card's accessible name)
    expect(document.querySelectorAll('.analytics-kpi-tiles').length).toBeGreaterThan(0);
    expect(screen.getByText('Refund count')).toBeTruthy();
    expect(screen.getAllByLabelText('Refunds & Voids').length).toBeGreaterThan(0);

    // Discounts card: share KPI label (derived, not a hardcoded value)
    expect(screen.getByText('of sales from discounts')).toBeTruthy();

    // Category card: top-category KPI row above the donut
    expect(screen.getByText('Top category')).toBeTruthy();

    // Headline KPIs on the shared cards
    expect(screen.getByText('Total customers')).toBeTruthy();
    expect(screen.getByText('Staff sales total')).toBeTruthy();
    expect(screen.getByText('Top payment method')).toBeTruthy();

    // Heatmap intensity scale legend (Less → More swatches)
    expect(screen.getByLabelText('Sales intensity scale')).toBeTruthy();
    expect(screen.getByText('Less')).toBeTruthy();
    expect(screen.getByText('More')).toBeTruthy();

    // Peak/low-bucket insight lines on the trend cards (revenue, AOV)
    expect(screen.getAllByText(/Peak:/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/Low:/).length).toBeGreaterThanOrEqual(2);

    // Top-items rows show units sold alongside the revenue figure, and the
    // card headlines the #1 product (KPI + its ranked row)
    expect(screen.getAllByText(/· \d+×/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Espresso').length).toBeGreaterThanOrEqual(2);

    // Basket card: aggregate tiles (avg items/order + order volume) above
    // a real per-bucket trend chart carrying the card title
    expect(screen.getByText('items / order')).toBeTruthy();
    expect(screen.getByText('orders')).toBeTruthy();
    expect(screen.getAllByLabelText('Average Basket Size').length).toBeGreaterThan(0);

    // Customers card: new-customer share insight; low-stock: critical tile
    expect(screen.getByText(/new customers/)).toBeTruthy();
    expect(screen.getByText('Critical items')).toBeTruthy();
  });

  it('exports the staff performance CSV from the staff card', async () => {
    vi.useFakeTimers();
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);
    await flushRecalc();

    vi.mocked(downloadCsv).mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Export staff data as CSV' }));

    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [filename, columns, rows] = vi.mocked(downloadCsv).mock.calls[0]!;
    expect(filename).toContain('staff-performance-');
    expect(columns.map((c) => c.key)).toEqual([
      'display_name', 'shift_count', 'closed_shift_count', 'sale_count', 'sale_total', 'shift_sales',
    ]);
    expect(columns.map((c) => c.label)).toEqual([
      'Name', 'Shifts', 'Closed shifts', 'Orders', 'Total sales', 'Shift sales',
    ]);
    // Top-ranked staff row: Arya (600000 minor = $6,000.00), ranked by sales.
    expect(rows[0]).toMatchObject({
      display_name: 'Arya',
      shift_count: '10',
      closed_shift_count: '8',
      sale_count: '40',
      sale_total: '$6,000.00',
      shift_sales: '$2,000.00',
    });
  });

  it('exports the top products CSV from the top-items card', async () => {
    vi.useFakeTimers();
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);
    await flushRecalc();

    vi.mocked(downloadCsv).mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Export top items as CSV' }));

    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [filename, columns, rows] = vi.mocked(downloadCsv).mock.calls[0]!;
    expect(filename).toContain('top-items-');
    expect(columns.map((c) => c.key)).toEqual(['name', 'sku', 'units', 'revenue']);
    expect(columns.map((c) => c.label)).toEqual(['Name', 'SKU', 'Units sold', 'Revenue']);
    expect(rows[0]).toMatchObject({ name: 'Espresso', sku: 'SKU-001', units: '45', revenue: '$900.00' });
    expect(rows[1]).toMatchObject({ name: 'Latte', sku: 'SKU-002', units: '38', revenue: '$950.00' });
  });

  it('exports the payment breakdown CSV from the payments card', async () => {
    vi.useFakeTimers();
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);
    await flushRecalc();

    vi.mocked(downloadCsv).mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Export payments as CSV' }));

    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [filename, columns, rows] = vi.mocked(downloadCsv).mock.calls[0]!;
    expect(filename).toContain('payments-');
    expect(columns.map((c) => c.key)).toEqual(['method', 'sales', 'orders']);
    expect(columns.map((c) => c.label)).toEqual(['Payment method', 'Total sales', 'Orders']);
    expect(rows[0]).toMatchObject({ method: 'Cash', sales: '$6,000.00', orders: '30' });
    expect(rows[1]).toMatchObject({ method: 'Card', sales: '$9,000.00', orders: '45' });
  });

  it('rounds payment shares so the stacked segments sum to 100', async () => {
    vi.useFakeTimers();
    // 1000/3000 = 33.3% each; independent rounding would total 99 (33+33+33).
    mockGetPaymentMethodBreakdown.mockResolvedValueOnce([
      { payment_method: 'cash', total_minor: 1000, sale_count: 1 },
      { payment_method: 'card', total_minor: 1000, sale_count: 1 },
      { payment_method: 'qris', total_minor: 1000, sale_count: 1 },
    ]);
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);
    await flushRecalc();

    const paymentsCard = screen.getByText('Top payment method').closest('.analytics-card') as HTMLElement;
    const legendValues = [...paymentsCard.querySelectorAll('.analytics-legend-value')]
      .map((n) => parseInt(n.textContent ?? '0', 10));
    expect(legendValues.reduce((sum, v) => sum + v, 0)).toBe(100);
  });

  it('exports the category breakdown CSV from the category card', async () => {
    vi.useFakeTimers();
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);
    await flushRecalc();

    vi.mocked(downloadCsv).mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Export categories as CSV' }));

    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [filename, columns, rows] = vi.mocked(downloadCsv).mock.calls[0]!;
    expect(filename).toContain('category-');
    // REP-06a: the export carries a currency column — an unlabelled
    // amount column across currencies is unreadable.
    expect(columns.map((c) => c.key)).toEqual(['category', 'currency', 'sales', 'orders', 'share']);
    expect(columns.map((c) => c.label)).toEqual(['Category', 'Currency', 'Total sales', 'Orders', 'Share %']);
    expect(rows[0]).toMatchObject({ category: 'Beverages', currency: 'USD', sales: '$5,000.00', orders: '40', share: '55' });
    expect(rows[1]).toMatchObject({ category: 'Food', currency: 'USD', sales: '$3,000.00', orders: '25', share: '33' });
  });

  it('exports the revenue trend CSV from the revenue card', async () => {
    vi.useFakeTimers();
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);
    await flushRecalc();

    vi.mocked(downloadCsv).mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Export revenue as CSV' }));

    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [filename, columns, rows] = vi.mocked(downloadCsv).mock.calls[0]!;
    expect(filename).toContain('revenue-');
    expect(columns.map((c) => c.key)).toEqual(['period', 'value']);
    expect(columns.map((c) => c.label)).toEqual(['Period', 'Revenue']);
    expect(rows[0]).toMatchObject({ value: '$85,000.00' });
  });

  it('exports the AOV trend CSV from the AOV card', async () => {
    vi.useFakeTimers();
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);
    await flushRecalc();

    vi.mocked(downloadCsv).mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Export average order value as CSV' }));

    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [filename, columns, rows] = vi.mocked(downloadCsv).mock.calls[0]!;
    expect(filename).toContain('aov-');
    expect(columns.map((c) => c.key)).toEqual(['period', 'value']);
    expect(columns.map((c) => c.label)).toEqual(['Period', 'Average order value']);
    expect(rows[0]).toMatchObject({ value: '$1,307.69' });
  });

  it('exports the basket size CSV from the basket card', async () => {
    vi.useFakeTimers();
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);
    await flushRecalc();

    vi.mocked(downloadCsv).mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Export basket size as CSV' }));

    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [filename, columns, rows] = vi.mocked(downloadCsv).mock.calls[0]!;
    expect(filename).toContain('basket-');
    expect(columns.map((c) => c.key)).toEqual(['period', 'value']);
    expect(columns.map((c) => c.label)).toEqual(['Period', 'Avg items per order']);
    expect(rows.length).toBe(1); // the 7 daily rows collapse into one weekly bucket
    expect(rows[0]).toMatchObject({
      period: expect.any(String),
      value: expect.stringMatching(/^\d+(\.\d+)?$/),
    });
  });

  it('exports the customer split CSV from the customers card', async () => {
    vi.useFakeTimers();
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);
    await flushRecalc();

    vi.mocked(downloadCsv).mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Export customers as CSV' }));

    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [filename, columns, rows] = vi.mocked(downloadCsv).mock.calls[0]!;
    expect(filename).toContain('customers-');
    expect(columns.map((c) => c.key)).toEqual(['segment', 'customers', 'share']);
    expect(columns.map((c) => c.label)).toEqual(['Segment', 'Customers', 'Share %']);
    expect(rows).toEqual([
      { segment: 'New', customers: '30', share: '30' },
      { segment: 'Returning', customers: '70', share: '70' },
    ]);
  });

  it('exports the discounts CSV from the discounts card', async () => {
    vi.useFakeTimers();
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);
    await flushRecalc();

    vi.mocked(downloadCsv).mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Export discounts as CSV' }));

    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [filename, columns, rows] = vi.mocked(downloadCsv).mock.calls[0]!;
    expect(filename).toContain('discounts-');
    expect(columns.map((c) => c.key)).toEqual(['code', 'redemptions']);
    expect(columns.map((c) => c.label)).toEqual(['Code', 'Redemptions']);
    expect(rows).toEqual([
      { code: 'WELCOME10', redemptions: '8' },
      { code: 'HAPPYHOUR', redemptions: '4' },
    ]);
  });

  it('exports the refunds CSV from the refunds card', async () => {
    vi.useFakeTimers();
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);
    await flushRecalc();

    vi.mocked(downloadCsv).mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Export refunds as CSV' }));

    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [filename, columns, rows] = vi.mocked(downloadCsv).mock.calls[0]!;
    expect(filename).toContain('refunds-');
    // REP-06: one CSV row per currency, with a currency column.
    expect(columns.map((c) => c.key)).toEqual(['currency', 'count', 'amount', 'average']);
    expect(columns.map((c) => c.label)).toEqual(['Currency', 'Refund count', 'Refunded amount', 'Average refund']);
    expect(rows).toEqual([{ currency: 'USD', count: '3', amount: '$450.00', average: '$150.00' }]);
  });

  it('exports the low stock CSV from the low-stock card', async () => {
    vi.useFakeTimers();
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);
    await flushRecalc();

    vi.mocked(downloadCsv).mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Export low stock as CSV' }));

    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [filename, columns, rows] = vi.mocked(downloadCsv).mock.calls[0]!;
    expect(filename).toContain('low-stock-');
    expect(columns.map((c) => c.key)).toEqual(['name', 'sku', 'stock', 'reorder', 'cost']);
    expect(columns.map((c) => c.label)).toEqual(['Name', 'SKU', 'Current stock', 'Reorder', 'Restock cost']);
    // Milk: current 3 vs threshold 10 → reorder 7 × $9.00 cost = $63.00.
    expect(rows[0]).toMatchObject({ name: 'Milk', sku: 'SKU-LO1', stock: '3', reorder: '7', cost: '$63.00' });
  });

  it('exports the inventory trend CSV from the inventory card', async () => {
    vi.useFakeTimers();
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);
    await flushRecalc();

    vi.mocked(downloadCsv).mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Export inventory as CSV' }));

    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [filename, columns, rows] = vi.mocked(downloadCsv).mock.calls[0]!;
    expect(filename).toContain('inventory-');
    expect(columns.map((c) => c.key)).toEqual(['period', 'value']);
    expect(columns.map((c) => c.label)).toEqual(['Period', 'Units sold']);
    expect(rows.length).toBe(1); // the two trend days collapse into one weekly bucket
    expect(rows[0]).toMatchObject({ value: '33' });
  });

  it('exports the restaurant-only card CSVs (tables, occupancy, voids)', async () => {
    vi.useFakeTimers();
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);
    await flushRecalc();

    const select = screen.getByRole('combobox', { name: 'Select workspace type' });
    fireEvent.change(select, { target: { value: 'restaurant' } });
    await flushRecalc();

    vi.mocked(downloadCsv).mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Export table turnover as CSV' }));
    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [tablesFile, tablesCols, tablesRows] = vi.mocked(downloadCsv).mock.calls[0]!;
    expect(tablesFile).toContain('tables-');
    expect(tablesCols.map((c) => c.key)).toEqual(['period', 'value']);
    expect(tablesCols.map((c) => c.label)).toEqual(['Period', 'Avg turn (min)']);
    expect(tablesRows.length).toBe(1); // three turn days collapse into one weekly bucket
    expect(tablesRows[0]).toMatchObject({ value: '134' });

    vi.mocked(downloadCsv).mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Export occupancy as CSV' }));
    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [, occCols, occRows] = vi.mocked(downloadCsv).mock.calls[0]!;
    expect(occCols.map((c) => c.key)).toEqual(['hour', 'orders', 'occupancy']);
    expect(occCols.map((c) => c.label)).toEqual(['Hour', 'Orders', 'Occupancy %']);
    expect(occRows[0]).toMatchObject({ hour: '08:00', orders: '6' });

    vi.mocked(downloadCsv).mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Export voids as CSV' }));
    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [voidsFile, voidsCols, voidsRows] = vi.mocked(downloadCsv).mock.calls[0]!;
    expect(voidsFile).toContain('voids-');
    expect(voidsCols.map((c) => c.key)).toEqual(['name', 'qty']);
    expect(voidsCols.map((c) => c.label)).toEqual(['Name', 'Quantity']);
    expect(voidsRows[0]).toMatchObject({ name: 'Cold Brew', qty: '2' });
  });

  it('exports the heatmap CSV from the heatmap card', async () => {
    vi.useFakeTimers();
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);
    await flushRecalc();

    vi.mocked(downloadCsv).mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Export heatmap as CSV' }));

    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [filename, columns, rows] = vi.mocked(downloadCsv).mock.calls[0]!;
    expect(filename).toContain('heatmap-');
    expect(columns.map((c) => c.key)).toEqual(['day', 'hour', 'sales', 'orders']);
    expect(columns.map((c) => c.label)).toEqual(['Day', 'Hour', 'Total sales', 'Orders']);
    // Weekly grid rows: day-of-week 1 (Sun-first) → Monday; 2 → Tuesday.
    expect(rows).toEqual([
      { day: 'Mon', hour: '10', sales: '$3,500.00', orders: '3' },
      { day: 'Tue', hour: '11', sales: '$4,000.00', orders: '4' },
    ]);
  });

  it('sums multi-currency rows in the monthly heatmap CSV export', async () => {
    vi.useFakeTimers();
    // Two currencies for the same day — the export must emit one combined row.
    mockGetDailyRevenue.mockResolvedValueOnce([
      dailyRevenueRow('2026-08-01'),
      { ...dailyRevenueRow('2026-08-01'), currency: 'IDR', total_minor: 500000, sale_count: 5 },
    ]);
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);
    await flushRecalc();

    fireEvent.click(screen.getByRole('radio', { name: 'Monthly' }));
    await flushRecalc();

    vi.mocked(downloadCsv).mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Export heatmap as CSV' }));

    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [filename, columns, rows] = vi.mocked(downloadCsv).mock.calls[0]!;
    expect(filename).toContain('heatmap-');
    expect(columns.map((c) => c.key)).toEqual(['date', 'sales', 'orders']);
    // 12 + 5 orders, $12,500.00 + $5,000.00 → one combined August 1st row.
    expect(rows.filter((r) => r['date'] === '2026-08-01')).toEqual([
      { date: '2026-08-01', sales: '$17,500.00', orders: '17' },
    ]);
  });

  it('gives the waitstaff card a distinct export label from staff', async () => {
    vi.useFakeTimers();
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);
    await flushRecalc();

    const select = screen.getByRole('combobox', { name: 'Select workspace type' });
    fireEvent.change(select, { target: { value: 'restaurant' } });
    await flushRecalc();

    // Restaurant shows both the shared "Staff Performance" card and the
    // restaurant-only "Top Waitstaff" — their export buttons must not share
    // one accessible name.
    expect(screen.getByRole('button', { name: 'Export staff data as CSV' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export waitstaff as CSV' })).toBeTruthy();

    vi.mocked(downloadCsv).mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Export waitstaff as CSV' }));
    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [filename] = vi.mocked(downloadCsv).mock.calls[0]!;
    expect(filename).toContain('waitstaff-');
  });

  it('ranks the waitstaff card by covers served, not sales revenue', async () => {
    vi.useFakeTimers();
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);
    await flushRecalc();

    const select = screen.getByRole('combobox', { name: 'Select workspace type' });
    fireEvent.change(select, { target: { value: 'restaurant' } });
    await flushRecalc();

    // The shared Staff Performance card ranks by revenue (currency values);
    // Top Waitstaff ranks by covers served (plain counts).
    const staffCard = screen.getByText('Staff Performance').closest('.analytics-card') as HTMLElement;
    const waitstaffCard = screen.getByText('Top Waitstaff').closest('.analytics-card') as HTMLElement;

    expect(waitstaffCard.querySelector('.analytics-rank-row')?.textContent).toContain('covers');
    expect(staffCard.querySelector('.analytics-rank-row')?.textContent).not.toContain('covers');
  });

  it('shows empty states when a card has no data', async () => {
    vi.useFakeTimers();
    // mockResolvedValue, not ...Once: the screen can fetch a card more than once
    // per mount. The "today" anchor in AnalyticsScreen.tsx falls back to a local
    // `new Date()` when the store has no timezone, so on a UTC host (CI) it
    // resolves to a different day than on this machine's UTC+7, the derived
    // range changes, and a second fetch fires. With ...Once that second call
    // fell through to the non-empty default at the top of this file, so the
    // empty state never rendered and this test failed only in CI. The intent is
    // "this card has no data at all", which is what an unconditional stub says.
    mockGetLowStockAlerts.mockResolvedValue([]);
    mockGetTopProducts.mockResolvedValue([]);
    mockGetHourlyHeatmap.mockResolvedValue([]);
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);
    await flushRecalc();

    // Low-stock card gets a specific reassuring message; the top-items
    // card (empty) falls back to the generic no-data placeholder; the
    // heatmap shows its own no-sales message instead of an all-zero grid.
    expect(screen.getByText('All items are sufficiently stocked.')).toBeTruthy();
    expect(screen.getByText('No data in this period.')).toBeTruthy();
    expect(screen.getByText('No sales recorded in this range.')).toBeTruthy();
  });

  it('keeps card visuals rendering as granularity changes', async () => {
    vi.useFakeTimers();
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);
    await flushRecalc();

    for (const g of ['Weekly', 'Monthly', 'Yearly']) {
      fireEvent.click(screen.getByRole('radio', { name: g }));
      await flushRecalc();
      // Real-data revenue card keeps rendering for every granularity
      expect(screen.getByText('Total revenue')).toBeTruthy();
    }
  });

  it('expands a card to fill the main area and restores it', async () => {
    vi.useFakeTimers();
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    // Skip the initial recalculation skeleton instantly
    await flushRecalc();

    // All cards visible before expanding
    expect(screen.getByText('Revenue Overview')).toBeTruthy();

    // Expand the Revenue card (first expand button)
    const expandButtons = screen.getAllByRole('button', { name: 'Expand card' });
    expect(expandButtons.length).toBeGreaterThan(1);
    fireEvent.click(expandButtons[1]!);

    // Only the expanded card remains visible, with a restore button
    expect(screen.getByRole('button', { name: 'Restore card' })).toBeTruthy();
    expect(screen.getByText('Revenue Overview')).toBeTruthy();

    // Restore brings the grid back
    fireEvent.click(screen.getByRole('button', { name: 'Restore card' }));
    expect(screen.getAllByRole('button', { name: 'Expand card' }).length).toBeGreaterThan(0);
  });

  it('expands exactly one card — expanding another while one is open is ignored', async () => {
    vi.useFakeTimers();
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    // Skip the initial recalculation skeleton instantly
    await flushRecalc();

    // Expand the first card
    const expandButtons = screen.getAllByRole('button', { name: 'Expand card' });
    const first = expandButtons[0]!;
    fireEvent.click(first);

    // Only the expanded card is rendered — exactly one restore action,
    // and no other expand buttons exist to open a different card
    expect(screen.getByRole('button', { name: 'Restore card' })).toBeTruthy();
    expect(screen.queryAllByRole('button', { name: 'Expand card' }).length).toBe(0);

    // Restore
    fireEvent.click(screen.getByRole('button', { name: 'Restore card' }));
    expect(screen.getAllByRole('button', { name: 'Expand card' }).length).toBeGreaterThan(0);
  });

  it('smart-expands every card — each one fills the grid and restores', async () => {
    vi.useFakeTimers();
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    // Skip the initial recalculation skeleton instantly
    await flushRecalc();

    const cardCount = screen.getAllByRole('button', { name: 'Expand card' }).length;
    expect(cardCount).toBeGreaterThan(1);

    // Loop over every card: expand it, verify it is the only expanded card,
    // then restore it before moving to the next one
    for (let i = 0; i < cardCount; i++) {
      fireEvent.click(screen.getAllByRole('button', { name: 'Expand card' })[i]!);

      expect(document.querySelectorAll('.analytics-card--expanded').length).toBe(1);
      // The expanded card always carries the scaled content wrapper
      const content = document.querySelector('.analytics-card--expanded .analytics-card-content');
      expect(content).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Restore card' }));
      expect(screen.getAllByRole('button', { name: 'Expand card' }).length).toBe(cardCount);
    }

    // Nothing stays expanded after the loop
    expect(document.querySelectorAll('.analytics-card--expanded').length).toBe(0);
  });

  it('expands a ranked-list card to reveal the full list and taller charts', async () => {
    vi.useFakeTimers();
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);
    await flushRecalc();

    // Staff card: the compact grid list caps at top 5
    const staffCard = screen.getByText('Staff Performance').closest('.analytics-card') as HTMLElement;
    expect(staffCard.querySelectorAll('.analytics-rank-row').length).toBe(5);

    // Expanding reveals the full list (6 staff rows from the mock)
    fireEvent.click(staffCard.querySelector('button[aria-label="Expand card"]') as HTMLButtonElement);
    const expanded = document.querySelector('.analytics-card--expanded') as HTMLElement;
    expect(expanded.querySelectorAll('.analytics-rank-row').length).toBe(6);

    // Restore, then check the revenue chart grows when expanded
    fireEvent.click(screen.getByRole('button', { name: 'Restore card' }));
    const revenueCard = screen.getByText('Revenue Overview').closest('.analytics-card') as HTMLElement;
    expect((revenueCard.querySelector('[data-testid="echarts-mock"]') as HTMLElement).style.height).toBe('104px');
    fireEvent.click(revenueCard.querySelector('button[aria-label="Expand card"]') as HTMLButtonElement);
    const expandedRevenue = document.querySelector('.analytics-card--expanded') as HTMLElement;
    expect((expandedRevenue.querySelector('[data-testid="echarts-mock"]') as HTMLElement).style.height).toBe('240px');
  });

  it('expands the low-stock card to reveal every alert row', async () => {
    vi.useFakeTimers();
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);
    await flushRecalc();

    // Compact grid caps the alert list at five (six mock rows)
    const lowStockCard = screen.getByText('Low Stock Alerts').closest('.analytics-card') as HTMLElement;
    expect(lowStockCard.querySelectorAll('.analytics-alert-row').length).toBe(5);

    // Expanding reveals all six alerts
    fireEvent.click(lowStockCard.querySelector('button[aria-label="Expand card"]') as HTMLButtonElement);
    const expanded = document.querySelector('.analytics-card--expanded') as HTMLElement;
    expect(expanded.querySelectorAll('.analytics-alert-row').length).toBe(6);
    expect(expanded.textContent).toContain('Filter Paper');
  });

  it('renders the refunds card as a money summary without a voided-items list', async () => {
    vi.useFakeTimers();
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);
    await flushRecalc();

    const refundsCard = screen.getByText('Refunds & Voids').closest('.analytics-card') as HTMLElement;
    expect(refundsCard.textContent).toContain('Refund count');
    expect(refundsCard.textContent).toContain('Refunded amount');
    expect(refundsCard.textContent).toContain('Average refund');
    // The voided-items list now lives on the restaurant-only Voids card.
    expect(refundsCard.querySelectorAll('.analytics-rank-row').length).toBe(0);
  });

  it('overlays the previous period on every card when compare mode is on', async () => {
    vi.useFakeTimers();
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);
    await flushRecalc();

    // Compare off: no vs-previous-period chips anywhere
    expect(screen.queryByText(/vs previous period/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Turn off comparison' })).toBeNull();

    // Toggle compare on
    fireEvent.click(screen.getByRole('button', { name: 'Compare with previous period' }));
    expect(screen.getByRole('button', { name: 'Turn off comparison' })).toBeTruthy();
    await flushRecalc();

    // Every card now surfaces a period-over-period chip. The daily mocks
    // return the same rows for both windows, so the change is 0.0%.
    const chips = screen.getAllByText(/vs previous period/);
    expect(chips.length).toBeGreaterThan(3);

    // Toggling off removes the chips again
    fireEvent.click(screen.getByRole('button', { name: 'Turn off comparison' }));
    await flushRecalc();
    expect(screen.queryByText(/vs previous period/)).toBeNull();
  });

  it('serves an identical query from the cache without a recalc skeleton', async () => {
    vi.useFakeTimers();
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    // First visit (weekly default): cache miss → recalc skeleton
    expect(document.querySelectorAll('.analytics-card-skeleton').length).toBeGreaterThan(0);
    await flushRecalc();
    expect(document.querySelectorAll('.analytics-card-skeleton').length).toBe(0);

    // Switch to monthly: different query → skeleton again
    fireEvent.click(screen.getByRole('radio', { name: 'Monthly' }));
    await flushRecalc();

    // Switch back to weekly within the TTL: fresh cache hit → no skeleton,
    // content renders instantly (identical query is not refetched)
    fireEvent.click(screen.getByRole('radio', { name: 'Weekly' }));
    expect(document.querySelectorAll('.analytics-card-skeleton').length).toBe(0);
    expect(screen.getByText('Total revenue')).toBeTruthy();
  });

  it('revalidates an identical query after the TTL expires (stale-while-revalidate)', async () => {
    vi.useFakeTimers();
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);
    await flushRecalc();

    // The default granularity is weekly, so the revenue card fetches weekly rows.
    const weeklyCallsBefore = mockGetWeeklyRevenue.mock.calls.length;

    // Let the weekly query's 5-minute TTL lapse
    act(() => {
      vi.advanceTimersByTime(5 * 60 * 1000 + 1000);
    });

    // Switch away and back — the cached weekly query is now stale. The
    // stale value renders instantly (no skeleton, no artificial delay)
    // while a background revalidation refreshes the cache.
    fireEvent.click(screen.getByRole('radio', { name: 'Monthly' }));
    await flushRecalc();
    fireEvent.click(screen.getByRole('radio', { name: 'Weekly' }));

    // Stale content is served immediately — no waiting skeleton.
    expect(screen.getByText('Total revenue')).toBeTruthy();
    expect(document.querySelectorAll('.analytics-card-skeleton').length).toBe(0);
    await flushRecalc();

    // The background revalidation refetched the expired rows.
    expect(mockGetWeeklyRevenue.mock.calls.length).toBeGreaterThan(weeklyCallsBefore);
  });

  it('refresh always refetches even when the query is cached', async () => {
    vi.useFakeTimers();
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);
    await flushRecalc();

    // The daily query is fresh in the cache, but the refresh button
    // forces a recalc skeleton and wipes the cached payloads
    fireEvent.click(screen.getByRole('button', { name: 'Refresh data' }));
    expect(document.querySelectorAll('.analytics-card-skeleton').length).toBeGreaterThan(0);
    await flushRecalc();
    expect(document.querySelectorAll('.analytics-card-skeleton').length).toBe(0);
  });

  it('renders the analytics card grid with workspace-appropriate titles', () => {
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    // Shared cards appear for retail
    expect(screen.getByText('Revenue Overview')).toBeTruthy();
    expect(screen.getByText('Staff Performance')).toBeTruthy();
    // Retail-specific
    expect(screen.getByText('Top Products')).toBeTruthy();
    expect(screen.getByText('Sales by Category')).toBeTruthy();
    // Full-width
    expect(screen.getByText('Heat Map')).toBeTruthy();
  });

  it('switches card titles when workspace changes to restaurant', async () => {
    vi.useFakeTimers();
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);

    // Retail defaults
    expect(screen.getByText('Top Products')).toBeTruthy();
    expect(screen.getByText('Sales by Category')).toBeTruthy();

    // Switch to restaurant
    const select = screen.getByRole('combobox', { name: 'Select workspace type' });
    fireEvent.change(select, { target: { value: 'restaurant' } });

    // Flush the recalc skeleton so card content renders
    await flushRecalc();

    // Restaurant-specific cards replace retail ones
    expect(screen.getByText('Top Menu Items')).toBeTruthy();
    expect(screen.getByText('Table Turnover')).toBeTruthy();

    // Tables card: daily remaps to weekly, so the three turn days (20/30/25
    // = 75 orders) collapse into one Monday-week bucket → 7×1440 ÷ 75 ≈ 134 min.
    expect(screen.getByText('134 min')).toBeTruthy();

    // With a single weekly bucket the zero-filled no-orders day can no
    // longer surface as a spurious "lowest turn time" reading. The labels
    // are derived from the current week (the mock is range-anchored), so
    // compute the Monday and the no-orders day the same way the loader does.
    const monday = isoLocalMonday();
    expect(screen.queryByText(`Low: ${daysAfter(monday, 3).slice(5)} · 0 min`)).toBeNull();
    expect(screen.getByText(`Low: ${monday.slice(5)} · 134 min`)).toBeTruthy();

    // Occupancy card renders its real hourly curve (peak derived from the
    // hourly-activity mock → 19:00) and the live rate from the tables
    // snapshot (2 of 4 occupied → 50%)
    expect(screen.getByLabelText('Occupancy by hour')).toBeTruthy();
    expect(screen.getByText('50%')).toBeTruthy();
    // Peak meta now carries the raw order count behind the peak bucket
    expect(screen.getByText('Peak hour · 19:00 · 60 table orders')).toBeTruthy();

    // Waitstaff card: total-sales KPI from staff-analytics mock rows
    expect(screen.getByText('Total covers')).toBeTruthy();

    // Voids card: voided-count tile from the voided-items mock rows
    expect(document.querySelectorAll('.analytics-rank-row').length).toBeGreaterThanOrEqual(3);
  });
});

// ────────────────────────────────────────────────────────────────────
// Role gate tests (unchanged — registration, not component)
// ────────────────────────────────────────────────────────────────────

describe('analytics page role gate (0046 taxonomy)', () => {
  beforeEach(() => {
    clearPages();
    clearNavItems();
    registerAnalyticsFeature();
    registerStaffFeature();
  });

  it('is visible to owner, admin, and manager', () => {
    for (const role of ['owner', 'admin', 'manager', 'role-admin', 'role-manager']) {
      const pages = getEnabledPages(undefined, role);
      expect(pages.some((p) => p.route === 'analytics')).toBe(true);
      const nav = getNavItems(undefined, role);
      expect(nav.some((n) => n.route === 'analytics')).toBe(true);
    }
  });

  it('is hidden from staff and auditor (no analytics:view grant)', () => {
    for (const role of ['staff', 'role-staff', 'auditor', 'role-auditor']) {
      const pages = getEnabledPages(undefined, role);
      expect(pages.some((p) => p.route === 'analytics')).toBe(false);
      const nav = getNavItems(undefined, role);
      expect(nav.some((n) => n.route === 'analytics')).toBe(false);
    }
  });

  it('manager-gated pages stay visible to admin (admin is manager-level)', () => {
    const pages = getEnabledPages(undefined, 'admin');
    expect(pages.some((p) => p.route === 'staff')).toBe(true);
  });

  it('permission gate is authoritative when the session carries granted keys', () => {
    const granted = getEnabledPages(undefined, 'staff', ['sales:process', 'analytics:view']);
    expect(granted.some((p) => p.route === 'analytics')).toBe(true);
    const denied = getEnabledPages(undefined, 'manager', ['sales:process', 'sales:view']);
    expect(denied.some((p) => p.route === 'analytics')).toBe(false);
    const owner = getEnabledPages(undefined, 'owner', ['*']);
    expect(owner.some((p) => p.route === 'analytics')).toBe(true);
    const empty = getEnabledPages(undefined, 'owner', []);
    expect(empty.some((p) => p.route === 'analytics')).toBe(false);
  });
});

describe('nextExpandedKey — single-expansion invariant', () => {
  it('expands a card when nothing is open', () => {
    expect(nextExpandedKey(null, 'revenue-shared')).toBe('revenue-shared');
  });

  it('restores the expanded card when clicked again', () => {
    expect(nextExpandedKey('revenue-shared', 'revenue-shared')).toBe(null);
  });

  it('ignores expanding a different card while one is open', () => {
    expect(nextExpandedKey('revenue-shared', 'heatmap-shared')).toBe('revenue-shared');
  });

  it('never yields a different card than the one currently expanded', () => {
    for (const current of ['a', 'b', 'c']) {
      for (const cid of ['a', 'b', 'c', 'd']) {
        const next = nextExpandedKey(current, cid);
        expect(next === null || next === current).toBe(true);
      }
    }
  });
});

describe('cardGranularity — per-card granularity remap', () => {
  const heatmap = { granularityMap: { custom: 'weekly' } as const };

  it('passes through the global granularity when no remap exists', () => {
    expect(cardGranularity({}, 'weekly')).toBe('weekly');
    expect(cardGranularity({}, 'yearly')).toBe('yearly');
  });

  it('applies the remap only for the mapped granularity', () => {
    expect(cardGranularity(heatmap, 'custom')).toBe('weekly');
    expect(cardGranularity(heatmap, 'weekly')).toBe('weekly');
    expect(cardGranularity(heatmap, 'monthly')).toBe('monthly');
  });

  it('does not mutate or leak the card remap across calls', () => {
    expect(cardGranularity({ granularityMap: { custom: 'daily' } }, 'custom')).toBe('daily');
    expect(cardGranularity({ granularityMap: { custom: 'daily' } }, 'yearly')).toBe('yearly');
  });
});

describe('cardRange — range follows the card\'s effective granularity', () => {
  it('derives the window from the remapped granularity, not the selector', () => {
    // daily → monthly remap must yield the monthly window, not the daily one.
    const card = { granularityMap: { daily: 'monthly' } as const };
    const customFrom = '2020-01-01';
    const customTo = '2020-01-31';
    expect(cardRange(card, 'daily', customFrom, customTo)).toEqual(
      rangeForGranularity('monthly', customFrom, customTo),
    );
    expect(cardRange(card, 'daily', customFrom, customTo)).not.toEqual(
      rangeForGranularity('daily', customFrom, customTo),
    );
  });

  it('passes the global window through when the card has no remap', () => {
    const customFrom = '2020-01-01';
    const customTo = '2020-01-31';
    expect(cardRange({}, 'weekly', customFrom, customTo)).toEqual(
      rangeForGranularity('weekly', customFrom, customTo),
    );
  });

  it('keeps the user-picked custom window even when the card remaps custom', () => {
    // The heatmap remaps custom → weekly for bucketing, but its range must
    // stay the chosen dates, not collapse to the current Monday week.
    const card = { granularityMap: { custom: 'weekly' } as const };
    expect(cardRange(card, 'custom', '2020-01-01', '2020-01-31')).toEqual({
      from: '2020-01-01',
      to: '2020-01-31',
    });
  });
});

describe('monthCalendarGrid — monthly heatmap calendar layout', () => {
  it('day 1 does not always start on the first cell', () => {
    const grid = monthCalendarGrid('2026-07-10');
    expect(grid.leading).toBeGreaterThanOrEqual(0);
    expect(grid.leading).toBeLessThanOrEqual(6);
  });

  it('derives the day count from the queried month', () => {
    expect(monthCalendarGrid('2026-07-10').days).toBe(31); // July
    expect(monthCalendarGrid('2026-02-10').days).toBe(28); // Feb (non-leap)
    expect(monthCalendarGrid('2026-04-10').days).toBe(30); // April
  });

  it('pads with leading/trailing empties so weeks are complete', () => {
    const grid = monthCalendarGrid('2026-07-10');
    expect((grid.leading + grid.days + grid.trailing) % 7).toBe(0);
    expect(grid.trailing).toBeGreaterThanOrEqual(0);
    expect(grid.trailing).toBeLessThan(7);
  });
});

describe('smartScale — expanded card fills the available area', () => {
  it('returns 1 when layout has not been measured', () => {
    expect(smartScale({ w: 800, h: 600 }, { w: 0, h: 0 })).toBe(1);
    expect(smartScale({ w: 0, h: 0 }, { w: 200, h: 150 })).toBe(1);
  });

  it('fills both axes when content is smaller than the area', () => {
    expect(smartScale({ w: 800, h: 600 }, { w: 200, h: 150 })).toBe(4);
  });

  it('is constrained by the narrower axis', () => {
    // Width allows 2x, height allows 6x → width wins
    expect(smartScale({ w: 800, h: 600 }, { w: 400, h: 100 })).toBe(2);
    // Height allows 1.5x, width allows 8x → height wins
    expect(smartScale({ w: 800, h: 600 }, { w: 100, h: 400 })).toBe(1.5);
  });

  it('caps the scale at the max to avoid absurd blow-ups', () => {
    expect(smartScale({ w: 1000, h: 1000 }, { w: 100, h: 100 }, 4)).toBe(4);
    expect(smartScale({ w: 1000, h: 1000 }, { w: 100, h: 100 }, 2)).toBe(2);
  });

  it('never shrinks content below 1x', () => {
    expect(smartScale({ w: 400, h: 300 }, { w: 2000, h: 1500 })).toBe(1);
  });
});

describe('AnalyticsScreen card error surface', () => {
  // Range-anchored row: the loaders zero-fill against the queried window,
  // so a fixed date would be dropped (rendering a $0 card) once the weekly
  // window widens to the current week.
  const ORIGINAL_WEEKLY = (startDate?: string) => [{
    week_start: startDate ?? '2026-07-21',
    total_minor: 8500000,
    currency: 'USD',
    sale_count: 65,
    cogs_minor: 3400000,
    gross_profit_minor: 5100000,
    gross_margin_percent: 60,
  }];

  /** Fire any pending recalculation timer and flush the IPC microtasks. */
  const flushRecalc = async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
  };

  beforeEach(() => {
    localStorage.clear();
    clearAnalyticsCache();
    mockGetWeeklyRevenue.mockReset();
    mockGetWeeklyRevenue.mockImplementation((startDate?: string) =>
      Promise.resolve(ORIGINAL_WEEKLY(startDate)),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a stable error card when an IPC query fails — no retry loop on re-render', async () => {
    vi.useFakeTimers();
    mockGetWeeklyRevenue.mockRejectedValue(new Error('backend boom'));

    const { rerender } = renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);
    await flushRecalc();

    // Revenue + AOV share getWeeklyRevenue (daily remaps to weekly), so
    // both surface the localized user-safe copy (ERR-05) — never the raw
    // backend message.
    expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Couldn't load this chart/).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/backend boom/)).toBeNull();

    // The failure map suppresses re-invocation: re-render (e.g. a zoom
    // change or unrelated state update) must NOT refetch — this is the
    // infinite-retry-loop fix.
    const callsAfterFirstRender = mockGetWeeklyRevenue.mock.calls.length;
    expect(callsAfterFirstRender).toBeGreaterThan(0);
    await act(async () => {
      // Rerender with the same Fluent wrapper — a bare `rerender(<Screen />)`
      // would replace the root without the LocalizationProvider.
      rerender(withFluent(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl));
    });
    expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(1);
    expect(mockGetWeeklyRevenue.mock.calls.length).toBe(callsAfterFirstRender);
  });

  it('recovers after refresh clears the recorded failure', async () => {
    vi.useFakeTimers();
    mockGetWeeklyRevenue.mockRejectedValue(new Error('backend boom'));

    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl, reportsFtl);
    await flushRecalc();
    expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(1);

    // Backend is healthy again — refresh wipes cache + failures and retries.
    mockGetWeeklyRevenue.mockImplementation((startDate?: string) =>
      Promise.resolve(ORIGINAL_WEEKLY(startDate)),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Refresh data' }));
    await flushRecalc();

    // The revenue KPI (8,500,000 minor = $85,000 → compact '$85K' or
    // '$85.0K'). Node/ICU versions differ on whether compact notation
    // keeps the trailing '.0' (Node 22 shows '$85.0K', Node 24 '$85K'),
    // so match either rendering. Anchored so the KPI total itself is
    // matched, not the 'Peak: … · $85K' / 'Low: …' insight lines.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mockGetWeeklyRevenue.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/^\$85(?:\.0)?K$/)).toBeTruthy();
  });
});

describe('AnalyticsScreen currency locale', () => {
  const flushRecalc = async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
  };

  beforeEach(() => {
    localStorage.clear();
    clearAnalyticsCache();
    // The error-surface describe resets the weekly mock to a rejected row;
    // restore the range-anchored implementation (zero-fill drops rows that
    // fall outside the queried range, so a leaked fixed date renders $0).
    mockGetWeeklyRevenue.mockReset();
    mockGetWeeklyRevenue.mockImplementation((startDate?: string) =>
      Promise.resolve([{
        week_start: startDate ?? '2026-07-21',
        total_minor: 8500000,
        currency: 'USD',
        sale_count: 65,
        cogs_minor: 3400000,
        gross_profit_minor: 5100000,
        gross_margin_percent: 60,
      }]),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats currency with the active Fluent locale, not hardcoded English', async () => {
    vi.useFakeTimers();
    // Indonesian Fluent bundle → Intl.NumberFormat('id', …).
    render(withFluentLocale('id', <AnalyticsScreen />, analyticsIdFtl, reportsIdFtl));
    await flushRecalc();

    // Revenue KPI + peak insight: 8,500,000 minor = US$85,000 → compact
    // Indonesian form (US$85 rb) — proves the locale is not hardcoded.
    expect(screen.getAllByText(/US\$85/).length).toBeGreaterThan(0);

    // Card container accessible names are localized too (not the English
    // `card.title` fallback) — the heatmap card's group reads "Peta Panas".
    expect(screen.getByRole('group', { name: 'Peta Panas' })).toBeTruthy();
  });
});

describe('hasGrantedPermission (backend has_permission mirror)', () => {
  it('matches exact keys, the global wildcard, and domain wildcards', () => {
    expect(hasGrantedPermission(['analytics:view'], 'analytics:view')).toBe(true);
    expect(hasGrantedPermission(['*'], 'analytics:view')).toBe(true);
    expect(hasGrantedPermission(['analytics:*'], 'analytics:view')).toBe(true);
    expect(hasGrantedPermission(['sales:*'], 'analytics:view')).toBe(false);
    expect(hasGrantedPermission(['analytics:view'], 'sales:create')).toBe(false);
    expect(hasGrantedPermission(undefined, 'analytics:view')).toBe(false);
  });
});

describe('C2.2 analytics tab lock (Plus → Pro)', () => {
  afterEach(() => {
    vi.mocked(useSubscription).mockImplementation(() => ({
      caps: null,
      state: 'active',
      loading: false,
      refresh: vi.fn(),
    }));
  });

  it('locks the screen with a blurred sample chart + upgrade CTA below Pro', async () => {
    vi.mocked(useSubscription).mockReturnValue({
      caps: makeSubscriptionCaps({ tier: 'plus', supportsAnalytics: false }),
      state: 'active',
      loading: false,
      refresh: vi.fn(),
    });
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('Analytics is a Pro feature')).toBeInTheDocument();
    });
    expect(screen.getByText('Upgrade to Pro')).toBeInTheDocument();
    // The live card grid must not render behind the lock.
    expect(screen.queryByTestId('echarts-mock')).not.toBeInTheDocument();
  });

  it('renders the live dashboard when the tier supports analytics', async () => {
    vi.mocked(useSubscription).mockReturnValue({
      caps: makeSubscriptionCaps({ tier: 'pro', supportsAnalytics: true }),
      state: 'active',
      loading: false,
      refresh: vi.fn(),
    });
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.queryByText('Analytics is a Pro feature')).not.toBeInTheDocument();
    });
  });
});

describe('§B administrative gate (todo-global-saas-1.md)', () => {
  afterEach(() => {
    vi.mocked(useSubscription).mockImplementation(() => ({
      caps: null,
      state: 'active',
      loading: false,
      refresh: vi.fn(),
    }));
  });

  it('locks the screen while the subscription is in grace — even for a Pro tier', async () => {
    // §B: administrative features lock AT expiresAt; the tier entitlements
    // survive grace for OPERATIONAL features only. An expired Premium/Pro
    // subscription gets the admin lock, not the live dashboard.
    vi.mocked(useSubscription).mockReturnValue({
      caps: makeSubscriptionCaps({ tier: 'pro', supportsAnalytics: true }),
      state: 'grace',
      loading: false,
      refresh: vi.fn(),
    });
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, subscriptionFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('Administrative features locked')).toBeInTheDocument();
    });
    // The admin lock replaces the content entirely — no live charts.
    expect(screen.queryByTestId('echarts-mock')).not.toBeInTheDocument();
  });

  it('locks fail-closed when subscription data is unavailable', async () => {
    vi.mocked(useSubscription).mockReturnValue({
      caps: makeSubscriptionCaps({ tier: 'pro', supportsAnalytics: true }),
      state: 'unavailable',
      loading: false,
      refresh: vi.fn(),
    });
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, subscriptionFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('Administrative features locked')).toBeInTheDocument();
    });
  });

  it('prefers the admin lock over the tier upsell when both would apply', async () => {
    // Expired Free-tier: the tier gate would say "upgrade to Pro", but §B
    // says the admin lock is the truthful message — the tier is not the
    // problem, the subscription state is.
    vi.mocked(useSubscription).mockReturnValue({
      caps: makeSubscriptionCaps({ tier: 'free', supportsAnalytics: false }),
      state: 'expired',
      loading: false,
      refresh: vi.fn(),
    });
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, subscriptionFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('Administrative features locked')).toBeInTheDocument();
    });
    expect(screen.queryByText('Analytics is a Pro feature')).not.toBeInTheDocument();
  });

  it('renders the live dashboard while active (no admin lock)', async () => {
    vi.mocked(useSubscription).mockReturnValue({
      caps: makeSubscriptionCaps({ tier: 'pro', supportsAnalytics: true }),
      state: 'active',
      loading: false,
      refresh: vi.fn(),
    });
    renderWithFluentSync(<AnalyticsScreen />, analyticsFtl, subscriptionFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.queryByText('Administrative features locked')).not.toBeInTheDocument();
    });
  });
});
