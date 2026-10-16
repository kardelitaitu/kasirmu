// A failed catalogue read must not be rendered as an empty catalogue.
//
// Both screens used to answer a throwing list-scoped IPC with `[]`, so a
// cashier could not tell "this store has no products" from "the store was
// never asked". The remedy is the sanctioned idiom in
// app/AppShell.tsx:87-94 — settle() returns {ok:true,value} or logs
// and returns {ok:false} and the caller WRITES NOTHING, so the state stays
// UNKNOWN. Each pair below asserts one arm of the distinction: the unanswered
// read says so out loud, the answered-with-zero read stays quiet.
//
// Strings are asserted RESOLVED (they come from the mounted .ftl bundles), so a
// missing key fails rather than passing on a JSX fallback.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithFluent, renderWithProviders } from '@/__tests__/test-utils/render';
import sharedFtl from '@/locales/shared.ftl?raw';
import salesFtl from '@/locales/sales.ftl?raw';
import terminalsFtl from '@/locales/terminals.ftl?raw';
import stockTransfersFtl from '@/locales/stock-transfers.ftl?raw';

const PRODUCTS_UNAVAILABLE = 'Failed to load products. Check the connection and retry.';
const TERMINALS_UNAVAILABLE = 'Failed to load terminals';
const SCAN_NO_MATCH = 'No product matches that barcode';

const { mockListProducts, mockListTerminals, mockListCountProducts, mockListTransfers, mockListCounts, mockGetCountLines } =
  vi.hoisted(() => ({
    mockListProducts: vi.fn(),
    mockListTerminals: vi.fn(),
    mockListCountProducts: vi.fn(),
    mockListTransfers: vi.fn(),
    mockListCounts: vi.fn(),
    mockGetCountLines: vi.fn(),
  }));

vi.mock('@/api/products', () => ({
  listProducts: () => mockListProducts(),
  listProductsScoped: () => mockListProducts(),
  listWarehouseProductsAtLocation: (token: string, locationId: string) =>
    mockListCountProducts(token, locationId),
}));

vi.mock('@/api/terminals', () => ({
  listTerminals: () => mockListTerminals(),
  listTerminalsScoped: () => mockListTerminals(),
}));

vi.mock('@/api/stockTransfers', () => ({
  listStockTransfers: () => mockListTransfers(),
  getStockTransfer: vi.fn(),
  sendStockTransfer: vi.fn(),
  receiveStockTransfer: vi.fn(),
  cancelStockTransfer: vi.fn(),
  createStockTransfer: vi.fn(),
}));

vi.mock('@/api/inventoryCounts', () => ({
  createStockCount: vi.fn(),
  listStockCounts: () => mockListCounts(),
  getCountLines: (token: string, countId: string) => mockGetCountLines(token, countId),
  addCountLine: vi.fn(),
  updateCountLine: vi.fn(),
  removeCountLine: vi.fn(),
  updateStockCountStatus: vi.fn(),
  completeStockCount: vi.fn(),
}));

import StockTransfersScreen from '@/features/stock-transfers/StockTransfersScreen';
import WarehouseCountFlow from '@/features/warehouse/WarehouseCountFlow';

// ── Site 1: StockTransfersScreen ──────────────────────────────────
describe('StockTransfersScreen — the SKU picker after a failed read', () => {
  it('says the product list could not be loaded instead of showing an empty picker', async () => {
    const user = userEvent.setup();
    mockListTransfers.mockResolvedValue([]);
    mockListProducts.mockRejectedValue(new Error('ipc unavailable'));
    mockListTerminals.mockResolvedValue([]);

    await renderWithFluent(
      <StockTransfersScreen />,
      stockTransfersFtl,
      terminalsFtl,
      salesFtl,
      sharedFtl,
    );
    await user.click(await screen.findByRole('button', { name: /new transfer/i }));

    expect(await screen.findByText(PRODUCTS_UNAVAILABLE)).toBeInTheDocument();
  });

  it('stays silent when the catalogue ANSWERED with zero products', async () => {
    const user = userEvent.setup();
    mockListTransfers.mockResolvedValue([]);
    mockListProducts.mockResolvedValue([]);
    mockListTerminals.mockResolvedValue([]);

    await renderWithFluent(
      <StockTransfersScreen />,
      stockTransfersFtl,
      terminalsFtl,
      salesFtl,
      sharedFtl,
    );
    await user.click(await screen.findByRole('button', { name: /new transfer/i }));
    await waitFor(() => {
      expect(screen.getByLabelText(/SKU/i)).toBeInTheDocument();
    });

    // "I asked and the answer was zero" is not an error — say nothing.
    expect(screen.queryByText(PRODUCTS_UNAVAILABLE)).not.toBeInTheDocument();
    expect(screen.queryByText(TERMINALS_UNAVAILABLE)).not.toBeInTheDocument();
  });

  it('says the terminal list could not be loaded, separately from the products one', async () => {
    const user = userEvent.setup();
    mockListTransfers.mockResolvedValue([]);
    mockListProducts.mockResolvedValue([]);
    mockListTerminals.mockRejectedValue(new Error('ipc unavailable'));

    await renderWithFluent(
      <StockTransfersScreen />,
      stockTransfersFtl,
      terminalsFtl,
      salesFtl,
      sharedFtl,
    );
    await user.click(await screen.findByRole('button', { name: /new transfer/i }));

    expect(await screen.findByText(TERMINALS_UNAVAILABLE)).toBeInTheDocument();
    // Each read settles on its own: one failure cannot forge the other answer
    // (the AppShell.tsx:84-86 rule).
    expect(screen.queryByText(PRODUCTS_UNAVAILABLE)).not.toBeInTheDocument();
  });
});

