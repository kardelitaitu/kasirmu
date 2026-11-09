import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProvidersSync, rerenderWithProviders } from '@/__tests__/test-utils/render';
import inventoryFtl from '@/locales/inventory.ftl?raw';

// ── Mocks ─────────────────────────────────────────────────────────

vi.mock('@/api/inventory', () => ({
  listInventoryLocations: vi.fn(),
  getActiveInventoryShift: vi.fn(),
  startInventoryShift: vi.fn(),
  endInventoryShift: vi.fn(),
  listInventoryTransactions: vi.fn(),
  listInventoryTransactionsForShift: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    session: { user_id: 'user-1', display_name: 'Test Cashier', role_name: 'cashier' },
    sessionToken: 'mock-session-token',
  }),
}));

// Mutable so a test can SWITCH STORES: ShiftBar's location/shift load depends
// on sessionToken, so changing it starts a second read while the first is in flight.
const wsState = vi.hoisted(() => ({ sessionToken: 'mock-session-token' }));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    sessionToken: wsState.sessionToken,
    currentInstanceId: 'inst-1',
  }),
}));

import ShiftBar from '@/features/inventory/ShiftBar';
import {
  listInventoryLocations,
  getActiveInventoryShift,
  startInventoryShift,
  endInventoryShift,
  listInventoryTransactions,
  listInventoryTransactionsForShift,
} from '@/api/inventory';

const mockLocations = listInventoryLocations as ReturnType<typeof vi.fn>;
const mockGetActiveShift = getActiveInventoryShift as ReturnType<typeof vi.fn>;
const mockStartShift = startInventoryShift as ReturnType<typeof vi.fn>;
const mockEndShift = endInventoryShift as ReturnType<typeof vi.fn>;
const mockListTransactions = listInventoryTransactions as ReturnType<typeof vi.fn>;
const mockListTransactionsForShift = listInventoryTransactionsForShift as ReturnType<typeof vi.fn>;

// ── Test data ─────────────────────────────────────────────────────

const locations = [
  { id: 'loc-1', name: 'Main Warehouse', type: 'warehouse', description: '', is_active: true, created_at: '', updated_at: '' },
  { id: 'loc-2', name: 'Store Front', type: 'store', description: '', is_active: true, created_at: '', updated_at: '' },
];

const activeShift = {
  id: 'shift-active-1',
  user_id: 'user-1',
  location_id: 'loc-1',
  terminal_id: null,
  started_at: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
  ended_at: null,
  status: 'active' as const,
  notes: 'Evening count',
};

const transactions = [
  { id: 'tx-1', type: 'manual-adjustment', location_id: 'loc-1', staff_id: 'user-1', transfer_id: null, purchase_order_id: null, notes: 'Restock', created_at: new Date(Date.now() - 1800000).toISOString() },
  { id: 'tx-2', type: 'stock-count', location_id: 'loc-1', staff_id: 'user-1', transfer_id: null, purchase_order_id: null, notes: 'Count', created_at: new Date(Date.now() - 900000).toISOString() },
];

describe('ShiftBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // A test that switches stores mutates this; every other case needs the
    // original token or startInventoryShift is called with the wrong one.
    wsState.sessionToken = 'mock-session-token';
    mockLocations.mockResolvedValue(locations);
    mockGetActiveShift.mockResolvedValue(null);
    mockStartShift.mockResolvedValue(activeShift);
    mockEndShift.mockResolvedValue(undefined);
    mockListTransactions.mockResolvedValue([]);
    mockListTransactionsForShift.mockResolvedValue([]);
  });

  // ── Empty / Start Form State ──────────────────────────────────

  // A store switch must not leave the location dropdown pointing into the store
