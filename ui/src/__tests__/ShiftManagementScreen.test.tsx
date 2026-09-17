import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import { ToastProvider } from '@/components/Toast';
import shiftsFtl from '@/locales/shifts.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';

const {
  mockListShifts,
  mockGetActiveShift,
  mockOpenShift,
  mockCloseShift,
  mockGetShiftReport,
  mockCreateCashPayout,
} = vi.hoisted(() => ({
  mockListShifts: vi.fn(),
  mockGetActiveShift: vi.fn(),
  mockOpenShift: vi.fn(),
  mockCloseShift: vi.fn(),
  mockGetShiftReport: vi.fn(),
  mockCreateCashPayout: vi.fn(),
}));

vi.mock('@/api/shifts', () => ({
  listShiftsScoped: (...args: unknown[]) => mockListShifts(...args),
  getActiveShiftScoped: (...args: unknown[]) => mockGetActiveShift(...args),
  openShiftScoped: (...args: unknown[]) => mockOpenShift(...args),
  closeShiftScoped: (...args: unknown[]) => mockCloseShift(...args),
  getShiftReportScoped: (...args: unknown[]) => mockGetShiftReport(...args),
  // `createCashPayout` and `getShiftReport` used to be listed here as well. Neither
  // exists on @/api/shifts -- they are legacy unscoped names from before the ADR #7
  // scoped migration -- while `createCashPayoutScoped`, which the screen DOES import
  // and call (ShiftManagementScreen.tsx:182), was absent. So the file arranged a
  // payout response on a name nothing can reach and left the real call unmocked:
  // any test that triggered a payout would have thrown, and none did, which is the
  // only reason this stayed green. Now caught by mockFactorySurface.test.ts.
  createCashPayoutScoped: (...args: unknown[]) => mockCreateCashPayout(...args),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    session: { user_id: 'user-1', display_name: 'Cashier', role_name: 'cashier' },
  }),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'mock-session-token' }),
}));

vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ currency: 'IDR', setCurrency: vi.fn(), loading: false }),
}));

import ShiftManagementScreen from '@/features/shifts/ShiftManagementScreen';



const activeShift = {
  id: 'shift-1', userId: 'user-1', terminalId: null,
  openedAt: '2026-07-07T08:00:00.000Z', closedAt: null as string | null,
  openingBalanceMinor: 50000, closingBalanceMinor: null as number | null,
  expectedCashMinor: 55000, cashDifferenceMinor: null as number | null,
  totalSalesMinor: 150000, totalCashMinor: 80000, totalCardMinor: 70000,
  totalOtherMinor: 0, totalVoidsMinor: 0, totalRefundsMinor: 0,
  totalPayoutsMinor: 0, notes: '', status: 'open',
  createdAt: '2026-07-07T08:00:00.000Z', updatedAt: '2026-07-07T08:00:00.000Z',
};

const closedShifts = [
  { ...activeShift, id: 'shift-2', status: 'closed', closedAt: '2026-07-06T20:00:00.000Z',
    closingBalanceMinor: 55000, expectedCashMinor: 54000, cashDifferenceMinor: 1000 } as typeof activeShift,
];

