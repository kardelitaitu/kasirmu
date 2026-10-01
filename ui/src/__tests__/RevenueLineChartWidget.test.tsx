import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import RevenueLineChartWidget from '@/features/sales/widgets/RevenueLineChartWidget';
import {
  assertCaseDiscriminates,
  discriminatingStoreZone,
  expectedStoreDay,
} from './test-utils/storeZoneCase';

// ── Mocks ──────────────────────────────────────────────────────────────

const mockGetDailyRevenue = vi.fn();
const mockGetPrimaryLocationScoped = vi.fn();

// REP-03: the widget anchors its 14-day window to the STORE's calendar, so
// the store profile must be mockable or the store-zone path silently falls
// back to UTC and the test below would pass vacuously.
vi.mock('@/api/locations', () => ({
  getPrimaryLocationScoped: (...args: unknown[]) => mockGetPrimaryLocationScoped(...args),
}));
vi.mock('@/api/reports', () => ({
  getDailyRevenue: (...args: unknown[]) => mockGetDailyRevenue(...args),
}));

vi.mock('@/contexts/WorkspaceContext', () => {
  const ctx = React.createContext({ sessionToken: 'test-token' });
  // R36-07: the component now reads the token through useWorkspace(), so
  // this local mock must provide it too. Deriving it from the same context
  // keeps an explicit <WorkspaceContext.Provider> working in a test.
  return { WorkspaceContext: ctx, useWorkspace: () => React.useContext(ctx) };
});

vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ currency: 'USD' }),
}));

vi.mock('@fluent/react', () => {
  const stableL10n = {
    getString: (id: string) => {
      const map: Record<string, string> = {
        'sales-dashboard-revenue-title': 'Revenue (14d)',
        'sales-dashboard-revenue-aria': 'Revenue line chart',
        'sales-dashboard-revenue-summary': '{total} over {days} days',
        'sales-dashboard-no-data': 'No data for this period',
        'app-error-generic': 'An error occurred',
      };
      return map[id] || id;
    },
  };
  return {
    Localized: ({ children }: { id: string; children: React.ReactNode }) => <>{children}</>,
    useLocalization: () => ({ l10n: stableL10n }),
  };
});

vi.mock('@/utils/app-error', () => ({
  l10nErrorMessage: () => 'An error occurred',
}));

vi.mock('@/components/charts/CanvasLineChart', () => ({
  default: ({ data, summary }: { data: unknown[]; summary: string }) => (
    <div data-testid="line-chart" data-count={data.length}>
      {summary}
    </div>
  ),
}));

vi.mock('@/components/Skeleton', () => ({
  Skeleton: ({ width }: { width?: string }) => <div data-testid="skeleton" data-width={width} />,
}));

// ── Tests ──────────────────────────────────────────────────────────────

