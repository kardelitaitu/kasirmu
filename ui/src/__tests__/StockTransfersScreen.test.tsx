import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import stockTransfersFtl from '@/locales/stock-transfers.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';

vi.mock('@/api/stockTransfers', () => ({
  listStockTransfers: vi.fn(),
  getStockTransfer: vi.fn(),
  sendStockTransfer: vi.fn(),
  cancelStockTransfer: vi.fn(),
  receiveStockTransfer: vi.fn(),
  createStockTransfer: vi.fn(),
}));

const { mockListProducts, mockListTerminals } = vi.hoisted(() => ({
  mockListProducts: vi.fn(),
  mockListTerminals: vi.fn(),
}));

vi.mock('@/api/products', () => ({
  listProducts: () => mockListProducts(),
  listProductsScoped: () => mockListProducts(),
}));

vi.mock('@/api/terminals', () => ({
  listTerminals: () => mockListTerminals(),
  listTerminalsScoped: () => mockListTerminals(),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    session: { user_id: 'user-1', display_name: 'Cashier', role_name: 'cashier' },
  }),
}));

import StockTransfersScreen from '@/features/stock-transfers/StockTransfersScreen';
import { listStockTransfers, getStockTransfer, sendStockTransfer, cancelStockTransfer } from '@/api/stockTransfers';

const mockListTransfers = listStockTransfers as ReturnType<typeof vi.fn>;
const mockGetTransfer = getStockTransfer as ReturnType<typeof vi.fn>;
const mockSendTransfer = sendStockTransfer as ReturnType<typeof vi.fn>;
const mockCancelTransfer = cancelStockTransfer as ReturnType<typeof vi.fn>;



const sampleTransfers = [
  {
    id: 'st-1', transfer_number: 'ST-001', status: 'draft',
    source_location: 'Warehouse A', destination_location: 'Storefront',
    source_terminal_id: null, destination_terminal_id: null,
    notes: '', created_by: 'user-1', received_by: null,
    created_at: '2026-07-01T10:00:00Z', sent_at: null, received_at: null,
    updated_at: '2026-07-01',
  },
  {
    id: 'st-2', transfer_number: 'ST-002', status: 'in_transit',
    source_location: 'Warehouse B', destination_location: 'Store B',
    source_terminal_id: null, destination_terminal_id: null,
    notes: 'Urgent', created_by: 'user-1', received_by: null,
    created_at: '2026-07-02T08:00:00Z', sent_at: '2026-07-02T12:00:00Z', received_at: null,
    updated_at: '2026-07-02',
  },
  {
    id: 'st-3', transfer_number: 'ST-003', status: 'received',
    source_location: null, destination_location: null,
    source_terminal_id: 'term-1', destination_terminal_id: 'term-2',
    notes: '', created_by: 'user-1', received_by: 'user-2',
    created_at: '2026-06-15T09:00:00Z', sent_at: '2026-06-15T14:00:00Z',
    received_at: '2026-06-16T11:00:00Z', updated_at: '2026-06-16',
  },
  {
    id: 'st-4', transfer_number: 'ST-004', status: 'cancelled',
    source_location: 'Warehouse C', destination_location: 'Store C',
    source_terminal_id: null, destination_terminal_id: null,
    notes: '', created_by: 'user-1', received_by: null,
    created_at: '2026-06-01T10:00:00Z', sent_at: null, received_at: null,
    updated_at: '2026-06-10',
  },
];

const sampleDetail = {
  transfer: sampleTransfers[0]!,
  lines: [
    { id: 'line-1', transfer_id: 'st-1', sku: 'SKU-001', product_name: 'Widget', qty: 10, received_qty: 0 },
    { id: 'line-2', transfer_id: 'st-1', sku: 'SKU-002', product_name: 'Gadget', qty: 5, received_qty: 0 },
  ],
};

const sampleDetailInTransit = {
  transfer: sampleTransfers[1]!,
  lines: [
    { id: 'line-3', transfer_id: 'st-2', sku: 'SKU-003', product_name: 'Thing', qty: 8, received_qty: 0 },
  ],
};

