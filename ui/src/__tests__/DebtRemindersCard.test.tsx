import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { LocalizationProvider, ReactLocalization } from '@fluent/react';
import { DebtRemindersCard } from '@/features/reports/DebtRemindersCard';
import type { Receivable } from '@/api/receivables';
import type { PayableDto } from '@/api/payables';

const mockListReceivablesScoped = vi.fn();
const mockListPayablesScoped = vi.fn();

vi.mock('@/api/receivables', () => ({
  listReceivablesScoped: (...args: unknown[]) => mockListReceivablesScoped(...args),
}));

vi.mock('@/api/payables', () => ({
  listPayablesScoped: (...args: unknown[]) => mockListPayablesScoped(...args),
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
});
