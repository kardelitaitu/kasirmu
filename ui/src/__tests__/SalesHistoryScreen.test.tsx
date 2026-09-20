import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
// renderWithProviders* (not renderWithFluentSync): the reprint button now reports a
// failed print through the toast context, so the screen needs a ToastProvider.
import { renderWithProvidersSync } from '@/__tests__/test-utils/render';
import salesFtl from '@/locales/sales.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';

vi.mock('@/api/sales', () => ({
  listSales: vi.fn(),
  getSale: vi.fn(),
  // Added so the scoped/ambient choice is assertable. The block originally listed the ambient
  // pair alongside voidSaleScoped and listRefundsScoped, which encoded the same asymmetry the
  // screen had: writes scoped, reads not.
  listSalesScoped: vi.fn(),
  getSaleScoped: vi.fn(),
  printSalesReceipt: vi.fn(),
  listRefundsScoped: vi.fn(),
  voidSaleScoped: vi.fn(),
}));

vi.mock('@/api/staff', () => ({
  listStaffScoped: vi.fn(),
}));

vi.mock('@/api/reports', () => ({
  getSaleLineMarginsScoped: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    session: { user_id: 'user-1', display_name: 'Cashier', role_name: 'cashier' },
    isManager: true,
  }),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'session-1' }),
}));

vi.mock('@/features/sales/RefundModal', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="refund-modal">
      <button onClick={onClose}>Close Refund</button>
    </div>
  ),
}));

import SalesHistoryScreen from '@/features/sales/SalesHistoryScreen';
import { listSales, getSale, listSalesScoped, getSaleScoped, listRefundsScoped } from '@/api/sales';
import { listStaffScoped } from '@/api/staff';
import { getSaleLineMarginsScoped } from '@/api/reports';

const mockListSales = listSales as ReturnType<typeof vi.fn>;
const mockGetSale = getSale as ReturnType<typeof vi.fn>;
const mockListSalesScoped = listSalesScoped as ReturnType<typeof vi.fn>;
const mockGetSaleScoped = getSaleScoped as ReturnType<typeof vi.fn>;
const mockListRefunds = listRefundsScoped as ReturnType<typeof vi.fn>;
const mockListStaff = listStaffScoped as ReturnType<typeof vi.fn>;
const mockGetSaleLineMargins = getSaleLineMarginsScoped as ReturnType<typeof vi.fn>;



const sampleSales = [
  {
    id: 'sale-001-aaaa-bbbb-cccc-ddddeeee', status: 'Completed',
    createdAt: '2026-07-07T10:00:00.000Z', total: { minor_units: 50000, currency: 'IDR' },
    lineCount: 2, paymentMethod: 'cash', userId: 'user-1',
  },
  {
    id: 'sale-002-aaaa-bbbb-cccc-ddddefff', status: 'Pending',
    createdAt: '2026-07-07T11:00:00.000Z', total: { minor_units: 25000, currency: 'IDR' },
    lineCount: 1, paymentMethod: 'card', userId: 'user-2',
  },
  {
    id: 'sale-003-aaaa-bbbb-cccc-ddddaaaa', status: 'Voided',
    createdAt: '2026-07-06T09:00:00.000Z', total: { minor_units: 10000, currency: 'IDR' },
    lineCount: 1, paymentMethod: null, userId: 'user-1',
  },
];

const sampleStaff = [
  { id: 'user-1', display_name: 'Alice' },
  { id: 'user-2', display_name: 'Bob' },
];

const sampleDetail = {
  id: 'sale-001-aaaa-bbbb-cccc-ddddeeee', status: 'Completed',
  createdAt: '2026-07-07T10:00:00.000Z', total: { minor_units: 50000, currency: 'IDR' },
  subtotal: { minor_units: 50000, currency: 'IDR' },
  taxTotal: { minor_units: 0, currency: 'IDR' },
  paymentMethod: 'cash', userId: 'user-1',
  tenderedMinor: 100000,
  lines: [
    { id: 'line-1', sku: 'SKU-001', name: 'Widget', qty: 2,
      unit_price: { minor_units: 25000, currency: 'IDR' },
      total_minor: 50000, tax_amount: null },
  ],
};

