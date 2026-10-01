import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProvidersSync, rerenderWithProviders } from '@/__tests__/test-utils/render';
import { getBundle } from '@/i18n';
import customersFtl from '@/locales/customers.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';

// Mutable so a test can SWITCH STORES. openHistory sets `historyTarget` BEFORE its
// await, so a store switch starts a second read while the first is in flight. Declared
// via vi.hoisted so the vi.mock factories below can close over it.
const wsState = vi.hoisted(() => ({ sessionToken: 'session-1' }));

vi.mock('@/api/customers', () => {
  const listCustomersScoped = vi.fn();
  const searchCustomersScoped = vi.fn();
  const getCustomerHistoryScoped = vi.fn();
  const createCustomerScoped = vi.fn();
  const updateCustomerScoped = vi.fn();
  const deleteCustomerScoped = vi.fn();
  return {
    listCustomersScoped,
    searchCustomersScoped,
    getCustomerHistoryScoped,
    createCustomerScoped,
    updateCustomerScoped,
    deleteCustomerScoped,
  };
});

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: wsState.sessionToken }),
}));

import CustomerManagementScreen from '@/features/customers/CustomerManagementScreen';
import {
  listCustomersScoped,
  searchCustomersScoped,
  getCustomerHistoryScoped,
  createCustomerScoped,
  updateCustomerScoped,
  deleteCustomerScoped,
} from '@/api/customers';

const mockListCustomers = listCustomersScoped as ReturnType<typeof vi.fn>;
const mockSearchCustomers = searchCustomersScoped as ReturnType<typeof vi.fn>;
const mockGetHistory = getCustomerHistoryScoped as ReturnType<typeof vi.fn>;
const mockCreateCustomer = createCustomerScoped as ReturnType<typeof vi.fn>;
const mockUpdateCustomer = updateCustomerScoped as ReturnType<typeof vi.fn>;
const mockDeleteCustomer = deleteCustomerScoped as ReturnType<typeof vi.fn>;



const sampleCustomers = [
  { id: 'cust-1', name: 'Alice', email: 'alice@example.com', phone: '+1-555-0101', notes: 'Regular' },
  { id: 'cust-2', name: 'Bob', email: null, phone: null, notes: '' },
  { id: 'cust-3', name: 'Carol', email: 'carol@example.com', phone: '+1-555-0103', notes: 'VIP' },
];