// the cashier just LEFT. `selectedLocationId` is what `handleStartShift` passes
// to `startInventoryShift`, and core opens the store DB from the session without
// checking the location belongs to it, so a stale id reaches the write.
//
// The stale read resolves with DISTINCTLY DIFFERENT locations -- same values would
// make this pass with the guard removed, because the late write would be
// indistinguishable from the correct one.
it('ignores a slower location load from the previous store after a switch', async () => {
  let releaseStale: (v: unknown) => void = () => {};
  const stalePending = new Promise((resolve) => { releaseStale = resolve; });

  mockGetActiveShift.mockResolvedValue(null);
  // First call: held open, will answer with the PREVIOUS store's locations.
  mockLocations.mockImplementationOnce(() => stalePending);

  const result = renderWithProvidersSync(<ShiftBar />, inventoryFtl);

  // Switch stores while the first read is outstanding. The re-render must go
  // through `rerenderWithProviders` -- the raw testing-library `rerender` replaces
  // the root WITHOUT the providers and anything consuming a context throws.
  mockLocations.mockResolvedValueOnce([
    { id: 'loc-b', name: 'Store B Warehouse', type: 'warehouse', description: '', is_active: true, created_at: '', updated_at: '' },
  ]);
  wsState.sessionToken = 'mock-session-token-2';
  await act(async () => { rerenderWithProviders(result, <ShiftBar />, inventoryFtl); });

  await waitFor(() => {
    expect(screen.getByRole('option', { name: /Store B Warehouse/ })).toBeTruthy();
  });

  // Now let the stale store-A read settle, after store B already won.
  await act(async () => {
    releaseStale([
      { id: 'loc-a', name: 'Store A Warehouse', type: 'warehouse', description: '', is_active: true, created_at: '', updated_at: '' },
    ]);
    await stalePending;
  });

  // Store B's location survives; store A's never appears.
  expect(screen.getByRole('option', { name: /Store B Warehouse/ })).toBeTruthy();
  expect(screen.queryByRole('option', { name: /Store A Warehouse/ })).toBeNull();
});

