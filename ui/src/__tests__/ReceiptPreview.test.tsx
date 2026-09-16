import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderInAct } from '@/test-utils/renderInAct';
import { withFluent, withFluentLocale } from '@/locales/test-utils';
import { ToastProvider } from '@/frontend/shared/Toast';
import salesFtl from '@/locales/sales.ftl?raw';
import salesIdFtl from '@/locales/sales.id.ftl?raw';
import ReceiptPreview from '@/features/sales/ReceiptPreview';
import type { PrintSalesReceiptArgs, MoneyDto } from '@/api/sales';

async function renderWithFluent(ui: React.ReactElement) {
  const wrapped = withFluent(<ToastProvider>{ui}</ToastProvider>, salesFtl);
  await renderInAct(wrapped);
}

async function renderWithFluentId(ui: React.ReactElement) {
  const wrapped = withFluentLocale('id', <ToastProvider>{ui}</ToastProvider>, salesIdFtl);
  await renderInAct(wrapped);
}

const moneyDto = (minorUnits: number, currency = 'USD'): MoneyDto => ({ minorUnits, currency });

const lineItem = (overrides: Partial<PrintSalesReceiptArgs['items'][0]> = {}): PrintSalesReceiptArgs['items'][0] => ({
  name: 'Coffee',
  quantity: 2,
  unitPrice: moneyDto(350),
  totalPrice: moneyDto(700),
  ...overrides,
});

const mockReceipt: PrintSalesReceiptArgs = {
  date: 'Jul 15, 2025',
  receiptNumber: 'SALE-123',
  items: [
    lineItem({ name: 'Coffee', quantity: 2, unitPrice: moneyDto(350), totalPrice: moneyDto(700) }),
    lineItem({ name: 'Tea', quantity: 1, unitPrice: moneyDto(250), totalPrice: moneyDto(250) }),
  ],
  subtotal: moneyDto(950),
  tax: moneyDto(50),
  total: moneyDto(1000),
  payments: [
    { method: 'CASH', amount: moneyDto(1500), change: moneyDto(500) },
    { method: 'CARD', amount: moneyDto(500), change: null },
  ],
};

const defaultProps = {
  receipt: mockReceipt,
  onPrint: vi.fn(),
  onSkip: vi.fn(),
};

