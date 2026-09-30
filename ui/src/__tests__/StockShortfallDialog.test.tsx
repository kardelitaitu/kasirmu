// ── StockShortfallDialog — unit tests ──────────────────────────────
//
// Covers: empty state, single/multiple shortfall cards, simple mode
// (radio buttons), split mode (qty inputs, toggles, clamping),
// no-alternatives mode, manager override checkbox, cancel + confirm
// actions (success and error states). 17 tests.

import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderInAct } from '@/test-utils/renderInAct';
import userEvent from '@testing-library/user-event';
import { withFluent } from '@/i18n/test-utils';
import salesFtl from '@/locales/sales.ftl?raw';
import StockShortfallDialog from '@/features/sales/StockShortfallDialog';
import type {
  PartialStockResult,
  Shortfall,
  LocationStock,
  CartLineData,
} from '@/api/sales';

// ── Hoisted mocks (run before the module factory) ──────────────────

const { mockCompleteSaleWithResolvedShortfalls } = vi.hoisted(() => ({
  mockCompleteSaleWithResolvedShortfalls: vi.fn<(...args: unknown[]) => unknown>(),
}));

vi.mock('@/api/sales', () => ({
  completeSaleWithResolvedShortfalls: mockCompleteSaleWithResolvedShortfalls,
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    sessionToken: 'mock-session-token',
  }),
}));

// ── Test data factories ────────────────────────────────────────────

function loc(overrides: Partial<LocationStock> = {}): LocationStock {
  return {
    locationId: `loc-${Math.random().toString(36).slice(2, 6)}`,
    locationName: 'Test Location',
    qtyAvailable: 50,
    ...overrides,
  };
}

function shortfall(overrides: Partial<Shortfall> = {}): Shortfall {
  return {
    sku: 'SKU-001',
    productName: 'Test Product',
    requestedQty: 20,
    primaryQtyAvailable: 3,
    deficit: 17,
    primaryLocationId: 'main-store',
    alternatives: [
      loc({ locationId: 'alt-1', locationName: 'Warehouse A', qtyAvailable: 50 }),
      loc({ locationId: 'alt-2', locationName: 'Warehouse B', qtyAvailable: 10 }),
    ],
    ...overrides,
  };
}

function partialStockResult(
  overrides: Partial<PartialStockResult> = {},
): PartialStockResult {
  return {
    requiresResolution: true,
    shortfalls: [shortfall()],
    ...overrides,
  };
}

// ── Default props ──────────────────────────────────────────────────

const defaultProps = {
  shortfallResult: partialStockResult(),
  cartLines: [{ sku: 'SKU-001', qty: 20, unitPriceMinor: 5000, unitPriceCurrency: 'USD' }] as CartLineData[],
  totalMinor: 100_000,
  currency: 'IDR',
  paymentMethod: 'CASH',
  tenderedMinor: 100_000,
  discountPercent: 0,
  onComplete: vi.fn(),
  onCancel: vi.fn(),
};

// ── Render helper ──────────────────────────────────────────────────

async function renderWithFluent(ui: React.ReactElement) {
  const wrapped = withFluent(ui, salesFtl);
  await renderInAct(wrapped);
}

// ── Tests ──────────────────────────────────────────────────────────

