import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, act, fireEvent } from '@testing-library/react';
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
  stampFakturPajakScoped: vi.fn(),
  createFakturPenggantiScoped: vi.fn(),
  // Both were ABSENT, so `handleIssueTaxInvoice` threw on its first call and no case
  // exercised it. The statutory-invoice surface of this screen was untested until
  // round 149, longer than any other write on it.
  issueTaxInvoiceScoped: vi.fn(),
  getSaleStatutoryNumberScoped: vi.fn(),
}));

vi.mock('@/api/staff', () => ({
  listStaffScoped: vi.fn(),
}));

vi.mock('@/api/reports', () => ({
  getSaleLineMarginsScoped: vi.fn(),
}));

// Mirrors AuthContext.hasPermission: the grant list decides when present
// (`*` and `domain:*` wildcards included), else the caller's role fallback.
// `mockPermissions.current` is a mutable list so a case can switch from the
// manager role to the STAFF preset without re-mocking the module.
const mockPermissions = vi.hoisted(() => ({ current: undefined as string[] | undefined }));
// Mutable so a case can model the STAFF preset, where the ROLE says cashier and the
// GRANTS say sales:process. Both halves matter: reverting a gate to `isManager` must
// fail these cases, which it cannot if the mock always reports a manager.
const mockIsManager = vi.hoisted(() => ({ current: true }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    session: { user_id: 'user-1', display_name: 'Cashier', role_name: mockIsManager.current ? 'manager' : 'cashier' },
    isManager: mockIsManager.current,
    hasPermission: (perm: string, fallback: boolean) => {
      const granted = mockPermissions.current;
      if (granted === undefined) return fallback;
      const domain = perm.includes(':') ? perm.split(':')[0]! : perm;
      return granted.some((k) => k === perm || k === '*' || k === `${domain}:*`);
    },
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
import {
  listSales,
  getSale,
  listSalesScoped,
  getSaleScoped,
  listRefundsScoped,
  stampFakturPajakScoped,
  createFakturPenggantiScoped,
  issueTaxInvoiceScoped,
  getSaleStatutoryNumberScoped,
  voidSaleScoped,
} from '@/api/sales';
import { listStaffScoped } from '@/api/staff';
import { getSaleLineMarginsScoped } from '@/api/reports';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const mockListSales = listSales as ReturnType<typeof vi.fn>;
const mockGetSale = getSale as ReturnType<typeof vi.fn>;
const mockListSalesScoped = listSalesScoped as ReturnType<typeof vi.fn>;
const mockGetSaleScoped = getSaleScoped as ReturnType<typeof vi.fn>;
const mockListRefunds = listRefundsScoped as ReturnType<typeof vi.fn>;
const mockStampFakturPajakScoped = stampFakturPajakScoped as ReturnType<typeof vi.fn>;
const mockVoidSale = voidSaleScoped as ReturnType<typeof vi.fn>;
const mockCreateFakturPenggantiScoped = createFakturPenggantiScoped as ReturnType<typeof vi.fn>;
const mockIssueTaxInvoiceScoped = issueTaxInvoiceScoped as ReturnType<typeof vi.fn>;
const mockGetSaleStatutoryNumberScoped = getSaleStatutoryNumberScoped as ReturnType<typeof vi.fn>;
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

  it('opens detail modal when row is tapped directly (touch-first ergonomics)', async () => {
    const user = userEvent.setup();
    mockListSalesScoped.mockResolvedValue({ sales: sampleSales, salesHistoryCapped: false });
    mockGetSaleScoped.mockResolvedValue(sampleDetail);
    mockListRefunds.mockResolvedValue([]);
    const { container } = renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);

    await waitFor(() => {
      const rows = container.querySelectorAll('.sales-history-row-wrap');
      expect(rows.length).toBeGreaterThan(0);
    });

    const firstRow = container.querySelector('.sales-history-row-wrap')!;
    await user.click(firstRow);

    await waitFor(() => {
      expect(screen.getByText('Sale Detail')).toBeInTheDocument();
      expect(screen.getByText('Line Items')).toBeInTheDocument();
    });
  });

  // ── The KEYBOARD path, which none of the cases above covered ──────────
  //
  // Every detail-modal case here opens the panel by CLICK. Escape is the path an
  // operator uses at a till, and it is a DIFFERENT code path: the panel is closed by
  // `useFocusTrap`'s document listener (`useExitAnimation` -> `requestClose`), not by
  // the click handler. Measured 2026-10-18: this screen's three focus-trapped
  // overlays had ZERO Escape coverage, so nothing pinned that Escape dismisses the
  // overlay rather than the screen behind it.
  //
  // The bug that shape produced one layer up is real and recent: `PosScreen`'s Escape
  // cascade is registered on `document` before the panel's trap, so it used to close
  // the WHOLE screen along with the panel (see `restaurant-tables-toolbar.spec.ts`).
  // `PosScreen` now stands down whenever `isAnyAriaModalOpen()`, and this case is what
  // pins the resulting behaviour for Sales History.
  it('closes the detail modal on Escape without leaving the screen', async () => {
    const user = userEvent.setup();
    mockListSalesScoped.mockResolvedValue({ sales: sampleSales, salesHistoryCapped: false });
    mockGetSaleScoped.mockResolvedValue(sampleDetail);
    mockListRefunds.mockResolvedValue([]);
    renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getAllByText('View').length).toBeGreaterThan(0);
    });
    await user.click(screen.getAllByText('View')[0]!);
    await waitFor(() => {
      expect(screen.getByText('Sale Detail')).toBeInTheDocument();
    });

    fireEvent.keyDown(document.body, { key: 'Escape' });

    // The PANEL goes.
    await waitFor(() => {
      expect(screen.queryByText('Sale Detail')).toBeNull();
    });
    // And the SCREEN STAYS — still showing the rows it was showing before.
    expect(
      screen.getAllByText('View').length,
      'Escape must dismiss the overlay, not navigate away from the screen',
    ).toBeGreaterThan(0);
  });
  it('voids once for a double click on Confirm while the first is in flight', async () => {
    // `void_sale` compare-and-sets on `status = 'active'` (sales_lifecycle.rs:903-914), so the
    // replay is REFUSED and the catch reports `sales-history-void-error`: "failed to void" over
    // a sale that was voided. The overlay closes on success, so the cashier sees the row gone
    // AND an error telling them it did not work.
    const user = userEvent.setup();
    mockListSalesScoped.mockResolvedValue({ sales: sampleSales, salesHistoryCapped: false });
    mockGetSaleScoped.mockResolvedValue(sampleDetail);
    mockListRefunds.mockResolvedValue([]);
    let releaseVoid: ((v: unknown) => void) | undefined;
    mockVoidSale.mockImplementation(
      () => new Promise((resolve) => { releaseVoid = resolve; }),
    );
    const { container } = renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);

    await waitFor(() => {
      expect(container.querySelectorAll('.sales-history-row-wrap').length).toBeGreaterThan(0);
    });

    const row = container.querySelector('.sales-history-row-wrap') as HTMLElement;
    fireEvent.touchStart(row, { touches: [{ clientX: 200, clientY: 10 }] });
    fireEvent.touchEnd(row, { changedTouches: [{ clientX: 40, clientY: 10 }] });
    await user.click(await screen.findByText('Void'));

    const confirmBtn = await screen.findByRole('button', { name: /confirm/i });
    // fireEvent inside one act(): userEvent awaits its own act(), which flushes the pending
    // chain so the first void would have settled and the clicks would never overlap. The
    // disabled flag React set is dropped for the second click so the ref is measured.
    await act(async () => {
      fireEvent.click(confirmBtn);
      confirmBtn.removeAttribute('disabled');
      fireEvent.click(confirmBtn);
    });

    expect(
      mockVoidSale.mock.calls.length,
      'a double click on Confirm sent the void twice; the CAS refuses the replay and the ' +
        'operator is told the void failed over a sale that was voided',
    ).toBe(1);

    releaseVoid?.({});
  });

  // ── The VOID overlay is a SEPARATE overlay from the detail panel ──────
  //
  // It is reached by SWIPING a row left (`SwipeableOrderRow` -> `useSwipe` ->
  // `onSwipeLeft` sets `revealed`), not by tapping, so none of the detail-modal cases
  // exercise it. Its own trap (`voidPanelRef`) is a second instance of the same
  // pattern, and round 191 pinned only the DETAIL one — do not assume that case covers
  // this. Measured 2026-10-18: the E2E probe could not find the Void affordance at all
  // because it lives behind a swipe, which is why this is a unit case.
  it('closes the VOID overlay on Escape without leaving the screen', async () => {
    const user = userEvent.setup();
    mockListSalesScoped.mockResolvedValue({ sales: sampleSales, salesHistoryCapped: false });
    mockGetSaleScoped.mockResolvedValue(sampleDetail);
    mockListRefunds.mockResolvedValue([]);
    const { container } = renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);

    await waitFor(() => {
      expect(container.querySelectorAll('.sales-history-row-wrap').length).toBeGreaterThan(0);
    });

    // Swipe the first row LEFT to reveal its actions. `useSwipe` reads clientX from
    // the touch payload, so start/finish must be supplied explicitly.
    const row = container.querySelector('.sales-history-row-wrap') as HTMLElement;
    fireEvent.touchStart(row, { touches: [{ clientX: 200, clientY: 10 }] });
    fireEvent.touchEnd(row, { changedTouches: [{ clientX: 40, clientY: 10 }] });

    const voidBtn = await screen.findByText('Void');
    await user.click(voidBtn);

    // The overlay is up: it is an ARIA modal, which is the predicate PosScreen uses.
    await waitFor(() => {
      expect(container.querySelectorAll('[aria-modal="true"]').length).toBeGreaterThan(0);
    });

    fireEvent.keyDown(document.body, { key: 'Escape' });

    // The OVERLAY goes…
    await waitFor(() => {
      expect(container.querySelectorAll('[aria-modal="true"]').length).toBe(0);
    });
    // …and the SCREEN STAYS: the rows are still there.
    expect(
      container.querySelectorAll('.sales-history-row-wrap').length,
      'Escape must dismiss the void overlay, not navigate away from the screen',
    ).toBeGreaterThan(0);
  });
  it('renders line items with course and modifier choices in detail modal', async () => {
    const user = userEvent.setup();
    const detailWithModifiers = {
      ...sampleDetail,
      lines: [
        {
          id: 'line-m1',
          sku: 'STEAK-01',
          name: 'Sirloin Steak',
          qty: 1,
          unit_price: { minor_units: 120000, currency: 'IDR' },
          total_minor: 120000,
          tax_amount: null,
          course: 'main',
          modifiers_json: JSON.stringify([
            { name: 'Doneness', choice: 'Medium Rare' },
            { name: 'Sauce', choice: 'Mushroom' },
          ]),
        },
      ],
    };
    mockListSalesScoped.mockResolvedValue({ sales: [sampleSales[0]!], salesHistoryCapped: false });
    mockGetSaleScoped.mockResolvedValue(detailWithModifiers);
    mockListRefunds.mockResolvedValue([]);
    mockGetSaleLineMargins.mockResolvedValue([]);
    renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);

    await waitFor(() => expect(screen.getAllByText('View').length).toBeGreaterThan(0));
    await user.click(screen.getAllByText('View')[0]!);

    await waitFor(() => {
      expect(screen.getByText('Sirloin Steak')).toBeInTheDocument();
      expect(screen.getByText('main')).toBeInTheDocument();
      expect(screen.getByText('Medium Rare')).toBeInTheDocument();
      expect(screen.getByText('Mushroom')).toBeInTheDocument();
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
    // ── Statutory invoice (e-Faktur) ─────────────────────────────
  //
  // The same defect round 148 fixed in PaymentModal (the receipt surface). This screen's
  // `handleIssueTaxInvoice` sets `issuingInvoice` and awaits with no ref guard, so the
  // second tap of a real double tap still reaches the handler.
  //
  // The backend does not fully absorb it: `issue_tax_invoice_for_sale` is idempotent ONCE A
  // NUMBER IS WRITTEN -- it reads `sales.statutory_number` and returns the existing value when
  // it already carries the series prefix (crates/kasirmu-core/src/db/fiscal.rs:572-587). But
  // that column is set by the SAME transaction, so two issues in one tick both read NULL and
  // both fall through to `claim_statutory_number_for_sale`, an atomic
  // `UPDATE document_number_sequences ... RETURNING` (fiscal.rs:438-455). The statutory
  // sequence advances TWICE: a gap or duplicate in a legally numbered series.
  it('issues a tax invoice once for a double tap on the detail panel', async () => {
    const user = userEvent.setup();
    mockListSalesScoped.mockResolvedValue({ sales: sampleSales, salesHistoryCapped: false });
    mockListStaff.mockResolvedValue([]);
    mockGetSaleScoped.mockResolvedValue(sampleDetail);
    mockListRefunds.mockResolvedValue([]);
    mockGetSaleStatutoryNumberScoped.mockResolvedValue(null);
    let releaseIssue: ((v: string) => void) | undefined;
    const held = new Promise<string>((resolve) => { releaseIssue = resolve; });
    mockIssueTaxInvoiceScoped.mockImplementation(() => held as never);

    renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getAllByText('View').length).toBeGreaterThan(0);
    });
    await user.click(screen.getAllByText('View')[0]!);

    const issueBtn = await screen.findByRole('button', { name: /issue tax invoice/i });
    // Both taps in ONE batch: a real double tap dispatches twice before React can
    // commit `issuingInvoice` and disable the button (round 148's shape).
    await act(async () => {
      fireEvent.click(issueBtn);
      issueBtn.removeAttribute('disabled');
      fireEvent.click(issueBtn);
    });

    expect(
      mockIssueTaxInvoiceScoped.mock.calls.length,
      'a second tap re-issued the invoice; both calls pass the idempotency read before ' +
        'either commits, so the statutory sequence advances twice for one sale',
    ).toBe(1);

    releaseIssue?.('010000000000001');
    await act(async () => { await held; });
  });
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
        expect(mockListSalesScoped).toHaveBeenCalledWith('session-1', 500);
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

  describe('Phase 6: e-Faktur integration (DJP Coretax / PER-11/PJ/2025)', () => {
    it('renders e-Faktur badge on sales list item with fakturPajak', async () => {
      const salesWithFp = [
        {
          ...sampleSales[0],
          fakturPajak: '01002600000000123',
        },
      ];
      mockListSalesScoped.mockResolvedValue({ sales: salesWithFp, salesHistoryCapped: false });
      mockListStaff.mockResolvedValue([]);
      renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);
      await waitFor(() => {
        expect(screen.getByText('e-Faktur')).toBeInTheDocument();
      });
    });

    it('displays e-Faktur compliance info and creates faktur pengganti', async () => {
      const user = userEvent.setup();
      const fpDetail = {
        ...sampleDetail,
        fakturPajak: {
          nsfp: '2600000000123',
          kodeTransaksi: '01',
          status: '00',
          formatted: '01002600000000123',
        },
      };
      mockListSalesScoped.mockResolvedValue({ sales: sampleSales, salesHistoryCapped: false });
      mockListStaff.mockResolvedValue([]);
      mockGetSaleScoped.mockResolvedValue(fpDetail);
      mockListRefunds.mockResolvedValue([]);
      mockCreateFakturPenggantiScoped.mockResolvedValue({
        nsfp: '2600000000123',
        kodeTransaksi: '01',
        status: '01',
        formatted: '01012600000000123',
      });

      renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);
      await waitFor(() => {
        expect(screen.getAllByText('View').length).toBeGreaterThan(0);
      });
      await user.click(screen.getAllByText('View')[0]!);

      await waitFor(() => {
        expect(screen.getByText('01002600000000123')).toBeInTheDocument();
        expect(screen.getByText('Normal')).toBeInTheDocument();
        expect(screen.getByText('Create Faktur Pengganti')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Create Faktur Pengganti'));
      await waitFor(() => {
        expect(mockCreateFakturPenggantiScoped).toHaveBeenCalledWith('session-1', sampleDetail.id);
      });
    });
    // A double tap on Create Faktur Pengganti must not burn TWO revisions.
    //
    // This is NOT a duplicate-row defect and it is not refused by the backend. A pengganti
    // is a deliberate INCREMENT: `create_faktur_pengganti` reads the stored status, refuses
    // at `MAX_PENGGANTI_STATUS`, and writes `current_status + 1`
    // (crates/kasirmu-core/src/db/faktur_pajak.rs:278-300). Its own test drives two calls in a
    // row on purpose and asserts 00 -> 01 -> 02 (faktur_pajak_tests.rs:195-205), so the
    // backend cannot tell an intentional second revision from an accidental one.
    //
    // The consequence is different from every other case in this class: the NSFP is preserved
    // and no row is duplicated, but the STATUS CODE is a finite sequential slot in a legally
    // numbered series, and it only ever moves FORWARD. One extra tap permanently advances a
    // sale's revision to 02 with no revision 01 ever intended -- and there is no way back,
    // because there is no decrement path.
    //
    // The handler sets `penggantiLoading` and awaits with no ref guard, so a real double tap
    // (two dispatches in one task) reaches the write twice (round 148's shape).
    it('creates one faktur pengganti for a double tap while the first is in flight', async () => {
      const fpDetail = {
        ...sampleDetail,
        fakturPajak: {
          nsfp: '2600000000123', kodeTransaksi: '01', status: '00',
          formatted: '01002600000000123',
        },
      };
      mockListSalesScoped.mockResolvedValue({ sales: sampleSales, salesHistoryCapped: false });
      mockListStaff.mockResolvedValue([]);
      mockGetSaleScoped.mockResolvedValue(fpDetail);
      mockListRefunds.mockResolvedValue([]);
      let releasePengganti: ((v: unknown) => void) | undefined;
      const held = new Promise((resolve) => { releasePengganti = resolve; });
      mockCreateFakturPenggantiScoped.mockImplementation(() => held as never);

      const user = userEvent.setup();
      renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);
      await waitFor(() => {
        expect(screen.getAllByText('View').length).toBeGreaterThan(0);
      });
      await user.click(screen.getAllByText('View')[0]!);

      const penggantiBtn = await screen.findByText('Create Faktur Pengganti');
      await act(async () => {
        fireEvent.click(penggantiBtn);
        penggantiBtn.removeAttribute('disabled');
        fireEvent.click(penggantiBtn);
      });

      expect(
        mockCreateFakturPenggantiScoped.mock.calls.length,
        'a second tap advanced the sale revision again; the status code only ever ' +
          'increments, so one extra tap permanently moves this sale to status 02 with no ' +
          'revision 01 ever intended, and no path back',
      ).toBe(1);

      releasePengganti?.({
        nsfp: '2600000000123', kodeTransaksi: '01', status: '01',
        formatted: '01012600000000123',
      });
      await act(async () => { await held; });
    });
    it('lets STAFF create a pengganti but not void — the two actions need different permissions', async () => {
      // The two role-gated actions on this screen are NOT the same gate:
      //
      //   void      -> `sales:void`     (kasirmu-bridge/src/void.rs, `void_sale_scoped`)
      //   pengganti -> `sales:process`  (kasirmu-bridge/src/history.rs, `create_faktur_pengganti_scoped`)
      //
      // The STAFF preset holds `sales:process` and NOT `sales:void`, and its own
      // description says so: "Checkout-operations role — processes sales… No management
      // access" (the STAFF preset in rbac_presets.rs). Both were gated on `isManager`, so Staff were
      // shown a working pengganti action HIDDEN from them — a capability removed from the
      // people the backend authorises, which is the mirror image of the usual
      // enabled-button-that-errors bug.
      // The ROLE is a cashier and the GRANTS are the Staff preset. Both matter: with
      // `isManager` true the case would pass against the OLD role gate too, and would
      // therefore prove nothing about the permission.
      mockIsManager.current = false;
      mockPermissions.current = ['sales:process', 'sales:view', 'payments:settle'];
      const user = userEvent.setup();
      const fpDetail = {
        ...sampleDetail,
        fakturPajak: { nsfp: '2600000000123', kodeTransaksi: '01', status: '00', formatted: '01002600000000123' },
      };
      mockListSalesScoped.mockResolvedValue({ sales: sampleSales, salesHistoryCapped: false });
      mockListStaff.mockResolvedValue([]);
      mockGetSaleScoped.mockResolvedValue(fpDetail);
      mockListRefunds.mockResolvedValue([]);

      renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);
      await waitFor(() => {
        expect(screen.getAllByText('View').length).toBeGreaterThan(0);
      });
      await user.click(screen.getAllByText('View')[0]!);

      // The pengganti action IS offered: Staff hold `sales:process`.
      await waitFor(() => {
        expect(screen.getByText('Create Faktur Pengganti')).toBeInTheDocument();
      });

      // The void affordance is NOT: it needs `sales:void`, which Staff lack. The row
      // reveals it on swipe, and `canVoid` gates the reveal itself.
      expect(screen.queryByText('Void')).toBeNull();
    });

    // ── The STAMP overlay is the THIRD focus-trapped overlay on this screen ─
  //
  // It is opened from INSIDE the detail panel ('Input e-Faktur NSFP'), so it is a
  // second-level overlay: the trap that must own Escape at that moment is
  // `stampPanelRef`, not `detailPanelRef`. Rounds 191 and 192 pinned DETAIL and VOID;
  // this is the last of the three, and the only one whose trigger lives behind another
  // overlay — which is why it needed its own case rather than being assumed covered.
  //
  // Asserting the screen survives as well as the overlay leaving is the half that
  // discriminates: the bug this class produces is a dismissal that ALSO navigates away
  // (see `restaurant-tables-toolbar.spec.ts`).
  // One Escape must dismiss ONE overlay. Both traps are active while the stamp
  // dialog sits over the sale-detail dialog, and each attaches its own document
  // keydown listener, so an unguarded handler closed BOTH — the cashier pressed
  // Escape once and lost the detail view behind it too (measured: 2 dialogs
  // open, Escape, 0 dialogs left).
  it('closes only the innermost overlay on a single Escape', async () => {
    const user = userEvent.setup();
    mockListSalesScoped.mockResolvedValue({ sales: sampleSales, salesHistoryCapped: false });
    mockListStaff.mockResolvedValue([]);
    mockGetSaleScoped.mockResolvedValue(sampleDetail);
    mockListRefunds.mockResolvedValue([]);
    const { container } = renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);

    await waitFor(() => expect(screen.getAllByText('View').length).toBeGreaterThan(0));
    await user.click(screen.getAllByText('View')[0]!);
    await waitFor(() => expect(screen.getByText('Input e-Faktur NSFP')).toBeInTheDocument());
    await user.click(screen.getByText('Input e-Faktur NSFP'));
    expect(screen.getByText('Input e-Faktur NSFP (DJP Coretax)')).toBeInTheDocument();
    expect(container.querySelectorAll('[role="dialog"]').length).toBe(2);

    fireEvent.keyDown(document.body, { key: 'Escape' });

    // The stamp overlay goes…
    await waitFor(() => {
      expect(screen.queryByText('Input e-Faktur NSFP (DJP Coretax)')).toBeNull();
    });
    // …and the DETAIL overlay it was opened from is still there.
    expect(screen.getByText('Input e-Faktur NSFP')).toBeInTheDocument();
    expect(container.querySelectorAll('[role="dialog"]').length).toBe(1);
  });

  it('closes the e-Faktur STAMP overlay on Escape without leaving the screen', async () => {
    const user = userEvent.setup();
    mockListSalesScoped.mockResolvedValue({ sales: sampleSales, salesHistoryCapped: false });
    mockListStaff.mockResolvedValue([]);
    mockGetSaleScoped.mockResolvedValue(sampleDetail);
    mockListRefunds.mockResolvedValue([]);
    const { container } = renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getAllByText('View').length).toBeGreaterThan(0);
    });
    await user.click(screen.getAllByText('View')[0]!);
    await waitFor(() => {
      expect(screen.getByText('Input e-Faktur NSFP')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Input e-Faktur NSFP'));
    expect(screen.getByText('Input e-Faktur NSFP (DJP Coretax)')).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: 'Escape' });

    // The STAMP overlay goes…
    await waitFor(() => {
      expect(screen.queryByText('Input e-Faktur NSFP (DJP Coretax)')).toBeNull();
    });
    // …and the SCREEN STAYS: its rows are still rendered.
    expect(
      container.querySelectorAll('.sales-history-row-wrap').length,
      'Escape must dismiss the stamp overlay, not navigate away from the screen',
    ).toBeGreaterThan(0);
  });
  it('stamps e-Faktur NSFP on unstamped sale', async () => {
      const user = userEvent.setup();
      mockListSalesScoped.mockResolvedValue({ sales: sampleSales, salesHistoryCapped: false });
      mockListStaff.mockResolvedValue([]);
      mockGetSaleScoped.mockResolvedValue(sampleDetail);
      mockListRefunds.mockResolvedValue([]);
      mockStampFakturPajakScoped.mockResolvedValue({
        nsfp: '2600000000999',
        kodeTransaksi: '01',
        status: '00',
        formatted: '01002600000000999',
      });

      renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);
      await waitFor(() => {
        expect(screen.getAllByText('View').length).toBeGreaterThan(0);
      });
      await user.click(screen.getAllByText('View')[0]!);

      await waitFor(() => {
        expect(screen.getByText('Belum ada e-Faktur (Unstamped)')).toBeInTheDocument();
        expect(screen.getByText('Input e-Faktur NSFP')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Input e-Faktur NSFP'));
      expect(screen.getByText('Input e-Faktur NSFP (DJP Coretax)')).toBeInTheDocument();

      const nsfpInput = screen.getByLabelText('13-Digit NSFP');
      await user.type(nsfpInput, '2600000000999');

      await user.click(screen.getByRole('button', { name: 'Stamp e-Faktur' }));
      await waitFor(() => {
        expect(mockStampFakturPajakScoped).toHaveBeenCalledWith('session-1', {
          saleId: sampleDetail.id,
          nsfp: '2600000000999',
          kodeTransaksi: '01',
        });
      });
    });
  });

  // ── The refund read that did not answer ─────────────────────
  //
  // listRefundsScoped(...).catch(() => []) reported a FAILED read as "this sale
  // was never refunded". The empty case is not a harmless mistake here: it
  // hides the Refunded badge and the Previous Refunds section (the evidence), while
  // the Refund button -- gated on sale status and session, never on this list --
  // stays enabled. create_refund bounds a refund by the cumulative total already
  // refunded (crates/kasirmu-core/src/db/refunds.rs:119-143), so the attempt is
  // refused for a reason the operator cannot see on screen.

  /** Open the detail modal for the first sample sale. */
  async function openFirstSaleDetail() {
    const user = userEvent.setup();
    mockListSalesScoped.mockResolvedValue({ sales: [sampleSales[0]!], salesHistoryCapped: false });
    mockGetSaleScoped.mockResolvedValue(sampleDetail);
    renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getAllByText('View').length).toBeGreaterThan(0);
    });
    await user.click(screen.getAllByText('View')[0]!);
    return user;
  }

  it('does not claim a sale was never refunded when the refund read failed', async () => {
    mockListRefunds.mockRejectedValue(new Error('invoke failed'));
    await openFirstSaleDetail();

    // Wait for the ARRIVING state, never for an absence: before the detail opens,
    // neither the badge nor the section is on screen either, so polling for their
    // absence would pass without exercising anything.
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Refunds for this sale could not be loaded',
      );
    });
    // The badge claim AND the evidence section must both be absent, not merely
    // accompanied by an error: each is gated on its own `!refundsUnknown`, so a
    // fix that removed only one of the two gates passes this line for the other.
    expect(screen.queryByText('Refunded')).not.toBeInTheDocument();
    expect(screen.queryByText('Previous Refunds')).not.toBeInTheDocument();
    // The action that would be refused for an invisible reason is not offered.
    expect(screen.queryByText('Refund')).not.toBeInTheDocument();
    // The detail itself still rendered -- only the refund read was unanswered.
    // (The total label is split across elements by its <Localized> wrapper, so the
    // footer action is the stable thing to anchor on.)
    expect(screen.getByRole('button', { name: /reprint/i })).toBeInTheDocument();
  });

  it('offers the refund action again once a retry answers with no refunds', async () => {
    mockListRefunds.mockRejectedValue(new Error('invoke failed'));
    const user = await openFirstSaleDetail();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Refunds for this sale could not be loaded',
      );
    });

    // The retry succeeds and answers [] -- a real answer now, not a swallowed throw.
    mockListRefunds.mockResolvedValue([]);
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(screen.getByText('Refund')).toBeInTheDocument();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // Absence becomes a fact only now: nothing was refunded, and a read said so.
    expect(screen.queryByText('Refunded')).not.toBeInTheDocument();
    expect(screen.queryByText('Previous Refunds')).not.toBeInTheDocument();
  });

  // ── A margin read that did not answer ────────────────────────────────
  //
  // getSaleLineMarginsScoped(...).catch(() => []) reported a FAILED read as
  // 'this sale has no line costs'. The Cost / Margin / Margin % columns are gated
  // on the LENGTH of that list, so a failed read deleted three columns of a
  // manager's profitability read in silence. The gap is not a formatting detail
  // either: query_sale_lines_with_margin prefers the per-line cost snapshot and
  // falls back to the product's CURRENT cost and then to 0
  // (crates/kasirmu-reporting/src/margin.rs:93), so a genuinely unknown cost is
  // itself a number that reads as a real one.

  const oneMargin = [{
    sale_line_id: 'line-1', sku: 'SKU-001', name: 'Widget', qty: 2,
    unit_price_minor: 25000, line_total_minor: 50000,
    unit_cost_minor: 15000, margin_minor: 20000, margin_percent: 40,
  }];

  it('does not hide the margin columns silently when the margin read failed', async () => {
    mockListRefunds.mockResolvedValue([]);
    mockGetSaleLineMargins.mockRejectedValue(new Error('invoke failed'));
    await openFirstSaleDetail();

    // Anchor on the ARRIVING alert, never on the absence of the columns: before
    // the detail opens the table has no columns either, so a poll for their
    // absence would pass without exercising anything.
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Cost and margin for this sale could not be loaded',
      );
    });
    // The columns stay gone -- a dash in a cost column would read as a cheaper
    // line -- but the absence is now named rather than implied.
    expect(screen.queryByText('Cost')).not.toBeInTheDocument();
    expect(screen.queryByText('Margin %')).not.toBeInTheDocument();
    // And only the margin read was unanswered: the detail itself is intact.
    expect(screen.getByText('SKU-001')).toBeInTheDocument();
  });

  // ── The SALE read itself, which was the one read settleRead never covered ──
  //
  // `openDetail` (:532-580) wraps getSale + refunds + margins in ONE Promise.all and
  // catches the lot with an empty body. The two SECONDARY reads are settled individually
  // through settleRead, so a failure in either is named on screen. The PRIMARY read was
  // not: when getSaleScoped rejects, the whole Promise.all rejects, the catch drops it,
  // `detail` stays null, and the modal's render guard (`detailExit.shouldRender && detail`,
  // :1626) draws nothing. The cashier taps a row and the drawer simply never opens -- no
  // skeleton, no message, nothing. Their next move is to tap it again.
  //
  // settle-read.ts's own doc lists SalesHistoryScreen as a consumer "-- the refunds of the
  // open sale ... then the sale's roster, then its per-line cost/margin report", and stops
  // short of the sale. This is that last read.
  it('opens the detail via settleRead so a FAILED sale read is not a dead tap', async () => {
    const source = readFileSync(
      resolve(__dirname, '../features/sales/SalesHistoryScreen.tsx'),
      'utf8',
    );
    // The contract, asserted at source because the behaviour is an ABSENCE (no modal, no
    // message) that a render assertion cannot distinguish from 'not opened yet'.
    expect(
      source,
      'the primary sale read must go through settleRead like its two siblings',
    ).toMatch(/settleRead\(\s*'sale'\s*,/);
    // And the failure must produce a message, not a dropped drawer.
    expect(source).toMatch(/sales-history-detail-load-failed/);
  });

  it('names the failure when the SALE read throws, and retries', async () => {
    mockListRefunds.mockResolvedValue([]);
    mockGetSaleLineMargins.mockResolvedValue([]);
    mockGetSaleScoped.mockRejectedValueOnce(new Error('invoke failed'));

    const user = userEvent.setup();
    mockListSalesScoped.mockResolvedValue({ sales: [sampleSales[0]!], salesHistoryCapped: false });
    renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getAllByText('View').length).toBeGreaterThan(0);
    });
    await user.click(screen.getAllByText('View')[0]!);

    // A failed open must SAY so, on a surface that OUTLIVES the toast: the toast is
       // transient and the failure is not, so the persistent banner is the assertion that
       // matters — polling for a toast alone would pass and then leave the operator with
       // nothing.
    await waitFor(() => {
      expect(
        screen.getByTestId('sales-history-detail-load-failed'),
        'tapping a sale that failed to load said nothing',
      ).toBeInTheDocument();
    });

    // And the retry works: the second attempt answers, so the detail opens.
    mockGetSaleScoped.mockResolvedValue(sampleDetail);
    const retry = screen.queryByRole('button', { name: /retry/i });
    if (retry) await user.click(retry);
    else await user.click(screen.getAllByText('View')[0]!);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /reprint/i })).toBeInTheDocument();
    });
  });

  it('shows the margin columns again once a retry answers', async () => {
    mockListRefunds.mockResolvedValue([]);
    mockGetSaleLineMargins.mockRejectedValueOnce(new Error('invoke failed'));
    const user = await openFirstSaleDetail();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Cost and margin for this sale could not be loaded',
      );
    });

    mockGetSaleLineMargins.mockResolvedValue(oneMargin);
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(screen.getByText('Cost')).toBeInTheDocument();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Rp 15.000')).toBeInTheDocument();
  });

  it('warns that an export dropped the cost and margin for the sales it could not read', async () => {
    const user = userEvent.setup();
    mockListSalesScoped.mockResolvedValue({ sales: [sampleSales[0]!], salesHistoryCapped: false });
    mockGetSaleLineMargins.mockRejectedValue(new Error('invoke failed'));
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);

    await waitFor(() => expect(screen.getByText('Export CSV')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));

    // The file still lands -- the summary rows are worth having -- and the gap in
    // it is named, because a blank cost cell in a CSV reads as a cost of zero.
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.getByText(/Cost and margin could not be read for 1 sale/)).toBeInTheDocument();
    });
    createUrl.mockRestore();
    clickSpy.mockRestore();
  });

  // MUTATION 1: drop the dash. `staffUnknown` is set on every settled read, so the
  //   flag is the only thing separating 'the roster is empty' from 'we could not
  //   ask'. Expected: BOTH new cases fail -- the dash disappears, the roster recovers.
  // MUTATION 2: keep the flag but delete the ALERT. Restores the original
  //   `[]`-on-failure shape minus the naming: truncated ids return to the table and
  //   the filter reads as a single-cashier store with nothing on screen to say so.
  //   Expected: the first new case fails, because nothing announces the gap.
  // MUTATION 3: the alert without the dash. Proves the DASH is load-bearing, not
  //   just the alert -- the same question the refund and margin blocks answered here.
  //   Expected: the first new case fails on `user-1` being back on screen.

  // ── The roster read that did not answer ─────────────────────
  //
  // listStaffScoped(sessionToken).catch(() => []) reported a FAILED read as
  // 'this store has no other cashiers'. That is a claim about the WORLD, and one
  // list feeds three of them on this screen: the Cashier filter, every name in the
  // table, and the cashier column of the CSV export. A refused read is an EXPECTED
  // outcome, not a malfunction -- list_staff_scoped requires permissions::STAFF_READ
  // (crates/kasirmu-bridge/src/staff.rs:349), so a session allowed to read sales
  // history can still be refused the roster.

  it('says the roster is unknown instead of claiming a single-cashier store', async () => {
    mockListSalesScoped.mockResolvedValue({ sales: [sampleSales[0]!], salesHistoryCapped: false });
    mockListStaff.mockRejectedValue(new Error('permission denied'));
    renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);

    // Anchor on the ARRIVING alert, never on an absence: while `loading` is true
    // neither the alert nor the names are on screen, so a poll for their absence
    // would pass without exercising anything.
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Cashier names could not be loaded',
      );
    });
    // The name column must NOT be a truncated id: 'user-1'.slice(0, 8) is a
    // different string that looks like a real name, and it reaches the export too.
    expect(screen.queryByText('user-1')).not.toBeInTheDocument();
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
    // The sales themselves are unaffected -- only the roster read was unanswered.
    expect(screen.getAllByText('View').length).toBeGreaterThan(0);
  });

  it('names the cashiers again once a retry answers', async () => {
    const user = userEvent.setup();
    mockListSalesScoped.mockResolvedValue({ sales: [sampleSales[0]!], salesHistoryCapped: false });
    mockListStaff.mockRejectedValueOnce(new Error('permission denied'));
    mockListStaff.mockResolvedValue(sampleStaff);
    const { container } = renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Cashier names could not be loaded',
      );
    });

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      // Alice is on screen TWICE once the roster answers -- in the filter option
      // and in the table cell -- so anchor on the CELL, which is the claim under
      // test, rather than a bare getByText that throws on the second match.
      const cells = container.querySelectorAll('.sales-history-cell-cashier');
      expect(cells.length).toBeGreaterThan(0);
      expect(cells[0]!.textContent).toBe('Alice');
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // The filter is populated again, not merely the table.
    expect(screen.getByRole('option', { name: 'Bob' })).toBeInTheDocument();
  });

  it('clears detail cache when kasirmu:trimMemory event is dispatched', async () => {
    mockListSalesScoped.mockResolvedValue({ sales: sampleSales, salesHistoryCapped: false });
    mockGetSaleScoped.mockResolvedValue(sampleDetail);
    mockListRefunds.mockResolvedValue([]);
    const user = userEvent.setup();
    renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('sale-001…')).toBeInTheDocument();
    });

    const viewButtons = screen.getAllByRole('button', { name: /view/i });
    await user.click(viewButtons[0]!);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    // Close detail dialog
    const closeButtons = screen.getAllByRole('button', { name: /close/i });
    await user.click(closeButtons[0]!);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    // Dispatch memory trim event
    act(() => {
      window.dispatchEvent(new CustomEvent('kasirmu:trimMemory', { detail: { level: 80 } }));
    });

    // Re-opening succeeds cleanly
    await user.click(viewButtons[0]!);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('renders standard back button when onBack prop is provided and triggers callback', async () => {
    mockListSalesScoped.mockResolvedValue({ sales: sampleSales, salesHistoryCapped: false });
    const onBack = vi.fn();
    const user = userEvent.setup();
    renderWithProvidersSync(<SalesHistoryScreen onBack={onBack} />, salesFtl, sharedFtl);

    const backBtn = await screen.findByTestId('sales-history-back-btn');
    expect(backBtn).toBeInTheDocument();
    expect(backBtn).toHaveAttribute('aria-label', 'Back');

    await user.click(backBtn);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('omits back button when onBack prop is not provided', async () => {
    mockListSalesScoped.mockResolvedValue({ sales: sampleSales, salesHistoryCapped: false });
    renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('sale-001…')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('sales-history-back-btn')).not.toBeInTheDocument();
  });

  it('renders search clear button when search query is entered and clears input on click', async () => {
    mockListSalesScoped.mockResolvedValue({ sales: sampleSales, salesHistoryCapped: false });
    const user = userEvent.setup();
    renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('sale-001…')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Search sale ID, payment, cashier…');
    expect(screen.queryByTestId('sales-history-search-clear-btn')).not.toBeInTheDocument();

    await user.type(searchInput, 'sale-001');
    expect(searchInput).toHaveValue('sale-001');

    const clearSearchBtn = screen.getByTestId('sales-history-search-clear-btn');
    expect(clearSearchBtn).toBeInTheDocument();

    await user.click(clearSearchBtn);
    expect(searchInput).toHaveValue('');
    expect(screen.queryByTestId('sales-history-search-clear-btn')).not.toBeInTheDocument();
  });

  it('renders clear filters button when filter is active and resets all filters on click', async () => {
    mockListSalesScoped.mockResolvedValue({ sales: sampleSales, salesHistoryCapped: false });
    const user = userEvent.setup();
    renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('sale-001…')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('sales-history-clear-filters-btn')).not.toBeInTheDocument();

    // Activate a status filter
    const voidedChip = screen.getByRole('radio', { name: 'Voided' });
    await user.click(voidedChip);

    // Only sale-003 is voided
    expect(screen.getByText('sale-003…')).toBeInTheDocument();
    expect(screen.queryByText('sale-001…')).not.toBeInTheDocument();

    // Clear filters button should now be visible
    const clearFiltersBtn = screen.getByTestId('sales-history-clear-filters-btn');
    expect(clearFiltersBtn).toBeInTheDocument();

    await user.click(clearFiltersBtn);

    // All sales visible again, status reset to All, button hidden
    expect(screen.getByText('sale-001…')).toBeInTheDocument();
    expect(screen.getByText('sale-003…')).toBeInTheDocument();
    expect(screen.queryByTestId('sales-history-clear-filters-btn')).not.toBeInTheDocument();
  });

  it('opens sale detail when the entire table row is clicked', async () => {
    mockListSalesScoped.mockResolvedValue({ sales: sampleSales, salesHistoryCapped: false });
    mockGetSaleScoped.mockResolvedValue(sampleDetail);
    mockListRefunds.mockResolvedValue([]);
    const user = userEvent.setup();
    renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('sale-001…')).toBeInTheDocument();
    });

    // Click the receipt cell itself rather than the View button
    const receiptCell = screen.getByText('sale-001…');
    await user.click(receiptCell);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    expect(mockGetSaleScoped).toHaveBeenCalledWith('session-1', sampleSales[0]!.id);
  });

  it('renders complete financial breakdown in detail dialog including discount, service charge, and tip', async () => {
    const breakdownDetail = {
      ...sampleDetail,
      subtotal: { minor_units: 100000, currency: 'IDR' },
      total: { minor_units: 115000, currency: 'IDR' },
      taxTotal: { minor_units: 10000, currency: 'IDR' },
      discountLabel: 'VIP Promo',
      discountPercent: 10,
      serviceChargeMinor: 10000,
      tipMinor: 5000,
      tenderedMinor: 120000,
    };
    mockListSalesScoped.mockResolvedValue({ sales: sampleSales, salesHistoryCapped: false });
    mockGetSaleScoped.mockResolvedValue(breakdownDetail);
    mockListRefunds.mockResolvedValue([]);
    const user = userEvent.setup();
    renderWithProvidersSync(<SalesHistoryScreen />, salesFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('sale-001…')).toBeInTheDocument();
    });

    const receiptCell = screen.getByText('sale-001…');
    await user.click(receiptCell);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    expect(screen.getByText(/subtotal/i)).toBeInTheDocument();
    expect(screen.getByText(/discount/i)).toBeInTheDocument();
    expect(screen.getByText('(VIP Promo)')).toBeInTheDocument();
    expect(screen.getByText(/service charge/i)).toBeInTheDocument();
    expect(screen.getByText(/tip/i)).toBeInTheDocument();
    expect(screen.getAllByText(/tax/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/total/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/tendered/i)).toBeInTheDocument();
    expect(screen.getByText(/change/i)).toBeInTheDocument();
  });
});