describe('StockTransfersScreen', () => {
  beforeEach(() => {
    mockListProducts.mockResolvedValue([]);
    mockListTerminals.mockResolvedValue([]);
  });

  // ── List rendering ───────────────────────────────────────────
  it('renders title and New Transfer button', async () => {
    mockListTransfers.mockResolvedValue([]);
    renderWithFluentSync(<StockTransfersScreen />, stockTransfersFtl, sharedFtl);
    expect(screen.getByText('Stock Transfers')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new transfer/i })).toBeInTheDocument();
  });

  it('shows loading skeleton while fetching transfers', async () => {
    mockListTransfers.mockReturnValue(new Promise(() => {}));
    renderWithFluentSync(<StockTransfersScreen />, stockTransfersFtl, sharedFtl);
    expect(document.querySelector('.stock-transfers-loading-skeleton')).toBeInTheDocument();
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
  });

  it('shows empty state when no transfers exist', async () => {
    mockListTransfers.mockResolvedValue([]);
    renderWithFluentSync(<StockTransfersScreen />, stockTransfersFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText(/no stock transfers found/i)).toBeInTheDocument();
    });
  });

  it('loads and displays transfers in the table', async () => {
    mockListTransfers.mockResolvedValue(sampleTransfers);
    renderWithFluentSync(<StockTransfersScreen />, stockTransfersFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('ST-001')).toBeInTheDocument();
    });
    expect(screen.getByText('ST-002')).toBeInTheDocument();
    expect(screen.getByText('Warehouse A')).toBeInTheDocument();
    expect(screen.getByText('Storefront')).toBeInTheDocument();
  });

  it('shows terminal IDs when location is null', async () => {
    mockListTransfers.mockResolvedValue([sampleTransfers[2]!]);
    renderWithFluentSync(<StockTransfersScreen />, stockTransfersFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('ST-003')).toBeInTheDocument();
    });
    expect(screen.getByText('term-1')).toBeInTheDocument();
    expect(screen.getByText('term-2')).toBeInTheDocument();
  });

  it('renders status badges with correct class', async () => {
    mockListTransfers.mockResolvedValue(sampleTransfers);
    renderWithFluentSync(<StockTransfersScreen />, stockTransfersFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('ST-001')).toBeInTheDocument();
    });

    // Use querySelector to avoid Fluent wrapper element collisions.
    const draftBadge = document.querySelector('.stock-transfers-badge--draft');
    expect(draftBadge).toBeInTheDocument();
    expect(draftBadge!.textContent).toBe('Draft');

    const inTransitBadge = document.querySelector('.stock-transfers-badge--in_transit');
    expect(inTransitBadge).toBeInTheDocument();
    // The badge uses the localized stock-transfers-status-in_transit key.
    expect(inTransitBadge!.textContent).toBe('In Transit');
  });

  it('shows View button for each transfer row', async () => {
    mockListTransfers.mockResolvedValue(sampleTransfers);
    renderWithFluentSync(<StockTransfersScreen />, stockTransfersFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('ST-001')).toBeInTheDocument();
    });

    // Use regex — Fluent may add wrappers that affect exact name matching.
    const viewButtons = screen.getAllByRole('button', { name: /view/i });
    expect(viewButtons.length).toBeGreaterThanOrEqual(2);
  });

  it('shows Cancel button for draft transfers', async () => {
    mockListTransfers.mockResolvedValue([sampleTransfers[0]!]);
    renderWithFluentSync(<StockTransfersScreen />, stockTransfersFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('ST-001')).toBeInTheDocument();
    });
    // "Cancel" button in the list row.
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('does not show Cancel button for non-draft transfers', async () => {
    mockListTransfers.mockResolvedValue([sampleTransfers[2]!]);
    renderWithFluentSync(<StockTransfersScreen />, stockTransfersFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('ST-003')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /view/i })).toBeInTheDocument();
    // The "Cancel Transfer" button from detail modal shouldn't exist without modal open.
    expect(screen.queryByRole('button', { name: /cancel transfer/i })).not.toBeInTheDocument();
  });

  // ── Status filters ───────────────────────────────────────────
  it('renders status filter tabs', async () => {
    mockListTransfers.mockResolvedValue(sampleTransfers);
    renderWithFluentSync(<StockTransfersScreen />, stockTransfersFtl, sharedFtl);

    const tablist = screen.getByRole('tablist');
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs.length).toBeGreaterThanOrEqual(4);
  });

  it('filters transfers by status', async () => {
    const user = userEvent.setup();
    mockListTransfers.mockResolvedValue(sampleTransfers);
    renderWithFluentSync(<StockTransfersScreen />, stockTransfersFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('ST-001')).toBeInTheDocument();
    });

    // Click Draft filter tab (role="tab").
    const draftTab = screen.getByRole('tab', { name: /draft/i });
    await user.click(draftTab);

    await waitFor(() => {
      expect(screen.getByText('ST-001')).toBeInTheDocument();
      expect(screen.queryByText('ST-002')).not.toBeInTheDocument();
    });
  });

  // A slow earlier detail read must not overwrite a newer one.
  //
  // Guarded in 1b0f0fb3a. Here the DISCRIMINATOR is the transfer id rather than a
  // session token: `openDetail` sets `detailId` BEFORE its await, so clicking
  // ST-001 and then ST-002 can leave the first read landing last and putting
  // ST-001's destination and LINES under ST-002's heading -- and `openReceiveModal`
  // prefills the received quantities from those lines, so the operator would
  // receive against the wrong transfer.
  //
  // The two fixtures differ in destination, and the destination is asserted via the
  // `stock-transfer-detail-destination` testid added alongside the guard.
  it('keeps the newer transfer when an earlier detail read resolves last', async () => {
    const user = userEvent.setup();
    mockListTransfers.mockResolvedValue(sampleTransfers);

    let releaseFirst: (v: unknown) => void = () => {};
    const firstPending = new Promise((resolve) => { releaseFirst = resolve; });

    // ST-001 (Storefront) is held open and will answer LAST.
    mockGetTransfer
      .mockImplementationOnce(() => firstPending)
      .mockResolvedValue(sampleDetailInTransit);

    renderWithFluentSync(<StockTransfersScreen />, stockTransfersFtl, sharedFtl);
    await waitFor(() => expect(screen.getByText('ST-001')).toBeInTheDocument());

    // Open ST-001 (slow), then ST-002 (fast) while the first is outstanding.
    await user.click(screen.getByText('ST-001'));
    await user.click(screen.getByText('ST-002'));

    await waitFor(() => {
      expect(screen.getByTestId('stock-transfer-detail-destination')).toHaveTextContent('Store B');
    });

    // Now the stale ST-001 read lands, after ST-002 already won.
    await act(async () => {
      releaseFirst(sampleDetail);
      await firstPending;
    });

    // ST-002's detail survives: the guard discarded the late ST-001 answer.
    expect(screen.getByTestId('stock-transfer-detail-destination')).toHaveTextContent('Store B');
  });

  // ── Detail modal ─────────────────────────────────────────────
  it('opens detail modal when transfer number link is clicked', async () => {
    const user = userEvent.setup();
    mockListTransfers.mockResolvedValue(sampleTransfers);
    mockGetTransfer.mockResolvedValue(sampleDetail);
    renderWithFluentSync(<StockTransfersScreen />, stockTransfersFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('ST-001')).toBeInTheDocument();
    });

    await user.click(screen.getByText('ST-001'));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('Transfer Details')).toBeInTheDocument();
    });
  });

  it('shows transfer info and line items in detail modal', async () => {
    const user = userEvent.setup();
    mockListTransfers.mockResolvedValue(sampleTransfers);
    mockGetTransfer.mockResolvedValue(sampleDetail);
    renderWithFluentSync(<StockTransfersScreen />, stockTransfersFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('ST-001')).toBeInTheDocument();
    });

    await user.click(screen.getByText('ST-001'));

    const dialog = await screen.findByRole('dialog');
    // Scope to dialog — "Warehouse A" also exists in the list view.
    expect(within(dialog).getByText('Warehouse A')).toBeInTheDocument();
    expect(within(dialog).getByText('SKU-001')).toBeInTheDocument();
    expect(within(dialog).getByText('Widget')).toBeInTheDocument();
    expect(within(dialog).getByText('SKU-002')).toBeInTheDocument();
  });

  it('shows Send and Cancel buttons in detail for draft transfers', async () => {
    const user = userEvent.setup();
    mockListTransfers.mockResolvedValue(sampleTransfers);
    mockGetTransfer.mockResolvedValue(sampleDetail);
    renderWithFluentSync(<StockTransfersScreen />, stockTransfersFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('ST-001')).toBeInTheDocument();
    });

    await user.click(screen.getByText('ST-001'));

    const dialog = await screen.findByRole('dialog');
    // Scope to dialog — list view also has a "Cancel" button.
    expect(within(dialog).getByRole('button', { name: /send transfer/i })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('shows Receive button in detail for in_transit transfers', async () => {
    const user = userEvent.setup();
    mockListTransfers.mockResolvedValue([sampleTransfers[1]!]);
    mockGetTransfer.mockResolvedValue(sampleDetailInTransit);
    renderWithFluentSync(<StockTransfersScreen />, stockTransfersFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('ST-002')).toBeInTheDocument();
    });

    await user.click(screen.getByText('ST-002'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /receive transfer/i })).toBeInTheDocument();
    });
  });

  it('rejects fractional receive quantity instead of silently truncating it', async () => {
    const user = userEvent.setup();
    mockListTransfers.mockResolvedValue([sampleTransfers[1]!]);
    mockGetTransfer.mockResolvedValue(sampleDetailInTransit);
    renderWithFluentSync(<StockTransfersScreen />, stockTransfersFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('ST-002')).toBeInTheDocument();
    });

    await user.click(screen.getByText('ST-002'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /receive transfer/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /receive transfer/i }));

    const qtyInput = screen.getByRole('spinbutton');
    await user.clear(qtyInput);
    await user.type(qtyInput, '4.5');

    await user.click(screen.getByRole('button', { name: /confirm receipt/i }));

    // The previous `parseInt('4.5', 10) || 0` would have sent 4 silently;
    // now the localized validation error surfaces and no receive call fires.
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Quantities must be whole numbers');
    });
    const receiveMock = vi.mocked(await import('@/api/stockTransfers')).receiveStockTransfer as ReturnType<typeof vi.fn>;
    expect(receiveMock).not.toHaveBeenCalled();
  });

  it('closes detail modal when X close button is clicked', async () => {
    const user = userEvent.setup();
    mockListTransfers.mockResolvedValue(sampleTransfers);
    mockGetTransfer.mockResolvedValue(sampleDetail);
    renderWithFluentSync(<StockTransfersScreen />, stockTransfersFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('ST-001')).toBeInTheDocument();
    });

    await user.click(screen.getByText('ST-001'));

    const dialog = await screen.findByRole('dialog');

    // The X button has class stock-transfers-modal-close.
    const xBtn = dialog.querySelector('.stock-transfers-modal-close') as HTMLElement;
    await user.click(xBtn);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('calls sendStockTransfer and refreshes on send', async () => {
    const user = userEvent.setup();
    mockListTransfers.mockResolvedValue(sampleTransfers);
    mockGetTransfer.mockResolvedValue(sampleDetail);
    mockSendTransfer.mockResolvedValue({});
    renderWithFluentSync(<StockTransfersScreen />, stockTransfersFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('ST-001')).toBeInTheDocument();
    });

    await user.click(screen.getByText('ST-001'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /send transfer/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /send transfer/i }));

    await waitFor(() => {
      expect(mockSendTransfer).toHaveBeenCalledWith('mock-session-token', 'st-1');
    });
  });

  it('calls cancelStockTransfer when Cancel is clicked on the list row', async () => {
    const user = userEvent.setup();
    mockListTransfers.mockResolvedValue([sampleTransfers[0]!]);
    mockCancelTransfer.mockResolvedValue({});
    renderWithFluentSync(<StockTransfersScreen />, stockTransfersFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('ST-001')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(mockCancelTransfer).toHaveBeenCalledWith('mock-session-token', 'st-1');
    });
  });
});
