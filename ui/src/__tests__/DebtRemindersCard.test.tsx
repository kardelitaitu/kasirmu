import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { LocalizationProvider, ReactLocalization } from '@fluent/react';
import { DebtRemindersCard } from '@/features/reports/DebtRemindersCard';
import type { Receivable } from '@/api/receivables';
import type { PayableDto } from '@/api/payables';

const mockListReceivablesScoped = vi.fn();
const mockListPayablesScoped = vi.fn();
const mockGetArAgingReportScoped = vi.fn();
const mockGetApAgingReportScoped = vi.fn();
const mockDownloadCsv = vi.fn();

vi.mock('@/api/receivables', () => ({
  listReceivablesScoped: (...args: unknown[]) => mockListReceivablesScoped(...args),
  getArAgingReportScoped: (...args: unknown[]) => mockGetArAgingReportScoped(...args),
}));

vi.mock('@/api/payables', () => ({
  listPayablesScoped: (...args: unknown[]) => mockListPayablesScoped(...args),
  getApAgingReportScoped: (...args: unknown[]) => mockGetApAgingReportScoped(...args),
}));

vi.mock('@/features/reports/csv', () => ({
  buildCsv: vi.fn((headers, rows) => JSON.stringify({ headers, rows })),
  downloadCsv: (...args: unknown[]) => mockDownloadCsv(...args),
}));

vi.mock('@/components/Card', () => ({
  Card: ({ children, className }: Record<string, unknown>) => (
    <div className={className as string} data-testid="card-mock">
      {children as React.ReactNode}
    </div>
  ),
}));

const ftlContent = `
dashboard-debt-reminders = Debt & Credit Reminders
dashboard-debt-ok = All credit & bills are up to date.
dashboard-debt-panel-ok = Up to date
dashboard-receivables-title = Customer Receivables (Piutang)
dashboard-payables-title = Vendor Bills (Hutang)
dashboard-overdue-count = { $count } overdue
dashboard-due-soon-count = { $count } due soon
dashboard-outstanding = Outstanding: { $amount }
dashboard-view-customers = View Customers
dashboard-view-vendor-bills = View Vendor Bills
dashboard-export-ar-aging = Export AR Aging
dashboard-export-ap-aging = Export AP Aging
`;

const resource = new FluentResource(ftlContent);
const bundle = new FluentBundle('en');
bundle.addResource(resource);
const l10n = new ReactLocalization([bundle]);

function renderCard(token = 'test-token', currency = 'IDR') {
  return render(
    <LocalizationProvider l10n={l10n}>
      <DebtRemindersCard sessionToken={token} currency={currency} />
    </LocalizationProvider>,
  );
}