describe('StockShortfallDialog', () => {
  // ── Rendering — empty / basic structure ───────────────────────────

  it('returns null when shortfalls array is empty', async () => {
    await renderWithFluent(
      <StockShortfallDialog
        {...defaultProps}
        shortfallResult={partialStockResult({ shortfalls: [] })}
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders title and description', async () => {
    await renderWithFluent(<StockShortfallDialog {...defaultProps} />);
    expect(
      screen.getByRole('heading', { name: /Insufficient Stock/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/don't have enough stock/i),
    ).toBeInTheDocument();
  });

  it('renders shortfall card with SKU, name, wanted, available, deficit', async () => {
    await renderWithFluent(<StockShortfallDialog {...defaultProps} />);
    expect(screen.getByText('#SKU-001')).toBeInTheDocument();
    expect(screen.getByText('Test Product')).toBeInTheDocument();
    expect(screen.getByText(/Wanted/)).toBeInTheDocument();
    expect(screen.getByText(/Available/)).toBeInTheDocument();
    expect(screen.getByText('-17')).toBeInTheDocument();
  });

  it('renders multiple shortfall cards', async () => {
    await renderWithFluent(
      <StockShortfallDialog
        {...defaultProps}
        shortfallResult={partialStockResult({
          shortfalls: [
            shortfall({ sku: 'SKU-001', productName: 'Product A' }),
            shortfall({ sku: 'SKU-002', productName: 'Product B' }),
          ],
        })}
      />,
    );
    expect(screen.getByText('#SKU-001')).toBeInTheDocument();
    expect(screen.getByText('#SKU-002')).toBeInTheDocument();
    expect(screen.getByText('Product A')).toBeInTheDocument();
    expect(screen.getByText('Product B')).toBeInTheDocument();
  });

  // ── Simple mode (radio buttons) ──────────────────────────────────

  it('shows alternative locations as radio buttons in simple mode', async () => {
    await renderWithFluent(<StockShortfallDialog {...defaultProps} />);
    expect(screen.getByText('Alternative locations:')).toBeInTheDocument();

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);

    expect(screen.getByText('Warehouse A')).toBeInTheDocument();
    expect(screen.getByText('Warehouse B')).toBeInTheDocument();
  });

  it('selects first alternative by default', async () => {
    await renderWithFluent(<StockShortfallDialog {...defaultProps} />);
    const radios = screen.getAllByRole('radio');
    expect(radios[0]!).toBeChecked();
    expect(radios[1]!).not.toBeChecked();
  });

  it('changes selection when clicking a different radio button', async () => {
    await renderWithFluent(<StockShortfallDialog {...defaultProps} />);
    const radios = screen.getAllByRole('radio');

    expect(radios[0]!).toBeChecked();
    expect(radios[1]!).not.toBeChecked();

    await userEvent.click(radios[1]!);
    expect(radios[1]!).toBeChecked();
    expect(radios[0]!).not.toBeChecked();
  });

  // ── Split mode ──────────────────────────────────────────────────

  it('toggles to split mode when "Split across locations" is clicked', async () => {
    await renderWithFluent(<StockShortfallDialog {...defaultProps} />);

    await userEvent.click(screen.getByText('Split across locations'));

    expect(screen.getByText('Use single location')).toBeInTheDocument();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });

  it('renders quantity inputs per location in split mode with correct max', async () => {
    await renderWithFluent(<StockShortfallDialog {...defaultProps} />);
    await userEvent.click(screen.getByText('Split across locations'));

    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs).toHaveLength(2);

    // Max = min(alt.qtyAvailable, requestedQty) -- requestedQty=20, loc-1=50,
    // loc-2=10. The cap was the deficit (17) and each row could reach it, so
    // two rows together over-allocated a 20-unit line and the submit was
    // refused by plan_resolution_deductions (crates/kasirmu-core/src/
    // sale_deduction.rs:210-218).
    expect(inputs[0]!).toHaveAttribute('max', '20');
    expect(inputs[1]!).toHaveAttribute('max', '10');

    expect(screen.getByText('Warehouse A')).toBeInTheDocument();
    expect(screen.getByText('Warehouse B')).toBeInTheDocument();
  });

  it('clamps split quantity to valid range via onChange', async () => {
    await renderWithFluent(<StockShortfallDialog {...defaultProps} />);
    await userEvent.click(screen.getByText('Split across locations'));

    const inputs = screen.getAllByRole('spinbutton');

    // Type a value above the max — the handler clamps to the cap, which is now
    // the requested qty (20) rather than the deficit (17).
    await userEvent.clear(inputs[0]!);
    await userEvent.type(inputs[0]!, '99');

    await waitFor(() => {
      // handleSplitQtyChange clamps Math.min(99, 20) => 20
      expect(inputs[0]!).toHaveValue(20);
    });
  });


  // ── The allocation sum must equal the REQUESTED qty, not the deficit ──

  // plan_resolution_deductions (crates/kasirmu-core/src/sale_deduction.rs:210-218)
  // refuses any sum other than line.qty, and the resolution branch REPLACES
  // the primary deduction rather than adding to it, so the whole line has to
  // be accounted for. Before the fix the dialog allocated only the deficit,
  // which made every retry of a shortfall whose primary location held ANY
  // stock fail with a Validation error the dialog then hid behind a generic
  // message.

  it('allocates the requested qty in simple mode, not the deficit', async () => {
    mockCompleteSaleWithResolvedShortfalls.mockResolvedValueOnce({
      saleId: 'sale-1',
      total: null,
      lineCount: 1,
    });

    await renderWithFluent(<StockShortfallDialog {...defaultProps} />);
    await userEvent.click(screen.getByText('Confirm & Continue'));

    await waitFor(() => {
      expect(mockCompleteSaleWithResolvedShortfalls).toHaveBeenCalledTimes(1);
    });

    const args = mockCompleteSaleWithResolvedShortfalls.mock.calls[0]![1] as {
      resolutions: Array<{ allocations: Array<{ qty: number }> }>;
    };
    // requestedQty=20 while the deficit is only 17.
    expect(args.resolutions[0]!.allocations.reduce((s, a) => s + a.qty, 0)).toBe(20);
  });

  // ── What the cashier SEES must be the quantity that will be allocated ──

  // Round 19 fixed the submit path but left three display sites still speaking
  // in deficit: the split pre-fill, the radio handler, and the per-row cap. They
  // were corrected downstream by the submit-time trim, so nothing was broken —
  // but the cashier was shown a deficit-relative number for a quantity the
  // backend defines as the whole line, which is the same confusion that caused
  // the failure. plan_resolution_deductions
  // (crates/kasirmu-core/src/sale_deduction.rs:210-218) is the authority.

  it('seeds the split pre-fill with the requested qty, not the deficit', async () => {
    await renderWithFluent(<StockShortfallDialog {...defaultProps} />);
    await userEvent.click(screen.getByText('Split across locations'));

    const inputs = screen.getAllByRole('spinbutton');
    // requestedQty=20, deficit=17. The pre-fill used to leave the 3-unit gap
    // to the submit-time auto-fill, so the row opened wrong.
    expect(inputs[0]!).toHaveValue(20);
  });

  it('seeds the CHOSEN location on entering split mode, capped to what it holds', async () => {
    await renderWithFluent(<StockShortfallDialog {...defaultProps} />);
    const radios = screen.getAllByRole('radio');

    await userEvent.click(radios[1]!);
    await userEvent.click(screen.getByText('Split across locations'));

    const inputs = screen.getAllByRole('spinbutton');
    // Radio[1] is Warehouse B. Choosing it and then splitting is an
    // instruction about WHERE, so the seed must land on B -- not on the
    // first alternative, which would move stock the cashier aimed
    // elsewhere. The value is capped to what B actually holds (10), never
    // the deficit (17) the row could not accept and never 0.
    expect(inputs[1]!).toHaveValue(10);
    expect(inputs[0]!).toHaveValue(0);
  });

  // A seed capped below the line is fine ONLY because the submit path tops the
  // rest up from primary. Without that, picking a small location would submit
  // 10 units for a 20-unit line and be refused.
  it('still submits the whole line when the seeded location cannot hold it', async () => {
    mockCompleteSaleWithResolvedShortfalls.mockResolvedValueOnce({
      saleId: 'sale-1',
      total: null,
      lineCount: 1,
    });

    await renderWithFluent(<StockShortfallDialog {...defaultProps} />);
    await userEvent.click(screen.getAllByRole('radio')[1]!);
    await userEvent.click(screen.getByText('Split across locations'));
    await userEvent.click(screen.getByText('Confirm & Continue'));

    await waitFor(() => {
      expect(mockCompleteSaleWithResolvedShortfalls).toHaveBeenCalledTimes(1);
    });

    const args = mockCompleteSaleWithResolvedShortfalls.mock.calls[0]![1] as {
      resolutions: Array<{ allocations: Array<{ qty: number }> }>;
    };
    expect(args.resolutions[0]!.allocations.reduce((s, a) => s + a.qty, 0)).toBe(20);
  });


  // ── No alternatives ──────────────────────────────────────────────


  // The per-row cap is Math.min(qtyAvailable, deficit), so both rows can be
  // filled and the sum can overshoot the line. The backend refuses such a sum
  // outright, so the dialog trims it back to what the line requires.
  it('trims an over-allocated split so the sum equals the requested qty', async () => {
    mockCompleteSaleWithResolvedShortfalls.mockResolvedValueOnce({
      saleId: 'sale-1',
      total: null,
      lineCount: 1,
    });

    await renderWithFluent(<StockShortfallDialog {...defaultProps} />);
    await userEvent.click(screen.getByText('Split across locations'));

    const inputs = screen.getAllByRole('spinbutton');
    await userEvent.clear(inputs[0]!);
    await userEvent.type(inputs[0]!, '17');
    await userEvent.clear(inputs[1]!);
    await userEvent.type(inputs[1]!, '10');

    await waitFor(() => {
      expect(inputs[1]!).toHaveValue(10);
    });

    await userEvent.click(screen.getByText('Confirm & Continue'));

    await waitFor(() => {
      expect(mockCompleteSaleWithResolvedShortfalls).toHaveBeenCalledTimes(1);
    });

    const args = mockCompleteSaleWithResolvedShortfalls.mock.calls[0]![1] as {
      resolutions: Array<{ allocations: Array<{ qty: number }> }>;
    };
    expect(args.resolutions[0]!.allocations.reduce((s, a) => s + a.qty, 0)).toBe(20);
  });

  // Every SKU carries its own resolution, so a well-formed SKU must not hide
  // a wrong sum on another.
  it('sums every SKU of a mixed batch against its own requested qty', async () => {
    mockCompleteSaleWithResolvedShortfalls.mockResolvedValueOnce({
      saleId: 'sale-1',
      total: null,
      lineCount: 2,
    });

    await renderWithFluent(
      <StockShortfallDialog
        {...defaultProps}
        shortfallResult={partialStockResult({
          shortfalls: [
            shortfall({ sku: 'SKU-001' }),
            shortfall({ sku: 'SKU-002', requestedQty: 6, primaryQtyAvailable: 1, deficit: 5 }),
          ],
        })}
      />,
    );

    await userEvent.click(screen.getByText('Confirm & Continue'));

    await waitFor(() => {
      expect(mockCompleteSaleWithResolvedShortfalls).toHaveBeenCalledTimes(1);
    });

    const args = mockCompleteSaleWithResolvedShortfalls.mock.calls[0]![1] as {
      resolutions: Array<{ sku: string; allocations: Array<{ qty: number }> }>;
    };
    const sums = Object.fromEntries(
      args.resolutions.map((r) => [r.sku, r.allocations.reduce((s, a) => s + a.qty, 0)]),
    );
    expect(sums['SKU-001']).toBe(20);
    expect(sums['SKU-002']).toBe(6);
  });

  it('shows no-alternatives message when alternatives list is empty', async () => {
    await renderWithFluent(
      <StockShortfallDialog
        {...defaultProps}
        shortfallResult={partialStockResult({
          shortfalls: [shortfall({ alternatives: [] })],
        })}
      />,
    );

    expect(
      screen.getByText('No alternative locations with stock available.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Alternative locations:'),
    ).not.toBeInTheDocument();
  });

  // ── Manager override checkbox ────────────────────────────────────

  it('renders allow-negative checkbox when alternatives exist', async () => {
    await renderWithFluent(<StockShortfallDialog {...defaultProps} />);

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(1);
    expect(
      screen.getByText('Allow negative stock (Manager PIN override)'),
    ).toBeInTheDocument();
  });

  it('renders allow-negative checkbox in no-alternatives mode and toggles', async () => {
    await renderWithFluent(
      <StockShortfallDialog
        {...defaultProps}
        shortfallResult={partialStockResult({
          shortfalls: [shortfall({ alternatives: [] })],
        })}
      />,
    );

    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).not.toBeChecked();

    await userEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    await userEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });

  // ── Cancel button ────────────────────────────────────────────────

  it('calls onCancel when Cancel Sale is clicked', async () => {
    const onCancel = vi.fn();
    await renderWithFluent(
      <StockShortfallDialog {...defaultProps} onCancel={onCancel} />,
    );

    await userEvent.click(screen.getByText('Cancel Sale'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  // ── Confirm button — success ─────────────────────────────────────

  it('calls completeSaleWithResolvedShortfalls and onComplete on confirm success', async () => {
    const onComplete = vi.fn();
    mockCompleteSaleWithResolvedShortfalls.mockResolvedValueOnce({
      saleId: 'sale-1',
      total: null,
      lineCount: 1,
    });

    await renderWithFluent(
      <StockShortfallDialog {...defaultProps} onComplete={onComplete} />,
    );

    await userEvent.click(screen.getByText('Confirm & Continue'));

    await waitFor(() => {
      expect(mockCompleteSaleWithResolvedShortfalls).toHaveBeenCalledTimes(1);
    });

    // Verify the first argument is the session token
    const callArgs = mockCompleteSaleWithResolvedShortfalls.mock.calls[0];
    expect(callArgs).toBeDefined();
    expect(callArgs![0]).toBe('mock-session-token');

    // Verify resolutions are passed
    const argsPayload = callArgs![1] as { resolutions: Array<{ sku: string }> };
    expect(argsPayload.resolutions).toBeDefined();
    expect(argsPayload.resolutions).toHaveLength(1);
    expect(argsPayload.resolutions[0]!.sku).toBe('SKU-001');

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  // Shortfall receipt gap: the retry commits a REAL sale, but onComplete
  // was called with no arguments, so PaymentModal could never build the
  // receipt preview the normal completion path shows. The dialog must
  // forward the CompleteSaleResult.
  it('forwards the CompleteSaleResult to onComplete (receipt parity)', async () => {
    const onComplete = vi.fn();
    const result = { saleId: 'sale-77', total: { minor_units: 9000, currency: 'IDR' }, lineCount: 2 };
    mockCompleteSaleWithResolvedShortfalls.mockResolvedValueOnce(result);

    await renderWithFluent(
      <StockShortfallDialog {...defaultProps} onComplete={onComplete} />,
    );

    await userEvent.click(screen.getByText('Confirm & Continue'));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
    expect(onComplete).toHaveBeenCalledWith(result);
  });

  it('resolves split-mode allocations correctly on confirm', async () => {
    const onComplete = vi.fn();
    mockCompleteSaleWithResolvedShortfalls.mockResolvedValueOnce({
      saleId: 'sale-1',
      total: null,
      lineCount: 1,
    });

    await renderWithFluent(
      <StockShortfallDialog {...defaultProps} onComplete={onComplete} />,
    );

    // Toggle to split mode
    await userEvent.click(screen.getByText('Split across locations'));

    // Set qty=10 for the first alternative (max=17)
    const inputs = screen.getAllByRole('spinbutton');
    await userEvent.clear(inputs[0]!);
    await userEvent.type(inputs[0]!, '10');

    await waitFor(() => {
      expect(inputs[0]!).toHaveValue(10);
    });

    // Confirm
    await userEvent.click(screen.getByText('Confirm & Continue'));

    await waitFor(() => {
      expect(mockCompleteSaleWithResolvedShortfalls).toHaveBeenCalledTimes(1);
    });

    const mockCalls = mockCompleteSaleWithResolvedShortfalls.mock.calls;
    const argsPayload = mockCalls[0]![1] as { resolutions: Array<{ sku: string; allocations: Array<{ locationId: string; qty: number }> }> };
    expect(argsPayload.resolutions).toHaveLength(1);

    const resolution = argsPayload.resolutions[0]!;
    expect(resolution.sku).toBe('SKU-001');

    // Should have 2 allocations: 10 from alt-1 + 10 auto-filled from primary.
    // The sum must be the REQUESTED qty (20), not the deficit (17):
    // plan_resolution_deductions compares the sum against line.qty
    // (crates/kasirmu-core/src/db/sales_lifecycle.rs:246-249) and the
    // resolution branch REPLACES the primary deduction, so the allocation
    // total has to cover the whole line.
    expect(resolution.allocations).toHaveLength(2);
    const altAlloc = resolution.allocations.find(
      (a) => a.locationId === 'alt-1',
    );
    const primaryAlloc = resolution.allocations.find(
      (a) => a.locationId === 'main-store',
    );
    expect(altAlloc?.qty).toBe(10);
    expect(primaryAlloc?.qty).toBe(10);
    expect(
      resolution.allocations.reduce((s, a) => s + a.qty, 0),
    ).toBe(20);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  // ── Confirm button — error ───────────────────────────────────────

  it('shows error message when resolution fails', async () => {
    mockCompleteSaleWithResolvedShortfalls.mockRejectedValueOnce(
      new Error('Insufficient stock at all locations'),
    );

    await renderWithFluent(<StockShortfallDialog {...defaultProps} />);

    await userEvent.click(screen.getByText('Confirm & Continue'));

    await waitFor(() => {
      expect(
        screen.getByText('Something went wrong. Please try again.'),
      ).toBeInTheDocument();
    });
  });

  it('renders error with role="alert"', async () => {
    mockCompleteSaleWithResolvedShortfalls.mockRejectedValueOnce(
      new Error('Network failure'),
    );

    await renderWithFluent(<StockShortfallDialog {...defaultProps} />);

    await userEvent.click(screen.getByText('Confirm & Continue'));

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveTextContent('Something went wrong. Please try again.');
    });
  });

  it('allows negative stock checkbox to be checked and confirms successfully', async () => {
    const onComplete = vi.fn();
    mockCompleteSaleWithResolvedShortfalls.mockResolvedValueOnce({
      saleId: 'sale-1',
      total: null,
      lineCount: 1,
    });

    await renderWithFluent(
      <StockShortfallDialog
        {...defaultProps}
        shortfallResult={partialStockResult({
          shortfalls: [shortfall({ alternatives: [] })],
        })}
        onComplete={onComplete}
      />,
    );

    // Check allow-negative checkbox
    const checkbox = screen.getByRole('checkbox');
    await userEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    // Confirm
    await userEvent.click(screen.getByText('Confirm & Continue'));

    await waitFor(() => {
      expect(mockCompleteSaleWithResolvedShortfalls).toHaveBeenCalledTimes(1);
    });

    const argsPayload = mockCompleteSaleWithResolvedShortfalls.mock.calls[0]![1] as {
      resolutions: Array<{ sku: string; allocations: Array<{ locationId: string; qty: number }> }>;
      lines: Array<{ sku: string; qty: number; unitPriceMinor: number; unitPriceCurrency?: string }>;
    };
    expect(argsPayload.resolutions).toHaveLength(1);
    // FRONTEND-03 follow-up: the dialog must pass the line currency
    // through to the second command untouched.
    expect(argsPayload.lines[0]).toMatchObject({
      sku: 'SKU-001',
      unitPriceMinor: 5000,
      unitPriceCurrency: 'USD',
    });
    const resolution = argsPayload.resolutions[0]!;
    // With no alternatives, allocation falls back to primaryLocationId
    expect(resolution.sku).toBe('SKU-001');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('toggles split mode back to simple mode', async () => {
    await renderWithFluent(<StockShortfallDialog {...defaultProps} />);

    // Switch to split mode
    await userEvent.click(screen.getByText('Split across locations'));
    expect(screen.getByText('Use single location')).toBeInTheDocument();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);

    // Switch back to simple mode
    await userEvent.click(screen.getByText('Use single location'));
    expect(screen.getByText('Split across locations')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('handles multiple shortfalls with mixed modes', async () => {
    mockCompleteSaleWithResolvedShortfalls.mockResolvedValueOnce({
      saleId: 'sale-1',
      total: null,
      lineCount: 2,
    });

    await renderWithFluent(
      <StockShortfallDialog
        {...defaultProps}
        shortfallResult={partialStockResult({
          shortfalls: [
            shortfall({ sku: 'SKU-001', productName: 'Product A' }),
            shortfall({ sku: 'SKU-002', productName: 'Product B', alternatives: [] }),
          ],
        })}
      />,
    );

    // First shortfall: switch to split mode
    const splitToggle = screen.getAllByText('Split across locations');
    await userEvent.click(splitToggle[0]!);
    expect(screen.getByText('Use single location')).toBeInTheDocument();

    // Second shortfall has no alternatives — no radio buttons shown
    expect(screen.queryAllByRole('radio')).toHaveLength(0);

    // Confirm
    await userEvent.click(screen.getByText('Confirm & Continue'));

    await waitFor(() => {
      expect(mockCompleteSaleWithResolvedShortfalls).toHaveBeenCalledTimes(1);
    });

    const argsPayload = mockCompleteSaleWithResolvedShortfalls.mock.calls[0]![1] as {
      resolutions: Array<{ sku: string; allocations: Array<{ locationId: string; qty: number }> }>;
    };
    expect(argsPayload.resolutions).toHaveLength(2);
  });

  // ── Checkout attempt id (COR-7 replay guard) ─────────────────────────
  //
  // This dialog is a *retry* of the submission that produced the shortfall, so
  // it must forward the caller's attempt id unchanged. Nothing else in the
  // payload ties the two calls together — the dialog synthesises a fresh
  // `resolved-${Date.now()}` cartId on every submit — so if the id were
  // re-minted here, a first submission that committed but lost its response
  // would be replayed as a second, independent sale.

  describe('checkout attempt id', () => {
    it('forwards the attempt id of the submission that produced the shortfall', async () => {
      mockCompleteSaleWithResolvedShortfalls.mockResolvedValueOnce({
        saleId: 'sale-1',
        total: null,
        lineCount: 1,
      });

      await renderWithFluent(
        <StockShortfallDialog {...defaultProps} attemptId="attempt-abc" />,
      );
      await userEvent.click(screen.getByText('Confirm & Continue'));

      await waitFor(() => {
        expect(mockCompleteSaleWithResolvedShortfalls).toHaveBeenCalledTimes(1);
      });
      const payload = mockCompleteSaleWithResolvedShortfalls.mock.calls[0]![1] as {
        attemptId?: string;
      };
      expect(payload.attemptId).toBe('attempt-abc');
    });

    it('sends the SAME attempt id on a retry after a failed submit', async () => {
      mockCompleteSaleWithResolvedShortfalls
        .mockRejectedValueOnce(new Error('Network failure'))
        .mockResolvedValueOnce({ saleId: 'sale-1', total: null, lineCount: 1 });

      await renderWithFluent(
        <StockShortfallDialog {...defaultProps} attemptId="attempt-abc" />,
      );
      await userEvent.click(screen.getByText('Confirm & Continue'));
      await waitFor(() => {
        expect(mockCompleteSaleWithResolvedShortfalls).toHaveBeenCalledTimes(1);
      });

      await userEvent.click(screen.getByText('Confirm & Continue'));
      await waitFor(() => {
        expect(mockCompleteSaleWithResolvedShortfalls).toHaveBeenCalledTimes(2);
      });

      const ids = mockCompleteSaleWithResolvedShortfalls.mock.calls.map(
        (c) => (c[1] as { attemptId?: string }).attemptId,
      );
      expect(ids).toEqual(['attempt-abc', 'attempt-abc']);
    });

    it('omits attemptId entirely when the caller has none', async () => {
      mockCompleteSaleWithResolvedShortfalls.mockResolvedValueOnce({
        saleId: 'sale-1',
        total: null,
        lineCount: 1,
      });

      await renderWithFluent(<StockShortfallDialog {...defaultProps} />);
      await userEvent.click(screen.getByText('Confirm & Continue'));

      await waitFor(() => {
        expect(mockCompleteSaleWithResolvedShortfalls).toHaveBeenCalledTimes(1);
      });
      const payload = mockCompleteSaleWithResolvedShortfalls.mock.calls[0]![1] as Record<string, unknown>;
      // Absent, not null: the backend treats a missing key as "no guard
      // requested", and an explicit null would sit in the same column that
      // already holds NULL rows which SQLite considers mutually distinct.
      expect('attemptId' in payload).toBe(false);
    });
  });
});
