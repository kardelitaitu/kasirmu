import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderInAct } from '@/test-utils/renderInAct';
import { withFluent } from '@/i18n/test-utils';
import salesFtl from '@/locales/sales.ftl?raw';
import PayLaterTenderPanel from '@/features/sales/payment/PayLaterTenderPanel';
import type { CustomerDto } from '@/api/customers';
import type { CustomerReceivablesSummary } from '@/api/receivables';
import type { Money, LineId, Sku } from '@/types/domain';

const idr = (minor: number): Money => ({ minor_units: minor, currency: 'IDR' });

const dummyCustomer: CustomerDto = {
  id: 'cust-1',
  name: 'Pak Budi',
  email: 'budi@example.com',
  phone: '08123456789',
  notes: 'Pelanggan setia',
  created_at: '2026-10-21T00:00:00Z',
  updated_at: '2026-10-21T00:00:00Z',
};

const dummySummary: CustomerReceivablesSummary = {
  customerId: 'cust-1',
  outstandingTotal: { minor_units: 5000000, currency: 'IDR' }, // Rp 50.000
  openCount: 2,
  hasOverdue: false,
};

describe('PayLaterTenderPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders select-customer prompt when customer is null', async () => {
    const onOpenSearch = vi.fn();
    const wrapped = withFluent(
      <PayLaterTenderPanel
        customer={null}
        onOpenCustomerSearch={onOpenSearch}
        summary={null}
        loadingSummary={false}
        currentTotal={idr(2500000)}
        creditLimitMinor={0}
      />,
      salesFtl,
    );
    await renderInAct(wrapped);

    expect(screen.getByTestId('pay-later-empty')).toBeInTheDocument();
    expect(screen.getByText('Select Customer for Kasbon')).toBeInTheDocument();

    const btn = screen.getByTestId('pay-later-select-customer-btn');
    fireEvent.click(btn);
    expect(onOpenSearch).toHaveBeenCalledTimes(1);
  });

  it('renders customer details, outstanding balance and projected total when customer is selected', async () => {
    const wrapped = withFluent(
      <PayLaterTenderPanel
        customer={dummyCustomer}
        onOpenCustomerSearch={vi.fn()}
        summary={dummySummary}
        loadingSummary={false}
        currentTotal={idr(2500000)} // Rp 25.000
        creditLimitMinor={0}
      />,
      salesFtl,
    );
    await renderInAct(wrapped);

    expect(screen.getByTestId('pay-later-customer-details')).toBeInTheDocument();
    expect(screen.getByText('Pak Budi')).toBeInTheDocument();
    expect(screen.getByText('08123456789')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument(); // open count
    expect(screen.queryByText('Has Overdue Kasbon')).not.toBeInTheDocument();
    expect(screen.queryByText('Warning: Total kasbon exceeds customer credit limit.')).not.toBeInTheDocument();
  });

  it('renders overdue badge when customer has overdue kasbon', async () => {
    const overdueSummary: CustomerReceivablesSummary = {
      ...dummySummary,
      hasOverdue: true,
    };
    const wrapped = withFluent(
      <PayLaterTenderPanel
        customer={dummyCustomer}
        onOpenCustomerSearch={vi.fn()}
        summary={overdueSummary}
        loadingSummary={false}
        currentTotal={idr(2500000)}
        creditLimitMinor={0}
      />,
      salesFtl,
    );
    await renderInAct(wrapped);

    expect(screen.getByText('Has Overdue Kasbon')).toBeInTheDocument();
  });

  it('displays non-blocking credit limit warning when projected debt exceeds limit', async () => {
    // Current outstanding 50.000 + cart 25.000 = 75.000, limit 60.000 -> exceeds
    const wrapped = withFluent(
      <PayLaterTenderPanel
        customer={dummyCustomer}
        onOpenCustomerSearch={vi.fn()}
        summary={dummySummary}
        loadingSummary={false}
        currentTotal={idr(2500000)}
        creditLimitMinor={6000000} // Rp 60.000 limit
      />,
      salesFtl,
    );
    await renderInAct(wrapped);

    expect(screen.getByText('Warning: Total kasbon exceeds customer credit limit.')).toBeInTheDocument();
  });
});

describe('PaymentModal with pay_later tender', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders pay_later radio button and disables complete without a customer', async () => {
    const { default: PaymentModal } = await import('@/features/sales/PaymentModal');
    const { ToastProvider } = await import('@/components/Toast');

    const wrapped = withFluent(
      <ToastProvider>
        <PaymentModal
          open
          lineItems={[{
            id: 'line-1' as LineId,
            sku: 'COFFEE' as Sku,
            name: 'Coffee',
            qty: 1,
            unit_price: idr(2500000),
          }]}
          total={idr(2500000)}
          userId="test-user"
          selectedCustomer={null}
          onComplete={vi.fn()}
          onClose={vi.fn()}
        />
      </ToastProvider>,
      salesFtl,
    );
    await renderInAct(wrapped);

    const payLaterRadio = document.querySelector<HTMLInputElement>(
      'input[name="payment-method"][value="pay_later"]',
    );
    expect(payLaterRadio, 'Pay Later radio must render in retail mode').not.toBeNull();
    expect(payLaterRadio!.checked).toBe(false);

    // Select pay_later
    fireEvent.click(payLaterRadio!);
    expect(payLaterRadio!.checked).toBe(true);

    // Settle button must be disabled because no customer is selected
    const settleBtn = screen.getByTestId('settle-button');
    expect(settleBtn).toBeDisabled();
  });

  it('enables complete button when pay_later is selected and a customer is present', async () => {
    const { default: PaymentModal } = await import('@/features/sales/PaymentModal');
    const { ToastProvider } = await import('@/components/Toast');

    const wrapped = withFluent(
      <ToastProvider>
        <PaymentModal
          open
          lineItems={[{
            id: 'line-1' as LineId,
            sku: 'COFFEE' as Sku,
            name: 'Coffee',
            qty: 1,
            unit_price: idr(2500000),
          }]}
          total={idr(2500000)}
          userId="test-user"
          selectedCustomer={dummyCustomer}
          onComplete={vi.fn()}
          onClose={vi.fn()}
        />
      </ToastProvider>,
      salesFtl,
    );
    await renderInAct(wrapped);

    const payLaterRadio = document.querySelector<HTMLInputElement>(
      'input[name="payment-method"][value="pay_later"]',
    );
    expect(payLaterRadio).not.toBeNull();

    // Select pay_later
    fireEvent.click(payLaterRadio!);
    expect(payLaterRadio!.checked).toBe(true);

    // Settle button must now be enabled
    const settleBtn = screen.getByTestId('settle-button');
    expect(settleBtn).not.toBeDisabled();
  });
});