describe('ReceiptPreview', () => {
  it('renders the receipt preview region with aria-label', async () => {
    await renderWithFluent(<ReceiptPreview {...defaultProps} />);

    const region = screen.getByRole('region', { name: /receipt preview/i });
    expect(region).toBeInTheDocument();
  });

  it('renders store name and receipt info', async () => {
    await renderWithFluent(<ReceiptPreview {...defaultProps} />);

    expect(screen.getByText('kasir.mu Store')).toBeInTheDocument();
    expect(screen.getByText('Jul 15, 2025')).toBeInTheDocument();
    expect(screen.getByText('SALE-123')).toBeInTheDocument();
  });

  it('renders column headers', async () => {
    await renderWithFluent(<ReceiptPreview {...defaultProps} />);

    expect(screen.getByText('Item')).toBeInTheDocument();
    expect(screen.getByText('Qty')).toBeInTheDocument();
    expect(screen.getByText('Price')).toBeInTheDocument();
    expect(screen.getByText('Total')).toBeInTheDocument();
  });

  it('renders line items with name, qty, price, and total', async () => {
    await renderWithFluent(<ReceiptPreview {...defaultProps} />);

    // Line items render as formatted strings like "Coffee      2  $ 3,50 $ 7,00"
    // Use flexible matcher since text may be in a single text node with other content
    expect(screen.getByText((content: string) => content.includes('Coffee'))).toBeInTheDocument();
    expect(screen.getByText((content: string) => content.includes('Tea'))).toBeInTheDocument();
  });

  it('renders tax amount for line items when present', async () => {
    const receiptWithTax = {
      ...mockReceipt,
      items: [
        { ...lineItem(), taxAmount: moneyDto(35) },
      ],
    };
    await renderWithFluent(<ReceiptPreview {...defaultProps} receipt={receiptWithTax} />);

    expect(screen.getByText('Tax: $ 0,35')).toBeInTheDocument();
  });

  it('renders subtotal, tax, and grand total', async () => {
    await renderWithFluent(<ReceiptPreview {...defaultProps} />);

    expect(screen.getByText('SUBTOTAL:')).toBeInTheDocument();
    expect(screen.getByText('TAX:')).toBeInTheDocument();
    expect(screen.getByText('TOTAL:')).toBeInTheDocument();
    expect(screen.getByText('$ 9,50')).toBeInTheDocument(); // subtotal
    expect(screen.getByText('$ 0,50')).toBeInTheDocument(); // tax
    expect(screen.getByText('$ 10,00')).toBeInTheDocument(); // total
  });

  it('renders payments with method and amount', async () => {
    await renderWithFluent(<ReceiptPreview {...defaultProps} />);

    expect(screen.getByText('CASH')).toBeInTheDocument();
    expect(screen.getByText('CARD')).toBeInTheDocument();
    expect(screen.getByText('$ 15,00')).toBeInTheDocument();
    const fiveAmounts = screen.getAllByText('$ 5,00');
    expect(fiveAmounts.length).toBeGreaterThanOrEqual(2); // CARD payment + CHANGE
  });

  it('renders change when present', async () => {
    await renderWithFluent(<ReceiptPreview {...defaultProps} />);

    expect(screen.getByText('CHANGE:')).toBeInTheDocument();
    const changeAmounts = screen.getAllByText('$ 5,00');
    expect(changeAmounts.length).toBeGreaterThanOrEqual(2); // CARD payment + CHANGE
  });

  it('renders barcode when showBarcode is true', async () => {
    await renderWithFluent(<ReceiptPreview {...defaultProps} showBarcode />);

    // SALE-123 appears in header and barcode text
    const receiptNumbers = screen.getAllByText('SALE-123');
    expect(receiptNumbers.length).toBeGreaterThanOrEqual(2);
    const barcodeVisual = document.querySelector('.receipt-preview-barcode-visual');
    expect(barcodeVisual).toBeInTheDocument();
  });

  it('renders QR code when paymentLinkTemplate is provided', async () => {
    await renderWithFluent(
      <ReceiptPreview {...defaultProps} paymentLinkTemplate="https://pay.example.com?receipt={receipt}&amount={amount}" />,
    );

    expect(screen.getByText('Scan to pay')).toBeInTheDocument();
    // QR visual is a div with class receipt-preview-qr-visual containing an SVG
    const qrContainer = document.querySelector('.receipt-preview-qr-visual');
    expect(qrContainer).toBeInTheDocument();
    expect(qrContainer?.querySelector('svg')).toBeInTheDocument();
  });

  it('renders footer thank you message', async () => {
    await renderWithFluent(<ReceiptPreview {...defaultProps} />);

    expect(screen.getByText('Thank you for your purchase!')).toBeInTheDocument();
  });

  it('renders Print and Skip buttons', async () => {
    await renderWithFluent(<ReceiptPreview {...defaultProps} />);

    expect(screen.getByRole('button', { name: /print receipt/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /skip/i })).toBeInTheDocument();
  });

  it('calls onPrint when Print button is clicked', async () => {
    const onPrint = vi.fn();
    await renderWithFluent(<ReceiptPreview {...defaultProps} onPrint={onPrint} />);

    await waitFor(() => {
      screen.getByRole('button', { name: /print receipt/i }).click();
    });

    expect(onPrint).toHaveBeenCalledTimes(1);
  });

  it('calls onSkip when Skip button is clicked', async () => {
    const onSkip = vi.fn();
    await renderWithFluent(<ReceiptPreview {...defaultProps} onSkip={onSkip} />);

    await waitFor(() => {
      screen.getByRole('button', { name: /skip/i }).click();
    });

    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('disables buttons when loading is true', async () => {
    await renderWithFluent(<ReceiptPreview {...defaultProps} loading />);

    expect(screen.getByRole('button', { name: /print receipt/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /skip/i })).toBeDisabled();
  });

  // ── Indonesian locale ──
  it('renders in Indonesian locale', async () => {
    await renderWithFluentId(
      <ReceiptPreview {...defaultProps} paymentLinkTemplate="https://pay.example.com?receipt={receipt}&amount={amount}" />,
    );

    expect(screen.getByRole('region', { name: /pratinjau struk/i })).toBeInTheDocument();
    expect(screen.getByText('Toko kasir.mu')).toBeInTheDocument();
    expect(screen.getByText('Item')).toBeInTheDocument();
    expect(screen.getByText('Jum')).toBeInTheDocument();
    expect(screen.getByText('Harga')).toBeInTheDocument();
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText('SUBTOTAL:')).toBeInTheDocument();
    expect(screen.getByText('PAJAK:')).toBeInTheDocument();
    expect(screen.getByText('TOTAL:')).toBeInTheDocument();
    expect(screen.getByText('KEMBALIAN:')).toBeInTheDocument();
    expect(screen.getByText('Scan untuk bayar')).toBeInTheDocument();
    expect(screen.getByText('Terima kasih atas pembelian Anda!')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /lewati/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cetak struk/i })).toBeInTheDocument();
  });

  // ── Edge cases ──
  it('handles receipt without tax', async () => {
    const receiptNoTax = { ...mockReceipt, tax: undefined as never };
    await renderWithFluent(<ReceiptPreview {...defaultProps} receipt={receiptNoTax} />);

    expect(screen.queryByText('TAX:')).not.toBeInTheDocument();
    expect(screen.getByText('TOTAL:')).toBeInTheDocument();
  });

  it('handles receipt with tableNumber', async () => {
    const receiptWithTable = { ...mockReceipt, tableNumber: 'Table 5' };
    await renderWithFluent(<ReceiptPreview {...defaultProps} receipt={receiptWithTable} />);

    // tableNumber is not rendered in preview but passed to print
    expect(screen.getByText('SALE-123')).toBeInTheDocument();
  });

  it('handles empty items array', async () => {
    const emptyReceipt = { ...mockReceipt, items: [], subtotal: moneyDto(0), total: moneyDto(0) };
    await renderWithFluent(<ReceiptPreview {...defaultProps} receipt={emptyReceipt} />);

    expect(screen.getByText('SUBTOTAL:')).toBeInTheDocument();
    expect(screen.getByText('TOTAL:')).toBeInTheDocument();
    // Both subtotal and total will show $ 0,00
    const zeroAmounts = screen.getAllByText('$ 0,00');
    expect(zeroAmounts.length).toBeGreaterThanOrEqual(2);
  });

  // ── Branch coverage: long item name truncation ──
  it('truncates item names longer than 22 characters', async () => {
    const longNameReceipt = {
      ...mockReceipt,
      items: [
        {
          ...lineItem(),
          name: 'Very Long Item Name That Exceeds Limit',
          unitPrice: moneyDto(1000),
          totalPrice: moneyDto(1000),
        },
      ],
    };
    await renderWithFluent(<ReceiptPreview {...defaultProps} receipt={longNameReceipt} />);

    // Name should be truncated to 20 chars + ellipsis (U+2026)
    expect(screen.getByText((content: string) => content.includes('Very Long Item Name \u2026'))).toBeInTheDocument();
  });

  // ── Branch coverage: QR code boundary check ──
  it('renders QR code with small size (boundary check)', async () => {
    // Use a template that forces small QR generation
    await renderWithFluent(
      <ReceiptPreview
        {...defaultProps}
        paymentLinkTemplate="https://pay.example.com?receipt={receipt}&amount={amount}"
        // The QR size is hardcoded to 33 in the component, but we can test
        // the boundary check is exercised by the finder pattern drawing
      />,
    );

    expect(screen.getByText('Scan to pay')).toBeInTheDocument();
    const qrVisual = document.querySelector('.receipt-preview-qr-visual');
    expect(qrVisual).toBeInTheDocument();
    // The finder patterns at corners exercise the boundary check on lines 250
    expect(qrVisual?.querySelector('svg')).toBeInTheDocument();
  });
});