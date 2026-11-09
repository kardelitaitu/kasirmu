import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithFluent } from '@/__tests__/test-utils/render';
import purchasingFtl from '@/locales/purchasing.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import * as purchasingApi from '@/api/purchasing';
import * as payablesApi from '@/api/payables';
import ReceivePoModal from '@/features/purchasing/ReceivePoModal';

vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ currency: 'IDR', setCurrency: vi.fn(), loading: false }),
}));

const samplePo: purchasingApi.PurchaseOrderDto = {
  id: 'po-101',
  po_number: 'PO-2026-101',
  supplier_id: 'sup-1',
  supplier_name: 'PT Kopi Nusantara',
  status: 'approved',
  order_date: '2026-10-21',
  expected_date: '2026-10-25',
  received_date: null,
  subtotal_minor: 5000000,
  tax_minor: 0,
  total_minor: 5000000,
  notes: 'Kopi Arabika 50kg',
  created_by: 'owner-1',
  created_at: '2026-10-21T00:00:00Z',
  updated_at: '2026-10-21T00:00:00Z',
  lines: [],
};

describe('ReceivePoModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(purchasingApi, 'receivePurchaseOrderScoped').mockResolvedValue(samplePo);
    vi.spyOn(payablesApi, 'createPayableScoped').mockResolvedValue({
      id: 'pay-1',
      tenant_id: 'default',
      supplier_id: 'sup-1',
      po_id: 'po-101',
      source: 'po_receive',
      reference: 'INV-999',
      amount: { minor_units: 5000000, currency: 'IDR' },
      paid: { minor_units: 0, currency: 'IDR' },
      balance: { minor_units: 5000000, currency: 'IDR' },
      due_date: '2026-11-20',
      status: 'open',
      is_overdue: false,
      note: '',
      created_at: '2026-10-21T00:00:00Z',
      updated_at: '2026-10-21T00:00:00Z',
    });
  });

  it('renders PO number, supplier, total amount and default cash option', async () => {
    await renderWithFluent(
      <ReceivePoModal
        po={samplePo}
        sessionToken="tok-test"
        onClose={vi.fn()}
        onReceived={vi.fn()}
      />,
      purchasingFtl,
      sharedFtl,
    );

    expect(screen.getByText('PO-2026-101')).toBeInTheDocument();
    expect(screen.getByText('PT Kopi Nusantara')).toBeInTheDocument();
    expect(screen.getByText(/Cash \(Paid Now\)/i)).toBeInTheDocument();
    expect(screen.getByText(/On Account \(Beli Tempo\)/i)).toBeInTheDocument();
  });

  it('submits cash receipt without creating a payable when Cash is chosen', async () => {
    const onReceived = vi.fn();
    const onClose = vi.fn();

    await renderWithFluent(
      <ReceivePoModal
        po={samplePo}
        sessionToken="tok-test"
        onClose={onClose}
        onReceived={onReceived}
      />,
      purchasingFtl,
      sharedFtl,
    );

    const confirmBtn = screen.getByRole('button', { name: /Confirm Receipt/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(purchasingApi.receivePurchaseOrderScoped).toHaveBeenCalledWith('tok-test', 'po-101');
      expect(payablesApi.createPayableScoped).not.toHaveBeenCalled();
      expect(onReceived).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('calls createPayableScoped when On Account (Beli Tempo) is selected and submitted', async () => {
    const onReceived = vi.fn();
    const onClose = vi.fn();

    await renderWithFluent(
      <ReceivePoModal
        po={samplePo}
        sessionToken="tok-test"
        onClose={onClose}
        onReceived={onReceived}
      />,
      purchasingFtl,
      sharedFtl,
    );

    // Select On Account
    const onAccountCard = screen.getByRole('radio', { name: /On Account \(Beli Tempo\)/i });
    fireEvent.click(onAccountCard);

    // Enter Invoice Ref
    const invoiceInput = screen.getByPlaceholderText(/e\.g\. INV-2026-001/i);
    fireEvent.change(invoiceInput, { target: { value: 'INV-KOPI-99' } });

    const confirmBtn = screen.getByRole('button', { name: /Confirm Receipt/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(purchasingApi.receivePurchaseOrderScoped).toHaveBeenCalledWith('tok-test', 'po-101');
      expect(payablesApi.createPayableScoped).toHaveBeenCalledWith(
        'tok-test',
        expect.objectContaining({
          supplierId: 'sup-1',
          poId: 'po-101',
          source: 'po_receive',
          reference: 'INV-KOPI-99',
        }),
      );
      expect(onReceived).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('receives and books the payable once when Confirm Receipt is double-tapped', async () => {
    // The replay is refused by the backend (only an 'approved' PO is receivable) and
    // lands in the catch as po-error-receive — an error over a receipt that worked.
    // Worse on the On-Account path: the first call already created the payable, so the
    // operator is told the receipt failed while a supplier debt exists.
    await renderWithFluent(
      <ReceivePoModal
        po={samplePo}
        sessionToken="tok-test"
        onClose={vi.fn()}
        onReceived={vi.fn()}
      />,
      purchasingFtl,
      sharedFtl,
    );

    fireEvent.click(screen.getByRole('radio', { name: /On Account \(Beli Tempo\)/i }));

    const confirmBtn = screen.getByRole('button', { name: /Confirm Receipt/i });
    await act(async () => {
      fireEvent.click(confirmBtn);
      fireEvent.click(confirmBtn);
    });

    await waitFor(() => {
      expect(purchasingApi.receivePurchaseOrderScoped).toHaveBeenCalledTimes(1);
      expect(payablesApi.createPayableScoped).toHaveBeenCalledTimes(1);
    });
  });
});