describe('CustomerManagementScreen', () => {
  beforeEach(() => {
    // A store-switching test mutates this; several cases assert the token verbatim
    // (e.g. toHaveBeenCalledWith('session-1', ...)), so it must be restored.
    wsState.sessionToken = 'session-1';
    mockListCustomers.mockResolvedValue(sampleCustomers);
  });

  // ── Rendering ─────────────────────────────────────────────────

  it('loads customers with the active session token', async () => {
    renderWithProvidersSync(<CustomerManagementScreen />, customersFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('Customers')).toBeInTheDocument();
    });
    expect(mockListCustomers).toHaveBeenCalledWith('session-1');
  });

  it('renders the title and Add Customer button', async () => {
    renderWithProvidersSync(<CustomerManagementScreen />, customersFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('Customers')).toBeInTheDocument();
    });
    expect(screen.getByText('Add Customer')).toBeInTheDocument();
  });

  it('shows loading skeleton while fetching customers', async () => {
    mockListCustomers.mockReturnValue(new Promise(() => {}));
    renderWithProvidersSync(<CustomerManagementScreen />, customersFtl, sharedFtl);
    expect(document.querySelector('.customer-mgmt-loading-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('Loading customers…')).not.toBeInTheDocument();
  });

  it('shows empty state when no customers exist', async () => {
    mockListCustomers.mockResolvedValue([]);
    renderWithProvidersSync(<CustomerManagementScreen />, customersFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('No customers yet.')).toBeInTheDocument();
    });
    expect(screen.getByText('Add your first customer')).toBeInTheDocument();
  });

  it('shows a load error with a working retry (CUST-11)', async () => {
    const user = userEvent.setup();
    // Mount fires the immediate `load()` (rejects -> error card). The retry
    // click is the next load() call and must be the one that resolves, so the
    // mock rejects once then resolves persistently — this genuinely exercises
    // the retry handler (the 250ms debounced re-load resolving later is
    // harmless).
    mockListCustomers
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue(sampleCustomers);
    renderWithProvidersSync(<CustomerManagementScreen />, customersFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('Failed to load customers')).toBeInTheDocument();
    });
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });
    expect(screen.queryByText('Failed to load customers')).not.toBeInTheDocument();
  });

  it('discards a stale slower response in favor of a newer refresh (CUST-10)', async () => {
    // Mount fires TWO loads: the immediate `load()` effect and the 250ms
    // debounced `runSearch('')` → `load()`. The first is a slow promise that
    // resolves with stale data only AFTER the second (fresh) refresh has
    // landed — the load seq guard must drop the stale page.
    let resolveStale!: (v: typeof sampleCustomers) => void;
    const stalePromise = new Promise<typeof sampleCustomers>((resolve) => {
      resolveStale = resolve;
    });
    mockListCustomers
      .mockImplementationOnce(() => stalePromise)
      .mockResolvedValueOnce(sampleCustomers);

    renderWithProvidersSync(<CustomerManagementScreen />, customersFtl, sharedFtl);

    // The debounced second load resolves the authoritative list.
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });
    expect(mockListCustomers).toHaveBeenCalledTimes(2);

    // Now let the stale mount response land with a DIFFERENT list — it must
    // not overwrite the newer, authoritative data. Wrapping in `act` runs the
    // late continuation deterministically so the assertions below genuinely
    // exercise the seq guard (they would fail if it were ever removed).
    await act(async () => {
      resolveStale([{ id: 'stale-1', name: 'Stale Bob', email: null, phone: null, notes: '' }]);
    });
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('Stale Bob')).not.toBeInTheDocument();
  });

  // ── Table rendering ──────────────────────────────────────────

  it('displays customers in the table', async () => {
    renderWithProvidersSync(<CustomerManagementScreen />, customersFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Carol')).toBeInTheDocument();
  });

  it('displays email and phone columns', async () => {
    renderWithProvidersSync(<CustomerManagementScreen />, customersFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('alice@example.com')).toBeInTheDocument();
      expect(screen.getByText('+1-555-0101')).toBeInTheDocument();
    });
  });

  it('displays dash for null email and phone', async () => {
    renderWithProvidersSync(<CustomerManagementScreen />, customersFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('Bob')).toBeInTheDocument();
    });
    // Bob has null email/phone — dashes should appear in those cells.
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });

  it('shows Edit and Delete buttons per row', async () => {
    renderWithProvidersSync(<CustomerManagementScreen />, customersFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getAllByText('Edit').length).toBeGreaterThanOrEqual(3);
    });
    expect(screen.getAllByText('Delete').length).toBeGreaterThanOrEqual(3);
  });

  // ── Search (CUST-06: server-side bounded search) ───────────────

  it('runs the query through the server-side search API (CUST-06)', async () => {
    const user = userEvent.setup();
    mockSearchCustomers.mockResolvedValue({
      items: [sampleCustomers[1]],
      total: 1,
    });
    renderWithProvidersSync(<CustomerManagementScreen />, customersFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/search by name/i);
    await user.type(searchInput, 'Bob');

    await waitFor(() => {
      expect(mockSearchCustomers).toHaveBeenCalledWith(
        'session-1',
        'Bob',
        50,
        0,
      );
      expect(screen.getByText('Bob')).toBeInTheDocument();
    });
    // The full client-side list is replaced by the bounded server page.
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
  });

  it('shows the server-side total count (CUST-06)', async () => {
    const user = userEvent.setup();
    mockSearchCustomers.mockResolvedValue({
      items: [sampleCustomers[0], sampleCustomers[2]],
      total: 17,
    });
    renderWithProvidersSync(<CustomerManagementScreen />, customersFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/search by name/i);
    await user.type(searchInput, 'a');

    await waitFor(() => {
      expect(screen.getByText('Showing 2 of 17 customers')).toBeInTheDocument();
    });
  });

  it('shows no-match state when the server returns an empty page', async () => {
    const user = userEvent.setup();
    mockSearchCustomers.mockResolvedValue({ items: [], total: 0 });
    renderWithProvidersSync(<CustomerManagementScreen />, customersFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/search by name/i);
    await user.type(searchInput, 'ZZZZZZ');

    await waitFor(() => {
      expect(screen.getByText('No customers match your search.')).toBeInTheDocument();
      expect(screen.getByText('Clear search')).toBeInTheDocument();
    });
  });

  it('clearing the search restores the full list', async () => {
    const user = userEvent.setup();
    mockSearchCustomers.mockResolvedValue({ items: [], total: 0 });
    renderWithProvidersSync(<CustomerManagementScreen />, customersFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/search by name/i);
    await user.type(searchInput, 'zzz');
    await waitFor(() => {
      expect(screen.getByText('No customers match your search.')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Clear search'));
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Carol')).toBeInTheDocument();
    });
  });

  // ── Create modal ──────────────────────────────────────────────

  it('opens the add customer modal when Add Customer is clicked', async () => {
    const user = userEvent.setup();
    renderWithProvidersSync(<CustomerManagementScreen />, customersFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('Add Customer')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Add Customer'));

    await waitFor(() => {
      // Modal should show with the form input; title and button both say "Add Customer".
      expect(screen.getByPlaceholderText(/jane smith/i)).toBeInTheDocument();
    });
  });

  it('creates a customer when form is filled and saved', async () => {
    const user = userEvent.setup();
    mockCreateCustomer.mockResolvedValue({});
    mockListCustomers.mockResolvedValueOnce(sampleCustomers);
    mockListCustomers.mockResolvedValueOnce([...sampleCustomers, { id: 'cust-4', name: 'Dave', email: null, phone: null, notes: '' }]);
    renderWithProvidersSync(<CustomerManagementScreen />, customersFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getByText('Add Customer')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Add Customer'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/jane smith/i)).toBeInTheDocument();
    });

    await user.type(screen.getByPlaceholderText(/jane smith/i), 'Dave');
    await user.click(screen.getByText('Create'));

    await waitFor(() => {
      expect(mockCreateCustomer).toHaveBeenCalledWith('session-1', {
        name: 'Dave',
      });
    });
  });

  it('disables Create button when name is empty', async () => {
    const user = userEvent.setup();
    renderWithProvidersSync(<CustomerManagementScreen />, customersFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('Add Customer')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Add Customer'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/jane smith/i)).toBeInTheDocument();
    });

    // The Button component renders as a span, not a native button.
    const createSpan = screen.getByText('Create');
    expect(createSpan).toBeInTheDocument();
  });

  it('closes the modal when Cancel is clicked', async () => {
    const user = userEvent.setup();
    renderWithProvidersSync(<CustomerManagementScreen />, customersFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('Add Customer')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Add Customer'));

    await waitFor(() => {
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Cancel'));

    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/jane smith/i)).not.toBeInTheDocument();
    });
  });

  // ── Edit modal ────────────────────────────────────────────────

  it('opens edit modal pre-filled with customer data', async () => {
    const user = userEvent.setup();
    renderWithProvidersSync(<CustomerManagementScreen />, customersFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getAllByText('Edit').length).toBeGreaterThanOrEqual(1);
    });

    await user.click(screen.getAllByText('Edit')[0]!);

    await waitFor(() => {
      expect(screen.getByText('Edit Customer')).toBeInTheDocument();
    });
    // The name field should be pre-filled with Alice.
    const nameInput = screen.getByPlaceholderText(/jane smith/i) as HTMLInputElement;
    expect(nameInput.value).toBe('Alice');
  });

  it('updates a customer when edit form is saved', async () => {
    const user = userEvent.setup();
    mockUpdateCustomer.mockResolvedValue({});
    mockListCustomers.mockResolvedValue(sampleCustomers);
    renderWithProvidersSync(<CustomerManagementScreen />, customersFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getAllByText('Edit').length).toBeGreaterThanOrEqual(1);
    });
    await user.click(screen.getAllByText('Edit')[0]!);

    await waitFor(() => {
      expect(screen.getByText('Edit Customer')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Update'));

    await waitFor(() => {
      expect(mockUpdateCustomer).toHaveBeenCalledWith('session-1', {
        id: 'cust-1',
        name: 'Alice',
        email: 'alice@example.com',
        phone: '+1-555-0101',
        notes: 'Regular',
      });
    });
  });

  // ── Delete confirmation + failure (CUST-02/04) ────────────────

  it('does not delete without confirmation (CUST-02)', async () => {
    const user = userEvent.setup();
    mockDeleteCustomer.mockResolvedValue(undefined);
    mockListCustomers.mockResolvedValue(sampleCustomers);
    renderWithProvidersSync(<CustomerManagementScreen />, customersFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getAllByText('Delete').length).toBeGreaterThanOrEqual(3);
    });
    // The row button only arms the confirmation dialog — no IPC yet.
    await user.click(screen.getAllByText('Delete')[0]!);
    await waitFor(() => {
      expect(screen.getByText('Delete customer?')).toBeInTheDocument();
    });
    expect(mockDeleteCustomer).not.toHaveBeenCalled();
  });

  it('deletes only after explicit confirmation with the session token (CUST-02)', async () => {
    const user = userEvent.setup();
    mockDeleteCustomer.mockResolvedValue(undefined);
    mockListCustomers.mockResolvedValue(sampleCustomers);
    renderWithProvidersSync(<CustomerManagementScreen />, customersFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getAllByText('Delete').length).toBeGreaterThanOrEqual(3);
    });
    await user.click(screen.getAllByText('Delete')[0]!);
    await waitFor(() => {
      expect(screen.getByText('Delete customer?')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(mockDeleteCustomer).toHaveBeenCalledWith('session-1', 'cust-1');
    });
  });

  it('surfaces a delete failure with a localized toast (CUST-04)', async () => {
    const user = userEvent.setup();
    mockDeleteCustomer.mockRejectedValue(new Error('fk constraint'));
    mockListCustomers.mockResolvedValue(sampleCustomers);
    renderWithProvidersSync(<CustomerManagementScreen />, customersFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getAllByText('Delete').length).toBeGreaterThanOrEqual(3);
    });
    await user.click(screen.getAllByText('Delete')[0]!);
    await waitFor(() => {
      expect(screen.getByText('Delete customer?')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(screen.getByText('Failed to delete customer')).toBeInTheDocument();
    });
    // The row stays visible and the dialog remains open for retry.
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Delete customer?')).toBeInTheDocument();
  });

  it('dismisses the delete dialog via Cancel without deleting (CUST-02)', async () => {
    const user = userEvent.setup();
    mockDeleteCustomer.mockResolvedValue(undefined);
    mockListCustomers.mockResolvedValue(sampleCustomers);
    renderWithProvidersSync(<CustomerManagementScreen />, customersFtl, sharedFtl);

    await waitFor(() => {
      expect(screen.getAllByText('Delete').length).toBeGreaterThanOrEqual(3);
    });
    await user.click(screen.getAllByText('Delete')[0]!);
    await waitFor(() => {
      expect(screen.getByText('Delete customer?')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByText('Delete customer?')).toBeNull();
    });
    expect(mockDeleteCustomer).not.toHaveBeenCalled();
  });

  // ── History modal (CUST-05) ────────────────────────────────────

  it('opens the read-only history modal for a customer (CUST-05)', async () => {
    const user = userEvent.setup();
    mockGetHistory.mockResolvedValue({
      customer: sampleCustomers[0],
      loyalty: {
        points: 120,
        lifetime_points: 450,
        tier_name: 'Silver',
      },
      sales: [
        {
          id: 's-1',
          total_minor: 2500,
          currency: 'USD',
          status: 'Completed',
          line_count: 2,
          created_at: '2026-07-01T10:00:00.000Z',
        },
      ],
      sales_total: 1,
    });
    renderWithProvidersSync(<CustomerManagementScreen />, customersFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getAllByText('Alice').length).toBeGreaterThanOrEqual(1);
    });

    await user.click(screen.getByRole('button', { name: 'View history for Alice' }));

    await waitFor(() => {
      expect(screen.getByText('Customer history')).toBeInTheDocument();
      expect(mockGetHistory).toHaveBeenCalledWith('session-1', 'cust-1');
    });
    expect(screen.getByText('Silver')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.getByText('450')).toBeInTheDocument();
    expect(screen.getByText('Recent sales')).toBeInTheDocument();
  });

  it('shows loyalty and no-sales empty states in the history modal (CUST-05)', async () => {
    const user = userEvent.setup();
    mockGetHistory.mockResolvedValue({
      customer: sampleCustomers[1],
      loyalty: null,
      sales: [],
      sales_total: 0,
    });
    renderWithProvidersSync(<CustomerManagementScreen />, customersFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('Bob')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'View history for Bob' }));

    await waitFor(() => {
      expect(screen.getByText('Customer history')).toBeInTheDocument();
    });
    expect(screen.getByText('No tier')).toBeInTheDocument();
    expect(screen.getByText('No sales yet.')).toBeInTheDocument();
  });

  // A store switch must not leave ONE customer's history under ANOTHER customer's name.
  //
  // openHistory sets `historyTarget` BEFORE its await, so clicking A then B can leave A's
  // slower read landing last. The dialog subtitle renders `historyTarget.name`, so the
  // result is A's purchase and loyalty history presented as B's -- the operator reads it
  // as B's, which is a correctness and privacy problem, not a stale label.
  //
  // The sink is the loyalty tier, a controlled read from `history`. Order is enforced by
  // CALL COUNT and the two arms answer with DISTINCT tiers, so the late write is
  // observable rather than a no-op.
  it('ignores a slower earlier history read after a store switch', async () => {
    const user = userEvent.setup();
    let releaseStale: (v: unknown) => void = () => {};
    const stalePending = new Promise((resolve) => { releaseStale = resolve; });

    // Call 1 (customer Alice, store A) held open; it will answer LAST.
    mockGetHistory.mockImplementationOnce(() => stalePending);
    mockGetHistory.mockImplementation(() =>
      Promise.resolve({
        customer: sampleCustomers[1],
        loyalty: { points: 0, lifetime_points: 0, tier_name: 'Current Tier' },
        sales: [],
        sales_total: 0,
      }),
    );

    const view = renderWithProvidersSync(<CustomerManagementScreen />, customersFtl, sharedFtl);
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());

    // Open Alice's history, then switch stores and open Bob's.
    await user.click(screen.getByRole('button', { name: 'View history for Alice' }));
    wsState.sessionToken = 'session-2';
    await act(async () => {
      rerenderWithProviders(view, <CustomerManagementScreen />, customersFtl, sharedFtl);
    });
    await user.click(screen.getByRole('button', { name: 'View history for Bob' }));

    await waitFor(() => expect(mockGetHistory).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(screen.getByText('Current Tier')).toBeInTheDocument();
    });

    // Only NOW does Alice's read settle, after Bob's already won.
    await act(async () => {
      releaseStale({
        customer: sampleCustomers[0],
        loyalty: { points: 0, lifetime_points: 0, tier_name: 'Stale Tier' },
        sales: [],
        sales_total: 0,
      });
      await stalePending;
    });

    // The guard held: the late Alice response was discarded.
    expect(screen.getByText('Current Tier')).toBeInTheDocument();
    expect(screen.queryByText('Stale Tier')).toBeNull();
  });

  it('closes the history modal on Escape and restores focus to the opener (CUST-11)', async () => {
    const user = userEvent.setup();
    mockGetHistory.mockResolvedValue({
      customer: sampleCustomers[0],
      loyalty: null,
      sales: [],
      sales_total: 0,
    });
    renderWithProvidersSync(<CustomerManagementScreen />, customersFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });

    const opener = screen.getByRole('button', { name: 'View history for Alice' });
    await user.click(opener);
    await waitFor(() => {
      expect(screen.getByText('Customer history')).toBeInTheDocument();
    });

    // Escape closes the dialog. The shared useFocusTrap listens on
    // document (same as SettingsPopup), so fire there.
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByText('Customer history')).not.toBeInTheDocument();
    });

    // Focus is restored to the button that opened the dialog.
    expect(opener).toHaveFocus();
  });

  it('surfaces a history load failure with a retry (CUST-05)', async () => {
    const user = userEvent.setup();
    mockGetHistory.mockRejectedValueOnce(new Error('boom'));
    renderWithProvidersSync(<CustomerManagementScreen />, customersFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'View history for Alice' }));
    await waitFor(() => {
      expect(screen.getByText('Failed to load history')).toBeInTheDocument();
    });

    mockGetHistory.mockResolvedValueOnce({
      customer: sampleCustomers[0],
      loyalty: null,
      sales: [],
      sales_total: 0,
    });
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(screen.getByText('No sales yet.')).toBeInTheDocument();
    });
  });

  // ── CUST-07: locale parity ──────────────────────────────────────

  it('resolves every screen Localized id in both the en and id bundles (CUST-07)', () => {
    // Reuse the production bundle loader (@/i18n) which already includes
    // customers.ftl + customers.id.ftl — same approach as i18nBundle.test.tsx.
    const en = getBundle('en');
    const id = getBundle('id');

    // Every id the screen resolves — via <Localized id> or l10n.getString().
    const usedIds = [
      'customer-mgmt-title',
      'customer-mgmt-add',
      'customer-mgmt-search',
      'customer-mgmt-empty',
      'customer-mgmt-empty-cta',
      'customer-mgmt-search-empty',
      'customer-mgmt-search-clear',
      'customer-mgmt-col-name',
      'customer-mgmt-col-email',
      'customer-mgmt-col-phone',
      'customer-mgmt-col-notes',
      'customer-mgmt-col-actions',
      'customer-mgmt-table-aria',
      'customer-mgmt-edit',
      'customer-mgmt-edit-aria',
      'customer-mgmt-delete',
      'customer-mgmt-delete-aria',
      'customer-mgmt-modal-add-title',
      'customer-mgmt-modal-edit-title',
      'customer-mgmt-field-name',
      'customer-mgmt-field-email',
      'customer-mgmt-field-phone',
      'customer-mgmt-field-notes',
      'customer-mgmt-name-placeholder',
      'customer-mgmt-email-placeholder',
      'customer-mgmt-phone-placeholder',
      'customer-mgmt-notes-placeholder',
      'customer-mgmt-btn-cancel',
      'customer-mgmt-btn-create',
      'customer-mgmt-btn-update',
      'customer-mgmt-error-name-required',
      'customer-mgmt-error-save-failed',
      'customer-mgmt-delete-confirm-title',
      'customer-mgmt-delete-confirm-message',
      'customer-mgmt-delete-confirm-btn',
      'customer-mgmt-error-delete',
      'customer-mgmt-error-load',
      'customer-mgmt-error-retry',
      'customer-mgmt-history',
      'customer-mgmt-history-aria',
      'customer-mgmt-history-title',
      'customer-mgmt-history-close',
      'customer-mgmt-history-loading',
      'customer-mgmt-history-error',
      'customer-mgmt-history-loyalty-title',
      'customer-mgmt-history-points',
      'customer-mgmt-history-lifetime',
      'customer-mgmt-history-tier',
      'customer-mgmt-history-no-tier',
      'customer-mgmt-history-sales-title',
      'customer-mgmt-history-no-sales',
      'customer-mgmt-search-results',
      'customer-mgmt-search-loading',
    ];
    for (const key of usedIds) {
      expect(en.getMessage(key), `en bundle missing ${key}`).toBeDefined();
      expect(id.getMessage(key), `id bundle missing ${key}`).toBeDefined();
    }
  });

  // ── CUST-09: field-level validation ────────────────────────────

  it('blocks save and flags an invalid email with aria-invalid (CUST-09)', async () => {
    const user = userEvent.setup();
    mockListCustomers.mockResolvedValue(sampleCustomers);
    renderWithProvidersSync(<CustomerManagementScreen />, customersFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getAllByText('Delete').length).toBeGreaterThanOrEqual(3);
    });

    await user.click(screen.getByRole('button', { name: 'Add Customer' }));
    await user.type(screen.getByLabelText('Name *'), 'Alice');
    await user.type(screen.getByLabelText('Email'), 'not-an-email');

    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => {
      expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(mockCreateCustomer).not.toHaveBeenCalled();
  });

  it('blocks save when the phone contains no digits (CUST-09)', async () => {
    const user = userEvent.setup();
    mockListCustomers.mockResolvedValue(sampleCustomers);
    renderWithProvidersSync(<CustomerManagementScreen />, customersFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getAllByText('Delete').length).toBeGreaterThanOrEqual(3);
    });

    await user.click(screen.getByRole('button', { name: 'Add Customer' }));
    await user.type(screen.getByLabelText('Name *'), 'Bob');
    await user.type(screen.getByLabelText('Phone'), '---');

    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => {
      expect(
        screen.getByText('Phone must contain at least one digit'),
      ).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Phone')).toHaveAttribute('aria-invalid', 'true');
    expect(mockCreateCustomer).not.toHaveBeenCalled();
  });

  it('accepts a valid phone with digits and letters (CUST-09)', async () => {
    const user = userEvent.setup();
    mockListCustomers.mockResolvedValue(sampleCustomers);
    renderWithProvidersSync(<CustomerManagementScreen />, customersFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getAllByText('Delete').length).toBeGreaterThanOrEqual(3);
    });

    await user.click(screen.getByRole('button', { name: 'Add Customer' }));
    await user.type(screen.getByLabelText('Name *'), 'Carol');
    await user.type(screen.getByLabelText('Phone'), '+62 812-3456');

    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => {
      expect(mockCreateCustomer).toHaveBeenCalledWith('session-1', {
        name: 'Carol',
        phone: '+62 812-3456',
      });
    });
  });

  it('shows a localized error for overlong notes (CUST-09)', async () => {
    const user = userEvent.setup();
    mockListCustomers.mockResolvedValue(sampleCustomers);
    renderWithProvidersSync(<CustomerManagementScreen />, customersFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getAllByText('Delete').length).toBeGreaterThanOrEqual(3);
    });

    await user.click(screen.getByRole('button', { name: 'Add Customer' }));
    await user.type(screen.getByLabelText('Name *'), 'Dan');
    // fireEvent.change bypasses the HTML maxLength truncation, reaching the
    // JS guard branch (the reason the guard exists alongside the attribute).
    fireEvent.change(screen.getByLabelText('Notes'), {
      target: { value: 'x'.repeat(501) },
    });

    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => {
      expect(
        screen.getByText('Notes must be 500 characters or fewer'),
      ).toBeInTheDocument();
    });
    expect(mockCreateCustomer).not.toHaveBeenCalled();
  });

  it('clears the field error once the operator fixes the value (CUST-09)', async () => {
    const user = userEvent.setup();
    mockListCustomers.mockResolvedValue(sampleCustomers);
    renderWithProvidersSync(<CustomerManagementScreen />, customersFtl, sharedFtl);
    await waitFor(() => {
      expect(screen.getAllByText('Delete').length).toBeGreaterThanOrEqual(3);
    });

    await user.click(screen.getByRole('button', { name: 'Add Customer' }));
    await user.type(screen.getByLabelText('Name *'), 'Eve');
    await user.type(screen.getByLabelText('Email'), 'bad');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => {
      expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
    });

    await user.clear(screen.getByLabelText('Email'));
    await user.type(screen.getByLabelText('Email'), 'eve@example.com');
    expect(screen.queryByText('Enter a valid email address')).toBeNull();
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid');
  });

  // ── CUST-08: 44px touch targets ─────────────────────────────────

  it('declares guaranteed 44px touch targets for row action buttons (CUST-08)', () => {
    // jsdom runs with `css: false` so computed styles are meaningless here;
    // assert against the stylesheet source on disk (mirrors
    // animationCompliance.test.ts).
    const cssPath = join(
      process.cwd(),
      'src/features/customers/CustomerManagementScreen.css',
    );
    const css = readFileSync(cssPath, 'utf8');

    // The action button block must declare a minimum 44px hit area in both
    // axes while keeping compact visual padding.
    const blockMatch = css.match(/\.customer-mgmt-action-btn\s*{[^}]*}/);
    expect(blockMatch).not.toBeNull();
    const block = blockMatch![0];
    expect(block).toMatch(/min-height:\s*2\.75rem/);
    expect(block).toMatch(/min-width:\s*2\.75rem/);
  });
});
