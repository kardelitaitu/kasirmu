import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
// renderWithProviders* (not renderWithFluentSync): the EOD screen's print button now
// reports a failed print through the toast context, so it needs a ToastProvider.
import { renderWithProvidersSync } from '@/__tests__/test-utils/render';
import salesFtl from '@/locales/sales.ftl?raw';
import shiftsFtl from '@/locales/shifts.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import EodReportScreen, { closedShiftsOnStoreDay } from '@/features/sales/EodReportScreen';
import { FALLBACK_STORE_TZ } from '@/features/analytics/analytics-data';

// ── Mocks ────────────────────────────────────────────────────────────

const mockEodReport = vi.fn();
const mockEodReportScoped = vi.fn();
const mockListShifts = vi.fn();
const mockPrintReceipt = vi.fn();

vi.mock('@/api/sales', () => ({
  exportEodReport: (...args: unknown[]) => mockEodReport(...args),
  // Separate fn, not the shared-target trick used for listShifts/listShiftsScoped two lines
  // below: the point of the ADR #7 case is to tell the two apart, and aliasing them makes the
  // assertion unfalsifiable.
  exportEodReportScoped: (...args: unknown[]) => mockEodReportScoped(...args),
}));

vi.mock('@/api/shifts', () => ({
  listShifts: (...args: unknown[]) => mockListShifts(...args),
  listShiftsScoped: (...args: unknown[]) => mockListShifts(...args),
}));

vi.mock('@/api/hardware', () => ({
  printReceiptScoped: (...args: unknown[]) => mockPrintReceipt(...args),
}));

// The screen reads the store's offset through useStoreTimezone, which fetches
// it asynchronously. Without this the zone arrives some ticks AFTER the shifts
// do, so a fixture built on the UTC day is reconciled under one calendar and
// re-reconciled under the other a moment later -- which is exactly how
// 'shows over/short tags for shift cash differences' came to fail on some runs
// and pass on others with identical inputs.
//
// 'UTC' is pinned deliberately. It makes every fixture below agree with the
// screen by construction, so the store-day behaviour itself is exercised ONLY
// by the dedicated describe block at the foot of this file, where the offset is
// passed explicitly and cannot race.
const mockGetPrimaryLocationScoped = vi.fn();
vi.mock('@/api/locations', () => ({
  getPrimaryLocationScoped: (...args: unknown[]) => mockGetPrimaryLocationScoped(...args),
}));

// EodReportScreen.tsx:10 imports buildCsv/downloadCsv from here. Only the
// download is replaced — buildCsv stays real so a malformed header/row pair
// still surfaces as a throw instead of being mocked silent.
const mockDownloadCsv = vi.fn();

vi.mock('@/features/reports/csv', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/features/reports/csv');
  return {
    ...actual,
    downloadCsv: (...args: unknown[]) => mockDownloadCsv(...args),
  };
});

// ── Helpers ───────────────────────────────────────────────────────────

function makeEodReport(overrides: Record<string, unknown> = {}) {
  return {
    total_sales: 10,
    total_revenue: 500000,
    currency: 'IDR',
    payment_breakdown: [
      { method: 'cash', count: 5, total: 250000 },
      { method: 'card', count: 5, total: 250000 },
    ],
    void_count: 1,
    void_total: 25000,
    discount_count: 2,
    discount_total: 10000,
    hourly_breakdown: [
      { hour: 8, total_minor: 50000, sale_count: 1 },
      { hour: 14, total_minor: 450000, sale_count: 9 },
    ],
    ...overrides,
  };
}

function makeShift(overrides: Record<string, unknown> = {}) {
  return {
    id: 'shift-1',
    userId: 'user-1',
    terminalId: null,
    openedAt: '2025-07-07T08:00:00.000Z',
    closedAt: '2025-07-07T18:00:00.000Z',
    openingBalanceMinor: 100000,
    closingBalanceMinor: 400000,
    expectedCashMinor: 350000,
    cashDifferenceMinor: 50000,
    totalSalesMinor: 500000,
    totalCashMinor: 250000,
    totalCardMinor: 250000,
    totalOtherMinor: 0,
    totalVoidsMinor: 25000,
    totalRefundsMinor: 0,
    totalPayoutsMinor: 0,
    notes: '',
    status: 'closed',
    createdAt: '2025-07-07T08:00:00.000Z',
    updatedAt: '2025-07-07T18:00:00.000Z',
    ...overrides,
  };
}

