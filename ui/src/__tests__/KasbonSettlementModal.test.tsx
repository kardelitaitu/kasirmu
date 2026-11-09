import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, screen, fireEvent, waitFor } from '@testing-library/react';
import { renderInAct } from '@/test-utils/renderInAct';
import { withFluent } from '@/i18n/test-utils';
import { ToastProvider } from '@/components/Toast';
import customersFtl from '@/locales/customers.ftl?raw';
import KasbonSettlementModal from '@/features/customers/KasbonSettlementModal';
import type { CustomerDto } from '@/api/customers';
import type { Receivable } from '@/api/receivables';
import * as receivablesApi from '@/api/receivables';
import * as hardwareApi from '@/api/hardware';

const dummyCustomer: CustomerDto = {
  id: 'cust-123',
  name: 'Ibu Siti',
  email: 'siti@example.com',
  phone: '08198765432',
  notes: 'Warung Bu Siti',
  created_at: '2026-10-21T00:00:00Z',
  updated_at: '2026-10-21T00:00:00Z',
};

const dummy1: Receivable = {
  id: 'rec-1',
  tenantId: 'tenant-1',
  customerId: 'cust-123',
  saleId: 'sale-1',
  source: 'pos',
  reference: 'SALE-1001',
  amount: { minor_units: 5000000, currency: 'IDR' }, // 50.000
  paid: { minor_units: 1000000, currency: 'IDR' },   // 10.000
  balance: { minor_units: 4000000, currency: 'IDR' },// 40.000
  dueDate: '2026-11-01',
  status: 'partial',
  isOverdue: false,
  note: '',
  createdAt: '2026-10-21T00:00:00Z',
  updatedAt: '2026-10-21T00:00:00Z',
};

const dummy2: Receivable = {
  id: 'rec-2',
  tenantId: 'tenant-1',
  customerId: 'cust-123',
  saleId: 'sale-2',
  source: 'pos',
  reference: 'SALE-1002',
  amount: { minor_units: 3000000, currency: 'IDR' }, // 30.000
  paid: { minor_units: 0, currency: 'IDR' },
  balance: { minor_units: 3000000, currency: 'IDR' },// 30.000
  dueDate: '2026-10-20',
  status: 'open',
  isOverdue: true,
  note: '',
  createdAt: '2026-10-20T00:00:00Z',
  updatedAt: '2026-10-20T00:00:00Z',
};

const dummyReceivables: Receivable[] = [dummy1, dummy2];

