import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithFluent } from '@/__tests__/test-utils/render';
import salesFtl from '@/locales/sales.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';

vi.mock('@/api/sales', () => ({
  listSales: vi.fn(),
  getSale: vi.fn(),
  // Present so a test can assert they are chosen. The screen never called these, which is the
  // defect: the mock originally listed only the ambient pair plus voidSaleScoped, so the file
  // itself encoded "writes are scoped, reads are not" and any scoped read would have crashed
  // the suite with "not a function" rather than revealing the omission.
  listSalesScoped: vi.fn(),
  getSaleScoped: vi.fn(),
  voidSaleScoped: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    session: { user_id: 'user-1', display_name: 'Cashier', role_name: 'cashier' },
  }),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'session-1' }),
}));

import VoidOrdersScreen from '@/features/sales/VoidOrdersScreen';
import { listSales, getSale, listSalesScoped, getSaleScoped, voidSaleScoped } from '@/api/sales';

const mockListSales = listSales as ReturnType<typeof vi.fn>;
const mockGetSale = getSale as ReturnType<typeof vi.fn>;
const mockListSalesScoped = listSalesScoped as ReturnType<typeof vi.fn>;
const mockGetSaleScoped = getSaleScoped as ReturnType<typeof vi.fn>;
const mockVoidSale = voidSaleScoped as ReturnType<typeof vi.fn>;



const sampleSales = [
  {
    id: 'ORD-001', createdAt: '2026-07-05T10:00:00Z', status: 'active',
    total: { minor_units: 35000, currency: 'IDR' }, lineCount: 3,
    paymentMethod: 'CASH', userId: 'user-1',
  },
  {
    id: 'ORD-002', createdAt: '2026-07-05T11:00:00Z', status: 'completed',
    total: { minor_units: 50000, currency: 'IDR' }, lineCount: 2,
    paymentMethod: 'CARD', userId: 'user-1',
  },
  {
    id: 'ORD-003', createdAt: '2026-07-05T12:00:00Z', status: 'voided',
    total: { minor_units: 12000, currency: 'IDR' }, lineCount: 1,
    paymentMethod: 'CASH', userId: 'user-1',
  },
];

const sampleDetail = {
  id: 'ORD-001', createdAt: '2026-07-05T10:00:00Z', status: 'active',
  total: { minor_units: 35000, currency: 'IDR' },
  subtotal: { minor_units: 35000, currency: 'IDR' },
  taxTotal: { minor_units: 0, currency: 'IDR' },
  lineCount: 3, paymentMethod: 'CASH', tenderedMinor: 50000,
  userId: 'user-1',
  lines: [
    { id: 'line-1', sku: 'SKU-001', name: 'Indomie Goreng', qty: 2, unit_price: { minor_units: 3500, currency: 'IDR' }, total_minor: 7000, tax_amount: null, tax_rate_id: null },
    { id: 'line-2', sku: 'SKU-002', name: 'Teh Botol', qty: 1, unit_price: { minor_units: 5000, currency: 'IDR' }, total_minor: 5000, tax_amount: null, tax_rate_id: null },
    { id: 'line-3', sku: 'SKU-003', name: 'Nasi Goreng', qty: 1, unit_price: { minor_units: 15000, currency: 'IDR' }, total_minor: 15000, tax_amount: null, tax_rate_id: null },
  ],
};

