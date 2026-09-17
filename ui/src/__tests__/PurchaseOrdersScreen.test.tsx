import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import { ToastProvider } from '@/components/Toast';
import purchasingFtl from '@/locales/purchasing.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';

vi.mock('@/api/purchasing', () => ({
  listPurchaseOrdersScoped: vi.fn(),
  updatePoStatusScoped: vi.fn(),
  receivePurchaseOrderScoped: vi.fn(),
}));

// F-005: the screen resolves the session token from WorkspaceContext.
vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'tok-test', activeInstance: null }),
}));

// PO totals render via the store default currency (USD fixtures → 110.00).
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ currency: 'USD', setCurrency: vi.fn(), loading: false }),
}));

// Mock PurchaseOrderForm child component.
vi.mock('@/features/purchasing/PurchaseOrderForm', () => ({
  default: ({ onClose, onSaved }: { editingId: string | null; onClose: () => void; onSaved: () => void }) => (
    <div role="dialog" aria-label="po-form">
      <button onClick={onClose}>Close Form</button>
      <button onClick={onSaved}>Saved</button>
    </div>
  ),
}));

import PurchaseOrdersScreen from '@/features/purchasing/PurchaseOrdersScreen';
import { listPurchaseOrdersScoped, updatePoStatusScoped, receivePurchaseOrderScoped } from '@/api/purchasing';

const mockListPOs = listPurchaseOrdersScoped as ReturnType<typeof vi.fn>;
const mockUpdateStatus = updatePoStatusScoped as ReturnType<typeof vi.fn>;
const mockReceivePO = receivePurchaseOrderScoped as ReturnType<typeof vi.fn>;



const sampleOrders = [
  {
    id: 'po-1', po_number: 'PO-001', supplier_id: 'sup-1', supplier_name: 'Acme Corp',
    status: 'draft', order_date: '2026-07-01', expected_date: '2026-07-15',
    received_date: null, subtotal_minor: 10000, tax_minor: 1000, total_minor: 11000,
    notes: '', created_by: 'user-1', created_at: '2026-07-01', updated_at: '2026-07-01',
    lines: [{ id: 'l1', po_id: 'po-1', sku: 'SKU-001', product_name: 'Widget', qty: 10, unit_cost_minor: 1000, line_total_minor: 10000 }],
  },
  {
    id: 'po-2', po_number: 'PO-002', supplier_id: 'sup-2', supplier_name: 'Global Goods',
    status: 'pending', order_date: '2026-07-02', expected_date: '2026-07-20',
    received_date: null, subtotal_minor: 20000, tax_minor: 2000, total_minor: 22000,
    notes: '', created_by: 'user-1', created_at: '2026-07-02', updated_at: '2026-07-02',
    lines: [
      { id: 'l2', po_id: 'po-2', sku: 'SKU-002', product_name: 'Gadget', qty: 5, unit_cost_minor: 2000, line_total_minor: 10000 },
      { id: 'l3', po_id: 'po-2', sku: 'SKU-003', product_name: 'Thing', qty: 10, unit_cost_minor: 1000, line_total_minor: 10000 },
    ],
  },
  {
    id: 'po-3', po_number: 'PO-003', supplier_id: 'sup-3', supplier_name: null,
    status: 'approved', order_date: '2026-07-03', expected_date: null,
    received_date: null, subtotal_minor: 5000, tax_minor: 0, total_minor: 5000,
    notes: 'Urgent', created_by: 'user-1', created_at: '2026-07-03', updated_at: '2026-07-03',
    lines: [{ id: 'l4', po_id: 'po-3', sku: 'SKU-004', product_name: 'Doodad', qty: 1, unit_cost_minor: 5000, line_total_minor: 5000 }],
  },
  {
    id: 'po-4', po_number: 'PO-004', supplier_id: 'sup-4', supplier_name: 'Old Supplier',
    status: 'cancelled', order_date: '2026-06-01', expected_date: '2026-06-10',
    received_date: null, subtotal_minor: 0, tax_minor: 0, total_minor: 0,
    notes: '', created_by: 'user-1', created_at: '2026-06-01', updated_at: '2026-06-02',
    lines: [],
  },
];