describe('DebtRemindersCard', () => {
  beforeEach(() => {
    mockListReceivablesScoped.mockReset();
    mockListPayablesScoped.mockReset();
    mockGetArAgingReportScoped.mockReset();
    mockGetApAgingReportScoped.mockReset();
    mockDownloadCsv.mockReset();
  });

  it('renders all healthy state when receivables and payables have no overdue or due soon', async () => {
    mockListReceivablesScoped.mockResolvedValue([]);
    mockListPayablesScoped.mockResolvedValue([]);

    renderCard();

    await waitFor(() => {
      expect(screen.getByText('Debt & Credit Reminders')).toBeTruthy();
      expect(screen.getByText('All credit & bills are up to date.')).toBeTruthy();
    });
  });

  it('does NOT claim "Up to date" when a debt read failed', async () => {
    // `allSettled` exists so one failure cannot take the other down — but the failure
    // used to be dropped, leaving the array at [] and the card showing the affirmative
    // all-clear badge. A merchant with overdue invoices was told their debtors settled.
    mockListReceivablesScoped.mockRejectedValue(new Error('ipc down'));
    mockListPayablesScoped.mockResolvedValue([]);

    renderCard();

    await waitFor(() => {
      expect(screen.getByText(/Could not load receivables/i)).toBeTruthy();
    });
    // The receivables panel must not claim the all-clear. (The PAYABLES panel legitimately
    // still shows it — that read answered.) Scope the assertion to the receivables block.
    const recBlock = screen.getByText('Customer Receivables (Piutang)').closest('.dashboard-debt-panel');
    expect(recBlock?.textContent).not.toContain('Up to date');
  });

  it('does NOT claim the payables panel is Up to date when that read failed', async () => {
    // The mirror of the receivables case: the two reads fail independently, so each side
    // needs its own guard. A failed payables read left the array at [] and the panel
    // rendered the affirmative all-clear over bills that may well be overdue.
    mockListReceivablesScoped.mockResolvedValue([]);
    mockListPayablesScoped.mockRejectedValue(new Error('ipc down'));

    renderCard();

    await waitFor(() => {
      expect(screen.getByText(/Could not load payables/i)).toBeTruthy();
    });
    const payBlock = screen.getByText('Vendor Bills (Hutang)').closest('.dashboard-debt-panel');
    expect(payBlock?.textContent).not.toContain('Up to date');
  });

  it('renders overdue and due-soon customer receivables with outstanding amount', async () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

    const recs: Partial<Receivable>[] = [
      {
        id: 'rec-1',
        status: 'open',
        isOverdue: true,
        dueDate: '2026-01-01',
        balance: { minor_units: 50000, currency: 'IDR' },
      },
      {
        id: 'rec-2',
        status: 'partial',
        isOverdue: false,
        dueDate: tomorrow,
        balance: { minor_units: 25000, currency: 'IDR' },
      },
    ];

    mockListReceivablesScoped.mockResolvedValue(recs);
    mockListPayablesScoped.mockResolvedValue([]);

    renderCard();

    await waitFor(() => {
      expect(screen.getByText(/1.*overdue/)).toBeTruthy();
      expect(screen.getByText(/1.*due soon/)).toBeTruthy();
      expect(screen.getByText(/75\.000/)).toBeTruthy();
    });
  });

  it('renders overdue vendor payables with outstanding amount and handles navigation', async () => {
    const pays: Partial<PayableDto>[] = [
      {
        id: 'pay-1',
        status: 'open',
        is_overdue: true,
        due_date: '2026-01-01',
        balance: { minor_units: 200000, currency: 'IDR' },
      },
    ];

    mockListReceivablesScoped.mockResolvedValue([]);
    mockListPayablesScoped.mockResolvedValue(pays);

    renderCard();

    await waitFor(() => {
      expect(screen.getByText(/1.*overdue/)).toBeTruthy();
      expect(screen.getByText(/200\.000/)).toBeTruthy();
    });

    const btn = screen.getByText('View Vendor Bills');
    fireEvent.click(btn);
    expect(window.location.hash).toBe('#vendor-bills');
  });

  it('navigates to customers screen when View Customers clicked', async () => {
    mockListReceivablesScoped.mockResolvedValue([]);
    mockListPayablesScoped.mockResolvedValue([]);

    renderCard();

    await waitFor(() => {
      expect(screen.getByText('View Customers')).toBeTruthy();
    });

    const btn = screen.getByText('View Customers');
    fireEvent.click(btn);
    expect(window.location.hash).toBe('#customers');
  });

  it('exports AR aging report when Export AR Aging clicked', async () => {
    mockListReceivablesScoped.mockResolvedValue([]);
    mockListPayablesScoped.mockResolvedValue([]);
    mockGetArAgingReportScoped.mockResolvedValue({
      asOfDate: '2026-10-21',
      summary: {
        currentMinor: 100000,
        days3160Minor: 50000,
        days6190Minor: 0,
        daysOver90Minor: 0,
        totalOutstandingMinor: 150000,
      },
      customers: [
        {
          customerId: 'cust-1',
          customerName: 'Budi Santoso',
          customerPhone: '08123456789',
          currentMinor: 100000,
          days3160Minor: 50000,
          days6190Minor: 0,
          daysOver90Minor: 0,
          totalMinor: 150000,
          openCount: 2,
        },
      ],
    });

    renderCard();

    await waitFor(() => {
      expect(screen.getByText('Export AR Aging')).toBeTruthy();
    });

    const btn = screen.getByText('Export AR Aging');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockGetArAgingReportScoped).toHaveBeenCalledWith('test-token');
      expect(mockDownloadCsv).toHaveBeenCalledWith(
        expect.any(String),
        'ar-aging-report-2026-10-21.csv',
      );
    });
  });

  it('shows a visible failure when the AR aging export is rejected', async () => {
    mockListReceivablesScoped.mockResolvedValue([]);
    mockListPayablesScoped.mockResolvedValue([]);
    mockGetArAgingReportScoped.mockRejectedValue(new Error('command not registered'));

    renderCard();

    const btn = await screen.findByText('Export AR Aging');
    fireEvent.click(btn);

    // The whole point of the fix: a rejected export must NOT be silent. Before this,
    // both handlers caught the error into console.error only, so a merchant on a shell
    // that does not register the command saw a dead button and no explanation.
    await waitFor(() => {
      expect(screen.getByTestId('ar-aging-export-failed')).toBeTruthy();
    });
  });

  it('shows a visible failure when the AP aging export is rejected', async () => {
    mockListReceivablesScoped.mockResolvedValue([]);
    mockListPayablesScoped.mockResolvedValue([]);
    mockGetApAgingReportScoped.mockRejectedValue(new Error('command not registered'));

    renderCard();

    const btn = await screen.findByText('Export AP Aging');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByTestId('ap-aging-export-failed')).toBeTruthy();
    });
  });

  it('clears the export failure once a later export succeeds', async () => {
    mockListReceivablesScoped.mockResolvedValue([]);
    mockListPayablesScoped.mockResolvedValue([]);
    mockGetApAgingReportScoped
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce({
        asOfDate: '2026-10-21',
        summary: {
          currentMinor: 200000,
          days3160Minor: 0,
          days6190Minor: 0,
          daysOver90Minor: 0,
          totalOutstandingMinor: 200000,
        },
        vendors: [
          {
            vendorName: 'CV Sumber Makmur',
            currentMinor: 200000,
            days3160Minor: 0,
            days6190Minor: 0,
            daysOver90Minor: 0,
            totalMinor: 200000,
            openCount: 1,
          },
        ],
      });

    renderCard();

    const btn = await screen.findByText('Export AP Aging');
    fireEvent.click(btn);
    await waitFor(() => {
      expect(screen.getByTestId('ap-aging-export-failed')).toBeTruthy();
    });

    fireEvent.click(btn);
    await waitFor(() => {
      expect(screen.queryByTestId('ap-aging-export-failed')).toBeNull();
      expect(mockDownloadCsv).toHaveBeenCalledWith(
        expect.any(String),
        'ap-aging-report-2026-10-21.csv',
      );
    });
  });

  it('exports AP aging report when Export AP Aging clicked', async () => {
    mockListReceivablesScoped.mockResolvedValue([]);
    mockListPayablesScoped.mockResolvedValue([]);
    mockGetApAgingReportScoped.mockResolvedValue({
      asOfDate: '2026-10-21',
      summary: {
        currentMinor: 200000,
        days3160Minor: 0,
        days6190Minor: 0,
        daysOver90Minor: 0,
        totalOutstandingMinor: 200000,
      },
      vendors: [
        {
          vendorName: 'CV Sumber Makmur',
          currentMinor: 200000,
          days3160Minor: 0,
          days6190Minor: 0,
          daysOver90Minor: 0,
          totalMinor: 200000,
          openCount: 1,
        },
      ],
    });

    renderCard();

    await waitFor(() => {
      expect(screen.getByText('Export AP Aging')).toBeTruthy();
    });

    const btn = screen.getByText('Export AP Aging');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockGetApAgingReportScoped).toHaveBeenCalledWith('test-token');
      expect(mockDownloadCsv).toHaveBeenCalledWith(
        expect.any(String),
        'ap-aging-report-2026-10-21.csv',
      );
    });
  });
});