it('shows start form when no active shift exists', async () => {
    renderWithProvidersSync(<ShiftBar />, inventoryFtl);
    await waitFor(() => {
      expect(screen.getByText('Start Inventory Shift')).toBeInTheDocument();
    });
    expect(screen.getByText('Start Shift')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /location/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /notes/i })).toBeInTheDocument();
  });

  it('loads locations into the dropdown', async () => {
    renderWithProvidersSync(<ShiftBar />, inventoryFtl);
    await waitFor(() => {
      const select = screen.getByRole('combobox', { name: /location/i });
      expect(select).toBeInTheDocument();
      // Should have both location options
      expect(select).toContainHTML('Main Warehouse');
      expect(select).toContainHTML('Store Front');
    });
  });

  it('calls startInventoryShift on form submit', async () => {
    const user = userEvent.setup();
    renderWithProvidersSync(<ShiftBar />, inventoryFtl);

    await waitFor(() => {
      expect(screen.getByText('Start Shift')).toBeInTheDocument();
    });

    // Select a location
    const select = screen.getByRole('combobox', { name: /location/i });
    await user.selectOptions(select, 'loc-2');

    // Enter notes
    const notesInput = screen.getByRole('textbox', { name: /notes/i });
    await user.type(notesInput, 'Night shift');

    // Submit
    await user.click(screen.getByText('Start Shift'));

    await waitFor(() => {
      expect(mockStartShift).toHaveBeenCalledWith(
        'mock-session-token', 'loc-2', 'Night shift'
      );
    });
  });

  // A second Start Shift submit while the first is in flight must not re-send.
  //
  // core `start_inventory_shift` refuses a duplicate: it counts the user's active
  // shifts at that location and returns Validation when one exists
  // (crates/kasirmu-core/src/db/inventory.rs:396-408), backed by the partial unique
  // index `idx_inv_shifts_active_per_user_location` on
  // `(user_id, location_id) WHERE status = 'active'` (20260813_init.sql:1134). So the
  // shift is NOT opened twice -- but the second call's rejection lands in
  // handleStartShift's catch and raises 'Failed to start shift' on a shift that DID
  // open, leaving the operator on the start form for a shift that is running. The
  // mirror of the End Shift double tap (round 136) in the same component.
  it('sends one start-shift call for a double submit while the first is in flight', async () => {
    let releaseFirst: ((v: unknown) => void) | undefined;
    const heldFirst = new Promise((resolve) => { releaseFirst = resolve; });
    mockStartShift.mockImplementationOnce(() => heldFirst as never);
    // The backend's real answer to a second start: the user already has one open.
    mockStartShift.mockRejectedValueOnce(new Error('user already has an active inventory shift'));

    renderWithProvidersSync(<ShiftBar />, inventoryFtl);
    await waitFor(() => {
      expect(screen.getByText('Start Shift')).toBeInTheDocument();
    });

    const form = screen.getByText('Start Shift').closest('form')!;
    // fireEvent, NOT user.click: userEvent awaits its own act(), which flushes the
    // pending promise chain, so the first start would already have settled and the two
    // submits would never overlap. Measured in round 136 on the End button.
    // SHAPE 3 (round 139): BOTH submits inside ONE act() batch. Sequential `fireEvent`
    // wraps each dispatch in its own act(), so React commits `setStartShiftPending(true)`
    // between them and the second is refused by the disabled button -- a genuine double
    // submit is two dispatches in one task, before re-render. Batching removes the
    // intervening commit, which is the whole point.
    await act(async () => {
      form.querySelector('button[type=submit]')?.removeAttribute('disabled');
      fireEvent.submit(form);
      form.querySelector('button[type=submit]')?.removeAttribute('disabled');
      fireEvent.submit(form);
    });

    expect(
      mockStartShift.mock.calls.length,
      'a second submit re-sent the start while the first was still in flight; the ' +
        'backend rejects the duplicate and handleStartShift reports a failed shift open',
    ).toBe(1);

    releaseFirst?.(activeShift);
    await act(async () => { await heldFirst; });

    // The shift that DID open is shown as running.
    await waitFor(() => {
      expect(screen.getByText('End Shift')).toBeInTheDocument();
    });
  });

  // As with the End button, the guard's own case cannot see the ATTRIBUTE: a
  // fireEvent submit bypasses a disabled submit button, so removing `disabled`
  // leaves the double-submit case green (measured -- ref-only red, disabled-only
  // green, so the ref is what the call-count assertion actually tests). The
  // attribute is what the operator sees, so it is asserted separately.
  it('disables the Start Shift button while the open is in flight', async () => {
    let releaseFirst: ((v: unknown) => void) | undefined;
    const heldFirst = new Promise((resolve) => { releaseFirst = resolve; });
    mockStartShift.mockImplementationOnce(() => heldFirst as never);

    renderWithProvidersSync(<ShiftBar />, inventoryFtl);
    await waitFor(() => {
      expect(screen.getByText('Start Shift')).toBeInTheDocument();
    });

    const startBtn = screen.getByText('Start Shift').closest('button')!;
    expect(startBtn).not.toBeDisabled();

    fireEvent.submit(screen.getByText('Start Shift').closest('form')!);
    await waitFor(() => {
      expect(startBtn).toBeDisabled();
    });

    releaseFirst?.(activeShift);
    await act(async () => { await heldFirst; });
  });

  // ── Active Shift State ────────────────────────────────────────

  it('shows active shift info with timer and end button', async () => {
    mockGetActiveShift.mockResolvedValue(activeShift);
    renderWithProvidersSync(<ShiftBar />, inventoryFtl);

    await waitFor(() => {
      // Fluent interpolates as "Test Cashier — Main Warehouse — Started 01:00:00"
      expect(screen.getByText(/Main Warehouse/)).toBeInTheDocument();
      expect(screen.getByText(/Test Cashier/)).toBeInTheDocument();
    });
    expect(screen.getByText('End Shift')).toBeInTheDocument();
  });

  it('calls onShiftChange callback when shift is loaded', async () => {
    const onShiftChange = vi.fn();
    mockGetActiveShift.mockResolvedValue(activeShift);
    renderWithProvidersSync(<ShiftBar onShiftChange={onShiftChange} />, inventoryFtl);

    await waitFor(() => {
      expect(onShiftChange).toHaveBeenCalledWith(activeShift);
    });
  });

  // ── End Shift Flow ────────────────────────────────────────────

  it('shows summary modal after ending shift', async () => {
    const user = userEvent.setup();
    mockGetActiveShift.mockResolvedValue(activeShift);
    mockListTransactions.mockResolvedValue(transactions);
    renderWithProvidersSync(<ShiftBar />, inventoryFtl);

    // Wait for active shift to load
    await waitFor(() => {
      expect(screen.getByText('End Shift')).toBeInTheDocument();
    });

    // Click End Shift
    await user.click(screen.getByText('End Shift'));

    // Verify endInventoryShift was called
    await waitFor(() => {
      expect(mockEndShift).toHaveBeenCalledWith('mock-session-token', activeShift.id);
    });

    // Summary modal should appear
    await waitFor(() => {
      expect(screen.getByText('Shift Summary')).toBeInTheDocument();
      // The copy names the SCOPE the backend actually filters on: the read is
      // `staff_id = session user AND location_id AND created_at >= start`
      // (crates/kasirmu-core/src/db/inventory.rs:789), so it is one cashier's movements,
      // not the location's. The old string promised a whole-location register.
      expect(
        screen.getByText('Your transactions at this location since this shift started:'),
      ).toBeInTheDocument();
    });
  });

  // A second End Shift tap while the first is in flight must not re-send.
  //
  // core `end_inventory_shift` updates `WHERE status = 'active'` and
  // returns NotFound when 0 rows change (crates/kasirmu-core/src/db/inventory.rs:434),
  // so the double click does NOT end the shift twice -- but the SECOND call's
  // rejection lands in handleEndShift's catch, which raises an ERROR toast reading
  // as if the end had failed when the shift is already closed. The operator sees a
  // failure on a successful operation and the summary modal was already dismissed
  // in favour of that message. Same re-entry class as useAutoQr.handleAutoReissue
  // (round 124) and usePosHeldCarts.handleOpenBill (round 126).
  it('sends one end-shift call for a double tap while the first is in flight', async () => {
    mockGetActiveShift.mockResolvedValue(activeShift);
    // The backend's real answer to a second end: the row is no longer 'active'.
    mockEndShift
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('active_inventory_shift not found'));
    // Hold the FIRST end open so both taps land inside the same in-flight window.
    let releaseFirst: ((v: unknown) => void) | undefined;
    const heldFirst = new Promise((resolve) => { releaseFirst = resolve; });
    mockEndShift.mockImplementationOnce(() => heldFirst as never);

    renderWithProvidersSync(<ShiftBar />, inventoryFtl);
    await waitFor(() => {
      expect(screen.getByText('End Shift')).toBeInTheDocument();
    });

    const endBtn = screen.getByText('End Shift');
    // fireEvent, NOT user.click. userEvent awaits its own act(), which flushes the
    // pending promise chain: MEASURED here, the first endInventoryShift had already
    // SETTLED before the second click, so activeShift was null by then and the taps
    // never overlapped. fireEvent does not await, so both land inside the first
    // call's in-flight window -- which is what a real double tap does.
    // SHAPE 3 (round 139): BOTH taps inside ONE act() batch. The sequential form was a
    // WEAKER test than it looked -- `fireEvent` wraps each dispatch in its own act(), so
    // React commits `setEndShiftPending(true)` between the taps and the second lands
    // disabled. A genuine double tap is two dispatches in one task, before re-render, and
    // that is what this must cover. Round 139 proved the point on ShiftManagementScreen:
    // sequential `fireEvent` reported 1 call on a path that really sent 2.
    await act(async () => {
      fireEvent.click(endBtn);
      // The disabled flag React set is not yet authoritative for a live double tap;
      // dropping it sends the second dispatch to the handler the way a real one would.
      endBtn.removeAttribute('disabled');
      fireEvent.click(endBtn);
    });

    releaseFirst?.(undefined);
    await act(async () => { await heldFirst; });

    await waitFor(() => {
      expect(screen.getByText('Shift Summary')).toBeInTheDocument();
    });

    expect(
      mockEndShift.mock.calls.length,
      'a second tap re-sent the end while the first was still in flight; the backend ' +
        'rejects the replay and handleEndShift reports it as a failed shift close',
    ).toBe(1);
  });

  // The guard above is invisible: nothing else proves the button is actually
  // DISABLED while the end is in flight. Without this, removing `disabled` leaves
  // every case green -- measured: ref-only and disabled-only are each sufficient to
  // stop the second CALL, so the ref guard's own test cannot see the attribute.
  it('disables the End Shift button while the end is in flight', async () => {
    mockGetActiveShift.mockResolvedValue(activeShift);
    let releaseFirst: ((v: unknown) => void) | undefined;
    const heldFirst = new Promise((resolve) => { releaseFirst = resolve; });
    mockEndShift.mockImplementationOnce(() => heldFirst as never);

    renderWithProvidersSync(<ShiftBar />, inventoryFtl);
    await waitFor(() => {
      expect(screen.getByText('End Shift')).toBeInTheDocument();
    });

    const endBtn = screen.getByText('End Shift').closest('button')!;
    expect(endBtn).not.toBeDisabled();

    fireEvent.click(endBtn);
    await waitFor(() => {
      expect(endBtn).toBeDisabled();
    });

    // Releasing returns the button to service, so a failed end can be retried.
    releaseFirst?.(undefined);
    await act(async () => { await heldFirst; });
  });

  it('shows empty state in summary when no transactions exist', async () => {
    const user = userEvent.setup();
    mockGetActiveShift.mockResolvedValue(activeShift);
    mockListTransactions.mockResolvedValue([]);
    renderWithProvidersSync(<ShiftBar />, inventoryFtl);

    await waitFor(() => {
      expect(screen.getByText('End Shift')).toBeInTheDocument();
    });

    await user.click(screen.getByText('End Shift'));

    await waitFor(() => {
      expect(screen.getByText('No transactions recorded.')).toBeInTheDocument();
    });
  });

  it('closes summary modal when Close button is clicked', async () => {
    const user = userEvent.setup();
    mockGetActiveShift.mockResolvedValue(activeShift);
    renderWithProvidersSync(<ShiftBar />, inventoryFtl);

    await waitFor(() => {
      expect(screen.getByText('End Shift')).toBeInTheDocument();
    });

    await user.click(screen.getByText('End Shift'));

    await waitFor(() => {
      expect(screen.getByText('Shift Summary')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Cancel'));

    await waitFor(() => {
      expect(screen.queryByText('Shift Summary')).not.toBeInTheDocument();
    });
  });
});