describe('PurchaseOrdersScreen', () => {
  // ── List rendering ───────────────────────────────────────────
  it('renders the title and New Purchase Order button', async () => {
    mockListPOs.mockResolvedValue([]);
    renderWithFluentSync(<ToastProvider><PurchaseOrdersScreen /></ToastProvider>, purchasingFtl, sharedFtl);
    expect(screen.getByText('Purchase Orders')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new purchase order/i })).toBeInTheDocument();
  });

  it('loads and displays purchase orders in the table', async () => {
    mockListPOs.mockResolvedValue(sampleOrders);
    renderWithFluentSync(<ToastProvider><PurchaseOrdersScreen /></ToastProvider>, purchasingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('PO-001')).toBeInTheDocument();
    });
    expect(screen.getByText('PO-002')).toBeInTheDocument();
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Global Goods')).toBeInTheDocument();
    expect(screen.getByText('110.00')).toBeInTheDocument();
  });

  it('shows loading skeleton while fetching purchase orders', async () => {
    mockListPOs.mockReturnValue(new Promise(() => {}));
    renderWithFluentSync(<ToastProvider><PurchaseOrdersScreen /></ToastProvider>, purchasingFtl, sharedFtl);
    expect(document.querySelector('.po-loading-skeleton')).toBeInTheDocument();
    expect(screen.queryByText(/loading purchase orders/i)).not.toBeInTheDocument();
  });

  it('shows empty state when no orders exist', async () => {
    mockListPOs.mockResolvedValue([]);
    renderWithFluentSync(<ToastProvider><PurchaseOrdersScreen /></ToastProvider>, purchasingFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText(/no purchase orders yet/i)).toBeInTheDocument();
    });
  });

  it('displays supplier_id when supplier_name is null', async () => {
    mockListPOs.mockResolvedValue([sampleOrders[2]!]);
    renderWithFluentSync(<ToastProvider><PurchaseOrdersScreen /></ToastProvider>, purchasingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('PO-003')).toBeInTheDocument();
      expect(screen.getByText('sup-3')).toBeInTheDocument();
    });
  });

  it('shows the line count for each PO', async () => {
    mockListPOs.mockResolvedValue(sampleOrders);
    renderWithFluentSync(<ToastProvider><PurchaseOrdersScreen /></ToastProvider>, purchasingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('PO-001')).toBeInTheDocument();
    });
    // PO-001 has 1 line → "1" cell; PO-002 has 2 lines → "2" cell.
    const cells = screen.getAllByRole('cell');
    const lineCounts = cells.filter(c => c.textContent === '1' || c.textContent === '2');
    expect(lineCounts.length).toBeGreaterThanOrEqual(2);
  });

  it('renders status badges with correct class', async () => {
    mockListPOs.mockResolvedValue(sampleOrders);
    renderWithFluentSync(<ToastProvider><PurchaseOrdersScreen /></ToastProvider>, purchasingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('PO-001')).toBeInTheDocument();
    });

    const draftBadge = document.querySelector('.po-status--draft');
    expect(draftBadge).toBeInTheDocument();
    expect(draftBadge!.textContent).toBe('Draft');

    const pendingBadge = document.querySelector('.po-status--pending');
    expect(pendingBadge).toBeInTheDocument();
    expect(pendingBadge!.textContent).toBe('Pending');

    const approvedBadge = document.querySelector('.po-status--approved');
    expect(approvedBadge).toBeInTheDocument();
    expect(approvedBadge!.textContent).toBe('Approved');
  });

  // ── Status filters ───────────────────────────────────────────
  it('renders status filter buttons', async () => {
    mockListPOs.mockResolvedValue(sampleOrders);
    renderWithFluentSync(<ToastProvider><PurchaseOrdersScreen /></ToastProvider>, purchasingFtl, sharedFtl);

    expect(screen.getByText('All')).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
  });

  it('filters orders by status when a filter is clicked', async () => {
    const user = userEvent.setup();
    mockListPOs.mockResolvedValue(sampleOrders);
    renderWithFluentSync(<ToastProvider><PurchaseOrdersScreen /></ToastProvider>, purchasingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('PO-001')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Draft' }));

    await waitFor(() => {
      expect(screen.getByText('PO-001')).toBeInTheDocument();
      expect(screen.queryByText('PO-002')).not.toBeInTheDocument();
    });
  });

  it('shows filtered empty message when status filter matches nothing', async () => {
    const user = userEvent.setup();
    mockListPOs.mockResolvedValue([sampleOrders[0]!]);
    renderWithFluentSync(<ToastProvider><PurchaseOrdersScreen /></ToastProvider>, purchasingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('PO-001')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Approved'));

    await waitFor(() => {
      expect(screen.getByText(/no purchase orders with status/i)).toBeInTheDocument();
    });
  });

  // ── Action buttons ───────────────────────────────────────────
  it('shows Submit button for draft orders', async () => {
    mockListPOs.mockResolvedValue([sampleOrders[0]!]);
    renderWithFluentSync(<ToastProvider><PurchaseOrdersScreen /></ToastProvider>, purchasingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('PO-001')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument();
  });

  it('calls updatePoStatusScoped when Submit is clicked on a draft', async () => {
    const user = userEvent.setup();
    mockListPOs.mockResolvedValue([sampleOrders[0]!]);
    mockUpdateStatus.mockResolvedValue({});
    renderWithFluentSync(<ToastProvider><PurchaseOrdersScreen /></ToastProvider>, purchasingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('PO-001')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => {
      expect(mockUpdateStatus).toHaveBeenCalledWith(
        'tok-test',
        expect.objectContaining({ id: 'po-1', status: 'pending' }),
      );
    });
  });

  it('shows Approve and Cancel buttons for pending orders', async () => {
    mockListPOs.mockResolvedValue([sampleOrders[1]!]);
    renderWithFluentSync(<ToastProvider><PurchaseOrdersScreen /></ToastProvider>, purchasingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('PO-002')).toBeInTheDocument();
    });
    // Use exact name to avoid colliding with "Approved"/"Cancelled" filter buttons.
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('shows Receive button for approved orders', async () => {
    mockListPOs.mockResolvedValue([sampleOrders[2]!]);
    renderWithFluentSync(<ToastProvider><PurchaseOrdersScreen /></ToastProvider>, purchasingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('PO-003')).toBeInTheDocument();
    });
    // Use exact name to avoid colliding with "Received" filter button.
    expect(screen.getByRole('button', { name: 'Receive' })).toBeInTheDocument();
  });

  it('calls receivePurchaseOrderScoped when Receive is clicked', async () => {
    const user = userEvent.setup();
    mockListPOs.mockResolvedValue([sampleOrders[2]!]);
    mockReceivePO.mockResolvedValue({});
    renderWithFluentSync(<ToastProvider><PurchaseOrdersScreen /></ToastProvider>, purchasingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('PO-003')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Receive' }));

    await waitFor(() => {
      expect(mockReceivePO).toHaveBeenCalledWith('tok-test', 'po-3');
    });
  });

  it('shows no action buttons for cancelled orders', async () => {
    mockListPOs.mockResolvedValue([sampleOrders[3]!]);
    renderWithFluentSync(<ToastProvider><PurchaseOrdersScreen /></ToastProvider>, purchasingFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('PO-004')).toBeInTheDocument();
    });
    // No action buttons in the cancelled row. Use exact names to avoid filter button collision.
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Receive' })).not.toBeInTheDocument();
  });

  // ── Create form modal ────────────────────────────────────────
  it('opens PurchaseOrderForm when New Purchase Order is clicked', async () => {
    const user = userEvent.setup();
    mockListPOs.mockResolvedValue([]);
    renderWithFluentSync(<ToastProvider><PurchaseOrdersScreen /></ToastProvider>, purchasingFtl, sharedFtl);

    await user.click(screen.getByRole('button', { name: /new purchase order/i }));

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /po-form/i })).toBeInTheDocument();
    });
  });

  it('refreshes list when form onSaved is called', async () => {
    const user = userEvent.setup();
    mockListPOs.mockResolvedValue([]);
    renderWithFluentSync(<ToastProvider><PurchaseOrdersScreen /></ToastProvider>, purchasingFtl, sharedFtl);

    await user.click(screen.getByRole('button', { name: /new purchase order/i }));
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /po-form/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /saved/i }));

    await waitFor(() => {
      expect(mockListPOs).toHaveBeenCalledTimes(2);
    });
  });

  it('closes form when form onClose is called', async () => {
    const user = userEvent.setup();
    mockListPOs.mockResolvedValue([]);
    renderWithFluentSync(<ToastProvider><PurchaseOrdersScreen /></ToastProvider>, purchasingFtl, sharedFtl);

    await user.click(screen.getByRole('button', { name: /new purchase order/i }));
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /po-form/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /close form/i }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /po-form/i })).not.toBeInTheDocument();
    });
  });
});
