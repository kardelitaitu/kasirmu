import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
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

  it('calls writeOffReceivableScoped when Write Off is clicked and confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);

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