// ── Site 2: WarehouseCountFlow ────────────────────────────────────
const inProgressCount = {
  id: 'count-1',
  count_number: 'CNT-1',
  status: 'in_progress',
  count_type: 'cyclic',
  notes: '',
  counted_by: 'user-1',
  created_at: '2026-07-01T10:00:00Z',
  completed_at: null,
  updated_at: '2026-07-01T10:00:00Z',
};

// `lines` defaults to EMPTY, which is what the two scan-resolution cases below need.
// The complete-guard case passes a line so the footer -- and its Complete button --
// renders at all; without one the button is ABSENT, not merely disabled.
async function openCountFlow(lines: unknown[] = []) {
  mockListCounts.mockResolvedValue([inProgressCount]);
  mockGetCountLines.mockResolvedValue(lines);
  const user = userEvent.setup();
  await renderWithProviders(
    <WarehouseCountFlow sessionToken="tok-1" locationId="loc-1" onCompleted={vi.fn()} />,
    salesFtl,
    sharedFtl,
  );
  // Open the in-progress count: that is the view whose scan box resolves SKUs
  // against the catalogue.
  await user.click(await screen.findByText(/CNT-1/));
  await screen.findByRole('textbox', { name: /scan barcode/i });
}

describe('WarehouseCountFlow — a scan against a catalogue that never loaded', () => {
  it('reports the failed read, not a non-matching scan', async () => {
    const user = userEvent.setup();
    mockListCountProducts.mockRejectedValue(new Error('ipc unavailable'));
    await openCountFlow();

    const scan = screen.getByRole('textbox', { name: /scan barcode/i });
    // The console has to say the list is not there BEFORE a scan is attempted:
    // an empty picker is indistinguishable from a dead read.
    expect(await screen.findByText(PRODUCTS_UNAVAILABLE)).toBeInTheDocument();

    await user.type(scan, '9312345678901{Enter}');
    // The product may exist perfectly well — "no match" is a claim about the
    // catalogue, and this read never produced one to make it from.
    await waitFor(() => {
      expect(screen.queryByText(SCAN_NO_MATCH)).not.toBeInTheDocument();
    });
    expect((await screen.findAllByText(PRODUCTS_UNAVAILABLE)).length).toBeGreaterThan(1);
  });

  it('still reports a genuine non-match when the catalogue answered empty', async () => {
    const user = userEvent.setup();
    mockListCountProducts.mockResolvedValue([]);
    await openCountFlow();

    const scan = screen.getByRole('textbox', { name: /scan barcode/i });
    await user.type(scan, '9312345678901{Enter}');

    expect(await screen.findByText(SCAN_NO_MATCH)).toBeInTheDocument();
    expect(screen.queryByText(PRODUCTS_UNAVAILABLE)).not.toBeInTheDocument();
  });
});

// ── Site 3: completing a count twice ──────────────────────────────
//
// `handleComplete` in BOTH WarehouseCountFlow and StockCountDetail has the same shape:
// `setSaving(true)` then await, with `saving` as STATE. React commits it on its next
// render, after the second tap of a real double tap, so the button's
// `disabled={saving || ...}` is not authoritative in the same task.
//
// core refuses the replay by compare-and-set:
//   UPDATE stock_counts SET status = 'completed' ... WHERE id = ?3
//     AND status IN ('draft', 'in_progress')       -- stock_counts.rs:529-539
// `claimed != 1` returns Validation, so NO second inventory adjustment is applied -- but
// that rejection lands in the catch that reports genuine failures, so the operator is
// told the complete FAILED for a count that DID complete. The StockCountDetail sibling is
// pinned by its own case in StockCountDetail.test.tsx.
//
// SHAPE 3 (round 139): both taps in ONE batch, before React can re-render.
describe('WarehouseCountFlow — completing a count twice', () => {
  it('sends one complete call for a double tap while the first is in flight', async () => {
    const { completeStockCount } = await import('@/api/inventoryCounts');
    const mockComplete = completeStockCount as ReturnType<typeof vi.fn>;
    let releaseComplete: (v: unknown) => void = () => {};
    const held = new Promise((resolve) => { releaseComplete = resolve; });
    mockComplete.mockImplementation(() => held as never);
    await openCountFlow([
      {
        id: 'line-1', count_id: 'count-1', sku: 'SKU-1', product_name: 'Widget',
        expected_qty: 5, counted_qty: 5, difference: 0, notes: '',
      },
    ]);

    const completeBtn = screen.getByRole('button', { name: /complete/i });
    await act(async () => {
      fireEvent.click(completeBtn);
      // The disabled flag React set is not yet authoritative for a live double tap;
      // dropping it sends the second click to the handler the way a real one would.
      completeBtn.removeAttribute('disabled');
      fireEvent.click(completeBtn);
    });

    expect(
      mockComplete.mock.calls.length,
      'a second tap re-sent the complete; core refuses the replay, so the failure is ' +
        'reported for a count that DID complete',
    ).toBe(1);

    releaseComplete([]);
    await act(async () => { await held; });
  });
});