function renderScreen() {
  return renderWithProvidersSync(<EodReportScreen />, salesFtl, shiftsFtl, sharedFtl);
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('EodReportScreen', () => {
  beforeEach(() => {
    mockEodReport.mockReset();
    // Reset alongside its ambient twin: the ADR #7 case asserts the ambient one is NOT called, and
    // a scoped call count leaking from an earlier test would not break that assertion -- it would
    // just make the scoped side untrustworthy.
    mockEodReportScoped.mockReset();
    mockListShifts.mockReset();
    mockPrintReceipt.mockReset();
    mockDownloadCsv.mockReset();
    // Pinned in beforeEach, not at module scope: mockReset() above would clear
    // a module-scope implementation and leave the fetch returning undefined,
    // which the hook swallows into storeTz = null -- and null resolves to
    // FALLBACK_STORE_TZ, a different value again.
    mockGetPrimaryLocationScoped.mockReset();
    mockGetPrimaryLocationScoped.mockResolvedValue({ id: 'store-1', timezone: 'UTC' });
  });

  it('renders the title', async () => {
    mockEodReportScoped.mockResolvedValue(makeEodReport());
    mockListShifts.mockResolvedValue([]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('End-of-Day Report')).toBeTruthy();
    });
  });

  it('shows loading skeleton initially', () => {
    mockEodReportScoped.mockImplementation(() => new Promise(() => {}));
    mockListShifts.mockImplementation(() => new Promise(() => {}));
    const { container } = renderScreen();

    const skeleton = container.querySelector('.eod-report-loading-skeleton');
    expect(skeleton).toBeTruthy();
    expect(skeleton?.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows error state with retry button', async () => {
    mockEodReportScoped.mockRejectedValue(new Error('Network error'));
    mockListShifts.mockRejectedValue(new Error('Network error'));
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Retry')).toBeTruthy();
    });
  });

  it('shows empty state when no report data', async () => {
    mockEodReportScoped.mockResolvedValue(null);
    mockListShifts.mockResolvedValue([]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('No sales data available for today.')).toBeTruthy();
    });
  });

  it('shows KPI cards when report loads', async () => {
    mockEodReportScoped.mockResolvedValue(makeEodReport());
    mockListShifts.mockResolvedValue([]);
    renderScreen();

    await waitFor(() => {
      // Total Revenue appears in both KPI card and summary table
      const revenueEls = screen.getAllByText('Total Revenue');
      expect(revenueEls.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Average Sale')).toBeTruthy();
      expect(screen.getByText('Voids')).toBeTruthy();
      expect(screen.getByText('Discounts Applied')).toBeTruthy();
    });
  });

  it('shows payment breakdown with progress bars', async () => {
    mockEodReportScoped.mockResolvedValue(makeEodReport());
    mockListShifts.mockResolvedValue([]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Payment Breakdown')).toBeTruthy();
      expect(screen.getByText('Cash')).toBeTruthy();
      expect(screen.getByText('Card')).toBeTruthy();
    });

    const bars = document.querySelectorAll('.eod-report-payment-bar');
    expect(bars.length).toBe(2);
  });

  it('shows hourly sales chart', async () => {
    mockEodReportScoped.mockResolvedValue(makeEodReport());
    mockListShifts.mockResolvedValue([]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Sales by Hour')).toBeTruthy();
    });

    const barRows = document.querySelectorAll('.eod-report-hour-bar-row');
    expect(barRows.length).toBe(24);
  });

  it('has a Refresh button', async () => {
    mockEodReportScoped.mockResolvedValue(makeEodReport());
    mockListShifts.mockResolvedValue([]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Refresh')).toBeTruthy();
    });
  });

  it('has a Print button', async () => {
    mockEodReportScoped.mockResolvedValue(makeEodReport());
    mockListShifts.mockResolvedValue([]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Print')).toBeTruthy();
    });
  });

  it('clicks Refresh re-fetches data', async () => {
    mockEodReportScoped.mockResolvedValue(makeEodReport());
    mockListShifts.mockResolvedValue([]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Refresh')).toBeTruthy();
    });

    const user = userEvent.setup();
    await user.click(screen.getByText('Refresh'));

    expect(mockEodReportScoped).toHaveBeenCalledTimes(2);
    expect(mockListShifts).toHaveBeenCalledTimes(2);
  });

  it('shows shift summary when closed shifts exist for today', async () => {
    const today = new Date().toISOString().slice(0, 10);
    mockEodReportScoped.mockResolvedValue(makeEodReport({ total_sales: 5 }));
    mockListShifts.mockResolvedValue([
      makeShift({
        openedAt: `${today}T08:00:00.000Z`,
        closedAt: `${today}T18:00:00.000Z`,
      }),
    ]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Cashier Shifts')).toBeTruthy();
      expect(screen.getByText('Closed Shifts Today')).toBeTruthy();
    });
  });

  it('shows active shift banner when a shift is open', async () => {
    const today = new Date().toISOString().slice(0, 10);
    mockEodReportScoped.mockResolvedValue(makeEodReport({ total_sales: 0 }));
    mockListShifts.mockResolvedValue([
      makeShift({
        status: 'open',
        closedAt: null,
        closingBalanceMinor: null,
        openedAt: `${today}T08:00:00.000Z`,
      }),
    ]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Shift in progress')).toBeTruthy();
    });
  });

  // ── Print functionality with shifts ──
  it('calls printReceiptScoped with shift data when shifts provided', async () => {
    mockEodReportScoped.mockResolvedValue(makeEodReport());
    const today = new Date().toISOString().slice(0, 10);
    mockListShifts.mockResolvedValue([
      makeShift({
        openedAt: `${today}T08:00:00.000Z`,
        closedAt: `${today}T18:00:00.000Z`,
      }),
      makeShift({
        id: 'shift-2',
        status: 'open',
        closedAt: null,
        closingBalanceMinor: null,
        openedAt: `${today}T10:00:00.000Z`,
      }),
    ]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Print')).toBeTruthy();
    });

    const user = userEvent.setup();
    await user.click(screen.getByText('Print'));

    // Wait for print to be called
    await waitFor(() => {
      expect(mockPrintReceipt).toHaveBeenCalled();
    }, { timeout: 2000 });
  });

  // ── CSV Export functionality ──
  it('calls downloadCsv when Export CSV button clicked', async () => {
    mockEodReportScoped.mockResolvedValue(makeEodReport());
    mockListShifts.mockResolvedValue([]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Export CSV')).toBeTruthy();
    });

    const user = userEvent.setup();
    await user.click(screen.getByText('Export CSV'));

    // The CSV export is async, wait for it to complete
    await waitFor(() => {
      expect(mockDownloadCsv).toHaveBeenCalledTimes(1);
    }, { timeout: 2000 });

    // Filename is stamped from the refresh time (EodReportScreen.tsx:417).
    const [csv, filename] = mockDownloadCsv.mock.calls[0] as [string, string];
    expect(filename).toMatch(/^end-of-day-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(csv).toContain(',');
  });

  // ── Shift summary with diff tags ──
  it('shows over/short tags for shift cash differences', async () => {
    const today = new Date().toISOString().slice(0, 10);
    mockEodReportScoped.mockResolvedValue(makeEodReport({ total_sales: 5 }));
    mockListShifts.mockResolvedValue([
      makeShift({
        openedAt: `${today}T08:00:00.000Z`,
        closedAt: `${today}T18:00:00.000Z`,
        cashDifferenceMinor: 50000, // Over
      }),
      makeShift({
        id: 'shift-2',
        openedAt: `${today}T10:00:00.000Z`,
        closedAt: `${today}T20:00:00.000Z`,
        cashDifferenceMinor: -25000, // Short
      }),
    ]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Cashier Shifts')).toBeTruthy();
    });

    // The tags are rendered with l10n.getString('eod-tag-over') and 'eod-tag-short'
    // which return "Over" and "Short" in English
    // Note: there are multiple "Over" elements (individual shifts + totals row)
    const overTags = screen.getAllByText('Over');
    const shortTags = screen.getAllByText('Short');
    expect(overTags.length).toBeGreaterThanOrEqual(2); // At least 2 (shift row + totals)
    expect(shortTags.length).toBe(1);
  });

  // ── Hourly breakdown chart ──
  it('renders all 24 hours in hourly breakdown', async () => {
    mockEodReportScoped.mockResolvedValue(makeEodReport());
    mockListShifts.mockResolvedValue([]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Sales by Hour')).toBeTruthy();
    });

    const barRows = document.querySelectorAll('.eod-report-hour-bar-row');
    expect(barRows.length).toBe(24);
  });

  // ── CSV Export with no report data ──
  it('shows empty state when no report data', async () => {
    mockEodReportScoped.mockResolvedValue(null);
    mockListShifts.mockResolvedValue([]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('No sales data available for today.')).toBeTruthy();
    });

    // Export CSV button is still rendered but clicking it does nothing when no data
    const exportBtn = screen.queryByText('Export CSV');
    expect(exportBtn).toBeInTheDocument();
  });

  // ── CSV Export guard ──
  it('does nothing when clicking Export CSV with no report data', async () => {
    mockEodReportScoped.mockResolvedValue(null);
    mockListShifts.mockResolvedValue([]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('No sales data available for today.')).toBeTruthy();
    });

    const user = userEvent.setup();
    await user.click(screen.getByText('Export CSV'));

    // exportCsv bails at `if (!r) return` (EodReportScreen.tsx:388) — no file
    // is written and nothing throws. Asserting the negative is the whole point:
    // a guard that silently wrote an empty CSV would still "not throw".
    expect(mockDownloadCsv).not.toHaveBeenCalled();
  });

  // ── Discount count = 0 branch ──
  it('shows "No discounts applied" when discount_count is 0', async () => {
    mockEodReportScoped.mockResolvedValue(makeEodReport({ discount_count: 0, discount_total: 0 }));
    mockListShifts.mockResolvedValue([]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('No discounts applied')).toBeTruthy();
    });
  });

  // ── Empty payment breakdown ──
  it('shows "No payment data" when payment_breakdown is empty', async () => {
    mockEodReportScoped.mockResolvedValue(makeEodReport({ payment_breakdown: [] }));
    mockListShifts.mockResolvedValue([]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('No payment data')).toBeTruthy();
    });
  });

  // ── Empty hourly breakdown ──
  it('shows "No hourly data" when hourly_breakdown is empty', async () => {
    mockEodReportScoped.mockResolvedValue(makeEodReport({ hourly_breakdown: [] }));
    mockListShifts.mockResolvedValue([]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('No hourly data')).toBeTruthy();
    });
  });

  // ── Error handling during load ──
  it('shows error when exportEodReport fails', async () => {
    mockEodReportScoped.mockRejectedValue(new Error('Database error'));
    mockListShifts.mockResolvedValue([]);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Retry')).toBeTruthy();
    });
  });

  // ── Loading state ──
  it('shows loading skeleton while fetching data', async () => {
    let resolveReport: (value: unknown) => void;
    const reportPromise = new Promise((resolve) => { resolveReport = resolve; });
    mockEodReportScoped.mockReturnValue(reportPromise);
    mockListShifts.mockReturnValue(new Promise(() => {}));
    renderScreen();

    const skeleton = document.querySelector('.eod-report-loading-skeleton');
    expect(skeleton).toBeTruthy();

    resolveReport!(makeEodReport());
    await waitFor(() => {
      expect(screen.queryByText('End-of-Day Report')).toBeTruthy();
    });
  });

  // ADR #7: load() reads the report and the shifts in one Promise.all -- exportEodReport() ambient
  // beside listShiftsScoped(sessionToken). The shifts call was scoped and the report call beside it
  // was not, and desktop-client registers no export_eod_report command, so the screen's load threw
  // on every desktop visit and rendered its error state.
  it('loads the report through the scoped command when a session token exists', async () => {
    mockEodReportScoped.mockResolvedValue(makeEodReport());
    mockListShifts.mockResolvedValue([]);
    renderScreen();

    await waitFor(() => {
      expect(mockEodReportScoped).toHaveBeenCalled();
    });
    expect(mockEodReport).not.toHaveBeenCalled();
  });
});

