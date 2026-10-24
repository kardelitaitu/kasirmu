import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithFluentSync } from '@/__tests__/test-utils/render';
import stockTransfersFtl from '@/locales/stock-transfers.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';

vi.mock('@/api/stockTransfers', () => ({
  listStockTransfers: vi.fn(),
  listInTransitTransfers: vi.fn(),
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
import { listStockTransfers, listInTransitTransfers, getStockTransfer, sendStockTransfer, cancelStockTransfer, createStockTransfer } from '@/api/stockTransfers';

const mockListTransfers = listStockTransfers as ReturnType<typeof vi.fn>;
const mockListInTransit = listInTransitTransfers as ReturnType<typeof vi.fn>;
const mockGetTransfer = getStockTransfer as ReturnType<typeof vi.fn>;
const mockSendTransfer = sendStockTransfer as ReturnType<typeof vi.fn>;
const mockCancelTransfer = cancelStockTransfer as ReturnType<typeof vi.fn>;
const mockCreateTransfer = createStockTransfer as ReturnType<typeof vi.fn>;



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
    // Default: nothing in transit. Every existing case then exercises the panel's
    // empty state, which is what the table-only assertions expect.
    mockListInTransit.mockResolvedValue([]);
  });

  // ── List rendering ───────────────────────────────────────────
  it('does not discard the ANSWERED dropdown reads when the transfer list fails', async () => {
    // `load` (:110-129) runs three reads in ONE Promise.all. The products and terminals
    // reads were already settled, so a failure in either is recorded as `null` and the two
    // `=== null` notices (:657, :710) say so. The PRIMARY read was a bare await, so its
    // rejection took the whole Promise.all down -- discarding two answers that had already
    // succeeded and reporting those dropdowns as unanswered when they had been answered.
    mockListTransfers.mockRejectedValue(new Error('invoke failed'));
    mockListProducts.mockResolvedValue([{ sku: 'SKU-1', name: 'Widget', unit: 'pcs' }]);
    mockListTerminals.mockResolvedValue([{ id: 'term-9', name: 'Register 9' }]);

    renderWithFluentSync(<StockTransfersScreen />, stockTransfersFtl, sharedFtl);

    // The failure is reported, not swallowed.
    await waitFor(() => {
      expect(screen.getByText(/failed to load|could not load|error/i)).toBeInTheDocument();
    });

    // And the answers survive it: the terminal picker renders Register 9, which only
    // happens if that read's answer reached state. It appears in BOTH the send and receive
    // pickers, hence getAllByText rather than getByText.
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /new transfer/i }));
    await waitFor(() => {
      expect(screen.getAllByText('Register 9').length).toBeGreaterThan(0);
    });
  });

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

  it('does not leave the previous transfer on screen when the next detail read fails', async () => {
    const user = userEvent.setup();
    mockListTransfers.mockResolvedValue(sampleTransfers);
    // A answers by default; the SECOND read (B) rejects. The mount path may issue its
    // own read, so the rejection is armed only after A's detail is on screen.
    mockGetTransfer.mockResolvedValue(sampleDetail);

    renderWithFluentSync(<StockTransfersScreen />, stockTransfersFtl, sharedFtl);
    await waitFor(() => expect(screen.getByText('ST-001')).toBeInTheDocument());

    await user.click(screen.getByText('ST-001'));
    // `sampleDetail` is ST-001, whose destination is "Storefront".
    await waitFor(() =>
      expect(screen.getByTestId('stock-transfer-detail-destination')).toHaveTextContent('Storefront'),
    );

    // B's read fails. `detail` used to survive, so A's number, A's lines and A's Receive
    // button stayed under a heading opened for B — and openReceiveModal prefills from
    // `detail.lines`, so the operator could receive A's lines thinking they were on B.
    mockGetTransfer.mockRejectedValue(new Error('store busy'));
    await user.click(screen.getByText('ST-002'));

    await waitFor(() => {
      expect(screen.queryByTestId('stock-transfer-detail-destination')).toBeNull();
    });
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

  // A double tap on Create Transfer must not create the transfer TWICE.
  //
  // The server does not protect this, and it is the worst instance of the class so far.
  // core `create_transfer` mints a fresh UUID and a DISTINCT transfer_number
  // (`TRF-{ts}-{random tail}`, crates/kasirmu-core/src/db/stock_transfers.rs:37-45). The
  // random tail is there on purpose -- the comment says two transfers in the same
  // millisecond would collide and trip the UNIQUE constraint, so the tail was chosen to
  // make that impossible. The consequence is that two calls CANNOT collide: they create
  // two wholly independent transfers, both carrying the same goods. And a stock transfer is
  // not a cosmetic row -- sending one moves physical stock out of a location, so the double
  // tap moves twice what the operator entered.
  //
  // The handler's only guard is `createSaving` state, which React commits on its NEXT
  // render -- after the second dispatch of a real double tap. Compare `customers` and
  // `cash_payouts` (rounds 139-140), which store a duplicate row, with `suppliers` and
  // purchase orders (round 141), which the unique index refuses. This one is the first
  // where the duplicate is BOTH stored AND consequential.
  //
  // SHAPE 3 (round 139): both taps inside ONE act() batch. Sequential `fireEvent` wraps
  // each dispatch in its own act() and React commits `setCreateSaving(true)` between them,
  // disabling the button -- that shape reports 1 call where a real double tap sends 2.
  it('creates a stock transfer once for a double tap while the first is in flight', async () => {
    mockListTransfers.mockResolvedValue(sampleTransfers);
    mockListProducts.mockResolvedValue([]);
    mockListTerminals.mockResolvedValue([]);
    let releaseCreate: ((v: unknown) => void) | undefined;
    const heldCreate = new Promise((resolve) => { releaseCreate = resolve; });
    mockCreateTransfer.mockImplementation(() => heldCreate as never);

    renderWithFluentSync(<StockTransfersScreen />, stockTransfersFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('New Transfer')).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByText('New Transfer'));
    await waitFor(() => {
      expect(screen.getByLabelText(/SKU/i)).toBeInTheDocument();
    });

    // One line is seeded on open (mirrors PurchaseOrderForm); fill it so the
    // handler's `no lines` branch is not what returns early.
    fireEvent.change(screen.getByLabelText(/SKU/i), { target: { value: 'SKU-001' } });

    const createBtn = screen.getByRole('button', { name: /create transfer/i });
    await act(async () => {
      fireEvent.click(createBtn);
      // The disabled flag React set is not yet authoritative for a live double tap;
      // dropping it sends the second click to the handler the way a real one would.
      createBtn.removeAttribute('disabled');
      fireEvent.click(createBtn);
    });

    expect(
      mockCreateTransfer.mock.calls.length,
      'a double tap on Create Transfer sent the create twice; core mints a distinct ' +
        'transfer_number per call, so this creates TWO transfers carrying the same goods ' +
        'and moves twice the stock on send',
    ).toBe(1);

    releaseCreate?.({ id: 'st-new', transfer_number: 'TRF-1' });
    await waitFor(() => {
      expect(mockCreateTransfer).toHaveBeenCalledTimes(1);
    });
  });

  // ── In-transit audit panel ───────────────────────────────────
  // The panel replaced the unreachable TransitAuditScreen. What it must prove:
  // the goods (not just the id) are on screen, overdue is derived rather than
  // assumed, the audit read failing does not take the transfer table with it,
  // and a reversal is CONFIRMED before it cancels anything.

  /** Build an in-transit row whose sent_at is `hoursAgo` before now. */
  function transitRow(hoursAgo: number, number = 'ST-002') {
    const sentAt = new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
    return {
      transfer: { ...sampleTransfers[1]!, transfer_number: number, sent_at: sentAt },
      lines: [
        { id: 'line-3', transfer_id: 'st-2', sku: 'SKU-003', product_name: 'Thing', qty: 8, received_qty: 0 },
      ],
    };
  }

  it('renders in-transit transfers with their lines in the audit panel', async () => {
    mockListTransfers.mockResolvedValue([]);
    mockListInTransit.mockResolvedValue([transitRow(2)]);

    renderWithFluentSync(<StockTransfersScreen />, stockTransfersFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /transit stock audit/i })).toBeInTheDocument();
    });
    // The line items, not only the transfer number: this is the audit view.
    expect(await screen.findByText('SKU-003')).toBeInTheDocument();
    expect(screen.getByText('Thing')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('flags a transfer that has been in transit longer than the expiry window', async () => {
    mockListTransfers.mockResolvedValue([]);
    // 25 h > 24 h, and 1 h < 24 h, so a single render must disagree with itself
    // about the two cards -- which is what makes this a measurement of the
    // threshold rather than of the badge.
    mockListInTransit.mockResolvedValue([transitRow(25, 'ST-OLD'), transitRow(1, 'ST-NEW')]);

    renderWithFluentSync(<StockTransfersScreen />, stockTransfersFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByTestId('transit-card-ST-OLD')).toBeInTheDocument();
    });
    expect(screen.getByTestId('transit-card-ST-OLD').className).toContain('stock-transfers-transit-card--overdue');
    expect(screen.getByTestId('transit-card-ST-NEW').className).not.toContain('stock-transfers-transit-card--overdue');
    expect(screen.getByText(/over 24 h in transit/i)).toBeInTheDocument();
  });

  it('does not report the transfer table as broken when only the audit read fails', async () => {
    // The two reads fail independently; folding them into one would let a
    // rejected audit read blank a table that answered.
    mockListTransfers.mockResolvedValue(sampleTransfers);
    mockListInTransit.mockRejectedValue(new Error('audit invoke failed'));

    renderWithFluentSync(<StockTransfersScreen />, stockTransfersFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('ST-001')).toBeInTheDocument();
    });
    // The audit read's OWN error string, which resolves from the inventory bundle
    // (`inv-transit-error-load`) -- a bundle this suite does not load, so the text
    // renders unresolved. It still renders inside a role="alert", which is both the
    // proof that the failure was reported and the assertion a screen reader relies on.
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('ST-002')).toBeInTheDocument();
  });

  it('asks for confirmation and then reverses the transfer from the audit panel', async () => {
    mockListTransfers.mockResolvedValue([]);
    mockListInTransit.mockResolvedValue([transitRow(2)]);
    mockCancelTransfer.mockResolvedValue(undefined);

    renderWithFluentSync(<StockTransfersScreen />, stockTransfersFtl, sharedFtl);

    const reverseBtn = await screen.findByRole('button', { name: /reverse transfer/i });
    await userEvent.setup().click(reverseBtn);

    // Nothing is cancelled by the click itself.
    expect(mockCancelTransfer).not.toHaveBeenCalled();
    // The confirm step renders. Its labels come from the inventory bundle this suite
    // does not load, so the dialog is found by test id; the assertion that matters is
    // the one just above -- the first click cancelled nothing.
    await waitFor(() => {
      expect(screen.getByTestId('confirm-dialog-confirm')).toBeInTheDocument();
    });
    expect(mockCancelTransfer).not.toHaveBeenCalled();

    await userEvent.setup().click(screen.getByTestId('confirm-dialog-confirm'));

    await waitFor(() => {
      expect(mockCancelTransfer).toHaveBeenCalledWith('mock-session-token', 'st-2');
    });
    // The audit read is re-issued after the reversal, so the card cannot outlive it.
    await waitFor(() => {
      expect(mockListInTransit.mock.calls.length).toBeGreaterThan(1);
    });
  });
});
