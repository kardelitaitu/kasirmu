import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { ReactLocalization, LocalizationProvider } from '@fluent/react';
import DashboardScreen from '@/features/reports/DashboardScreen';
import {
  assertCaseDiscriminates,
  discriminatingStoreZone,
  expectedStoreDay,
} from '@/__tests__/test-utils/storeZoneCase';

// Mock echarts-for-react — jsdom has no Canvas
vi.mock('echarts-for-react/lib/core', () => ({
  default: (props: Record<string, unknown>) => {
    // Drop the chart-only props so React doesn't warn about unknown DOM
    // attributes (notMerge, option, …) on the placeholder div.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { option, notMerge, echarts, style, ...rest } = props;
    return React.createElement('div', { ...rest, 'data-testid': 'echarts-mock', style });
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

// ── FTL bundles ────────────────────────────────────────────────────────
const sharedFtl = `
error-occurred = An error occurred
spinner-label = Loading dashboard
`;

// dashboard keys only exist in id locale, so fallback children are used
const reportsFtl = `
dashboard-region-aria = Dashboard
dashboard-stock-alerts-aria = Low stock alerts
dashboard-stock-below-threshold = { $qty } left (below { $threshold })
dashboard-delta-new = New
dashboard-popularity-trend = Popularity Trend
dashboard-popularity-trend-aria = Popularity of the top category over the last 7 days
dashboard-popularity-trend-empty = No popularity data yet
sales-report-category-popularity-uncategorized = Uncategorized
`;

// ── mock API functions ─────────────────────────────────────────────────
const mockGetDailyRevenue = vi.fn();
const mockGetWeeklyRevenue = vi.fn();
const mockGetMonthlyRevenue = vi.fn();
const mockGetTopProducts = vi.fn();
const mockGetLowStockAlerts = vi.fn();
const mockGetCategoryBreakdown = vi.fn();
const mockGetHourlyHeatmap = vi.fn();
const mockGetPrimaryLocationScoped = vi.fn();

// R36-05: DashboardScreen now fetches the primary store to anchor its default
// date range to the store's zone. Without this mock the call hits real invoke,
// rejects, and the component silently falls back to UTC -- so the store-zone
// path would look green while never being exercised.
vi.mock('@/api/locations', () => ({
  getPrimaryLocationScoped: (...args: unknown[]) => mockGetPrimaryLocationScoped(...args),
}));

vi.mock('@/api/reports', () => ({
  getDailyRevenue: (...args: unknown[]) => mockGetDailyRevenue(...args),
  getWeeklyRevenue: (...args: unknown[]) => mockGetWeeklyRevenue(...args),
  getMonthlyRevenue: (...args: unknown[]) => mockGetMonthlyRevenue(...args),
  getTopProducts: (...args: unknown[]) => mockGetTopProducts(...args),
  getLowStockAlerts: (...args: unknown[]) => mockGetLowStockAlerts(...args),
  getCategoryBreakdown: (...args: unknown[]) => mockGetCategoryBreakdown(...args),
  getHourlyHeatmap: (...args: unknown[]) => mockGetHourlyHeatmap(...args),
}));

vi.mock('@/components/Card', () => ({
  Card: ({ children, className, shadow }: Record<string, unknown>) => (
    <div className={className as string} data-shadow={shadow as string}>{children as React.ReactNode}</div>
  ),
}));

vi.mock('@/components/Spinner', () => ({
  Spinner: (props: Record<string, unknown>) => <div data-testid="spinner" aria-label={props['aria-label'] as string} />,
}));

vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ currency: 'USD', setCurrency: vi.fn(), loading: false }),
}));

vi.mock('@/features/reports/DashboardScreen.css', () => ({}));

// ── helpers ────────────────────────────────────────────────────────────
// `useIsolating: false` matches the production loader (i18n/index.ts), so
// interpolated numbers render without U+2068/U+2069 bidi-isolating markers
// that would otherwise break `getByText` assertions.
const bundle = new FluentBundle('en', { useIsolating: false });
bundle.addResource(new FluentResource(sharedFtl));
bundle.addResource(new FluentResource(reportsFtl));
const l10n = new ReactLocalization([bundle]);