describe('SalesHistoryScreen', () => {
  beforeEach(() => {
    mockListStaff.mockResolvedValue(sampleStaff);
    mockGetSaleLineMargins.mockResolvedValue([]);
  });

  // ── Rendering ─────────────────────────────────────────────────

  it('renders the title', async () => {
    mockListSalesScoped.mockResolvedValue({ sales: [], salesHistoryCapped: false });
    renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('Sales History')).toBeInTheDocument();
    });
  });

  it('shows loading skeleton', async () => {
    mockListSalesScoped.mockReturnValue(new Promise(() => {}));
    const { container } = renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);
    const skeleton = container.querySelector('.sales-history-loading-skeleton');
    expect(skeleton).toBeInTheDocument();
    expect(skeleton?.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows empty state when no sales exist', async () => {
    mockListSalesScoped.mockResolvedValue({ sales: [], salesHistoryCapped: false });
    renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('No sales recorded yet')).toBeInTheDocument();
    });
  });

  // ── C1.2 history-cap teaser ──────────────────────────────────

  it('shows the 3-month history cap teaser with an upgrade CTA (C1.2)', async () => {
    mockListSalesScoped.mockResolvedValue({ sales: sampleSales, salesHistoryCapped: true });
    renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText(/more than 3 months of sales history/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /upgrade/i })).toBeInTheDocument();
  });

  it('hides the history cap teaser when the tier is unlimited (C1.2)', async () => {
    mockListSalesScoped.mockResolvedValue({ sales: sampleSales, salesHistoryCapped: false });
    renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getAllByText('Alice').length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByText(/more than 3 months of sales history/i)).not.toBeInTheDocument();
  });

  // ── Table rendering ──────────────────────────────────────────

  it('displays sales in the table with cashier names', async () => {
    mockListSalesScoped.mockResolvedValue({ sales: sampleSales, salesHistoryCapped: false });
    renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);
    await waitFor(() => {
      // Cashier names appear in table cells AND the cashier filter dropdown.
      expect(screen.getAllByText('Alice').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Bob').length).toBeGreaterThanOrEqual(1);
    });
    // Status text appears in both filter chips and badges — use getAllByText.
    expect(screen.getAllByText('Completed').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Voided').length).toBeGreaterThanOrEqual(1);
  });

  it('shows status filter chips', async () => {
    mockListSalesScoped.mockResolvedValue({ sales: [], salesHistoryCapped: false });
    renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('All')).toBeInTheDocument();
    });
    // "Completed", "Pending", "Voided" appear only in filter chips (no table).
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Voided')).toBeInTheDocument();
  });

  it('filters sales by status when a filter chip is clicked', async () => {
    const user = userEvent.setup();
    mockListSalesScoped.mockResolvedValue({ sales: sampleSales, salesHistoryCapped: false });
    renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);

    await waitFor(() => {
      // First sale's truncated ID should appear in the table.
      expect(screen.getByText(/sale-001/)).toBeInTheDocument();
      expect(screen.getByText(/sale-002/)).toBeInTheDocument();
    });

    // Click the "Voided" filter chip.
    const voidedChip = screen.getByRole('radio', { name: /voided/i });
    await user.click(voidedChip);

    // After filtering, only the Voided sale (sale-003) remains.
    // The Completed (sale-001) and Pending (sale-002) sale IDs should be gone.
    await waitFor(() => {
      expect(screen.queryByText(/sale-001/)).not.toBeInTheDocument();
      expect(screen.queryByText(/sale-002/)).not.toBeInTheDocument();
    });
  });

  it('shows search input and cashier dropdown', async () => {
    mockListSalesScoped.mockResolvedValue({ sales: [], salesHistoryCapped: false });
    renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });
    const searchInputs = screen.getAllByRole('textbox');
    expect(searchInputs.length).toBeGreaterThanOrEqual(1);
  });

  it('shows export CSV button', async () => {
    mockListSalesScoped.mockResolvedValue({ sales: [], salesHistoryCapped: false });
    renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('Export CSV')).toBeInTheDocument();
    });
  });

  it('exports per-line cost and margin columns to CSV', async () => {
    const user = userEvent.setup();
    mockListSalesScoped.mockResolvedValue({ sales: [sampleSales[0]!], salesHistoryCapped: false });
    mockGetSaleLineMargins.mockResolvedValue([
      {
        sale_line_id: 'line-1', sku: 'SKU-001', name: 'Widget', qty: 2,
        unit_price_minor: 25000, line_total_minor: 50000,
        unit_cost_minor: 15000, margin_minor: 20000, margin_percent: 40,
      },
    ]);
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);
    await waitFor(() => expect(screen.getByText('Export CSV')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    const blob = createUrl.mock.calls[0]![0] as Blob;
    // jsdom's Blob lacks .text() — read via FileReader.
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    // New per-line headers (header line is unquoted, data cells are quoted)
    expect(text).toContain('Cashier,SKU,Product,Qty,Unit Price,Unit Cost,Line Margin,Margin %');
    // Per-line row: sale context + cost/margin (HPP 15000 IDR, margin 40%)
    expect(text).toContain('"SKU-001"');
    expect(text).toContain('"Widget"');
    expect(text).toContain('"Rp 25.000"');
    expect(text).toContain('"Rp 15.000"');
    expect(text).toContain('"Rp 20.000"');
    expect(text).toContain('"40.0%"');
    createUrl.mockRestore();
    revokeUrl.mockRestore();
    clickSpy.mockRestore();
  });

  // ── Detail modal ─────────────────────────────────────────────

  it('opens detail modal when View is clicked', async () => {
    const user = userEvent.setup();
    mockListSalesScoped.mockResolvedValue({ sales: sampleSales, salesHistoryCapped: false });
    mockGetSaleScoped.mockResolvedValue(sampleDetail);
    mockListRefunds.mockResolvedValue([]);
    renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);

    await waitFor(() => {
      const viewBtns = screen.getAllByText('View');
      expect(viewBtns.length).toBeGreaterThan(0);
    });

    await user.click(screen.getAllByText('View')[0]!);

    await waitFor(() => {
      expect(screen.getByText('Sale Detail')).toBeInTheDocument();
      expect(screen.getByText('Line Items')).toBeInTheDocument();
    });
  });

  it('shows line items in detail modal', async () => {
    const user = userEvent.setup();
    mockListSalesScoped.mockResolvedValue({ sales: [sampleSales[0]!], salesHistoryCapped: false });
    mockGetSaleScoped.mockResolvedValue(sampleDetail);
    mockListRefunds.mockResolvedValue([]);
    mockGetSaleLineMargins.mockResolvedValue([]);
    renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getAllByText('View').length).toBeGreaterThan(0);
    });

    await user.click(screen.getAllByText('View')[0]!);

    await waitFor(() => {
      expect(screen.getByText('SKU-001')).toBeInTheDocument();
      expect(screen.getByText('Widget')).toBeInTheDocument();
    });
  });

  it('shows cost and margin columns when the margin report loads', async () => {
    const user = userEvent.setup();
    mockListSalesScoped.mockResolvedValue({ sales: [sampleSales[0]!], salesHistoryCapped: false });
    mockGetSaleScoped.mockResolvedValue(sampleDetail);
    mockListRefunds.mockResolvedValue([]);
    mockGetSaleLineMargins.mockResolvedValue([
      {
        sale_line_id: 'line-1', sku: 'SKU-001', name: 'Widget', qty: 2,
        unit_price_minor: 25000, line_total_minor: 50000,
        unit_cost_minor: 15000, margin_minor: 20000, margin_percent: 40,
      },
    ]);
    renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getAllByText('View').length).toBeGreaterThan(0);
    });
    await user.click(screen.getAllByText('View')[0]!);

    await waitFor(() => {
      expect(screen.getByText('Cost')).toBeInTheDocument();
      expect(screen.getByText('Margin')).toBeInTheDocument();
      expect(screen.getByText('40.0%')).toBeInTheDocument();
    });
    // HPP of 15000 IDR renders as Rp 15.000 (id-ID locale).
    expect(screen.getByText('Rp 15.000')).toBeInTheDocument();
  });

  // ── F2-7: the estimated-stamp badge ─────────────────────────────────
  it('shows the estimated badge on a sale stamped as tax-estimated', async () => {
    const user = userEvent.setup();
    mockListSalesScoped.mockResolvedValue({ sales: [sampleSales[0]!], salesHistoryCapped: false });
    // The core-authored stamp shape (F2-5): client claim + core-verified delta.
    mockGetSaleScoped.mockResolvedValue({
      ...sampleDetail,
      taxTotal: { minor_units: 1200, currency: 'IDR' },
      taxEstimateNote: '{"estimated":true,"claim":1200,"verified":1180,"delta":-20}',
    });
    mockListRefunds.mockResolvedValue([]);
    mockGetSaleLineMargins.mockResolvedValue([]);
    renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getAllByText('View').length).toBeGreaterThan(0);
    });
    await user.click(screen.getAllByText('View')[0]!);

    await waitFor(() => {
      expect(screen.getByText('Estimated')).toBeInTheDocument();
    });
  });

  it('shows no estimated badge when the sale is unstamped or live-computed', async () => {
    const user = userEvent.setup();
    mockListSalesScoped.mockResolvedValue({ sales: [sampleSales[0]!], salesHistoryCapped: false });
    // Plain detail (no taxEstimateNote at all — the pre-F2-6 wire shape).
    mockGetSaleScoped.mockResolvedValue({
      ...sampleDetail,
      // Positive tax so the tax row (and thus the badge slot) renders — the
      // badge's absence is then the stamp logic's doing, not the row's.
      taxTotal: { minor_units: 1200, currency: 'IDR' },
    });
    mockListRefunds.mockResolvedValue([]);
    mockGetSaleLineMargins.mockResolvedValue([]);
    renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getAllByText('View').length).toBeGreaterThan(0);
    });
    await user.click(screen.getAllByText('View')[0]!);

    await waitFor(() => {
      // Detail is open (the total renders as the formatMoney id-ID shape;
      // the list row carries the same figure, so assert on ANY instance).
      expect(screen.getAllByText('Rp 50.000').length).toBeGreaterThan(0);
    });
    expect(screen.queryByText('Estimated')).not.toBeInTheDocument();
  });

  it('shows a negative margin in red for loss-leader lines', async () => {
    const user = userEvent.setup();
    mockListSalesScoped.mockResolvedValue({ sales: [sampleSales[0]!], salesHistoryCapped: false });
    mockGetSaleScoped.mockResolvedValue(sampleDetail);
    mockListRefunds.mockResolvedValue([]);
    mockGetSaleLineMargins.mockResolvedValue([
      {
        sale_line_id: 'line-1', sku: 'SKU-001', name: 'Widget', qty: 2,
        unit_price_minor: 25000, line_total_minor: 50000,
        unit_cost_minor: 30000, margin_minor: -10000, margin_percent: -20,
      },
    ]);
    renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getAllByText('View').length).toBeGreaterThan(0);
    });
    await user.click(screen.getAllByText('View')[0]!);

    await waitFor(() => {
      expect(screen.getByText('-20.0%')).toBeInTheDocument();
    });
    const negMargin = screen.getByText('-20.0%');
    expect(negMargin.className).toContain('sales-history-cell-negative');
  });

  it('shows Reprint Receipt and Refund buttons in detail', async () => {
    const user = userEvent.setup();
    mockListSalesScoped.mockResolvedValue({ sales: [sampleSales[0]!], salesHistoryCapped: false });
    mockGetSaleScoped.mockResolvedValue(sampleDetail);
    mockListRefunds.mockResolvedValue([]);
    renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getAllByText('View').length).toBeGreaterThan(0);
    });

    await user.click(screen.getAllByText('View')[0]!);

    await waitFor(() => {
      expect(screen.getByText('Reprint Receipt')).toBeInTheDocument();
      expect(screen.getByText('Refund')).toBeInTheDocument();
    });
  });

  // ── Refund modal ─────────────────────────────────────────────

  it('opens refund modal when Refund is clicked in detail', async () => {
    const user = userEvent.setup();
    mockListSalesScoped.mockResolvedValue({ sales: [sampleSales[0]!], salesHistoryCapped: false });
    mockGetSaleScoped.mockResolvedValue(sampleDetail);
    mockListRefunds.mockResolvedValue([]);
    renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getAllByText('View').length).toBeGreaterThan(0);
    });
    await user.click(screen.getAllByText('View')[0]!);

    await waitFor(() => {
      expect(screen.getByText('Refund')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Refund'));

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /refund-modal/i })).toBeInTheDocument();
    });
  });

  // ── The already-refunded badge ─────────────────────────────────
  // The badge is a STATUS label beside the grand total; refund-title is the modal's
  // title ("Process Refund"), so wiring the badge to that key told the operator to
  // perform the very action the badge exists to warn about. Pinned on the RESOLVED
  // string, because the defect was the key -> string mapping, not a missing key.
  it('labels the already-refunded badge as a refund status, not as the refund action', async () => {
    const user = userEvent.setup();
    mockListSalesScoped.mockResolvedValue({ sales: [sampleSales[0]!], salesHistoryCapped: false });
    mockGetSaleScoped.mockResolvedValue(sampleDetail);
    mockListRefunds.mockResolvedValue([{
      id: 'refund-1', saleId: sampleDetail.id,
      total: { minor_units: 12000, currency: 'IDR' },
      reason: 'Damaged', note: '', processedBy: 'user-1',
      createdAt: '2026-07-07T12:00:00.000Z', lines: [],
    }]);
    renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getAllByText('View').length).toBeGreaterThan(0);
    });
    await user.click(screen.getAllByText('View')[0]!);
    await waitFor(() => {
      expect(screen.getByText('Previous Refunds')).toBeInTheDocument();
    });

    // Primary: the badge must not resolve to the modal's title.
    expect(screen.queryByText('Process Refund')).toBeNull();
    // And it must positively say the status it is warning about.
    expect(screen.getByText('Refunded')).toBeInTheDocument();
  });

  // ADR #7: a screen holding a session token must read through the scoped command so the store is
  // resolved from the session. This screen already applies the pattern to listStaffScoped two lines
  // from where it forgets it on listSales (see load(), SalesHistoryScreen.tsx:211-216), and reads
  // sale detail through the ambient getSale. The asymmetry inside a single Promise.all is what makes
  // the omission a slip rather than a policy.
  describe('ADR #7: reads are session-scoped when a workspace token exists', () => {
    beforeEach(() => {
      mockListSales.mockClear();
      mockGetSale.mockClear();
      mockListSalesScoped.mockClear();
      mockGetSaleScoped.mockClear();
    });

    it('loads the list through list_sales_scoped, not the ambient list_sales', async () => {
      mockListSalesScoped.mockResolvedValue({ sales: sampleSales, salesHistoryCapped: false });
      mockListStaff.mockResolvedValue([]);
      renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);
      await waitFor(() => {
        expect(mockListSalesScoped).toHaveBeenCalledWith('session-1');
      });
      expect(mockListSales).not.toHaveBeenCalled();
    });

    it('opens sale detail through get_sale_scoped', async () => {
      const user = userEvent.setup();
      mockListSalesScoped.mockResolvedValue({ sales: sampleSales, salesHistoryCapped: false });
      mockListStaff.mockResolvedValue([]);
      mockGetSaleScoped.mockResolvedValue(sampleDetail);
      mockListRefunds.mockResolvedValue([]);
      renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);
      await waitFor(() => {
        expect(screen.getAllByText('View').length).toBeGreaterThan(0);
      });
      await user.click(screen.getAllByText('View')[0]!);
      await waitFor(() => {
        // The token is asserted exactly -- that is what the case is about. The id is matched
        // loosely because the screen sorts by date, so the first rendered row is not
        // sampleSales[0]; pinning the id would test the sort order, not the scoping.
        expect(mockGetSaleScoped).toHaveBeenCalledWith(
          'session-1',
          expect.stringMatching(/^sale-00\d-/),
        );
      });
      expect(mockGetSale).not.toHaveBeenCalled();
    });
  });
});