describe('KasbonSettlementModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(receivablesApi, 'listCustomerReceivablesScoped').mockResolvedValue(dummyReceivables);
    vi.spyOn(receivablesApi, 'recordReceivablePaymentScoped').mockResolvedValue(dummy1);
    vi.spyOn(receivablesApi, 'writeOffReceivableScoped').mockResolvedValue(dummy2);
  });

  it('renders customer name, total owed, and list of receivables', async () => {
    const wrapped = withFluent(
      <ToastProvider>
        <KasbonSettlementModal
          customer={dummyCustomer}
          sessionToken="mock-token"
          onClose={vi.fn()}
        />
      </ToastProvider>,
      customersFtl,
    );
    await renderInAct(wrapped);

    expect(screen.getByText('Ibu Siti')).toBeInTheDocument();
    expect(screen.getByText('SALE-1001')).toBeInTheDocument();
    expect(screen.getByText('SALE-1002')).toBeInTheDocument();
    expect(screen.getByText('partial')).toBeInTheDocument();
    expect(screen.getByText('open')).toBeInTheDocument();
  });

  it('opens repayment drawer when Pay is clicked, and records payment on submit', async () => {
    const wrapped = withFluent(
      <ToastProvider>
        <KasbonSettlementModal
          customer={dummyCustomer}
          sessionToken="mock-token"
          onClose={vi.fn()}
        />
      </ToastProvider>,
      customersFtl,
    );
    await renderInAct(wrapped);

    const payBtns = screen.getAllByRole('button', { name: /Pay/i });
    expect(payBtns[0]).toBeDefined();
    fireEvent.click(payBtns[0]!);

    expect(screen.getByText('Record Repayment')).toBeInTheDocument();

    const submitBtn = screen.getByRole('button', { name: /Confirm Payment/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(receivablesApi.recordReceivablePaymentScoped).toHaveBeenCalledWith(
        'mock-token',
        expect.objectContaining({
          receivableId: 'rec-1',
          method: 'cash',
        }),
      );
    });
  });

  it('records a repayment once for a double click while the first is in flight', async () => {
    // THE MONEY CASE. `record_receivable_payment` reads the balance before opening its
    // transaction (receivables.rs:242-289) and CASes on STATUS, which stays 'partial' after
    // a partial payment. So a second call with a PARTIAL amount passes the overpayment
    // check, inserts a SECOND receivable_payments row, and overwrites paid_minor with a
    // stale sum: the customer reads as having paid twice, with no error shown. The default
    // amount is the full balance, where the CAS refuses the replay and reports "Failed to
    // record repayment" over a payment that landed. Either way the second call must not be
    // sent. This case sets a PARTIAL amount, the silent arm.
    let releasePayment: ((v: unknown) => void) | undefined;
    vi.spyOn(receivablesApi, 'recordReceivablePaymentScoped').mockImplementation(
      () => new Promise((resolve) => { releasePayment = resolve; }) as never,
    );

    const wrapped = withFluent(
      <ToastProvider>
        <KasbonSettlementModal
          customer={dummyCustomer}
          sessionToken="mock-token"
          onClose={vi.fn()}
        />
      </ToastProvider>,
      customersFtl,
    );
    await renderInAct(wrapped);

    fireEvent.click(screen.getAllByRole('button', { name: /Pay/i })[0]!);
    const amountInput = document.querySelector('input[type="number"]') as HTMLInputElement | null;
    if (!amountInput) throw new Error('amount field not found');
    fireEvent.change(amountInput, { target: { value: '10000' } });

    const submitBtn = screen.getByRole('button', { name: /Confirm Payment/i });
    // fireEvent, not userEvent: userEvent awaits its own act(), which flushes the pending
    // chain so the first payment would have settled and the clicks would never overlap.
    // The disabled flag React set is dropped for the second click so the atomic guard is
    // what is measured, not the DOM.
    await act(async () => {
      fireEvent.click(submitBtn);
      submitBtn.removeAttribute('disabled');
      fireEvent.click(submitBtn);
    });

    expect(
      (receivablesApi.recordReceivablePaymentScoped as unknown as { mock: { calls: unknown[] } }).mock.calls.length,
      'a double click on Confirm Payment sent the repayment twice; a partial amount is ' +
        'ACCEPTED by the backend both times, so the customer is recorded as paying twice',
    ).toBe(1);

    releasePayment?.(dummy1);
  });

  it('calls writeOffReceivableScoped when Write Off is clicked and confirmed', async () => {
    // This used to mock window.confirm and click once. The confirmation is now a
    // ConfirmDialog, so the test drives the real two-step flow: the row button
    // only OPENS the dialog, and the write-off fires from the dialog's confirm.
    // That is stronger than the old assertion — it proves the destructive call
    // cannot happen without the operator confirming.

    const wrapped = withFluent(
      <ToastProvider>
        <KasbonSettlementModal
          customer={dummyCustomer}
          sessionToken="mock-token"
          onClose={vi.fn()}
        />
      </ToastProvider>,
      customersFtl,
    );
    await renderInAct(wrapped);

    const writeOffBtns = screen.getAllByRole('button', { name: /Write Off/i });
    expect(writeOffBtns[0]).toBeDefined();
    fireEvent.click(writeOffBtns[0]!);

    // Opening the dialog must not write anything off on its own.
    expect(receivablesApi.writeOffReceivableScoped).not.toHaveBeenCalled();

    const confirmBtn = await screen.findByTestId('confirm-dialog-confirm');
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(receivablesApi.writeOffReceivableScoped).toHaveBeenCalledWith('mock-token', 'rec-1');
    });
  });

  it('calls printKasbonSettlementSlipScoped when print checkbox is enabled on submit', async () => {
    const printSpy = vi.spyOn(hardwareApi, 'printKasbonSettlementSlipScoped').mockResolvedValue({ printed: true });
    const wrapped = withFluent(
      <ToastProvider>
        <KasbonSettlementModal
          customer={dummyCustomer}
          sessionToken="mock-token"
          onClose={vi.fn()}
        />
      </ToastProvider>,
      customersFtl,
    );
    await renderInAct(wrapped);

    const payBtns = screen.getAllByRole('button', { name: /Pay/i });
    fireEvent.click(payBtns[0]!);

    expect(screen.getByLabelText(/Print Receipt/i)).toBeChecked();

    const submitBtn = screen.getByRole('button', { name: /Confirm Payment/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(printSpy).toHaveBeenCalledWith(
        'mock-token',
        expect.objectContaining({
          customerName: 'Ibu Siti',
          paymentMethod: 'cash',
        }),
      );
    });
  });
});
