import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnalyticsCardContent, ExportCsvButton } from '@/features/analytics/AnalyticsCardContent';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('echarts-for-react/lib/core', () => ({
  default: ({ option }: { option?: Record<string, unknown> }) => (
    <div
      data-testid="echarts"
      data-keys={option ? Object.keys(option).join(',') : ''}
      data-series={JSON.stringify(
        ((option?.['series'] as { data?: { name: string }[] }[] | undefined)?.[0]?.data ?? []).map(
          (d) => d.name,
        ),
      )}
    />
  ),
}));

vi.mock('echarts/core', () => ({ use: vi.fn() }));
vi.mock('echarts/charts', () => ({ BarChart: {}, LineChart: {}, PieChart: {} }));
vi.mock('echarts/components', () => ({ GridComponent: {}, LegendComponent: {}, TooltipComponent: {} }));
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }));

const mockUseAnalyticsQuery = vi.fn();
vi.mock('@/features/analytics/useAnalyticsQuery', () => ({
  useAnalyticsQuery: (...args: unknown[]) => mockUseAnalyticsQuery(...args),
}));

vi.mock('@/features/analytics/analytics-cache', () => ({
  cardQueryKey: vi.fn(() => ['test-key']),
}));

vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ currency: 'USD' }),
}));

vi.mock('@fluent/react', () => ({
  useLocalization: () => ({
    l10n: {
      getString: (id: string) => {
        const map: Record<string, string> = {
          'analytics-export-csv': 'Export CSV',
          'analytics-card-aov': 'Average Order Value',
          'analytics-card-basket-items': 'items / order',
          'analytics-card-basket-orders': 'orders',
          'analytics-card-category-top': 'Top category',
          'analytics-card-customers-new': 'New',
          'analytics-card-customers-new-share': '$pct % new customers',
          'analytics-card-customers-returning': 'Returning',
          'analytics-card-customers-total': 'Total customers',
          'analytics-card-discounts-redeemed': 'redeemed',
          'analytics-card-discounts-share': 'of sales from discounts',
          'analytics-card-inventory-days': 'Days of stock',
          'analytics-card-inventory-skus': 'Active SKUs',
          'analytics-card-inventory-turnover': 'Turnover',
          'analytics-card-low': 'Low: $label · $value',
          'analytics-card-low-stock-critical': 'Critical items',
          'analytics-card-low-stock-items': 'items flagged',
          'analytics-card-low-stock-left': 'left',
          'analytics-card-low-stock-order': 'Order $n',
          'analytics-card-low-stock-restock': 'Est. restock cost',
          'analytics-card-occupancy-hourly': 'Occupancy by hour',
          'analytics-card-occupancy-occupied': 'occupied',
          'analytics-card-occupancy-orders': 'table orders',
          'analytics-card-occupancy-peak': 'Peak hour',
          'analytics-card-payments-top': 'Top payment method',
          'analytics-card-peak': 'Peak: $label · $value',
          'analytics-card-piutang-count': '$count repayment(s)',
          'analytics-card-refunds-amount': 'Refunded amount',
          'analytics-card-refunds-avg': 'Average refund',
          'analytics-card-refunds-count': 'Refund count',
          'analytics-card-staff-sales': 'Staff sales total',
          'analytics-card-tables-turn': 'Avg. turn time',
          'analytics-card-top-product': 'Top product',
          'analytics-card-total-revenue': 'Total revenue',
          'analytics-card-voids-count': 'Voided items',
          'analytics-card-waitstaff-covers': 'covers',
          'analytics-card-waitstaff-total': 'Total covers',
          'analytics-category-currency-aria': 'Select currency for the category chart',
          'analytics-empty-low-stock': 'All items are sufficiently stocked.',
          'analytics-export-aov-aria': 'Export average order value as CSV',
          'analytics-export-basket-aria': 'Export basket size as CSV',
          'analytics-export-category-aria': 'Export categories as CSV',
          'analytics-export-col-aov': 'Average order value',
          'analytics-export-col-basket': 'Avg items per order',
          'analytics-export-col-revenue': 'Revenue',
          'analytics-export-col-turn': 'Avg turn (min)',
          'analytics-export-col-units': 'Units sold',
          'analytics-export-csv-aria': 'Export staff data as CSV',
          'analytics-export-customers-aria': 'Export customers as CSV',
          'analytics-export-discounts-aria': 'Export discounts as CSV',
          'analytics-export-inventory-aria': 'Export inventory as CSV',
          'analytics-export-low-stock-aria': 'Export low stock as CSV',
          'analytics-export-occupancy-aria': 'Export occupancy as CSV',
          'analytics-export-payments-aria': 'Export payments as CSV',
          'analytics-export-piutang-aria': 'Export piutang collections CSV',
          'analytics-export-refunds-aria': 'Export refunds as CSV',
          'analytics-export-revenue-aria': 'Export revenue as CSV',
          'analytics-export-tables-aria': 'Export table turnover as CSV',
          'analytics-export-top-items-aria': 'Export top items as CSV',
          'analytics-export-voids-aria': 'Export voids as CSV',
          'analytics-export-waitstaff-aria': 'Export waitstaff as CSV',
          'analytics-unit-days': '$n [one] day',
          'analytics-unit-minutes': '$n min',
          'analytics-card-error-load': 'Failed to load',
          'analytics-card-empty': 'No data',
          'analytics-empty-generic': 'No data available',
          'analytics-card-payments-cash': 'Cash',
          'analytics-card-payments-card': 'Card',
          'analytics-card-payments-qris': 'QRIS',
          'analytics-card-payments-ewallet': 'E-wallet',
          'analytics-card-piutang-total': 'Collected from customer credit',
        };
        return map[id] || id;
      },
      bundles: [{ locales: ['en-US'] }],
    },
  }),
}));

