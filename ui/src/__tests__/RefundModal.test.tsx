import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import salesFtl from '@/locales/sales.ftl?raw';

// Mock the sales API.
vi.mock('@/api/sales', () => ({
  processRefundScoped: vi.fn(),
}));

// Mock AuthContext.
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    session: { user_id: 'user-1', display_name: 'Cashier', role_name: 'cashier' },
  }),
}));

import RefundModal from '@/features/sales/RefundModal';
import { processRefundScoped } from '@/api/sales';

const mockProcessRefund = processRefundScoped as ReturnType<typeof vi.fn>;

const refundFtl = `
refund-title = Process Refund
refund-close-aria = Cancel refund
    .aria-label = Cancel refund
refund-sale-id = Sale: { $id }…
refund-sale-total = Total: { $amount }
refund-sale-date = Date: { $date }
refund-items-title = Select Items to Refund
refund-reason-label = Reason *
refund-reason-placeholder = Enter reason…
refund-reason-aria = Refund reason
refund-note-label = Note (internal)
refund-note-placeholder = Internal notes
refund-note-aria = Refund note
refund-total-label = Refund Total
refund-cancel = Cancel
refund-submit = Process Refund
refund-done-title = Refund Processed
refund-done = Done
refund-error = Refund failed
refund-item-aria = Refund { $sku }
    .aria-label = Refund { $sku }
refund-qty-decrease-aria = Decrease refund quantity
    .aria-label = Decrease refund quantity
refund-qty-increase-aria = Increase refund quantity
    .aria-label = Increase refund quantity
refund-dialog-aria = Process refund
    .aria-label = Process refund
refund-done-amount = Refunded: { $amount }
`;



const mockSale = {
  id: 'sale-abc123456789',
  total: { minor_units: 35000, currency: 'IDR' },
  subtotal: { minor_units: 35000, currency: 'IDR' },
  taxTotal: { minor_units: 0, currency: 'IDR' },
  lineCount: 2,
  status: 'completed',
  paymentMethod: 'CASH',
  tenderedMinor: 50000,
  userId: 'user-1',
  createdAt: '2026-07-05T10:00:00.000Z',
  lines: [
    { id: 'line-1', sku: 'SKU-001', name: 'Indomie Goreng', qty: 2, unit_price: { minor_units: 3500, currency: 'IDR' }, total_minor: 7000, tax_amount: null, tax_rate_id: null },
    { id: 'line-2', sku: 'SKU-002', name: 'Teh Botol', qty: 1, unit_price: { minor_units: 5000, currency: 'IDR' }, total_minor: 5000, tax_amount: null, tax_rate_id: null },
  ],
};

const defaultProps = {
  open: true,
  sale: mockSale,
  onClose: vi.fn(),
  onRefunded: vi.fn(),
};

// ── Helpers ────────────────────────────────────────────────────────────
// fireEvent.click on a checkbox toggles it via the component's onChange
// handler. fireEvent.change on a textbox sets the value in one step,
// saving ~20ms/char compared to userEvent.type.

function clickCheckbox(index = 0) {
  const checkboxes = screen.getAllByRole('checkbox');
  fireEvent.click(checkboxes[index]!);
  return checkboxes[index]!;
}

function fillReason(text: string) {
  const reasonInput = screen.getAllByRole('textbox')[0]!;
  fireEvent.change(reasonInput, { target: { value: text } });
}

function clickSubmitRefund() {
  const submitBtns = screen.getAllByRole('button', { name: /process refund/i });
  fireEvent.click(submitBtns[submitBtns.length - 1]!);
}

function doRefund(reason: string) {
  clickCheckbox(0);
  fillReason(reason);
  clickSubmitRefund();
}