describe('VoidOrdersScreen', () => {
  it('renders the list view with title', async () => {
    mockListSalesScoped.mockResolvedValue({ sales: [], salesHistoryCapped: false });
    await renderWithFluent(<VoidOrdersScreen />, salesFtl, sharedFtl);
    expect(screen.getByText('Orders')).toBeInTheDocument();
  });

  it('renders loading skeleton initially', async () => {
    mockListSalesScoped.mockReturnValue(new Promise(() => {}));
    const { container } = await renderWithFluent(<VoidOrdersScreen />, salesFtl, sharedFtl);
    const skeleton = container.querySelector('.void-orders-loading-skeleton');
    expect(skeleton).toBeInTheDocument();
    expect(skeleton?.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders empty state when no orders', async () => {
    mockListSalesScoped.mockResolvedValue({ sales: [], salesHistoryCapped: false });
    await renderWithFluent(<VoidOrdersScreen />, salesFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText(/No orders recorded yet/i)).toBeInTheDocument();
    });
  });

  it('renders orders in the list', async () => {
    mockListSalesScoped.mockResolvedValue({ sales: sampleSales, salesHistoryCapped: false });
    await renderWithFluent(<VoidOrdersScreen />, salesFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText(/ORD-001/)).toBeInTheDocument();
    });
    expect(screen.getByText(/ORD-002/)).toBeInTheDocument();
    expect(screen.getByText(/ORD-003/)).toBeInTheDocument();
  });

  it('renders the status filter chips', async () => {
    mockListSalesScoped.mockResolvedValue({ sales: sampleSales, salesHistoryCapped: false });
    await renderWithFluent(<VoidOrdersScreen />, salesFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('All')).toBeInTheDocument();
    });
    expect(screen.getAllByText('Active').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Completed').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Voided').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Pending').length).toBeGreaterThanOrEqual(1);
  });

  it('filters orders by status', async () => {
    mockListSalesScoped.mockResolvedValue({ sales: sampleSales, salesHistoryCapped: false });
    await renderWithFluent(<VoidOrdersScreen />, salesFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText(/ORD-001/)).toBeInTheDocument();
    });

    await userEvent.click(screen.getAllByText('Voided')[0]!);

    expect(screen.queryByText(/ORD-001/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ORD-002/)).not.toBeInTheDocument();
    expect(screen.getByText(/ORD-003/)).toBeInTheDocument();
  });

  it('opens detail view when View is clicked', async () => {
    mockListSalesScoped.mockResolvedValue({ sales: sampleSales, salesHistoryCapped: false });
    mockGetSaleScoped.mockResolvedValue(sampleDetail);
    await renderWithFluent(<VoidOrdersScreen />, salesFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText(/ORD-001/)).toBeInTheDocument();
    });

    const viewBtns = screen.getAllByRole('button', { name: /^View|^view/i });
    await userEvent.click(viewBtns[0]!);

    await waitFor(() => {
      expect(screen.getByText(/Indomie Goreng/)).toBeInTheDocument();
    });
    expect(screen.getByText('SKU-001')).toBeInTheDocument();
  });

  it('shows void section for Active orders in detail view', async () => {
    mockListSalesScoped.mockResolvedValue({ sales: sampleSales, salesHistoryCapped: false });
    mockGetSaleScoped.mockResolvedValue(sampleDetail);
    await renderWithFluent(<VoidOrdersScreen />, salesFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText(/ORD-001/)).toBeInTheDocument();
    });

    const viewBtns = screen.getAllByRole('button', { name: /^view/i });
    await userEvent.click(viewBtns[0]!);

    await waitFor(() => {
      expect(screen.getByText(/Void Order/)).toBeInTheDocument();
    });
  });

  it('renders the void reason select', async () => {
    mockListSalesScoped.mockResolvedValue({ sales: sampleSales, salesHistoryCapped: false });
    mockGetSaleScoped.mockResolvedValue(sampleDetail);
    await renderWithFluent(<VoidOrdersScreen />, salesFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText(/ORD-001/)).toBeInTheDocument();
    });

    const viewBtns = screen.getAllByRole('button', { name: /^view/i });
    await userEvent.click(viewBtns[0]!);

    await waitFor(() => {
      expect(screen.getByDisplayValue(/Select a reason/i)).toBeInTheDocument();
    });
  });

  it('disables Confirm Void button until a reason is selected', async () => {
    mockListSalesScoped.mockResolvedValue({ sales: sampleSales, salesHistoryCapped: false });
    mockGetSaleScoped.mockResolvedValue(sampleDetail);
    await renderWithFluent(<VoidOrdersScreen />, salesFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText(/ORD-001/)).toBeInTheDocument();
    });

    const viewBtns = screen.getAllByRole('button', { name: /^view/i });
    await userEvent.click(viewBtns[0]!);

    await waitFor(() => {
      const confirmBtn = screen.getByRole('button', { name: /confirm void/i });
      expect(confirmBtn).toBeDisabled();
    });
  });

  it('voids a sale once for a double click while the first is in flight', async () => {
    // `void_sale` is a compare-and-set (`WHERE id = ?2 AND status = 'active'`,
    // sales_lifecycle.rs:903-914), so the replay is REFUSED -- and the catch reports
    // `void-orders-error-void`, telling the cashier the void failed over a sale that was
    // voided. Worse on this screen: the sale is GONE from the active list, so they cannot
    // tell whether the first tap worked.
    mockListSalesScoped.mockResolvedValue({ sales: sampleSales, salesHistoryCapped: false });
    mockGetSaleScoped.mockResolvedValue(sampleDetail);
    let releaseVoid: ((v: unknown) => void) | undefined;
    mockVoidSale.mockImplementation(
      () => new Promise((resolve) => { releaseVoid = resolve; }),
    );
    const user = userEvent.setup();

    await renderWithFluent(<VoidOrdersScreen />, salesFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText(/ORD-001/)).toBeInTheDocument();
    });

    await user.click(screen.getAllByRole('button', { name: /^view/i })[0]!);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument();
    });
    await user.selectOptions(screen.getByDisplayValue(/Select a reason/i), 'cancelled-by-customer');

    const confirmBtn = screen.getByRole('button', { name: /confirm void/i }) as HTMLButtonElement;
    // fireEvent inside one act(), not two user.click()s: userEvent awaits its own act(),
    // which flushes the pending chain so the first void would have settled and the clicks
    // would never overlap. The disabled flag React set is dropped for the second click so
    // the atomic guard is what is measured, not the DOM.
    await act(async () => {
      fireEvent.click(confirmBtn);
      confirmBtn.removeAttribute('disabled');
      fireEvent.click(confirmBtn);
    });

    expect(
      mockVoidSale.mock.calls.length,
      'a double click on Confirm Void sent the void twice; the CAS refuses the replay and ' +
        'the operator is told the void failed over a sale that was voided',
    ).toBe(1);

    releaseVoid?.({});
  });

  it('calls voidSale when Confirm Void is clicked with a reason', async () => {
    mockListSalesScoped.mockResolvedValue({ sales: sampleSales, salesHistoryCapped: false });
    mockGetSaleScoped.mockResolvedValue(sampleDetail);
    mockVoidSale.mockResolvedValue({});
    const user = userEvent.setup();

    await renderWithFluent(<VoidOrdersScreen />, salesFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText(/ORD-001/)).toBeInTheDocument();
    });

    const viewBtns = screen.getAllByRole('button', { name: /^view/i });
    await user.click(viewBtns[0]!);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument();
    });

    const reasonSelect = screen.getByDisplayValue(/Select a reason/i);
    await user.selectOptions(reasonSelect, 'cancelled-by-customer');

    const confirmBtn = screen.getByRole('button', { name: /confirm void/i });
    await user.click(confirmBtn);

    await waitFor(() => {
      // 5e0d4caa: voidSaleScoped(token, saleId, reason) — positional.
      expect(mockVoidSale).toHaveBeenCalledWith(
        'session-1',
        'ORD-001',
        'cancelled-by-customer',
      );
    });
  });

  it('shows error when void fails', async () => {
    mockListSalesScoped.mockResolvedValue({ sales: sampleSales, salesHistoryCapped: false });
    mockGetSaleScoped.mockResolvedValue(sampleDetail);
    mockVoidSale.mockRejectedValue(new Error('Network error'));
    const user = userEvent.setup();

    await renderWithFluent(<VoidOrdersScreen />, salesFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText(/ORD-001/)).toBeInTheDocument();
    });

    const viewBtns = screen.getAllByRole('button', { name: /^view/i });
    await user.click(viewBtns[0]!);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument();
    });

    const reasonSelect = screen.getByDisplayValue(/Select a reason/i);
    await user.selectOptions(reasonSelect, 'cancelled-by-customer');

    const confirmBtn = screen.getByRole('button', { name: /confirm void/i });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByText('Failed to void order')).toBeInTheDocument();
    });
  });

  // ADR #7 says a screen holding a session token must read through the scoped command, so the
  // store is resolved from the session rather than from whatever the ambient singleton happens
  // to point at. VoidOrdersScreen wrote through voidSaleScoped but read through listSales and
  // getSale, so in a multi-workspace session the cashier could act as one store and see another.
  // These three cases pin the read side to the same rule the write side already follows.
  describe('ADR #7: reads are session-scoped when a workspace token exists', () => {
    beforeEach(() => {
      // The file has no global mock reset, and mockResolvedValue accumulates across cases, so
      // call history must be cleared here or "was not called" assertions inherit the prior test.
      mockListSales.mockClear();
      mockGetSale.mockClear();
      mockListSalesScoped.mockClear();
      mockGetSaleScoped.mockClear();
    });

    it('lists orders through list_sales_scoped, not the ambient list_sales', async () => {
      mockListSalesScoped.mockResolvedValue({ sales: sampleSales, salesHistoryCapped: false });
      await renderWithFluent(<VoidOrdersScreen />, salesFtl, sharedFtl);
      await waitFor(() => {
        expect(mockListSalesScoped).toHaveBeenCalled();
      });
      expect(mockListSalesScoped.mock.calls[0]?.[0]).toBe('session-1');
      expect(mockListSales).not.toHaveBeenCalled();
    });
    // The fallback used to be `active` -- the label of the state this screen exists to make
    // voidable. A status the UI cannot name would therefore have looked like the one row an
    // operator is hunting for. The wire carries exactly four spellings
    // (foundation/src/enums.rs:40), so the floor only fires on drift, and drift is precisely
    // when a confident-looking label is worst.
    it('labels an unrecognised status as unknown, never as active', async () => {
      const odd = [{ ...sampleSales[0], id: 'ORD-ODD', status: 'refunded' }];
      mockListSalesScoped.mockResolvedValue({ sales: odd, salesHistoryCapped: false });
      await renderWithFluent(<VoidOrdersScreen />, salesFtl, sharedFtl);
      await waitFor(() => {
        expect(document.querySelectorAll('tbody tr').length).toBe(1);
      });
      const row = document.querySelectorAll('tbody tr')[0];
      expect(row?.textContent).toContain('Unknown status');
      expect(row?.textContent).not.toContain('Active');
    });

    // Unbounded by omission: `list_sales_with_history_cap_bounded` appends LIMIT only when a
    // limit is given (sales_crud.rs:308-314), so calling the scoped command with no limit read
    // every sale in the tier window while SalesHistoryScreen read at most 500 from the same
    // store. Asserting the ARGUMENT, not just the call, is what makes the omission visible --
    // a `toHaveBeenCalledWith('session-1')` assertion passed happily on the unbounded call.
    it('passes a finite limit so the session read is bounded like the history screen', async () => {
      mockListSalesScoped.mockResolvedValue({ sales: sampleSales, salesHistoryCapped: false });
      await renderWithFluent(<VoidOrdersScreen />, salesFtl, sharedFtl);
      await waitFor(() => {
        expect(mockListSalesScoped).toHaveBeenCalled();
      });
      const firstCall = mockListSalesScoped.mock.calls[0];
      expect(firstCall).toBeDefined();
      const [, limit, offset] = firstCall as unknown as [string, number?, number?];
      expect(typeof limit).toBe('number');
      expect(limit).toBe(500);
      // A ceiling, not a page: no offset, or the screens own client-side filters would miss rows.
      expect(offset).toBeUndefined();
    });

    it('loads sale detail through get_sale_scoped when opened with an initial id', async () => {
      mockListSalesScoped.mockResolvedValue({ sales: sampleSales, salesHistoryCapped: false });
      mockGetSaleScoped.mockResolvedValue(sampleDetail);
      await renderWithFluent(<VoidOrdersScreen initialSaleId="ORD-001" />, salesFtl, sharedFtl);
      await waitFor(() => {
        expect(mockGetSaleScoped).toHaveBeenCalledWith('session-1', 'ORD-001');
      });
      expect(mockGetSale).not.toHaveBeenCalled();
    });

    it('refreshes detail through the scoped command after a void', async () => {
      const user = userEvent.setup();
      mockListSalesScoped.mockResolvedValue({ sales: sampleSales, salesHistoryCapped: false });
      // Must be an ACTIVE order: the void form only renders for one, so seeding the post-void
      // 'Voided' status here left no Cancel button to find. The status change is the void's
      // consequence, not its precondition.
      mockGetSaleScoped.mockResolvedValue(sampleDetail);
      mockVoidSale.mockResolvedValue({});

      // Same route the existing void test uses: list -> View -> reason -> Confirm Void. The
      // first attempt rendered with initialSaleId and looked for a "void order" button, which
      // is not in that view; the guard there caught that before it could pass vacuously.
      await renderWithFluent(<VoidOrdersScreen />, salesFtl, sharedFtl);
      await waitFor(() => {
        expect(screen.getByText(/ORD-001/)).toBeInTheDocument();
      });
      const viewBtns = screen.getAllByRole('button', { name: /^view/i });
      await user.click(viewBtns[0]!);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument();
      });

      mockGetSaleScoped.mockClear();
      mockGetSale.mockClear();

      await user.selectOptions(screen.getByDisplayValue(/Select a reason/i), 'cancelled-by-customer');
      await user.click(screen.getByRole('button', { name: /confirm void/i }));

      await waitFor(() => {
        expect(mockGetSaleScoped).toHaveBeenCalledWith('session-1', 'ORD-001');
      });
      expect(mockGetSale).not.toHaveBeenCalled();
    });
  });
});