vi.mock('@/utils/app-error', () => ({
  l10nErrorMessage: () => 'Failed to load',
}));

vi.mock('@/utils/export-csv', () => ({
  downloadCsv: vi.fn(),
}));

// ── Tests: ExportCsvButton ─────────────────────────────────────────────

describe('ExportCsvButton', () => {
  it('renders with aria label', () => {
    render(<ExportCsvButton onClick={vi.fn()} ariaLabel="Export revenue CSV" />);
    expect(screen.getByRole('button', { name: 'Export revenue CSV' })).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<ExportCsvButton onClick={onClick} ariaLabel="Export" />);
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders CSV label text', () => {
    render(<ExportCsvButton onClick={vi.fn()} ariaLabel="Export" />);
    expect(screen.getByText('Export CSV')).toBeInTheDocument();
  });
});

// ── Tests: AnalyticsCardContent ────────────────────────────────────────

describe('AnalyticsCardContent', () => {
  const baseProps = {
    granularity: 'daily' as const,
    workspaceView: 'retail' as const,
    from: '2026-08-01',
    to: '2026-08-19',
    sessionToken: 'test-token',
    title: 'Revenue',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows error state when query fails', () => {
    mockUseAnalyticsQuery.mockReturnValue({ data: undefined, isLoading: false, error: new Error('network') });
    render(<AnalyticsCardContent {...baseProps} cardKey="revenue" />);
    expect(screen.getByText('Failed to load')).toBeInTheDocument();
  });

  it('renders aov card with data', () => {
    mockUseAnalyticsQuery.mockReturnValue({
      data: { aov_minor: 1500, total_orders: 20, total_minor: 30000, buckets: [{ label: 'Aug 1', value: 1500 }] },
      isLoading: false,
      error: null,
    });
    render(<AnalyticsCardContent {...baseProps} cardKey="aov" />);
    expect(screen.getByTestId('echarts')).toBeInTheDocument();
  });

  // DECISION Q1's collection line, as a card. The `payments` card reports what was
  // SOLD and excludes `pay_later`; a day whose only takings were repayments is
  // invisible there and must be visible here. This case renders the collection side
  // and asserts the tender names AND the money, so a card wired to the wrong
  // endpoint (the breakdown) would fail on content, not just on the command name.
  it('renders the piutang collections card with tender rows', () => {
    mockUseAnalyticsQuery.mockReturnValue({
      data: [
        { payment_method: 'cash', currency: 'IDR', total_minor: 12500000, payment_count: 23 },
        { payment_method: 'bank_transfer', currency: 'IDR', total_minor: 8700000, payment_count: 9 },
      ],
      isLoading: false,
      error: null,
    });
    render(<AnalyticsCardContent {...baseProps} cardKey="piutang-collections" />);
    // The tender names resolve through PAYMENT_NAMES; bank_transfer has no entry
    // and falls back to its raw code, which is the honest label.
    expect(screen.getByText('Cash')).toBeInTheDocument();
    expect(screen.getByText('bank_transfer')).toBeInTheDocument();
    // REP-06: the total is per currency, and 21,200,000 IDR minor units must appear
    // as money rather than as a bare number.
    expect(screen.getByText(/21,200,000|21\.200\.000/)).toBeInTheDocument();
  });
  it('renders customers card with data', () => {
    mockUseAnalyticsQuery.mockReturnValue({
      data: { new_count: 25, returning_count: 125, total_spend_minor: 50000 },
      isLoading: false,
      error: null,
    });
    render(<AnalyticsCardContent {...baseProps} cardKey="customers" />);
    expect(screen.getByTestId('echarts')).toBeInTheDocument();
  });

  it('renders basket card with data', () => {
    mockUseAnalyticsQuery.mockReturnValue({
      data: { avg_line_count: 3.2, sale_count: 50, buckets: [{ label: '1', value: 50 }] },
      isLoading: false,
      error: null,
    });
    render(<AnalyticsCardContent {...baseProps} cardKey="basket" />);
    expect(screen.getByTestId('echarts')).toBeInTheDocument();
  });

  it('renders low-stock card with data', () => {
    mockUseAnalyticsQuery.mockReturnValue({
      data: [
        { product_name: 'Widget', current_qty: 2, sku: 'WDG-001', product_id: 'p1' },
        { product_name: 'Gadget', current_qty: 4, sku: 'GDG-001', product_id: 'p2' },
      ],
      isLoading: false,
      error: null,
    });
    const { container } = render(<AnalyticsCardContent {...baseProps} cardKey="low-stock" />);
    expect(container.querySelector('.analytics-card-visual')).toBeInTheDocument();
  });

  it('returns null for unknown card key', () => {
    mockUseAnalyticsQuery.mockReturnValue({ data: null, isLoading: false, error: null });
    const { container } = render(
      <AnalyticsCardContent {...baseProps} cardKey="nonexistent" />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('passes sessionToken to query', () => {
    mockUseAnalyticsQuery.mockReturnValue({ data: null, isLoading: true, error: null });
    render(<AnalyticsCardContent {...baseProps} cardKey="revenue" sessionToken="tok-123" />);
    expect(mockUseAnalyticsQuery).toHaveBeenCalled();
  });

  it('handles compare mode prop', () => {
    mockUseAnalyticsQuery.mockReturnValue({
      data: { aov_minor: 1500, total_orders: 20, total_minor: 30000, buckets: [{ label: 'Aug 1', value: 1500 }] },
      isLoading: false,
      error: null,
    });
    render(<AnalyticsCardContent {...baseProps} cardKey="aov" compare={true} />);
    expect(screen.getByTestId('echarts')).toBeInTheDocument();
  });

  it('handles expanded prop', () => {
    mockUseAnalyticsQuery.mockReturnValue({
      data: { aov_minor: 1500, total_orders: 20, total_minor: 30000, buckets: [{ label: 'Aug 1', value: 1500 }] },
      isLoading: false,
      error: null,
    });
    render(<AnalyticsCardContent {...baseProps} cardKey="aov" expanded={true} />);
    expect(screen.getByTestId('echarts')).toBeInTheDocument();
  });
});

// REP-06 follow-up (a): the category pie previously drew one slice per
// (category, currency) row — IDR minor units (×10⁴ larger) dwarfed USD
// slices and the within-currency percentages became meaningless when
// mixed. The pie is now per-currency tabs; the display currency (from
// CurrencyContext, mocked 'USD' here) picks the default tab.
describe('CategoryCard — per-currency pie tabs (REP-06a)', () => {
  const q = {
    granularity: 'daily' as const,
    workspaceView: 'retail' as const,
    from: '2026-08-01',
    to: '2026-08-19',
    sessionToken: 'test-token',
    title: 'Categories',
  };
  const rows = [
    { currency: 'USD', category_id: 'c1', category_name: 'Drinks', total_minor: 6000, sale_count: 6, percentage: 60 },
    { currency: 'USD', category_id: 'c2', category_name: 'Food', total_minor: 4000, sale_count: 4, percentage: 40 },
    { currency: 'IDR', category_id: 'c1', category_name: 'Drinks', total_minor: 90000000, sale_count: 9, percentage: 90 },
    { currency: 'IDR', category_id: 'c3', category_name: 'Retail', total_minor: 10000000, sale_count: 1, percentage: 10 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAnalyticsQuery.mockReturnValue({ data: rows, isLoading: false, error: null });
  });

  it('renders one tab per currency present in the rows', () => {
    render(<AnalyticsCardContent {...q} cardKey="category" />);
    expect(screen.getByRole('button', { name: 'USD' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'IDR' })).toBeInTheDocument();
  });

  it('defaults to the display currency and draws only its slices', () => {
    render(<AnalyticsCardContent {...q} cardKey="category" />);
    const usd = screen.getByRole('button', { name: 'USD' });
    expect(usd).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('echarts').getAttribute('data-series')).toBe(
      JSON.stringify(['Drinks', 'Food']),
    );
  });

  it('switching the tab re-renders the pie with that currency only', () => {
    render(<AnalyticsCardContent {...q} cardKey="category" />);
    fireEvent.click(screen.getByRole('button', { name: 'IDR' }));
    expect(screen.getByRole('button', { name: 'IDR' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('echarts').getAttribute('data-series')).toBe(
      JSON.stringify(['Drinks', 'Retail']),
    );
  });

  it('single-currency rows render no tab strip', () => {
    mockUseAnalyticsQuery.mockReturnValue({
      data: rows.filter((r) => r.currency === 'USD'),
      isLoading: false,
      error: null,
    });
    render(<AnalyticsCardContent {...q} cardKey="category" />);
    expect(screen.queryByRole('button', { name: 'USD' })).not.toBeInTheDocument();
    expect(screen.getByTestId('echarts').getAttribute('data-series')).toBe(
      JSON.stringify(['Drinks', 'Food']),
    );
  });
});