describe('RefundModal', () => {
  it('renders null when not open', () => {
    const { container } = renderWithFluentSync(<RefundModal {...defaultProps} open={false} />, salesFtl, refundFtl);
    expect(container.innerHTML).toBe('');
  });

  it('renders the refund form title and sale info', () => {
    renderWithFluentSync(<RefundModal {...defaultProps} />, salesFtl, refundFtl);
    // The heading "Process Refund" appears in multiple elements (dialog aria-label + h2).
    const headings = screen.getAllByText('Process Refund');
    expect(headings.length).toBeGreaterThanOrEqual(1);
    // Fluent bidi markers wrap variables, so use a function matcher.
    expect(screen.getByText((content: string) => content.includes('Sale:') && content.includes('sale-abc'))).toBeInTheDocument();
    expect(screen.getByText('Select Items to Refund')).toBeInTheDocument();
  });

  it('shows sale line items with SKU and name', () => {
    renderWithFluentSync(<RefundModal {...defaultProps} />, salesFtl, refundFtl);
    expect(screen.getByText('SKU-001')).toBeInTheDocument();
    expect(screen.getByText('Indomie Goreng')).toBeInTheDocument();
    expect(screen.getByText('SKU-002')).toBeInTheDocument();
    expect(screen.getByText('Teh Botol')).toBeInTheDocument();
  });

  it('renders refund details fields', () => {
    renderWithFluentSync(<RefundModal {...defaultProps} />, salesFtl, refundFtl);
    expect(screen.getByText('Reason *')).toBeInTheDocument();
    expect(screen.getByText('Note (internal)')).toBeInTheDocument();
  });

  it('shows Process Refund button disabled when no items selected', () => {
    renderWithFluentSync(<RefundModal {...defaultProps} />, salesFtl, refundFtl);
    const btns = screen.getAllByRole('button', { name: /process refund/i });
    expect(btns.length).toBeGreaterThanOrEqual(1);
    expect(btns[0]).toBeDisabled();
  });

  it('selects a line item when its checkbox is clicked', () => {
    renderWithFluentSync(<RefundModal {...defaultProps} />, salesFtl, refundFtl);
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(2);

    fireEvent.click(checkboxes[0]!);
    // Should be selected.
    expect(checkboxes[0]).toBeChecked();
  });

  it('shows qty controls when a line is selected', () => {
    renderWithFluentSync(<RefundModal {...defaultProps} />, salesFtl, refundFtl);
    const checkbox = screen.getAllByRole('checkbox')[0]!;
    fireEvent.click(checkbox);

    // Qty controls should appear: decrement, value, increment.
    expect(screen.getByText('2')).toBeInTheDocument(); // maxQty displayed
    expect(screen.getByRole('button', { name: /decrease refund quantity/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /increase refund quantity/i })).toBeInTheDocument();
  });

  it('decrements selected qty when decrease button clicked', () => {
    renderWithFluentSync(<RefundModal {...defaultProps} />, salesFtl, refundFtl);
    const checkbox = screen.getAllByRole('checkbox')[0]!;
    fireEvent.click(checkbox);

    // Initial qty = maxQty = 2
    expect(screen.getByText('2')).toBeInTheDocument();

    const decBtn = screen.getByRole('button', { name: /decrease refund quantity/i });
    fireEvent.click(decBtn);
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn();
    renderWithFluentSync(<RefundModal {...defaultProps} onClose={onClose} />, salesFtl, refundFtl);
    const closeBtns = screen.getAllByRole('button', { name: /cancel refund/i });
    fireEvent.click(closeBtns[0]!);
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('calls processRefund with correct args on submit', async () => {
    mockProcessRefund.mockResolvedValueOnce({ refundId: 'ref-1', totalMinor: 7000 });
    renderWithFluentSync(<RefundModal {...defaultProps} />, salesFtl, refundFtl);

    // Select first line item + enter reason + submit.
    clickCheckbox(0);
    fillReason('Customer returned');
    clickSubmitRefund();

    await waitFor(() => {
      expect(mockProcessRefund).toHaveBeenCalledTimes(1);
    });
    // 5e0d4caa: processRefund is session-scoped — token is arg 0, and the
    // user is resolved from the session server-side (no userId on the wire).
    expect(mockProcessRefund).toHaveBeenCalledWith(
      'mock-session-token',
      expect.objectContaining({
        saleId: 'sale-abc123456789',
        reason: 'Customer returned',
        lines: expect.arrayContaining([
          expect.objectContaining({ sku: 'SKU-001', qty: 2 }),
        ]),
      }),
    );
  });

  it('shows success state after refund', async () => {
    mockProcessRefund.mockResolvedValueOnce({ refundId: 'ref-done', totalMinor: 12000 });
    renderWithFluentSync(<RefundModal {...defaultProps} />, salesFtl, refundFtl);

    await doRefund('Defective');

    await waitFor(() => {
      expect(screen.getByText('Refund Processed')).toBeInTheDocument();
    });
  });

  it('shows error when processRefund fails', async () => {
    mockProcessRefund.mockRejectedValueOnce(new Error('Network down'));
    renderWithFluentSync(<RefundModal {...defaultProps} />, salesFtl, refundFtl);

    await doRefund('Broken');

    await waitFor(() => {
      expect(screen.getByText('Refund failed')).toBeInTheDocument();
    });
  });

  it('calls onRefunded and onClose when Done is clicked after success', async () => {
    mockProcessRefund.mockResolvedValueOnce({ refundId: 'ref-ok', totalMinor: 0 });
    const onRefunded = vi.fn();
    const onClose = vi.fn();

    renderWithFluentSync(<RefundModal {...defaultProps} onRefunded={onRefunded} onClose={onClose} />, salesFtl, refundFtl);

    clickCheckbox(0);
    fillReason('Return');
    clickSubmitRefund();

    await waitFor(() => {
      expect(screen.getByText('Refund Processed')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /done/i }));
    expect(onRefunded).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('shows refund total row', () => {
    renderWithFluentSync(<RefundModal {...defaultProps} />, salesFtl, refundFtl);
    expect(screen.getByText('Refund Total')).toBeInTheDocument();
  });

  it('deselects a line item when clicked again', () => {
    renderWithFluentSync(<RefundModal {...defaultProps} />, salesFtl, refundFtl);
    const checkbox = screen.getAllByRole('checkbox')[0]!;
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });

  it('closes when backdrop overlay is clicked', async () => {
    const onClose = vi.fn();
    renderWithFluentSync(<RefundModal {...defaultProps} onClose={onClose} />, salesFtl, refundFtl);
    const overlay = screen.getByRole('dialog');
    fireEvent.click(overlay);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });


  // ── Proration is ONE rule, not two ─────────────────────────────────
  //
  // The displayed total and the submitted payload used to disagree. The
  // total showed the exact fraction `total_minor * qty / line.qty`; the payload
  // rounded a UNIT price and multiplied it back. On the fixture below a line
  // of 700 over 2 units taken as 1 displayed 3500 but submitted 3500 -- equal
  // by luck -- so the fixture lines divide evenly and the defect is INVISIBLE
  // on them. These cases use lines that do not divide evenly.

  it('never refunds more than the line was sold for a full-line refund', async () => {
    mockProcessRefund.mockResolvedValueOnce({ refundId: 'r1', refundedMinor: 0 });
    // 999 over 7 units: rounding a unit price gives 143, and 143 * 7 = 1001,
    // which is MORE than the line was originally worth.
    const sale = {
      ...mockSale,
      lines: [{ id: 'line-x', sku: 'SKU-X', name: 'Bulk', qty: 7, unit_price: { minor_units: 143, currency: 'IDR' }, total_minor: 999, tax_amount: null, tax_rate_id: null }],
    };
    renderWithFluentSync(<RefundModal {...defaultProps} sale={sale} />, salesFtl, refundFtl);
    fillReason('defective goods');
    clickCheckbox(0);
    clickSubmitRefund();

    await waitFor(() => expect(mockProcessRefund).toHaveBeenCalled());
    const lines = mockProcessRefund.mock.calls[0]![1].lines as Array<{ lineTotalMinor: number }>;
    expect(lines[0]!.lineTotalMinor).toBe(999);
    expect(lines[0]!.lineTotalMinor).toBeLessThanOrEqual(999);
  });

  it('refunds the same amount it displays for an uneven partial line', async () => {
    mockProcessRefund.mockResolvedValueOnce({ refundId: 'r2', refundedMinor: 0 });
    // 1000 over 7 units, 3 selected: exact share 428.57..., so the displayed
    // total and the submitted amount must both be 429.
    const sale = {
      ...mockSale,
      lines: [{ id: 'line-y', sku: 'SKU-Y', name: 'Bulk', qty: 7, unit_price: { minor_units: 143, currency: 'IDR' }, total_minor: 1000, tax_amount: null, tax_rate_id: null }],
    };
    renderWithFluentSync(<RefundModal {...defaultProps} sale={sale} />, salesFtl, refundFtl);
    fillReason('defective goods');
    clickCheckbox(0);

    // The checkbox selects the WHOLE line; the qty is walked down with the
    // minus button, which is the only qty control this dialog offers.
    for (let i = 0; i < 4; i++) {
      fireEvent.click(screen.getAllByRole('button', { name: /decrease/i })[0]!);
    }
    expect(screen.getByText('3')).toBeInTheDocument();

    // No assertion on the DISPLAYED total here: formatMoney rounds, so the
    // exact fraction 428.57... and the rounded share both render as 429. The
    // display was never visibly wrong -- the defect is the amount SUBMITTED,
    // which is what the next assertion pins. Reverting only the display to
    // the exact fraction was measured and survives, because it is
    // behaviourally equivalent.
    clickSubmitRefund();
    await waitFor(() => expect(mockProcessRefund).toHaveBeenCalled());
    const lines = mockProcessRefund.mock.calls[0]![1].lines as Array<{ lineTotalMinor: number }>;
    expect(lines[0]!.lineTotalMinor).toBe(429);
  });

  it('does not close when modal panel is clicked', () => {
    const onClose = vi.fn();
    renderWithFluentSync(<RefundModal {...defaultProps} onClose={onClose} />, salesFtl, refundFtl);
    const panel = screen.getByRole('dialog').querySelector('.refund-modal')!;
    fireEvent.click(panel);
    expect(onClose).not.toHaveBeenCalled();
  });
});
