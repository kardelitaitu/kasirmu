// ── SalesReportScreen tests ────────────────────────────────────────
// Covers loading, error, daily/weekly/monthly view modes, revenue bar
// chart, category pie, top products table, hourly heatmap, date filter,
// CSV export, print report, empty states, and ARIA accessibility.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { ReactLocalization, LocalizationProvider } from '@fluent/react';
import userEvent from '@testing-library/user-event';
import SalesReportScreen from '@/features/reports/SalesReportScreen';
import { HARNESS_SESSION_TOKEN } from '@/__tests__/test-utils/harnessDefaults';
import {
  assertCaseDiscriminates,
  discriminatingStoreZone,
  expectedStoreDay,
} from '@/__tests__/test-utils/storeZoneCase';

// ── FTL bundles ──────────────────────────────────────────────────
const sharedFtl = `
error-occurred = An error occurred
no-results = No results
print = Print
`;
const reportsFtl = `
sales-report-title = Sales Report
sales-report-start-date = Start
sales-report-end-date = End
sales-report-daily = Daily
sales-report-weekly = Weekly
sales-report-monthly = Monthly
sales-report-export-csv = Export CSV
sales-report-revenue-chart = Revenue
sales-report-revenue-label = Revenue (minor units)
sales-report-total-revenue = Total
sales-report-total-orders = Orders
sales-report-total-gross-profit = Gross Profit
sales-report-total-refunds = Refunds
sales-report-total-net-revenue = Net Revenue
sales-report-category-breakdown = By Category
sales-report-top-products = Top Products
sales-report-rank = #
top-products-name = Name
top-products-quantity = Qty
top-products-revenue = Revenue
top-products-gross-profit = Gross Profit
top-products-margin = Margin
heatmap-title = Busiest Hours
heatmap-no-data = No data
sales-report-hourly-heatmap-aria = Hourly heatmap

# Sales Report — a11y labels
sales-report-region-aria = Sales Report
day-sunday = Sun
day-monday = Mon
day-tuesday = Tue
day-wednesday = Wed
day-thursday = Thu
day-friday = Fri
day-saturday = Sat
sales-report-start-aria = Start date
sales-report-end-aria = End date
sales-report-view-aria = View mode
sales-report-compare-off-aria = Disable period comparison
sales-report-compare-on-aria = Compare to previous period
sales-report-print-aria = Print report
sales-report-export-aria = Export CSV
sales-report-heatmap-aria = Hourly heatmap
sales-report-top-rank-aria = Rank top products by
sales-report-top-rank-revenue-aria = Rank by revenue
sales-report-top-rank-profit-aria = Rank by gross profit
sales-report-category-popularity = Category Popularity
sales-report-category-popularity-category = Category
sales-report-category-popularity-products = Products
sales-report-category-popularity-mean = Popularity
sales-report-category-popularity-mean-tip = Category average vs. catalog average
sales-report-category-popularity-top = Top Sellers
sales-report-category-popularity-uncategorized = Uncategorized
sales-report-popularity-trend = Popularity Trend
sales-report-demand-forecast = Demand Forecast
sales-report-demand-forecast-category = Category
sales-report-demand-forecast-avg = Avg / period
sales-report-demand-forecast-trend = Trend
sales-report-demand-forecast-next = Next period
`;

// ── Mock recharts ─────────────────────────────────────────────────
vi.mock('recharts', () => ({
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: (props: { dataKey: string; 'aria-label'?: string }) => <div data-testid="bar" data-key={props.dataKey} aria-label={props['aria-label']} />,
  LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="line-chart">{children}</div>,
  Line: (props: { dataKey?: string }) => <div data-testid="line" data-key={props.dataKey} />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  Tooltip: () => <div data-testid="tooltip" />,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="responsive-container">{children}</div>,
  PieChart: ({ children }: { children: React.ReactNode }) => <div data-testid="pie-chart">{children}</div>,
  Pie: ({ children }: { children: React.ReactNode }) => <div data-testid="pie">{children}</div>,
  Cell: () => <div data-testid="pie-cell" />,
  Legend: () => <div data-testid="legend" />
}));

// ── Mock API functions ────────────────────────────────────────────
const mockGetDailyRevenue = vi.fn();
const mockGetWeeklyRevenue = vi.fn();
const mockGetMonthlyRevenue = vi.fn();
const mockGetTopProducts = vi.fn();
const mockGetHourlyHeatmap = vi.fn();
const mockGetCategoryBreakdown = vi.fn();
const mockGetCategoryPopularity = vi.fn();
const mockGetCategoryPopularityTrend = vi.fn();
const mockGetCategoryForecast = vi.fn();
const mockPrintSalesReceipt = vi.fn();

vi.mock('@/api/reports', () => ({
  getDailyRevenue: (...args: unknown[]) => mockGetDailyRevenue(...args),
  getWeeklyRevenue: (...args: unknown[]) => mockGetWeeklyRevenue(...args),
  getMonthlyRevenue: (...args: unknown[]) => mockGetMonthlyRevenue(...args),
  getTopProducts: (...args: unknown[]) => mockGetTopProducts(...args),
  getHourlyHeatmap: (...args: unknown[]) => mockGetHourlyHeatmap(...args),
  getCategoryBreakdown: (...args: unknown[]) => mockGetCategoryBreakdown(...args),
  getCategoryPopularity: (...args: unknown[]) => mockGetCategoryPopularity(...args),
  getCategoryPopularityTrend: (...args: unknown[]) => mockGetCategoryPopularityTrend(...args),
  getCategoryForecast: (...args: unknown[]) => mockGetCategoryForecast(...args),
}));

vi.mock('@/api/sales', () => ({
  printSalesReceipt: (_sessionToken: string, ...args: unknown[]) => mockPrintSalesReceipt(...args),
}));

// R36-06: SalesReportScreen now fetches the primary store to anchor its default
// window. Without this mock the call hits real invoke, rejects, and is swallowed
// by the .catch -- the store-zone path would stay untested while the suite stayed
// green (exactly the trap R36-05 hit).
const mockGetPrimaryLocationScoped = vi.fn();
vi.mock('@/api/locations', () => ({
  getPrimaryLocationScoped: (...args: unknown[]) => mockGetPrimaryLocationScoped(...args),
}));

vi.mock('@/components/Card', () => ({
  Card: ({ children, className, shadow }: Record<string, unknown>) => (
    <div className={className as string} data-shadow={shadow as string}>{children as React.ReactNode}</div>
  ),
}));

vi.mock('@/components/Button', () => ({
  Button: ({ children, onClick, variant, 'aria-label': ariaLabel }: Record<string, unknown>) => (
    <button onClick={onClick as () => void} data-variant={variant as string} aria-label={ariaLabel as string}>
      {children as React.ReactNode}
    </button>
  ),
}));