describe('RevenueLineChartWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // REP-03: clearAllMocks() drops the implementation too, so the store
    // lookup has to be re-armed every test or the hook reads `.then` off
    // undefined. 'UTC' is the schema's own column default, which is also what
    // the hook falls back to, so these tests keep their previous behaviour and
    // only the store-anchoring case below overrides it.
    mockGetPrimaryLocationScoped.mockResolvedValue({
      id: 'store-a',
      name: 'Store A',
      timezone: 'UTC',
    });
  });

  it('shows skeleton while loading', () => {
    mockGetDailyRevenue.mockReturnValue(new Promise(() => {}));
    render(<RevenueLineChartWidget />);
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
  });

  it('shows error message when API fails', async () => {
    mockGetDailyRevenue.mockRejectedValue(new Error('network'));
    render(<RevenueLineChartWidget />);
    await waitFor(() => {
      expect(screen.getByText('An error occurred')).toBeInTheDocument();
    });
  });

  it('renders chart when data is available', async () => {
    mockGetDailyRevenue.mockResolvedValue([
      { date: '2026-08-01', total_minor: 5000 },
      { date: '2026-08-02', total_minor: 3000 },
    ]);
    render(<RevenueLineChartWidget />);
    await waitFor(() => {
      expect(screen.getByTestId('line-chart')).toBeInTheDocument();
    });
    expect(screen.getByTestId('line-chart').getAttribute('data-count')).toBe('2');
  });

  it('displays total revenue KPI', async () => {
    mockGetDailyRevenue.mockResolvedValue([
      { date: '2026-08-01', total_minor: 5000 },
      { date: '2026-08-02', total_minor: 3000 },
    ]);
    render(<RevenueLineChartWidget />);
    await waitFor(() => {
      expect(screen.getByText('Revenue (14d)')).toBeInTheDocument();
    });
    // $80.00 = (5000 + 3000) / 100
    expect(screen.getByText('$80.00')).toBeInTheDocument();
  });

  it('renders title in success state', async () => {
    mockGetDailyRevenue.mockResolvedValue([
      { date: '2026-08-01', total_minor: 1000 },
    ]);
    render(<RevenueLineChartWidget />);
    await waitFor(() => {
      expect(screen.getByText('Revenue (14d)')).toBeInTheDocument();
    });
  });

  it('calls API with correct date range (14 days)', async () => {
    mockGetDailyRevenue.mockResolvedValue([]);
    render(<RevenueLineChartWidget />);
    await waitFor(() => {
      expect(mockGetDailyRevenue).toHaveBeenCalled();
    });
    const args = mockGetDailyRevenue.mock.calls[0] as string[];
    const [start, end] = args;
    expect(start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('formats $0.00 when no data', async () => {
    mockGetDailyRevenue.mockResolvedValue([]);
    render(<RevenueLineChartWidget />);
    await waitFor(() => {
      expect(screen.getByText('$0.00')).toBeInTheDocument();
    });
  });

  // ── REP-03: the window is the STORE's, not UTC's ────────────────
  // The backend buckets every row by the store's offset (REP-03, pinned by
  // daily_revenue_buckets_by_store_timezone at
  // crates/kasirmu-core/src/db/reports_tests.rs:2473), so a range ending on the
  // UTC day asks for a window that STOPS SHORT of the store's current trading day
  // whenever the store has already crossed midnight. Measured at 2026-09-04T21:30Z:
  // a +07:00 store is on 09-05 while a UTC-anchored end date still says 09-04.
  //
  // Expected values come from test-utils/storeZoneCase (plain UTC arithmetic),
  // NOT from isoToday/isoDaysAgo, so the assertion does not restate the code
  // under test. The zone is discriminating by construction: a hardcoded +14:00
  // would be vacuous for ten hours of every day, which is the "passes at some
  // hours, fails at others" property a regression guard must never have.
  // scripts/check-tz-invariance.py replays this file under five host zones.
  it(`the last 14 days, the store's calendar days`, async () => {
    mockGetDailyRevenue.mockResolvedValue([]);
    const zone = discriminatingStoreZone();
    assertCaseDiscriminates(zone);
    mockGetPrimaryLocationScoped.mockResolvedValue({
      id: 'store-a',
      name: 'Store A',
      timezone: zone.offset,
    });

    render(<RevenueLineChartWidget />);
    await waitFor(() => {
      expect(mockGetDailyRevenue).toHaveBeenCalled();
    });

    // The zone arrives AFTER the first render, so the window is refetched once
    // it lands; assert on the LAST call, not the first.
    await waitFor(() => {
      const calls = mockGetDailyRevenue.mock.calls;
      const args = calls[calls.length - 1] as string[];
      expect(args[0]).toBe(expectedStoreDay(zone, 13));
      expect(args[1]).toBe(expectedStoreDay(zone, 0));
    });
    // The store must actually have been consulted, or storeTz stayed null and
    // both values are the UTC fallback — which is a different day on purpose.
    expect(mockGetPrimaryLocationScoped).toHaveBeenCalled();
  });
});