function buildRevenueRow(overrides: Partial<{ date: string; total_minor: number; currency: string; sale_count: number; cogs_minor: number; gross_profit_minor: number; gross_margin_percent: number }> = {}) {
  const total_minor = overrides.total_minor ?? 150000;
  const cogs_minor = overrides.cogs_minor ?? 60000;
  return {
    date: overrides.date ?? '2026-07-07',
    total_minor,
    currency: overrides.currency ?? 'USD',
    sale_count: overrides.sale_count ?? 12,
    cogs_minor,
    gross_profit_minor: overrides.gross_profit_minor ?? total_minor - cogs_minor,
    gross_margin_percent: overrides.gross_margin_percent ?? 60,
  };
}

function buildTopProductRow(overrides: Partial<{ product_id: string; sku: string; name: string; total_qty: number; total_minor: number; cogs_minor: number; gross_profit_minor: number; gross_margin_percent: number }> = {}) {
  return {
    product_id: overrides.product_id ?? 'prod-1',
    sku: overrides.sku ?? 'SKU001',
    name: overrides.name ?? 'Espresso',
    total_qty: overrides.total_qty ?? 45,
    total_minor: overrides.total_minor ?? 90000,
    cogs_minor: overrides.cogs_minor ?? 30000,
    gross_profit_minor: overrides.gross_profit_minor ?? 60000,
    gross_margin_percent: overrides.gross_margin_percent ?? 66.7,
  };
}

function buildLowStockAlert(overrides: Partial<{ product_id: string; sku: string; name: string; current_qty: number; threshold: number; currency: string; price_minor: number; cost_minor: number }> = {}) {
  return {
    product_id: overrides.product_id ?? 'prod-lo',
    sku: overrides.sku ?? 'SKU-LOW',
    name: overrides.name ?? 'Milk',
    current_qty: overrides.current_qty ?? 3,
    threshold: overrides.threshold ?? 10,
    currency: overrides.currency ?? 'USD',
    price_minor: overrides.price_minor ?? 1500,
    cost_minor: overrides.cost_minor ?? 900,
  };
}

function renderScreen() {
  return render(
    <LocalizationProvider l10n={l10n}>
      <DashboardScreen />
    </LocalizationProvider>,
  );
}