vi.mock('@/features/reports/SalesReportScreen.css', () => ({}));

// ── Test helpers ──────────────────────────────────────────────
function buildDailyRevenue(overrides: Partial<{ date: string; total_minor: number; currency: string; sale_count: number; cogs_minor: number; gross_profit_minor: number; gross_margin_percent: number; refund_minor: number; net_revenue_minor: number }> = {}) {
  const total_minor = overrides.total_minor ?? 150000;
  const cogs_minor = overrides.cogs_minor ?? 60000;
  const refund_minor = overrides.refund_minor ?? 0;
  return {
    date: overrides.date ?? '2026-07-01',
    total_minor,
    currency: overrides.currency ?? 'USD',
    sale_count: overrides.sale_count ?? 12,
    cogs_minor,
    gross_profit_minor: overrides.gross_profit_minor ?? total_minor - cogs_minor,
    gross_margin_percent: overrides.gross_margin_percent ?? 60,
    refund_minor,
    net_revenue_minor: overrides.net_revenue_minor ?? total_minor - refund_minor,
  };
}

function buildWeeklyRevenue(overrides: Partial<{ week_start: string; total_minor: number; currency: string; sale_count: number; cogs_minor: number; gross_profit_minor: number; gross_margin_percent: number }> = {}) {
  const total_minor = overrides.total_minor ?? 500000;
  const cogs_minor = overrides.cogs_minor ?? 200000;
  return {
    week_start: overrides.week_start ?? '2026-06-29',
    total_minor,
    currency: overrides.currency ?? 'USD',
    sale_count: overrides.sale_count ?? 45,
    cogs_minor,
    gross_profit_minor: overrides.gross_profit_minor ?? total_minor - cogs_minor,
    gross_margin_percent: overrides.gross_margin_percent ?? 60,
  };
}

function buildMonthlyRevenue(overrides: Partial<{ month: string; total_minor: number; currency: string; sale_count: number; cogs_minor: number; gross_profit_minor: number; gross_margin_percent: number }> = {}) {
  const total_minor = overrides.total_minor ?? 2000000;
  const cogs_minor = overrides.cogs_minor ?? 800000;
  return {
    month: overrides.month ?? '2026-07',
    total_minor,
    currency: overrides.currency ?? 'USD',
    sale_count: overrides.sale_count ?? 180,
    cogs_minor,
    gross_profit_minor: overrides.gross_profit_minor ?? total_minor - cogs_minor,
    gross_margin_percent: overrides.gross_margin_percent ?? 60,
  };
}

