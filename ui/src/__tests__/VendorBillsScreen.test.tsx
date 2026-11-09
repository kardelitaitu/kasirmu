import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithFluent } from '@/__tests__/test-utils/render';
import { ToastProvider } from '@/components/Toast';
import purchasingFtl from '@/locales/purchasing.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import * as payablesApi from '@/api/payables';
import * as purchasingApi from '@/api/purchasing';
import VendorBillsScreen from '@/features/purchasing/VendorBillsScreen';

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'tok-test', activeInstance: null }),
}));

vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ currency: 'IDR', setCurrency: vi.fn(), loading: false }),
}));

const sampleSuppliers: purchasingApi.SupplierDto[] = [
  {
    id: 'sup-1',
    code: 'SUP-001',
    name: 'PT Kopi Nusantara',
    contact_person: 'Budi',
    phone: '0812345678',
    email: 'budi@kopi.co.id',
    address: 'Bandung',
    tax_id: '12.345.678.9-012.000',
    payment_terms: 'net30',
    notes: '',
    status: 'active',
    created_at: '2026-10-21T00:00:00Z',
    updated_at: '2026-10-21T00:00:00Z',
  },
];

const samplePayable1: payablesApi.PayableDto = {
  id: 'pay-1',
  tenant_id: 'default',
  supplier_id: 'sup-1',
  po_id: 'po-101',
  source: 'po_receive',
  reference: 'INV-101',
  amount: { minor_units: 3000000, currency: 'IDR' },
  paid: { minor_units: 1000000, currency: 'IDR' },
  balance: { minor_units: 2000000, currency: 'IDR' },
  due_date: '2026-11-15',
  status: 'partial',
  is_overdue: false,
  note: '',
  created_at: '2026-10-21T00:00:00Z',
  updated_at: '2026-10-21T00:00:00Z',
};

const samplePayable2: payablesApi.PayableDto = {
  id: 'pay-2',
  tenant_id: 'default',
  supplier_id: 'sup-1',
  po_id: null,
  source: 'manual',
  reference: 'INV-102',
  amount: { minor_units: 1500000, currency: 'IDR' },
  paid: { minor_units: 0, currency: 'IDR' },
  balance: { minor_units: 1500000, currency: 'IDR' },
  due_date: '2026-10-10',
  status: 'open',
  is_overdue: true,
  note: 'Overdue milk supply',
  created_at: '2026-10-21T00:00:00Z',
  updated_at: '2026-10-21T00:00:00Z',
};

describe('VendorBillsScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(purchasingApi, 'listSuppliers').mockResolvedValue(sampleSuppliers);
    vi.spyOn(payablesApi, 'listPayablesScoped').mockResolvedValue([samplePayable1, samplePayable2]);
    vi.spyOn(payablesApi, 'recordPayablePaymentScoped').mockResolvedValue(samplePayable1);
    vi.spyOn(payablesApi, 'writeOffPayableScoped').mockResolvedValue(samplePayable2);
    vi.spyOn(payablesApi, 'createPayableScoped').mockResolvedValue(samplePayable1);
  });

  it('renders stats, table with bills, and overdue badges', async () => {
    await renderWithFluent(
      <ToastProvider>
        <VendorBillsScreen />
      </ToastProvider>,
      purchasingFtl,
      sharedFtl,
    );

    expect(screen.getByText('Vendor Bills (Hutang Supplier)')).toBeInTheDocument();
    expect(screen.getByText('INV-101')).toBeInTheDocument();
    expect(screen.getByText('INV-102')).toBeInTheDocument();
    expect(screen.getAllByText('PT Kopi Nusantara')[0]).toBeInTheDocument();
    expect(screen.getByText('OVERDUE')).toBeInTheDocument();
  });

  it('records payment when Pay button is clicked and confirmed', async () => {
    await renderWithFluent(
      <ToastProvider>
        <VendorBillsScreen />
      </ToastProvider>,
      purchasingFtl,
      sharedFtl,
    );

    const payBtns = screen.getAllByRole('button', { name: /Pay/i });
    expect(payBtns[0]).toBeDefined();
    fireEvent.click(payBtns[0]!);

    expect(screen.getByText('Record Vendor Payment')).toBeInTheDocument();

    const confirmBtn = screen.getByRole('button', { name: /Disburse Payment/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(payablesApi.recordPayablePaymentScoped).toHaveBeenCalledWith(
        'tok-test',
        expect.objectContaining({
          payableId: 'pay-1',
          method: 'cash',
        }),
      );
    });
  });

  it('writes off debt when Write Off button is clicked and confirmed', async () => {
    // The confirmation is a ConfirmDialog, not window.confirm, so this drives the
    // real two-step flow and asserts that clicking the row button alone writes
    // nothing off — the destructive call needs the dialog's confirm.

    await renderWithFluent(
      <ToastProvider>
        <VendorBillsScreen />
      </ToastProvider>,
      purchasingFtl,
      sharedFtl,
    );

    const writeOffBtns = screen.getAllByRole('button', { name: /Write Off/i });
    expect(writeOffBtns[0]).toBeDefined();
    fireEvent.click(writeOffBtns[0]!);

    expect(payablesApi.writeOffPayableScoped).not.toHaveBeenCalled();

    const confirmBtn = await screen.findByTestId('confirm-dialog-confirm');
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(payablesApi.writeOffPayableScoped).toHaveBeenCalledWith('tok-test', 'pay-1');
    });
  });

  it('creates manual bill when Add Vendor Bill modal is submitted', async () => {
    await renderWithFluent(
      <ToastProvider>
        <VendorBillsScreen />
      </ToastProvider>,
      purchasingFtl,
      sharedFtl,
    );

    const addBtn = screen.getByRole('button', { name: /\+ Add Vendor Bill/i });
    fireEvent.click(addBtn);

    expect(screen.getByText('Add Vendor Bill')).toBeInTheDocument();

    const supplierSelect = screen.getByLabelText(/Supplier \*/i);
    fireEvent.change(supplierSelect, { target: { value: 'sup-1' } });

    const refInput = screen.getByPlaceholderText(/e\.g\. INV-9981/i);
    fireEvent.change(refInput, { target: { value: 'INV-NEW-99' } });

    const amountInput = screen.getByLabelText(/Bill Amount/i);
    fireEvent.change(amountInput, { target: { value: '2500000' } });

    const saveBtn = screen.getByRole('button', { name: /Save Bill/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(payablesApi.createPayableScoped).toHaveBeenCalledWith(
        'tok-test',
        expect.objectContaining({
          supplierId: 'sup-1',
          source: 'manual',
          reference: 'INV-NEW-99',
          amount: { minor_units: 2500000, currency: 'IDR' },
        }),
      );
    });
  });
});