// ── tests ──────────────────────────────────────────────────────────────
describe('DashboardScreen', () => {
  beforeEach(() => {
    // Default for loading tests: never-resolving promises
    const pending = () => new Promise(() => {});
    mockGetDailyRevenue.mockImplementation(pending);
    mockGetWeeklyRevenue.mockImplementation(pending);
    mockGetMonthlyRevenue.mockImplementation(pending);
    mockGetTopProducts.mockImplementation(pending);
    mockGetLowStockAlerts.mockImplementation(pending);
    mockGetCategoryBreakdown.mockImplementation(pending);
    mockGetHourlyHeatmap.mockImplementation(pending);
    // Default: a store profile with no timezone configured, so the range lands
    // on the UTC fallback and the pre-existing assertions stay meaningful.
    // Tests that care about the store anchor override this explicitly.
    mockGetPrimaryLocationScoped.mockResolvedValue({ id: 'store-a', name: 'Store A', timezone: null });
  });

  /** Resolve all 7 endpoints with empty/default data to get past loading */
  function resolveAllWithDefaults() {
    mockGetDailyRevenue.mockResolvedValue([]);
    mockGetWeeklyRevenue.mockResolvedValue([]);
    mockGetMonthlyRevenue.mockResolvedValue([]);
    mockGetTopProducts.mockResolvedValue([]);
    mockGetLowStockAlerts.mockResolvedValue([]);
    mockGetCategoryBreakdown.mockResolvedValue([]);
    mockGetHourlyHeatmap.mockResolvedValue([]);
  }

  // ── Loading ────────────────────────────────────────────────────────
  it('shows loading spinner initially', () => {
    renderScreen();
    expect(screen.getByTestId('spinner')).toBeTruthy();
    expect(screen.getByTestId('spinner').getAttribute('aria-label')).toBe('Loading dashboard');
  });

  // ── Error ──────────────────────────────────────────────────────────
  it('shows error message when all API calls fail', async () => {
    const error = new Error('Server offline');
    mockGetDailyRevenue.mockRejectedValue(error);
    mockGetWeeklyRevenue.mockRejectedValue(error);
    mockGetMonthlyRevenue.mockRejectedValue(error);
    mockGetTopProducts.mockRejectedValue(error);
    mockGetLowStockAlerts.mockRejectedValue(error);
    mockGetCategoryBreakdown.mockRejectedValue(error);
    mockGetHourlyHeatmap.mockRejectedValue(error);
    renderScreen();
    // ERR-05: raw backend text must never leak — the screen renders the
    // localized user-safe message instead of `err.message`.
    await waitFor(() => {
      expect(screen.getByText('Something went wrong. Please try again.')).toBeTruthy();
    });
  });

  // ── Title ──────────────────────────────────────────────────────────
  it('renders the Dashboard title', async () => {
    resolveAllWithDefaults();
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeTruthy();
    });
  });

  // ── KPI cards ──────────────────────────────────────────────────────
  it('shows KPI labels: Revenue, Gross Profit, Orders, Top Product', async () => {
    resolveAllWithDefaults();
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Revenue')).toBeTruthy();
      expect(screen.getByText('Gross Profit')).toBeTruthy();
      expect(screen.getByText('Orders')).toBeTruthy();
      expect(screen.getByText('Top Product')).toBeTruthy();
    });
  });

  it('shows gross profit KPI from the daily revenue rows', async () => {
    const revenue = [
      buildRevenueRow({ total_minor: 250000, cogs_minor: 100000, sale_count: 5 }),
      buildRevenueRow({ total_minor: 100000, cogs_minor: 40000, sale_count: 3 }),
    ];
    mockGetDailyRevenue.mockResolvedValue(revenue);
    resolveAllWithDefaults();
    mockGetDailyRevenue.mockResolvedValue(revenue);
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('$2,100.00')).toBeTruthy();
    });
  });

  it('renders a negative gross profit KPI in the danger color', async () => {
    const revenue = [buildRevenueRow({ total_minor: 100000, cogs_minor: 130000, sale_count: 5 })];
    resolveAllWithDefaults();
    mockGetDailyRevenue.mockResolvedValue(revenue);
    renderScreen();
    await waitFor(() => {
      const value = screen.getByText('-$300.00');
      expect(value.className).toContain('dashboard-kpi-negative');
    });
  });

  it('displays formatted revenue and order count in KPIs', async () => {
    const revenue = [buildRevenueRow({ total_minor: 250000, sale_count: 5 })];
    resolveAllWithDefaults();
    mockGetDailyRevenue.mockResolvedValue(revenue);
    renderScreen();
    await waitFor(() => {
      const amounts = screen.getAllByText('$2,500.00');
      expect(amounts.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('5')).toBeTruthy();
    });
  });

  // ── REP-02: Dashboard KPI never sums across currencies ──────────────
  it('shows per-currency revenue KPI when the period spans multiple currencies', async () => {
    // Backend groups by currency; two-currency period arrives as two rows.
    // 10000 USD minor = $100.00 + 500000 IDR minor = Rp 500,000
    // The bug would collapse this to $5,100.00 (510000 minor formatted as USD).
    const revenue = [
      buildRevenueRow({ date: '2026-07-01', total_minor: 10000, currency: 'USD', sale_count: 1 }),
      buildRevenueRow({ date: '2026-07-01', total_minor: 500000, currency: 'IDR', sale_count: 2 }),
    ];
    resolveAllWithDefaults();
    mockGetDailyRevenue.mockResolvedValue(revenue);
    renderScreen();
    await waitFor(() => {
      // Each currency's total should render in its own currency...
      expect(screen.getByText((content) => content.includes('$100.00'))).toBeTruthy();
      expect(screen.getByText((content) => content.includes('IDR 500,000'))).toBeTruthy();
      // ...and the collapsed single total must NOT appear.
      expect(screen.queryByText((content) => content.includes('$5,100.00'))).toBeNull();
    });
  });

  it('shows top product name or dash when none', async () => {
    resolveAllWithDefaults();
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('-')).toBeTruthy();
    });
  });

  it('shows top product name when available', async () => {
    resolveAllWithDefaults();
    mockGetTopProducts.mockResolvedValue([buildTopProductRow({ name: 'Latte' })]);
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Latte')).toBeTruthy();
    });
  });

  // ── Revenue Trend chart heading ────────────────────────────────────
  it('renders "Revenue Trend" section heading', async () => {
    resolveAllWithDefaults();
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Revenue Trend')).toBeTruthy();
    });
  });

  // ── Category Breakdown chart heading ──────────────────────────────
  it('renders "Category Breakdown" section heading', async () => {
    resolveAllWithDefaults();
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Category Breakdown')).toBeTruthy();
    });
  });

  // ── Sales Heatmap chart heading ────────────────────────────────────
  it('renders "Sales Heatmap" section heading', async () => {
    resolveAllWithDefaults();
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Sales Heatmap')).toBeTruthy();
    });
  });

  // ── Top 10 Products chart heading ──────────────────────────────────
  it('renders "Top 10 Products" section heading', async () => {
    resolveAllWithDefaults();
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Top 10 Products')).toBeTruthy();
    });
  });

  // ── Granularity toggle ────────────────────────────────────────────
  it('renders Daily/Weekly/Monthly granularity toggle', async () => {
    resolveAllWithDefaults();
    renderScreen();
    await waitFor(() => {
      // The granularity buttons have role="radio"
      const radios = screen.getAllByRole('radio');
      expect(radios.length).toBe(3);
      expect(radios[0]!.textContent?.toLowerCase()).toContain('daily');
      expect(radios[1]!.textContent?.toLowerCase()).toContain('weekly');
      expect(radios[2]!.textContent?.toLowerCase()).toContain('monthly');
    });
  });

  // ── Low stock alerts ───────────────────────────────────────────────
  it('renders "Low Stock Alerts" section heading', async () => {
    resolveAllWithDefaults();
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Low Stock Alerts')).toBeTruthy();
    });
  });

  it('shows healthy stock message when no alerts', async () => {
    resolveAllWithDefaults();
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('All stock levels are healthy.')).toBeTruthy();
    });
  });

  it('renders low stock items with name, quantity, and threshold context', async () => {
    const alerts = [
      buildLowStockAlert({ name: 'Milk', current_qty: 2 }),
      buildLowStockAlert({ product_id: 'prod-sugar', name: 'Sugar', current_qty: 5 }),
    ];
    resolveAllWithDefaults();
    mockGetLowStockAlerts.mockResolvedValue(alerts);
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Milk')).toBeTruthy();
      expect(screen.getByText('2 left (below 10)')).toBeTruthy();
    });
  });

  it('low stock list has aria-label', async () => {
    resolveAllWithDefaults();
    mockGetLowStockAlerts.mockResolvedValue([buildLowStockAlert()]);
    renderScreen();
    await waitFor(() => {
      const list = screen.getByRole('list', { name: 'Low stock alerts' });
      expect(list).toBeTruthy();
    });
  });

  // ── ARIA ───────────────────────────────────────────────────────────
  it('has role="region" with aria-label="Dashboard" on container', async () => {
    resolveAllWithDefaults();
    renderScreen();
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Dashboard' })).toBeTruthy();
    });
  });

  // ── Delta edge case (no previous period) ─────────────────────────
  it('shows a localized "New" delta when there is no previous period', async () => {
    const revenue = [buildRevenueRow({ total_minor: 250000, sale_count: 5 })];
    resolveAllWithDefaults();
    // First getDailyRevenue call is the current range; second is the previous
    // period (empty → prev totals are zero).
    mockGetDailyRevenue.mockResolvedValueOnce(revenue);
    mockGetDailyRevenue.mockResolvedValueOnce([]);
    renderScreen();
    await waitFor(() => {
      expect(screen.getAllByText('New').length).toBeGreaterThan(0);
    });
  });

  // ── Lazy granularity loading ─────────────────────────────────────
  it('lazy-loads the weekly/monthly series only when that granularity is selected', async () => {
    resolveAllWithDefaults();
    renderScreen();
    await waitFor(() => expect(screen.getByText('Revenue Trend')).toBeTruthy());

    // The default daily view must not fetch the weekly/monthly aggregates.
    expect(mockGetWeeklyRevenue).not.toHaveBeenCalled();
    expect(mockGetMonthlyRevenue).not.toHaveBeenCalled();

    const radios = screen.getAllByRole('radio');
    fireEvent.click(radios[1]!); // Weekly
    await waitFor(() => expect(mockGetWeeklyRevenue).toHaveBeenCalledTimes(1));
    expect(mockGetMonthlyRevenue).not.toHaveBeenCalled();

    fireEvent.click(radios[2]!); // Monthly
    await waitFor(() => expect(mockGetMonthlyRevenue).toHaveBeenCalledTimes(1));
  });

  // ── No full-screen spinner on reload ─────────────────────────────
  it('keeps the dashboard visible (no full-screen spinner) while reloading', async () => {
    resolveAllWithDefaults();
    renderScreen();
    await waitFor(() => expect(screen.getByText('Revenue Trend')).toBeTruthy());

    // Hold the next core load in flight to observe the non-blocking state.
    mockGetDailyRevenue.mockImplementation(() => new Promise(() => {}));

    fireEvent.change(screen.getByLabelText('dashboard-filter-from'), { target: { value: '2026-06-01' } });
    fireEvent.click(screen.getByText('Apply'));

    // The dashboard must stay rendered with a lightweight status — never
    // replaced by the full-screen spinner.
    await waitFor(() => expect(screen.getByText('Refreshing…')).toBeTruthy());
    expect(screen.getByText('Revenue Trend')).toBeTruthy();
    expect(screen.queryByTestId('spinner')).toBeNull();
  });

  // ── R36-05: the default range anchors to the STORE, not the host ────
  // Expected values are computed with explicit UTC arithmetic here rather than
  // by calling isoToday/isoDaysAgo, so the assertion is independent of the code
  // under test. scripts/check-tz-invariance.py runs this file under four host
  // zones; if the range ever depended on the device calendar these would diverge.
  it('anchors the default range to the primary store timezone (R36-05)', async () => {
    resolveAllWithDefaults();
    // The offset is chosen so its calendar day provably differs from UTC at the
    // moment the test runs -- a hardcoded +14:00 is vacuous for ten hours a day.
    const zone = discriminatingStoreZone();
    assertCaseDiscriminates(zone);
    mockGetPrimaryLocationScoped.mockResolvedValue({ id: 'store-a', name: 'Store A', timezone: zone.offset });

    renderScreen();
    await waitFor(() => expect(screen.getByText('Revenue Trend')).toBeTruthy());

    const fromInput = screen.getByLabelText('dashboard-filter-from') as HTMLInputElement;
    const toInput = screen.getByLabelText('dashboard-filter-to') as HTMLInputElement;

    await waitFor(() => {
      expect(toInput.value).toBe(expectedStoreDay(zone, 0));
      expect(fromInput.value).toBe(expectedStoreDay(zone, 29));
    });
    // The store must actually have been consulted -- otherwise storeTz stayed
    // null and these values would be the UTC fallback.
    expect(mockGetPrimaryLocationScoped).toHaveBeenCalled();
  });

  it('does not clobber a range the operator already edited', async () => {
    resolveAllWithDefaults();
    const zone = discriminatingStoreZone();
    // Hold the store response open so the edit provably precedes it. Resolving
    // eagerly races: the re-seed refires the fetch effect and the loading state
    // can unmount the inputs mid-assertion.
    let resolveStore: (v: unknown) => void = () => {};
    mockGetPrimaryLocationScoped.mockReturnValue(new Promise((r) => { resolveStore = r; }));

    renderScreen();
    await waitFor(() => expect(screen.getByText('Revenue Trend')).toBeTruthy());

    const fromInput = screen.getByLabelText('dashboard-filter-from') as HTMLInputElement;
    fireEvent.change(fromInput, { target: { value: '2026-01-05' } });

    resolveStore({ id: 'store-a', name: 'Store A', timezone: zone.offset });
    await waitFor(() => {
      const input = screen.getByLabelText('dashboard-filter-from') as HTMLInputElement;
      expect(input.value).toBe('2026-01-05');
    });
  });
});