describe('ShiftManagementScreen', () => {
  // ── Rendering ─────────────────────────────────────────────────

  it('renders the title', async () => {
    mockListShifts.mockResolvedValue([]);
    mockGetActiveShift.mockResolvedValue(null);
    renderWithFluentSync(<ToastProvider><ShiftManagementScreen /></ToastProvider>, shiftsFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('Shift Management')).toBeInTheDocument();
    });
  });

  it('shows loading skeleton initially', async () => {
    mockListShifts.mockReturnValue(new Promise(() => {}));
    mockGetActiveShift.mockReturnValue(new Promise(() => {}));
    renderWithFluentSync(<ToastProvider><ShiftManagementScreen /></ToastProvider>, shiftsFtl, sharedFtl);
    expect(document.querySelector('.shift-mgmt-loading-skeleton')).toBeInTheDocument();
  });

  // ── No active shift ──────────────────────────────────────────

  it('shows no active shift banner when none is active', async () => {
    mockListShifts.mockResolvedValue(closedShifts);
    mockGetActiveShift.mockResolvedValue(null);
    renderWithFluentSync(<ToastProvider><ShiftManagementScreen /></ToastProvider>, shiftsFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('No active shift')).toBeInTheDocument();
    });
    expect(screen.getByText('Open Shift')).toBeInTheDocument();
  });

  it('shows Open Shift button on the no-active banner', async () => {
    mockListShifts.mockResolvedValue([]);
    mockGetActiveShift.mockResolvedValue(null);
    renderWithFluentSync(<ToastProvider><ShiftManagementScreen /></ToastProvider>, shiftsFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('Open Shift')).toBeInTheDocument();
    });
  });

  // ── Active shift card ────────────────────────────────────────

  it('shows active shift card when a shift is active', async () => {
    mockListShifts.mockResolvedValue([activeShift]);
    mockGetActiveShift.mockResolvedValue(activeShift);
    renderWithFluentSync(<ToastProvider><ShiftManagementScreen /></ToastProvider>, shiftsFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('Active Shift')).toBeInTheDocument();
    });
    expect(screen.getByText('Close Shift')).toBeInTheDocument();
    expect(screen.getByText('Record Payout')).toBeInTheDocument();
  });

  it('shows sales stats on the active shift card', async () => {
    mockListShifts.mockResolvedValue([activeShift]);
    mockGetActiveShift.mockResolvedValue(activeShift);
    renderWithFluentSync(<ToastProvider><ShiftManagementScreen /></ToastProvider>, shiftsFtl, sharedFtl);

    await waitFor(() => {
      // "Sales" appears in multiple labels (Sales, Cash Sales, Card Sales).
      const salesLabel = screen.getAllByText('Sales');
      expect(salesLabel.length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText('Cash Sales')).toBeInTheDocument();
      expect(screen.getByText('Card Sales')).toBeInTheDocument();
    });
  });

  // ── Shift history table ──────────────────────────────────────

  it('shows shift history table with shifts', async () => {
    mockListShifts.mockResolvedValue(closedShifts);
    mockGetActiveShift.mockResolvedValue(null);
    renderWithFluentSync(<ToastProvider><ShiftManagementScreen /></ToastProvider>, shiftsFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('Shift History')).toBeInTheDocument();
      // "Closed" appears in both table header and status badge.
      expect(screen.getAllByText('Closed').length).toBeGreaterThanOrEqual(2);
    });
  });

  it('shows empty state when no shifts exist', async () => {
    mockListShifts.mockResolvedValue([]);
    mockGetActiveShift.mockResolvedValue(null);
    renderWithFluentSync(<ToastProvider><ShiftManagementScreen /></ToastProvider>, shiftsFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('No shifts recorded yet.')).toBeInTheDocument();
    });
  });

  // ── Open shift modal ─────────────────────────────────────────

  it('opens the open shift modal when Open Shift is clicked', async () => {
    const user = userEvent.setup();
    mockListShifts.mockResolvedValue([]);
    mockGetActiveShift.mockResolvedValue(null);
    renderWithFluentSync(<ToastProvider><ShiftManagementScreen /></ToastProvider>, shiftsFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('Open Shift')).toBeInTheDocument();
    });

    // Click the Open Shift button on the banner.
    const openBtns = screen.getAllByText('Open Shift');
    await user.click(openBtns[0]!);

    await waitFor(() => {
      // The modal title should appear.
      expect(screen.getAllByText('Open Shift').length).toBeGreaterThanOrEqual(2);
    });
  });

  it('rejects fractional opening balance instead of silently truncating it', async () => {
    const user = userEvent.setup();
    mockListShifts.mockResolvedValue([]);
    mockGetActiveShift.mockResolvedValue(null);
    renderWithFluentSync(<ToastProvider><ShiftManagementScreen /></ToastProvider>, shiftsFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('Open Shift')).toBeInTheDocument();
    });

    await user.click(screen.getAllByText('Open Shift')[0]!);

    await waitFor(() => {
      expect(screen.getByLabelText(/opening balance/i)).toBeInTheDocument();
    });
    await user.type(screen.getByLabelText(/opening balance/i), '500.5');
    await user.click(screen.getAllByText('Open Shift').at(-1)!.closest('button')!);

    // The previous `parseInt('500.5', 10)` would have sent 500 silently;
    // now the localized validation error surfaces and no open call fires.
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Opening balance must be a whole, non-negative number');
    });
    expect(mockOpenShift).not.toHaveBeenCalled();
  });

  // ── Shift detail modal ───────────────────────────────────────

  it('opens detail modal when View button is clicked', async () => {
    const user = userEvent.setup();
    mockListShifts.mockResolvedValue(closedShifts);
    mockGetActiveShift.mockResolvedValue(null);
    mockGetShiftReport.mockResolvedValue({
      paymentBreakdown: [], hourlyBreakdown: [], cashPayouts: [],
      saleCount: 0, voidCount: 0, refundCount: 0,
      cogsMinor: 0, grossProfitMinor: 0, grossMarginPercent: 0,
    });
    renderWithFluentSync(<ToastProvider><ShiftManagementScreen /></ToastProvider>, shiftsFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('View')).toBeInTheDocument();
    });

    await user.click(screen.getByText('View'));

    await waitFor(() => {
      expect(screen.getByText('Shift Details')).toBeInTheDocument();
      // "Status" appears in table header AND detail modal.
      const statusElements = screen.getAllByText('Status');
      expect(statusElements.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── Cash payout ────────────────────────────────────────────────
  //
  // None of these existed, and none could have: the mock wired `createCashPayout`
  // (which @/api/shifts does not export) and omitted `createCashPayoutScoped`
  // (which the screen calls at ShiftManagementScreen.tsx:182), so any payout
  // interaction would have thrown a missing-export error. The file read as if
  // payouts were covered.

  /** Open the payout modal against an active shift and return the user handle. */
  async function renderWithActiveShiftAndOpenPayout() {
    const user = userEvent.setup();
    mockListShifts.mockResolvedValue(closedShifts);
    mockGetActiveShift.mockResolvedValue(activeShift);
    mockGetShiftReport.mockResolvedValue({
      paymentBreakdown: [], hourlyBreakdown: [], cashPayouts: [],
      saleCount: 0, voidCount: 0, refundCount: 0,
      cogsMinor: 0, grossProfitMinor: 0, grossMarginPercent: 0,
    });
    renderWithFluentSync(<ToastProvider><ShiftManagementScreen /></ToastProvider>, shiftsFtl, sharedFtl);

    // The trigger's accessible name is its aria-label, not its text, so it does not
    // collide with the confirm button inside the modal.
    await waitFor(() => {
      expect(screen.getByLabelText('Record cash payout')).toBeInTheDocument();
    });
    await user.click(screen.getByLabelText('Record cash payout'));
    await waitFor(() => {
      expect(screen.getByLabelText('Payout amount in minor units')).toBeInTheDocument();
    });
    return user;
  }

  it('records a payout with the session token, shift id, amount and reason', async () => {
    mockCreateCashPayout.mockResolvedValue(undefined);
    const user = await renderWithActiveShiftAndOpenPayout();

    await user.type(screen.getByLabelText('Payout amount in minor units'), '20000');
    await user.type(screen.getByLabelText('Payout reason'), 'bank deposit');
    await user.click(screen.getByRole('button', { name: 'Record Payout' }));

    // The amount is sent as a Number, not the typed string -- the screen does
    // `Number(payoutAmount)` and validates Number.isInteger before calling.
    await waitFor(() => {
      expect(mockCreateCashPayout).toHaveBeenCalledWith(
        'mock-session-token', 'shift-1', 20000, 'bank deposit',
      );
    });
    // Success closes the modal and reloads, so the totals the cashier just changed
    // are re-fetched rather than left stale.
    await waitFor(() => {
      expect(screen.queryByLabelText('Payout amount in minor units')).not.toBeInTheDocument();
    });
    expect(mockListShifts.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('defaults an empty reason to "safe drop" instead of sending a blank', async () => {
    mockCreateCashPayout.mockResolvedValue(undefined);
    const user = await renderWithActiveShiftAndOpenPayout();

    await user.type(screen.getByLabelText('Payout amount in minor units'), '5000');
    await user.click(screen.getByRole('button', { name: 'Record Payout' }));

    await waitFor(() => {
      expect(mockCreateCashPayout).toHaveBeenCalledWith(
        'mock-session-token', 'shift-1', 5000, 'safe drop',
      );
    });
  });

  it('surfaces a failed payout and keeps the modal open so the amount is not lost', async () => {
    mockCreateCashPayout.mockRejectedValue(new Error('db busy'));
    const user = await renderWithActiveShiftAndOpenPayout();

    await user.type(screen.getByLabelText('Payout amount in minor units'), '20000');
    await user.type(screen.getByLabelText('Payout reason'), 'bank deposit');
    await user.click(screen.getByRole('button', { name: 'Record Payout' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    // The modal must stay open with the values intact: the sale of cash is not
    // recorded, so closing it would force the cashier to retype everything.
    // The input is type="number", so jest-dom compares its value numerically --
    // toHaveValue('20000') fails against 20000 and the failure message renders the
    // difference as blank, which reads like an empty field rather than a type mismatch.
    expect(screen.getByLabelText('Payout amount in minor units')).toHaveValue(20000);
    expect(mockListShifts.mock.calls.length).toBe(1); // no reload after failure
  });

  it('disables the confirm button until the amount is a positive whole number', async () => {
    const user = await renderWithActiveShiftAndOpenPayout();
    const confirm = () => screen.getByRole('button', { name: 'Record Payout' });
    const amount = screen.getByLabelText('Payout amount in minor units');

    expect(confirm()).toBeDisabled();
    await user.type(amount, '50.5');
    expect(confirm()).toBeDisabled();
    await user.clear(amount);
    await user.type(amount, '0');
    expect(confirm()).toBeDisabled();
    await user.clear(amount);
    await user.type(amount, '500');
    expect(confirm()).toBeEnabled();
    // This guard is what makes handleCreatePayout's own Number.isInteger check
    // unreachable by clicking, so that branch cannot be tested through the UI.
    expect(mockCreateCashPayout).not.toHaveBeenCalled();
  });
});