// ── REP-03: the shift reconciliation is the STORE's day, not UTC's ──────────
//
// This file is where the UTC-prefix filter lives, so it is where the pin has to
// be. `closedShiftsOnStoreDay` takes a `now` seam precisely because the defect
// is only observable while the store and UTC disagree about the date; a test
// written against the wall clock would have been green for most of the day and
// useless as a regression gate.
describe('closedShiftsOnStoreDay — store-day anchoring (REP-03)', () => {
  // Every fixture below is chosen so the store day and the UTC day DISAGREE,
  // and the choice is ASSERTED, not assumed -- see the first case. The defect
  // exists only while those two calendars differ, so a fixture that agreed with
  // them would make the case below it pass for the wrong reason.
  //
  // Shifts run ~12h, so a close time is an OFFSET BACK FROM NOW rather than a
  // wall-clock date: realistic, and one helper then builds a discriminating
  // pair and a control.
  //
  // NOW is midday UTC deliberately: at 00:00Z a +14 store has ALREADY crossed
  // into the next day, which inverts every fixture. The earlier drafts of this
  // block used midnight and asserted the opposite direction of the same
  // relationship -- they passed by measuring a fixture and asserting the wrong
  // sign of the result. Pinning NOW here and deriving each offset from the
  // arithmetic below is what stops that recurring.
  const NOW = Date.parse('2026-09-04T12:00:00Z');
  const closedAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

  // The store calendar day for an offset, as this test computes it: the
  // instant shifted, then read on the UTC calendar. Plain arithmetic, written
  // out here so no expectation below is produced by the code under test.
  const storeDayAt = (hoursAgo: number, offsetHours: number) =>
    new Date(NOW - hoursAgo * 3_600_000 + offsetHours * 3_600_000).toISOString().slice(0, 10);
  const utcDayAt = (hoursAgo: number) =>
    new Date(NOW - hoursAgo * 3_600_000).toISOString().slice(0, 10);

  // 13h back is 23:00Z on the 3rd: yesterday in UTC, but 09:00 on the 3rd at
  // -14:00, which IS the store's today (the store is on the 3rd at midday UTC).
  // The old filter compared the UTC prefix "2026-09-03" against UTC's today
  // "2026-09-04", found no match, and dropped the shift from the
  // reconciliation entirely.
  const STORE_TODAY_UTC_YESTERDAY = 13;
  // 6h back is 06:00Z on the 4th: today in UTC, but yesterday at +14:00.
  const UTC_TODAY_STORE_YESTERDAY = 6;
  // 1h back: both calendars say today. The control that catches a fix which
  // moves shifts that were always right.
  const SAME_DAY_BOTH = 1;
  // 30h back: both calendars say yesterday.
  const BOTH_YESTERDAY = 30;

  it('files a shift under the store day that closed it, not under UTC', () => {
    const shifts = [makeShift({ closedAt: closedAgo(STORE_TODAY_UTC_YESTERDAY) })];

    // The discriminating claim, made first so the next line cannot be vacuous.
    expect(utcDayAt(STORE_TODAY_UTC_YESTERDAY)).not.toBe(utcDayAt(0));
    expect(storeDayAt(STORE_TODAY_UTC_YESTERDAY, -14)).toBe(storeDayAt(0, -14));
    expect(closedShiftsOnStoreDay(shifts, '-14:00', NOW)).toHaveLength(1);
    // The old filter compared the UTC prefix, so it dropped this shift.
    expect(closedShiftsOnStoreDay(shifts, 'UTC', NOW)).toHaveLength(0);
  });

  it('drops a shift the store saw yesterday but UTC calls today', () => {
    const shifts = [makeShift({ closedAt: closedAgo(UTC_TODAY_STORE_YESTERDAY) })];

    // Same discrimination, other direction: today for the cashier, yesterday
    // for a store at +14:00, which at midday UTC is already on the 5th.
    expect(utcDayAt(UTC_TODAY_STORE_YESTERDAY)).toBe(utcDayAt(0));
    expect(storeDayAt(UTC_TODAY_STORE_YESTERDAY, 14)).not.toBe(storeDayAt(0, 14));
    expect(closedShiftsOnStoreDay(shifts, '+14:00', NOW)).toHaveLength(0);
    expect(closedShiftsOnStoreDay(shifts, 'UTC', NOW)).toHaveLength(1);
  });

  it('agrees with UTC when the two calendars name the same day', () => {
    // The fix must not have turned a UTC-anchored screen into a store-anchored
    // one that also MOVES shifts that were always right.
    const shifts = [makeShift({ closedAt: closedAgo(SAME_DAY_BOTH) })];

    expect(storeDayAt(SAME_DAY_BOTH, 14)).toBe(storeDayAt(0, 14));
    expect(closedShiftsOnStoreDay(shifts, '+14:00', NOW)).toHaveLength(1);
    expect(closedShiftsOnStoreDay(shifts, '-14:00', NOW)).toHaveLength(1);
    expect(closedShiftsOnStoreDay(shifts, 'UTC', NOW)).toHaveLength(1);
  });

  it('drops a shift both calendars call yesterday', () => {
    const shifts = [makeShift({ closedAt: closedAgo(BOTH_YESTERDAY) })];

    expect(storeDayAt(BOTH_YESTERDAY, 14)).not.toBe(storeDayAt(0, 14));
    expect(closedShiftsOnStoreDay(shifts, '+14:00', NOW)).toHaveLength(0);
    expect(closedShiftsOnStoreDay(shifts, 'UTC', NOW)).toHaveLength(0);
  });

  it('separates the two days at every hour of the day, for shifts of every age', () => {
    // Not "exactly one of the two zones says yes" -- that is false, and asserting
    // it was the first mistake in this file. A shift that closed 1h ago is the
    // same day for BOTH calendars, and one that closed 20h ago is the previous
    // day for BOTH; only a middle band disagrees. Measured over the sweep below
    // (24 instants x ages 1..20h, offset +14:00): 196 pairs agree, 136 agree on
    // being yesterday, 74 say yes for the store only, 74 for UTC only.
    //
    // The claim worth pinning is therefore the DIRECTION, not a count: whenever
    // the two zones disagree, the store must say yes exactly when the store's
    // own calendar says the close happened on the store's own today. Recomputed
    // independently here with plain UTC arithmetic on the shifted instants, so
    // the expectation does not come from the function under test.
    const H = 3_600_000;
    let disagreed = 0;
    for (let hour = 0; hour < 24; hour++) {
      for (const ageH of [1, 6, 12, 20]) {
        const now = NOW + hour * H;
        const closed = now - ageH * H;
        const onStoreDay = new Date(closed + 14 * H).toISOString().slice(0, 10)
          === new Date(now + 14 * H).toISOString().slice(0, 10);
        const onUtcDay = new Date(closed).toISOString().slice(0, 10)
          === new Date(now).toISOString().slice(0, 10);
        const shifts = [makeShift({ closedAt: new Date(closed).toISOString() })];
        expect(closedShiftsOnStoreDay(shifts, '+14:00', now).length, `hour ${hour}, age ${ageH}h`)
          .toBe(onStoreDay ? 1 : 0);
        if (onStoreDay !== onUtcDay) disagreed++;
      }
    }
    // Guard against the sweep silently degenerating into a no-op.
    expect(disagreed).toBeGreaterThan(0);
  });

  it('is unaffected by the host zone', () => {
    // Not a self-comparison (an earlier draft of this test compared the helper
    // with itself and could never fail). Every day in the helper is read on a
    // UTC calendar after shifting by the store offset, and the host zone is
    // never consulted -- so the same call must produce the same array under any
    // host. Only a host-sensitive implementation could break this, and the way
    // to break it here is to move the comparison to a gate that runs under
    // several host zones; see the registration in scripts/check-tz-invariance.py.
    const shifts = [makeShift({ closedAt: closedAgo(STORE_TODAY_UTC_YESTERDAY) })];
    const result = closedShiftsOnStoreDay(shifts, '-14:00', NOW);

    expect(result).toHaveLength(1);
    expect(result.map((s) => s.closedAt)).toEqual([closedAgo(STORE_TODAY_UTC_YESTERDAY)]);
    // The instant's own date is the 3rd; the store at -14:00, which at midday
    // UTC is still on the 3rd, is looking at the 3rd. A raw string comparison of
    // the unshifted instant against UTC's day would have said 'no'.
    expect(closedAgo(STORE_TODAY_UTC_YESTERDAY).slice(0, 10))
      .not.toBe(utcDayAt(0));
    expect(utcDayAt(STORE_TODAY_UTC_YESTERDAY)).toBe(storeDayAt(0, -14));
  });

  it('falls back to the store default when no zone is known', () => {
    const shifts = [makeShift({ closedAt: closedAgo(STORE_TODAY_UTC_YESTERDAY) })];
    // FALLBACK_STORE_TZ is UTC, so an unknown zone keeps the previous
    // behaviour rather than silently adopting the device's (analytics-data:99-117
    // is why that fallback is a fixed constant and not the host).
    expect(closedShiftsOnStoreDay(shifts, null, NOW)).toHaveLength(0);
    expect(closedShiftsOnStoreDay(shifts, undefined, NOW)).toHaveLength(0);
    expect(closedShiftsOnStoreDay(shifts, FALLBACK_STORE_TZ, NOW)).toHaveLength(0);
    // And a value that is not a fixed +-HH:MM offset resolves to 0 too, which
    // is the path a store profile with an IANA name would take if a caller ever
    // passed one straight through.
    expect(closedShiftsOnStoreDay(shifts, 'Asia/Jakarta', NOW)).toHaveLength(0);
  });

  it('ignores open shifts and shifts with no close time', () => {
    const shifts = [
      makeShift({ status: 'open', closedAt: closedAgo(SAME_DAY_BOTH) }),
      makeShift({ status: 'closed', closedAt: null }),
    ];
    expect(closedShiftsOnStoreDay(shifts, '+14:00', NOW)).toHaveLength(0);
  });

  it('keeps every closed shift the store saw today, and drops the rest', () => {
    // A drawer that reconciles three shifts must not lose one because the
    // cashier's terminal sits in a different region than the store. 'a' is
    // today everywhere; 'b' is today only for a store behind UTC; 'c' is
    // yesterday everywhere.
    const shifts = [
      makeShift({ id: 'a', closedAt: closedAgo(UTC_TODAY_STORE_YESTERDAY) }),
      makeShift({ id: 'b', closedAt: closedAgo(STORE_TODAY_UTC_YESTERDAY) }),
      makeShift({ id: 'c', closedAt: closedAgo(BOTH_YESTERDAY) }),
    ];
    // Measured: UTC keeps 'a'; the -14:00 store, which at midday UTC is still on
    // the 3rd, keeps 'a' and 'b'.
    expect(closedShiftsOnStoreDay(shifts, 'UTC', NOW).map((s) => s.id)).toEqual(['a']);
    expect(closedShiftsOnStoreDay(shifts, '-14:00', NOW).map((s) => s.id)).toEqual(['a', 'b']);
  });
});