function buildTopProduct(overrides: Partial<{ currency: string; product_id: string; sku: string; name: string; total_qty: number; total_minor: number; cogs_minor: number; gross_profit_minor: number; gross_margin_percent: number }> = {}) {
  return {
    currency: overrides.currency ?? 'USD',
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

function buildCategory(overrides: Partial<{ category_id: string | null; category_name: string; total_minor: number; sale_count: number; percentage: number }> = {}) {
  return {
    category_id: overrides.category_id ?? 'cat-1',
    category_name: overrides.category_name ?? 'Beverages',
    total_minor: overrides.total_minor ?? 300000,
    sale_count: overrides.sale_count ?? 60,
    percentage: overrides.percentage ?? 40,
  };
}

function buildHeatmap(overrides: Partial<{ currency: string; day_of_week: number; hour: number; total_minor: number; sale_count: number }> = {}) {
  return {
    currency: overrides.currency ?? 'USD',
    day_of_week: overrides.day_of_week ?? 1,
    hour: overrides.hour ?? 14,
    total_minor: overrides.total_minor ?? 25000,
    sale_count: overrides.sale_count ?? 5,
  };
}

const bundle = new FluentBundle('en');
bundle.addResource(new FluentResource(sharedFtl));
bundle.addResource(new FluentResource(reportsFtl));
const l10n = new ReactLocalization([bundle]);

function renderScreen() {
  return render(
    <LocalizationProvider l10n={l10n}>
      <SalesReportScreen />
    </LocalizationProvider>,
  );
}


function buildCategoryPopularity(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    category_id: 'cat-drinks',
    category_name: 'Drinks',
    product_count: 3,
    mean_score: 2.5,
    catalog_ratio: 1.7,
    top_products: [
      { sku: 'DRINK-1', name: 'Latte', popularity_score: 4, rank: 1, percentile: 1 },
      { sku: 'DRINK-2', name: 'Mocha', popularity_score: 2, rank: 2, percentile: 0.5 },
      { sku: 'DRINK-3', name: 'Tea', popularity_score: 1, rank: 3, percentile: 0 },
    ],
    ...overrides,
  };
}

function resolveDefaultData() {
  mockGetDailyRevenue.mockResolvedValue([buildDailyRevenue()]);
  mockGetTopProducts.mockResolvedValue([buildTopProduct()]);
  mockGetHourlyHeatmap.mockResolvedValue([buildHeatmap()]);
  mockGetCategoryBreakdown.mockResolvedValue([buildCategory()]);
  mockGetCategoryPopularity.mockResolvedValue([buildCategoryPopularity()]);
  mockGetCategoryPopularityTrend.mockResolvedValue([
    buildTrendPoint({ period_start: '2026-07-01', category_id: 'cat-drinks', category_name: 'Drinks', score: 2 }),
    buildTrendPoint({ period_start: '2026-07-02', category_id: 'cat-drinks', category_name: 'Drinks', score: 3 }),
  ]);
  mockGetCategoryForecast.mockResolvedValue([
    {
      category_id: 'cat-drinks',
      category_name: 'Drinks',
      forecast_units: 18,
      trend_per_period: 2,
      recent_avg_units: 13,
    },
  ]);
}

function buildTrendPoint(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    period_start: '2026-07-01',
    category_id: 'cat-drinks',
    category_name: 'Drinks',
    score: 2,
    units_sold: 4,
    distinct_transactions: 3,
    searches: 1,
    edits: 0,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────
describe('SalesReportScreen', () => {
  beforeEach(() => {
    // Default: never resolves (loading state)
    mockGetDailyRevenue.mockImplementation(() => new Promise(() => {}));
    mockGetTopProducts.mockImplementation(() => new Promise(() => {}));
    mockGetHourlyHeatmap.mockImplementation(() => new Promise(() => {}));
    mockGetCategoryBreakdown.mockImplementation(() => new Promise(() => {}));
    // Store profile with no timezone -> the UTC fallback, so pre-existing
    // assertions stay meaningful. Anchoring tests override this.
    mockGetPrimaryLocationScoped.mockResolvedValue({ id: 'store-a', name: 'Store A', timezone: null });
    // Category popularity defaults to empty (not pending) so tests that
    // override only the other mocks still resolve the shared Promise.all.
    mockGetCategoryPopularity.mockResolvedValue([]);
    mockGetCategoryPopularityTrend.mockResolvedValue([]);
    mockGetCategoryForecast.mockResolvedValue([]);
    mockPrintSalesReceipt.mockResolvedValue(undefined);
  });

  // ── Loading ──────────────────────────────────────────────────
  it('shows loading skeleton initially', () => {
    renderScreen();
    const skeleton = document.querySelector('.sales-report-loading-skeleton');
    expect(skeleton).toBeTruthy();
    expect(skeleton?.getAttribute('aria-hidden')).toBe('true');
  });

  // ── Error ────────────────────────────────────────────────────
  it('shows error message when API calls fail', async () => {
    mockGetDailyRevenue.mockRejectedValue(new Error('Server offline'));
    mockGetTopProducts.mockRejectedValue(new Error('Server offline'));
    mockGetHourlyHeatmap.mockRejectedValue(new Error('Server offline'));
    mockGetCategoryBreakdown.mockRejectedValue(new Error('Server offline'));
    mockGetCategoryPopularity.mockRejectedValue(new Error('Server offline'));
    mockGetCategoryPopularityTrend.mockRejectedValue(new Error('Server offline'));
    mockGetCategoryForecast.mockRejectedValue(new Error('Server offline'));
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('An error occurred')).toBeTruthy();
    });
  });

  // ── Title & controls ─────────────────────────────────────────
  it('renders the Sales Report title', async () => {
    resolveDefaultData();
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Sales Report')).toBeTruthy();
    });
  });

  it('renders date inputs with default values', async () => {
    resolveDefaultData();
    renderScreen();
    await waitFor(() => {
      const startInput = screen.getByLabelText('Start date');
      const endInput = screen.getByLabelText('End date');
      expect(startInput).toBeTruthy();
      expect(endInput).toBeTruthy();
      // Both should have values (default is last 30 days and today)
      expect((startInput as HTMLInputElement).value).toBeTruthy();
      expect((endInput as HTMLInputElement).value).toBeTruthy();
    });
  });

  // R36-06: the default window must follow the PRIMARY STORE's zone. Expected
  // dates are computed with explicit UTC arithmetic here rather than by calling
  // isoToday/isoDaysAgo, so this does not assert the helper against itself.
  // scripts/check-tz-invariance.py replays this file under four host zones.
  it('anchors the default window to the primary store timezone (R36-06)', async () => {
    resolveDefaultData();
    // Chosen so its calendar day provably differs from UTC right now; a
    // hardcoded +14:00 is vacuous for ten hours of every day.
    const zone = discriminatingStoreZone();
    assertCaseDiscriminates(zone);
    mockGetPrimaryLocationScoped.mockResolvedValue({ id: 'store-a', name: 'Store A', timezone: zone.offset });

    renderScreen();
    await waitFor(() => {
      expect((screen.getByLabelText('End date') as HTMLInputElement).value).toBe(expectedStoreDay(zone, 0));
      expect((screen.getByLabelText('Start date') as HTMLInputElement).value).toBe(expectedStoreDay(zone, 30));
    });
    // Without this, a rejected fetch would fall back to UTC and could coincide
    // with the expectation, making the test vacuous.
    expect(mockGetPrimaryLocationScoped).toHaveBeenCalled();
  });

  it('does not clobber a window the operator already edited (R36-06)', async () => {
    resolveDefaultData();
    const zone = discriminatingStoreZone();
    // Hold the store response open so the edit provably precedes it. Resolving
    // eagerly races: the re-seed refires the fetch effect and `loading`
    // unmounts the date inputs mid-assertion.
    let resolveStore: (v: unknown) => void = () => {};
    mockGetPrimaryLocationScoped.mockReturnValue(new Promise((r) => { resolveStore = r; }));

    renderScreen();
    await waitFor(() => expect(screen.getByLabelText('Start date')).toBeTruthy());
    const startInput = screen.getByLabelText('Start date') as HTMLInputElement;
    fireEvent.change(startInput, { target: { value: '2026-01-05' } });

    resolveStore({ id: 'store-a', name: 'Store A', timezone: zone.offset });
    await waitFor(() => {
      const input = screen.getByLabelText('Start date') as HTMLInputElement;
      expect(input.value).toBe('2026-01-05');
    });
  });

  it('renders view mode toggle buttons (daily, weekly, monthly)', async () => {
    resolveDefaultData();
    renderScreen();
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /daily/i })).toBeTruthy();
      expect(screen.getByRole('radio', { name: /weekly/i })).toBeTruthy();
      expect(screen.getByRole('radio', { name: /monthly/i })).toBeTruthy();
    });
  });

  it('daily is the default selected view mode', async () => {
    resolveDefaultData();
    renderScreen();
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /daily/i }).getAttribute('aria-checked')).toBe('true');
      expect(screen.getByRole('radio', { name: /weekly/i }).getAttribute('aria-checked')).toBe('false');
      expect(screen.getByRole('radio', { name: /monthly/i }).getAttribute('aria-checked')).toBe('false');
    });
  });

  it('renders Print and Export CSV buttons', async () => {
    resolveDefaultData();
    renderScreen();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Print report' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Export CSV' })).toBeTruthy();
    });
  });

  // ── Daily view data ──────────────────────────────────────────
  it('displays total revenue and total orders for daily data', async () => {
    mockGetDailyRevenue.mockResolvedValue([
      buildDailyRevenue({ total_minor: 250000, sale_count: 5 }),
      buildDailyRevenue({ total_minor: 100000, sale_count: 3 }),
    ]);
    mockGetTopProducts.mockResolvedValue([]);
    mockGetHourlyHeatmap.mockResolvedValue([]);
    mockGetCategoryBreakdown.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => {
      // $3,500.00 total (250000 + 100000) = 350000 minor units
      expect(screen.getByText(/\$3,500\.00/)).toBeTruthy();
      // 8 orders (5 + 3)
      expect(screen.getByText(/8/)).toBeTruthy();
    });
  });

  it('shows gross profit total in daily view (HPP exposure)', async () => {
    mockGetDailyRevenue.mockResolvedValue([
      buildDailyRevenue({ total_minor: 250000, cogs_minor: 100000, sale_count: 5 }),
      buildDailyRevenue({ total_minor: 100000, cogs_minor: 40000, sale_count: 3 }),
    ]);
    mockGetTopProducts.mockResolvedValue([]);
    mockGetHourlyHeatmap.mockResolvedValue([]);
    mockGetCategoryBreakdown.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => {
      // Gross profit = (250000 − 100000) + (100000 − 40000) = 210000 → $2,100.00
      expect(screen.getByText(/\$2,100\.00/)).toBeTruthy();
      // Margin % = 210000 / 350000 = 60%
      expect(screen.getByText(/\(60\.0%\)/)).toBeTruthy();
    });
  });

  it('shows refunds and net revenue totals when the period has refunds (REP-04)', async () => {
    mockGetDailyRevenue.mockResolvedValue([
      buildDailyRevenue({ total_minor: 100000, cogs_minor: 0, refund_minor: 30000 }),
    ]);
    mockGetTopProducts.mockResolvedValue([]);
    mockGetHourlyHeatmap.mockResolvedValue([]);
    mockGetCategoryBreakdown.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => {
      // Refund 30000 → $300.00; net = 100000 − 30000 = $700.00.
      expect(screen.getByText(/Refunds/)).toBeTruthy();
      expect(screen.getByText(/\$300\.00/)).toBeTruthy();
      expect(screen.getByText(/Net Revenue/)).toBeTruthy();
      expect(screen.getByText(/\$700\.00/)).toBeTruthy();
    });
  });

  it('hides the refunds row when the period has no refunds (REP-04)', async () => {
    resolveDefaultData();
    renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId('bar-chart')).toBeTruthy();
    });
    expect(screen.queryByText(/Refunds/)).toBeNull();
    expect(screen.queryByText(/Net Revenue/)).toBeNull();
  });

  it('shows gross profit total in weekly view too (HPP exposure)', async () => {
    resolveDefaultData();
    renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId('bar-chart')).toBeTruthy();
    });

    // Weekly rows carry the same HPP fields now.
    mockGetDailyRevenue.mockReset();
      mockGetWeeklyRevenue.mockReset();
      mockGetWeeklyRevenue.mockResolvedValue([
        buildWeeklyRevenue({ total_minor: 500000, cogs_minor: 300000, sale_count: 45 }),
      ]);

    await userEvent.setup().click(screen.getByRole('radio', { name: /weekly/i }));

    await waitFor(() => {
      // Gross profit = 500000 − 300000 = 200000 → $2,000.00
      // Margin % = 200000 / 500000 = 40%
      expect(screen.getByText(/\$2,000\.00/)).toBeTruthy();
      expect(screen.getByText(/\(40\.0%\)/)).toBeTruthy();
    });
  });

  // ── REP-02: multi-currency periods never collapse into one total ──
  it('shows per-currency totals when the period spans multiple currencies', async () => {
    // Backend groups by currency, so a two-currency period arrives as two
    // rows with DIFFERENT currency codes (audit REP-02: the UI must never
    // sum minor units across currencies). 10000 USD + 500000 IDR collapsed
    // and formatted as the first row's currency would read "$5,100.00".
    mockGetDailyRevenue.mockResolvedValue([
      buildDailyRevenue({ date: '2026-08-01', total_minor: 10000, currency: 'USD', sale_count: 1 }),
      buildDailyRevenue({ date: '2026-08-01', total_minor: 500000, currency: 'IDR', sale_count: 2 }),
    ]);
    mockGetTopProducts.mockResolvedValue([]);
    mockGetHourlyHeatmap.mockResolvedValue([]);
    mockGetCategoryBreakdown.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => {
      // Each currency's total renders in its own currency…
      expect(screen.getByText(/\$100\.00/)).toBeTruthy();
      expect(screen.getByText(/IDR 500,000/)).toBeTruthy();
      // …and the collapsed single total (510000 minor units formatted as
      // USD) must NOT appear.
      expect(screen.queryByText(/\$5,100\.00/)).toBeNull();
    });
  });

  it('hides the collapsed comparison delta when either period spans currencies', async () => {
    // Both the current and previous period resolve to the same multi-
    // currency rows; a single percentage over mixed currencies is
    // meaningless and must not render.
    mockGetDailyRevenue.mockResolvedValue([
      buildDailyRevenue({ date: '2026-08-01', total_minor: 10000, currency: 'USD', sale_count: 1 }),
      buildDailyRevenue({ date: '2026-08-01', total_minor: 500000, currency: 'IDR', sale_count: 2 }),
    ]);
    mockGetTopProducts.mockResolvedValue([]);
    mockGetHourlyHeatmap.mockResolvedValue([]);
    mockGetCategoryBreakdown.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText(/IDR 500,000/)).toBeTruthy();
    });
    // Turn period comparison on; the prev-period feed uses the same mock.
    fireEvent.click(screen.getByRole('button', { name: 'Compare to previous period' }));
    await waitFor(() => {
      // The totals are per-currency; no single % delta over mixed currencies.
      expect(screen.queryByText(/%/)).toBeNull();
    });
  });

  it('renders the bar chart and revenue section', async () => {
    resolveDefaultData();
    renderScreen();
    await waitFor(() => {
      // 'Revenue' appears in both chart heading and top-products table header
      expect(screen.getAllByText('Revenue').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByTestId('bar-chart')).toBeTruthy();
      expect(screen.getByTestId('bar')).toBeTruthy();
    });
  });

  it('bar chart has Revenue (minor units) aria label', async () => {
    resolveDefaultData();
    renderScreen();
    await waitFor(() => {
      const bar = screen.getByTestId('bar');
      expect(bar.getAttribute('aria-label')).toBe('Revenue (minor units)');
    });
  });

  // ── Category breakdown ───────────────────────────────────────
  it('renders category breakdown section with pie chart', async () => {
    resolveDefaultData();
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('By Category')).toBeTruthy();
      expect(screen.getByTestId('pie-chart')).toBeTruthy();
    });
  });

  it('shows "No results" when category breakdown is empty', async () => {
    mockGetDailyRevenue.mockResolvedValue([buildDailyRevenue()]);
    mockGetTopProducts.mockResolvedValue([]);
    mockGetHourlyHeatmap.mockResolvedValue([]);
    mockGetCategoryBreakdown.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => {
      const noResultsElements = screen.getAllByText('No results');
      // Category breakdown section should show "No results"
      expect(noResultsElements.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Top products ─────────────────────────────────────────────
  it('renders top products table with headers', async () => {
    resolveDefaultData();
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Top Products')).toBeTruthy();
      expect(screen.getByText('#')).toBeTruthy();
      expect(screen.getByText('Name')).toBeTruthy();
      expect(screen.getByText('Qty')).toBeTruthy();
      // 'Revenue' appears multiple times; check at least one exists
      expect(screen.getAllByText('Revenue').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders top product rows with data', async () => {
    mockGetDailyRevenue.mockResolvedValue([buildDailyRevenue()]);
    mockGetTopProducts.mockResolvedValue([
      buildTopProduct({ product_id: 'prod-1', name: 'Latte', total_qty: 30, total_minor: 120000 }),
      buildTopProduct({ product_id: 'prod-2', name: 'Mocha', total_qty: 20, total_minor: 100000 }),
    ]);
    mockGetHourlyHeatmap.mockResolvedValue([]);
    mockGetCategoryBreakdown.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Latte')).toBeTruthy();
      expect(screen.getByText('30')).toBeTruthy();
      expect(screen.getByText('Mocha')).toBeTruthy();
      expect(screen.getByText('20')).toBeTruthy();
      // Revenue formatted: $1,200.00 and $1,000.00
      expect(screen.getByText('$1,200.00')).toBeTruthy();
      expect(screen.getByText('$1,000.00')).toBeTruthy();
    });
  });

  it('renders gross profit and margin per product', async () => {
    mockGetDailyRevenue.mockResolvedValue([buildDailyRevenue()]);
    mockGetTopProducts.mockResolvedValue([
      buildTopProduct({ product_id: 'prod-1', name: 'Latte', total_minor: 120000, cogs_minor: 40000, gross_profit_minor: 80000, gross_margin_percent: 66.7 }),
      buildTopProduct({ product_id: 'prod-2', name: 'Mocha', total_minor: 100000, cogs_minor: 130000, gross_profit_minor: -30000, gross_margin_percent: -30 }),
    ]);
    mockGetHourlyHeatmap.mockResolvedValue([]);
    mockGetCategoryBreakdown.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => {
      // Gross Profit column header (also appears in the totals line)
      expect(screen.getAllByText('Gross Profit').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Margin')).toBeTruthy();
      // Latte: $800.00 profit, 66.7% margin
      expect(screen.getByText('$800.00')).toBeTruthy();
      expect(screen.getByText('66.7%')).toBeTruthy();
      // Mocha: loss-leader, red class
      const loss = screen.getByText('-$300.00');
      expect(loss.className).toContain('sales-report-top-negative');
      expect(screen.getByText('-30.0%')).toBeTruthy();
    });
  });

  it('re-ranks by gross profit when the toggle is clicked', async () => {
    resolveDefaultData();
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Top Products')).toBeTruthy();
    });

    // Default fetch is ranked by revenue
    expect(mockGetTopProducts).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      10,
      HARNESS_SESSION_TOKEN,
      'revenue',
    );

    mockGetTopProducts.mockReset();
    resolveDefaultData();
    await userEvent.click(screen.getByRole('radio', { name: 'Rank by gross profit' }));

    await waitFor(() => {
      expect(mockGetTopProducts).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        10,
        HARNESS_SESSION_TOKEN,
        'profit',
      );
      // Native radio input uses 'checked' property, not aria-checked attribute
      expect(screen.getByRole('radio', { name: 'Rank by gross profit' })).toBeChecked();
    });
  });

  it('shows "No results" when top products is empty', async () => {
    mockGetDailyRevenue.mockResolvedValue([buildDailyRevenue()]);
    mockGetTopProducts.mockResolvedValue([]);
    mockGetHourlyHeatmap.mockResolvedValue([]);
    mockGetCategoryBreakdown.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => {
      const noResultsElements = screen.getAllByText('No results');
      // Top products section should show "No results"
      expect(noResultsElements.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Category popularity ──────────────────────────────────────
  it('renders the category popularity leaderboard', async () => {
    resolveDefaultData();
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Category Popularity')).toBeTruthy();
      // Category row: name, count, catalog ratio, ranked top products
      // ('Drinks' also appears in the Demand Forecard card; '3' is a
      // heatmap hour header — use getAllByText for both).
      expect(screen.getAllByText('Drinks').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('3').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('1.7×')).toBeTruthy();
      expect(screen.getByText('1. Latte · 2. Mocha · 3. Tea')).toBeTruthy();
    });
  });

  it('localizes the uncategorized label when category_name is null', async () => {
    mockGetDailyRevenue.mockResolvedValue([buildDailyRevenue()]);
    mockGetTopProducts.mockResolvedValue([]);
    mockGetHourlyHeatmap.mockResolvedValue([]);
    mockGetCategoryBreakdown.mockResolvedValue([]);
    mockGetCategoryPopularity.mockResolvedValue([
      buildCategoryPopularity({
        category_id: '',
        category_name: null,
        catalog_ratio: 0,
        top_products: [],
      }),
    ]);
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Uncategorized')).toBeTruthy();
      expect(screen.getByText('—')).toBeTruthy();
    });
  });

  it('shows "No results" when category popularity is empty', async () => {
    mockGetDailyRevenue.mockResolvedValue([buildDailyRevenue()]);
    mockGetTopProducts.mockResolvedValue([]);
    mockGetHourlyHeatmap.mockResolvedValue([]);
    mockGetCategoryBreakdown.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => {
      const noResultsElements = screen.getAllByText('No results');
      expect(noResultsElements.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders the popularity trend chart with one line per category', async () => {
    resolveDefaultData();
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Popularity Trend')).toBeTruthy();
      const lines = screen.getAllByTestId('line');
      // One Line per category series (Drinks here).
      expect(lines.length).toBeGreaterThanOrEqual(1);
      expect(lines[0]!.getAttribute('data-key')).toBe('Drinks');
    });
  });

  it('re-fetches the trend when the view mode changes granularity', async () => {
    resolveDefaultData();
    renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId('bar-chart')).toBeTruthy();
    });

    expect(mockGetCategoryPopularityTrend).toHaveBeenCalledWith(
      HARNESS_SESSION_TOKEN,
      expect.any(String),
      expect.any(String),
      'daily',
      5,
    );

    mockGetCategoryPopularityTrend.mockReset();
    resolveDefaultData();
    await userEvent.click(screen.getByRole('radio', { name: /weekly/i }));

    await waitFor(() => {
      expect(mockGetCategoryPopularityTrend).toHaveBeenCalledWith(
        HARNESS_SESSION_TOKEN,
        expect.any(String),
        expect.any(String),
        'weekly',
        5,
      );
    });
  });

  // ── Demand forecast ──────────────────────────────────────────
  it('renders the demand forecast table with trend direction', async () => {
    resolveDefaultData();
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Demand Forecast')).toBeTruthy();
      // 'Drinks' also appears in the Category Popularity card.
      expect(screen.getAllByText('Drinks').length).toBeGreaterThanOrEqual(1);
      // Avg 13.0, rising trend ▲ 2.0, next period 18 ('18' is also a
      // heatmap hour header, so use getAllByText).
      expect(screen.getByText('13.0')).toBeTruthy();
      expect(screen.getByText('▲ 2.0')).toBeTruthy();
      expect(screen.getAllByText('18').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows a falling trend indicator for declining categories', async () => {
    mockGetDailyRevenue.mockResolvedValue([buildDailyRevenue()]);
    mockGetTopProducts.mockResolvedValue([]);
    mockGetHourlyHeatmap.mockResolvedValue([]);
    mockGetCategoryBreakdown.mockResolvedValue([]);
    mockGetCategoryPopularity.mockResolvedValue([]);
    mockGetCategoryForecast.mockResolvedValue([
      {
        category_id: 'cat-x',
        category_name: 'X',
        forecast_units: 3,
        trend_per_period: -1.5,
        recent_avg_units: 8,
      },
    ]);
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('▼ 1.5')).toBeTruthy();
      const down = screen.getByText('▼ 1.5');
      expect(down.className).toContain('sales-report-forecast-down');
    });
  });

  // ── Hourly heatmap ───────────────────────────────────────────
  it('renders heatmap section with title', async () => {
    resolveDefaultData();
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Busiest Hours')).toBeTruthy();
    });
  });

  it('renders heatmap grid with 24 hour columns and 7 day rows', async () => {
    const heatmapData = [
      buildHeatmap({ day_of_week: 1, hour: 9, total_minor: 50000 }),
      buildHeatmap({ day_of_week: 3, hour: 15, total_minor: 75000 }),
    ];
    mockGetDailyRevenue.mockResolvedValue([buildDailyRevenue()]);
    mockGetTopProducts.mockResolvedValue([]);
    mockGetHourlyHeatmap.mockResolvedValue(heatmapData);
    mockGetCategoryBreakdown.mockResolvedValue([]);
    mockGetCategoryPopularity.mockResolvedValue([]);
    mockGetCategoryPopularityTrend.mockResolvedValue([]);
    mockGetCategoryForecast.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => {
      const grid = screen.getByRole('grid', { name: 'Hourly heatmap' });
      expect(grid).toBeTruthy();
      // 7 rows (one per day) + 1 header row = 8 total rows
      const rows = within(grid).getAllByRole('row');
      expect(rows.length).toBe(7);
    });
  });

  it('renders heatmap cells with aria labels showing day, hour, and value', async () => {
    mockGetDailyRevenue.mockResolvedValue([buildDailyRevenue()]);
    mockGetTopProducts.mockResolvedValue([]);
    mockGetHourlyHeatmap.mockResolvedValue([buildHeatmap({ day_of_week: 1, hour: 14, total_minor: 25000 })]);
    mockGetCategoryBreakdown.mockResolvedValue([]);
    mockGetCategoryPopularity.mockResolvedValue([]);
    mockGetCategoryPopularityTrend.mockResolvedValue([]);
    mockGetCategoryForecast.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => {
      // Cell aria-label: "Mon 14:00 - $250.00"
      const cell = screen.getByRole('gridcell', { name: /Mon 14:00/ });
      expect(cell).toBeTruthy();
    });
  });

  it('shows "No data" when heatmap is empty', async () => {
    mockGetDailyRevenue.mockResolvedValue([buildDailyRevenue()]);
    mockGetTopProducts.mockResolvedValue([]);
    mockGetHourlyHeatmap.mockResolvedValue([]);
    mockGetCategoryBreakdown.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => {
      // Heatmap + popularity trend cards both show "No data" when empty.
      expect(screen.getAllByText('No data').length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── View mode switching ──────────────────────────────────────
  it('switches to weekly view and calls getWeeklyRevenue', async () => {
    resolveDefaultData();
    renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId('bar-chart')).toBeTruthy();
    });

    // Reset mocks for the new view fetch
    mockGetDailyRevenue.mockReset();
    mockGetWeeklyRevenue.mockReset();
    mockGetWeeklyRevenue.mockResolvedValue([buildWeeklyRevenue()]);

    await userEvent.click(screen.getByRole('radio', { name: /weekly/i }));

    await waitFor(() => {
      expect(mockGetWeeklyRevenue).toHaveBeenCalled();
      expect(screen.getByRole('radio', { name: /weekly/i }).getAttribute('aria-checked')).toBe('true');
    });
  });

  it('switches to monthly view and calls getMonthlyRevenue', async () => {
    resolveDefaultData();
    renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId('bar-chart')).toBeTruthy();
    });

    mockGetDailyRevenue.mockReset();
      mockGetMonthlyRevenue.mockReset();
      mockGetMonthlyRevenue.mockResolvedValue([buildMonthlyRevenue()]);

    await userEvent.click(screen.getByRole('radio', { name: /monthly/i }));

    await waitFor(() => {
      expect(mockGetMonthlyRevenue).toHaveBeenCalled();
      expect(screen.getByRole('radio', { name: /monthly/i }).getAttribute('aria-checked')).toBe('true');
    });
  });

  // ── Date filter ────────────────────……………………………………
  it('re-fetches data when start date changes', async () => {
    resolveDefaultData();
    renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId('bar-chart')).toBeTruthy();
    });

    mockGetDailyRevenue.mockReset();
    resolveDefaultData();

    const startInput = screen.getByLabelText('Start date') as HTMLInputElement;
    fireEvent.change(startInput, { target: { value: '2026-06-01' } });

    await waitFor(() => {
      expect(mockGetDailyRevenue).toHaveBeenCalledWith('2026-06-01', expect.any(String), HARNESS_SESSION_TOKEN);
    });
  });

  it('re-fetches data when end date changes', async () => {
    resolveDefaultData();
    renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId('bar-chart')).toBeTruthy();
    });

    mockGetDailyRevenue.mockReset();
    resolveDefaultData();

    const endInput = screen.getByLabelText('End date') as HTMLInputElement;
    fireEvent.change(endInput, { target: { value: '2026-07-24' } });

    await waitFor(() => {
      expect(mockGetDailyRevenue).toHaveBeenCalledWith(expect.any(String), '2026-07-24', HARNESS_SESSION_TOKEN);
    });
  });

  // ── CSV export ───────────────────────────────────────────────
  it('triggers CSV download when Export CSV button is clicked', async () => {
    // jsdom doesn't provide URL.createObjectURL — stub it
    const origCreateObjectURL = URL.createObjectURL;
    const origRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:test');
    URL.revokeObjectURL = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    // Capture the anchor element via createElement spy (it's never appended to DOM)
    const origCreateElement = document.createElement.bind(document);
    let capturedAnchor: HTMLAnchorElement | null = null;
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: ElementCreationOptions) => {
      const el = origCreateElement(tag, options);
      if (tag === 'a') capturedAnchor = el as HTMLAnchorElement;
      return el;
    });

    mockGetDailyRevenue.mockResolvedValue([
      buildDailyRevenue({ date: '2026-07-01', total_minor: 150, sale_count: 12 }),
    ]);
    mockGetTopProducts.mockResolvedValue([]);
    mockGetHourlyHeatmap.mockResolvedValue([]);
    mockGetCategoryBreakdown.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId('bar-chart')).toBeTruthy();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(capturedAnchor).toBeTruthy();
    expect(capturedAnchor!.download).toMatch(/sales-report-.*\.csv/);

    // Restore originals
    URL.createObjectURL = origCreateObjectURL;
    URL.revokeObjectURL = origRevokeObjectURL;
    clickSpy.mockRestore();
    createElementSpy.mockRestore();
  });

  // ── CSV escaping ─────────────────────────────────────────────
  it('properly escapes CSV values with commas, quotes, and newlines (REP-08)', async () => {
    // jsdom doesn't provide URL.createObjectURL — stub it
    const origCreateObjectURL = URL.createObjectURL;
    const origRevokeObjectURL = URL.revokeObjectURL;
    let capturedBlob: Blob | null = null;
     URL.createObjectURL = vi.fn((blob) => {
      capturedBlob = blob;
      return 'blob:test';
    });
    URL.revokeObjectURL = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    // Capture the anchor element via createElement spy (it's never appended to DOM)
    const origCreateElement = document.createElement.bind(document);
    let capturedAnchor: HTMLAnchorElement | null = null;
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: ElementCreationOptions) => {
      const el = origCreateElement(tag, options);
      if (tag === 'a') capturedAnchor = el as HTMLAnchorElement;
      return el;
    });

    // Test data with problematic characters that should be escaped in CSV
    const problematicRevenue = [
      buildDailyRevenue({ 
        date: '2026-07-01', 
        total_minor: 150, 
        sale_count: 12,
        currency: 'USD'
      }), // Normal row
      buildDailyRevenue({ 
        date: '2026-07-02', 
        total_minor: 200, 
        sale_count: 8,
        currency: 'USD, EUR' // Contains comma
      }),
      buildDailyRevenue({ 
        date: '2026-07-03', 
        total_minor: 250, 
        sale_count: 15,
        currency: 'USD "Special""' // Contains quotes
      }),
      buildDailyRevenue({ 
        date: '2026-07-04\nNew Line', 
        total_minor: 300, 
        sale_count: 20,
        currency: 'USD' // Contains newline in date
      }),
    ];
    mockGetDailyRevenue.mockResolvedValue(problematicRevenue);
    mockGetTopProducts.mockResolvedValue([]);
    mockGetHourlyHeatmap.mockResolvedValue([]);
    mockGetCategoryBreakdown.mockResolvedValue([]);

    renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId('bar-chart')).toBeTruthy();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(capturedAnchor).toBeTruthy();
    expect(capturedAnchor!.download).toMatch(/sales-report-.*\.csv/);
    
    // Validate CSV content
    expect(capturedBlob).toBeTruthy();
    const blob = capturedBlob!;
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    
    // Parse CSV lines
    const lines = text.trim().split('\n');
    const headerLine = lines[0];
    const dataLines = lines.slice(1);
    
    // Header should be: Period,Revenue,Currency,Orders
    expect(headerLine).toBe('Period,Revenue,Currency,Orders');
    
    // First row (normal): 2026-07-01,1.50,USD,12
    expect(dataLines[0]).toBe('2026-07-01,1.50,USD,12');
    
    // Second row (comma in currency): 2026-07-02,2.00,"USD, EUR",8
    expect(dataLines[1]).toBe('2026-07-02,2.00,"USD, EUR",8');
    
    // Third row (quotes in currency): 2026-07-03,2.50,"USD ""Special""""",15
    expect(dataLines[2]).toBe('2026-07-03,2.50,"USD ""Special""""",15');
    
    // Fourth row (newline in date): field is quoted and contains literal newline
    // CSV split by \n will produce two lines for this row
    expect(dataLines[3]).toBe('"2026-07-04');
    expect(dataLines[4]).toBe('New Line",3.00,USD,20');
    
    // Restore originals
    URL.createObjectURL = origCreateObjectURL;
    URL.revokeObjectURL = origRevokeObjectURL;
    clickSpy.mockRestore();
    createElementSpy.mockRestore();
  });

  // ── Print report ─────────────────────────────────────────────
  it('calls printSalesReceipt when Print button is clicked', async () => {
    mockGetDailyRevenue.mockResolvedValue([
      buildDailyRevenue({ total_minor: 150000 }),
    ]);
    mockGetTopProducts.mockResolvedValue([buildTopProduct()]);
    mockGetHourlyHeatmap.mockResolvedValue([]);
    mockGetCategoryBreakdown.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId('bar-chart')).toBeTruthy();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Print report' }));

    await waitFor(() => {
      expect(mockPrintSalesReceipt).toHaveBeenCalledTimes(1);
      const callArgs = mockPrintSalesReceipt.mock.calls[0]![0] as Record<string, unknown>;
      expect(callArgs['receiptNumber']).toEqual(expect.stringMatching(/^RPT-/));
      expect(callArgs['items']).toBeTruthy();
    });
  });

  // ── ARIA ─────────────────────────────────────────────────────
  it('has role="region" with aria-label="Sales Report"', async () => {
    resolveDefaultData();
    renderScreen();
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Sales Report' })).toBeTruthy();
    });
  });

  it('view mode toggle has role="radiogroup"', async () => {
    resolveDefaultData();
    renderScreen();
    await waitFor(() => {
      expect(screen.getByRole('radiogroup', { name: 'View mode' })).toBeTruthy();
    });
  });

  // ── Edge: null category_id ───────────────────────────────────
  it('handles category with null category_id', async () => {
    mockGetDailyRevenue.mockResolvedValue([buildDailyRevenue()]);
    mockGetTopProducts.mockResolvedValue([]);
    mockGetHourlyHeatmap.mockResolvedValue([]);
    mockGetCategoryBreakdown.mockResolvedValue([
      buildCategory({ category_id: null, category_name: 'Uncategorized' }),
    ]);
    renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId('pie-chart')).toBeTruthy();
    });
  });

  it('renders a multi-currency heatmap cell listing both amounts (REP-06)', async () => {
    mockGetDailyRevenue.mockResolvedValue([buildDailyRevenue()]);
    mockGetTopProducts.mockResolvedValue([]);
    mockGetHourlyHeatmap.mockResolvedValue([
      buildHeatmap({ day_of_week: 1, hour: 10, total_minor: 50000, sale_count: 3 }),
      buildHeatmap({ currency: 'IDR', day_of_week: 1, hour: 10, total_minor: 8000000, sale_count: 5 }),
    ]);
    mockGetCategoryBreakdown.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => {
      const cell = document.querySelector('[aria-label*="Mon 10:00"]');
      expect(cell).toBeTruthy();
      const label = cell!.getAttribute('aria-label') ?? '';
      // Both currencies visible; order count aggregates across them.
      expect(label).toContain('$500.00');
      expect(label).toContain('IDR');
      expect(cell!.textContent).toBe('8');
    });
  });

  it('formats top product rows in their own currency (REP-06)', async () => {
    mockGetDailyRevenue.mockResolvedValue([buildDailyRevenue()]);
    mockGetHourlyHeatmap.mockResolvedValue([]);
    mockGetCategoryBreakdown.mockResolvedValue([]);
    mockGetTopProducts.mockResolvedValue([
      buildTopProduct({ sku: 'LAT', name: 'Latte', total_minor: 70000 }),
      buildTopProduct({ sku: 'LAT', name: 'Latte', currency: 'IDR', total_minor: 11550000 }),
    ]);
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText(/\$700\.00/)).toBeTruthy();
      expect(screen.getByText(/IDR 11,550,000/)).toBeTruthy();
    });
  });

  // ── Edge: heatmap row with out-of-bounds values ──────────────
  it('handles heatmap row with day_of_week and hour within bounds', async () => {
    mockGetDailyRevenue.mockResolvedValue([buildDailyRevenue()]);
    mockGetTopProducts.mockResolvedValue([]);
    mockGetHourlyHeatmap.mockResolvedValue([
      { currency: 'USD', day_of_week: 0, hour: 0, total_minor: 100, sale_count: 1 },
      { currency: 'USD', day_of_week: 6, hour: 23, total_minor: 200, sale_count: 2 },
    ]);
    mockGetCategoryBreakdown.mockResolvedValue([]);
    mockGetCategoryPopularity.mockResolvedValue([]);
    mockGetCategoryPopularityTrend.mockResolvedValue([]);
    mockGetCategoryForecast.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => {
      expect(screen.getByRole('grid', { name: 'Hourly heatmap' })).toBeTruthy();
    });
  });

  // ── All data empty ───────────────────────────────────────────
  it('renders all sections with empty data without errors', async () => {
    mockGetDailyRevenue.mockResolvedValue([]);
    mockGetTopProducts.mockResolvedValue([]);
    mockGetHourlyHeatmap.mockResolvedValue([]);
    mockGetCategoryBreakdown.mockResolvedValue([]);
    mockGetCategoryPopularity.mockResolvedValue([]);
    mockGetCategoryPopularityTrend.mockResolvedValue([]);
    mockGetCategoryForecast.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => {
      // Revenue section still renders (heading + $0.00 total)
      expect(screen.getAllByText('Revenue').length).toBeGreaterThanOrEqual(1);
      // All sections show "No results" or "No data" when empty:
      // Top Products, Category Breakdown, Category Popularity,
      // Category Popularity Trend, Demand Forecast = 5 "No results"
      expect(screen.getAllByText('No results').length).toBe(5);
      // Heatmap shows "No data"
      expect(screen.getAllByText('No data').length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── REP-06: Race condition guard ────────────────────────────────
  // Note: The component shows a loading skeleton during fetch which hides the
  // date inputs, making rapid sequential changes through the UI impossible to
  // test in an integration test. The generation counter logic is verified by
  // code review and unit tests. This integration test verifies that sequential
  // date changes correctly trigger new fetches and the latest response wins.
  it('sequential date changes trigger new fetches and latest response wins', async () => {
    // STEP 1: Initial feed for date A (Jan 1) - completes normally
    mockGetDailyRevenue.mockResolvedValue([
      buildDailyRevenue({ total_minor: 100000, sale_count: 5 }),
    ]);
    mockGetTopProducts.mockResolvedValue([]);
    mockGetHourlyHeatmap.mockResolvedValue([]);
    mockGetCategoryBreakdown.mockResolvedValue([]);
    mockGetCategoryPopularity.mockResolvedValue([]);
    mockGetCategoryPopularityTrend.mockResolvedValue([]);
    mockGetCategoryForecast.mockResolvedValue([]);

    renderScreen();

    // Wait for initial feed to load (UI shows $1,000.00)
    await waitFor(() => {
      expect(screen.getByText(/\$1,000\.00/)).toBeTruthy();
    });

    // STEP 2: User changes start date to date B (Feb 1) -> triggers new fetch
    mockGetDailyRevenue.mockResolvedValue([
      buildDailyRevenue({ total_minor: 150000, sale_count: 8 }),
    ]);
    mockGetTopProducts.mockResolvedValue([]);
    mockGetHourlyHeatmap.mockResolvedValue([]);
    mockGetCategoryBreakdown.mockResolvedValue([]);
    mockGetCategoryPopularity.mockResolvedValue([]);
    mockGetCategoryPopularityTrend.mockResolvedValue([]);
    mockGetCategoryForecast.mockResolvedValue([]);

    const startInput = document.getElementById('start-date') as HTMLInputElement;
    expect(startInput).toBeTruthy();
    fireEvent.change(startInput, { target: { value: '2026-02-01' } });

    // Wait for second feed to load (UI shows $1,500.00)
    await waitFor(() => {
      expect(screen.getByText(/\$1,500\.00/)).toBeTruthy();
    });

    // STEP 3: User changes start date to date C (Mar 1) -> triggers another fetch
    mockGetDailyRevenue.mockResolvedValue([
      buildDailyRevenue({ total_minor: 200000, sale_count: 10 }),
    ]);
    mockGetTopProducts.mockResolvedValue([]);
    mockGetHourlyHeatmap.mockResolvedValue([]);
    mockGetCategoryBreakdown.mockResolvedValue([]);
    mockGetCategoryPopularity.mockResolvedValue([]);
    mockGetCategoryPopularityTrend.mockResolvedValue([]);
    mockGetCategoryForecast.mockResolvedValue([]);

    // Re-query input (element may be replaced across re-renders)
    const startInputAfter = document.getElementById('start-date') as HTMLInputElement;
    expect(startInputAfter).toBeTruthy();
    fireEvent.change(startInputAfter, { target: { value: '2026-03-01' } });

    // Wait for third feed to load (UI shows $2,000.00)
    await waitFor(() => {
      expect(screen.getByText(/\$2,000\.00/)).toBeTruthy();
      expect(screen.queryByText(/\$1,500\.00/)).toBeNull();
    });
  });

  // REP-06 generation counter (fetchGenerationRef). The SEQUENTIAL case is
  // already covered by the integration test above — rapid successive changes
  // settle on the last one. The CONCURRENT case is still open: proving it needs
  // the loading skeleton to keep the controls mounted so a second change can be
  // fired mid-flight, which is a UX change tracked separately.
  // Was `expect(true).toBe(true); // Placeholder - logic verified by code review`.
  it.todo('generation counter ignores stale responses (concurrent fetches)');
});