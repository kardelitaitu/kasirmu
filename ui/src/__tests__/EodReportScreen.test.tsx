import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
// renderWithProviders* (not renderWithFluentSync): the EOD screen's print button now
// reports a failed print through the toast context, so it needs a ToastProvider.
import { renderWithProvidersSync } from '@/__tests__/test-utils/render';
import salesFtl from '@/locales/sales.ftl?raw';
import shiftsFtl from '@/locales/shifts.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import EodReportScreen from '@/features/sales/EodReportScreen';

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
