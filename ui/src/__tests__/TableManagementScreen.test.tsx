import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithWorkspace, MOCK_SESSION_TOKEN } from '@/test-utils';
import userEvent from '@testing-library/user-event';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { ReactLocalization, LocalizationProvider } from '@fluent/react';
import TableManagementScreen from '@/features/tables/TableManagementScreen';
import tablesFtl from '@/locales/tables.ftl?raw';
import type { Table } from '@/api/tables';
import type * as SalesApi from '@/api/sales';

const {
  mockListTables,
  mockListSections,
  mockUpdateTableStatus,
  mockReleaseTable,
  mockListOpenBills,
  mockCreateTable,
  mockUpdateTable,
  mockDeleteTable,
  mockGetHeldCart,
  mockHoldCart,
  mockDeleteHeldCart,
  mockPrintSalesReceipt,
} = vi.hoisted(() => ({
  mockListTables: vi.fn(),
  mockListSections: vi.fn(),
  mockUpdateTableStatus: vi.fn(),
  mockReleaseTable: vi.fn(),
  mockListOpenBills: vi.fn(),
  mockCreateTable: vi.fn(),
  mockUpdateTable: vi.fn(),
  mockDeleteTable: vi.fn(),
  mockGetHeldCart: vi.fn(),
  mockHoldCart: vi.fn(),
  mockDeleteHeldCart: vi.fn(),
  mockPrintSalesReceipt: vi.fn(),
}));

vi.mock('@/api/sales', async (importOriginal) => {
  const actual = await importOriginal<typeof SalesApi>();
  return {
    ...actual,
    listOpenBillsScoped: (_token: string) => mockListOpenBills(),
    getHeldCartScoped: (_token: string, id: string) => mockGetHeldCart(id),
    holdCartScoped: (_token: string, args: unknown) => mockHoldCart(args),
    deleteHeldCartScoped: (_token: string, id: string) => mockDeleteHeldCart(id),
    printSalesReceipt: (_token: string, args: unknown) => mockPrintSalesReceipt(args),
  };
});

vi.mock('@/api/tables', () => ({
  listTables: (section?: string) => mockListTables(section),
  listTablesScoped: (_token: string, section?: string) => mockListTables(section),
  listSections: () => mockListSections(),
  listSectionsScoped: (_token: string) => mockListSections(),
  updateTableStatus: (userId: string, id: string, status: string) =>
    mockUpdateTableStatus(userId, id, status),
  updateTableStatusScoped: (_token: string, id: string, status: string) =>
    mockUpdateTableStatus(_token, id, status),
  releaseTable: (userId: string, id: string) => mockReleaseTable(userId, id),
  releaseTableScoped: (_token: string, id: string) => mockReleaseTable(_token, id),
  createTable: (_token: string, table: Table) => mockCreateTable(table),
  createTableScoped: (_token: string, table: Table) => mockCreateTable(table),
  updateTable: (_token: string, table: Table) => mockUpdateTable(table),
  updateTableScoped: (_token: string, table: Table) => mockUpdateTable(table),
  deleteTable: (_token: string, id: string) => mockDeleteTable(id),
  deleteTableScoped: (_token: string, id: string) => mockDeleteTable(id),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ session: { user_id: 'user-1' } }),
}));

const bundle = new FluentBundle('en-US');
bundle.addResource(new FluentResource(tablesFtl));
const l10n = new ReactLocalization([bundle]);

function renderScreen() {
  return renderWithWorkspace(
    <LocalizationProvider l10n={l10n}>
      <TableManagementScreen />
    </LocalizationProvider>,
  );
}

function makeTable(overrides: Partial<Table> = {}): Table {
  return {
    id: 't-1',
    name: 'Table 1',
    capacity: 4,
    pos_x: 10,
    pos_y: 20,
    shape: 'circle',
    width: 8,
    height: 8,
    status: 'available',
    active_sale_id: null,
    section: 'Main',
    active: true,
    sort_order: 1,
    ...overrides,
  };
}

async function openTableDetail(table: Table) {
  mockListTables.mockResolvedValue([table]);
  renderScreen();
  await waitFor(() => expect(screen.getByText(table.name)).toBeDefined());
  await userEvent.click(screen.getByText(table.name).closest('button')!);
  await waitFor(() => expect(document.querySelector('.tables-detail')).toBeDefined());
}

describe('TableManagementScreen', () => {
  beforeEach(() => {
    mockListTables.mockReset();
    mockListSections.mockReset();
    mockUpdateTableStatus.mockReset();
    mockReleaseTable.mockReset();
    mockListOpenBills.mockReset();
    mockCreateTable.mockReset();
    mockUpdateTable.mockReset();
    mockDeleteTable.mockReset();
    mockGetHeldCart.mockReset();
    mockHoldCart.mockReset();
    mockDeleteHeldCart.mockReset();
    mockPrintSalesReceipt.mockReset();
    mockListTables.mockResolvedValue([]);
    mockListSections.mockResolvedValue([]);
    mockListOpenBills.mockResolvedValue([]);
    mockHoldCart.mockResolvedValue({ id: 'new-held-id' });
    mockDeleteHeldCart.mockResolvedValue(undefined);
    mockPrintSalesReceipt.mockResolvedValue({ printed: true });
    mockUpdateTableStatus.mockImplementation((_token: string, id: string, status: string) =>
      Promise.resolve(makeTable({ id, status })),
    );
    mockReleaseTable.mockImplementation((_token: string, id: string) =>
      Promise.resolve(makeTable({ id, status: 'cleaning' })),
    );
    mockCreateTable.mockImplementation((table: Table) =>
      Promise.resolve(makeTable({ ...table, id: 't-new' })),
    );
    mockUpdateTable.mockImplementation((table: Table) =>
      Promise.resolve(table),
    );
    mockDeleteTable.mockResolvedValue(undefined);
  });

  it('renders the title', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('Table Management')).toBeDefined());
  });

  it('shows All section button', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByText('All')).toBeDefined());
  });

  it('shows section buttons from the sections API (TBL-09)', async () => {
    mockListSections.mockResolvedValue(['Main', 'Patio']);
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Main')).toBeDefined();
      expect(screen.getByText('Patio')).toBeDefined();
    });
  });

  it('keeps section buttons stable while a section is selected (TBL-09)', async () => {
    mockListSections.mockResolvedValue(['Main', 'Patio']);
    mockListTables.mockResolvedValue([makeTable({ section: 'Patio' })]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Patio')).toBeDefined());
    // Selecting Patio must not make Main disappear (sections come from
    // independent metadata, not from the filtered table page).
    await userEvent.click(screen.getByText('Patio'));
    await waitFor(() => {
      expect(screen.getByText('Main')).toBeDefined();
      expect(screen.getByText('Patio')).toBeDefined();
    });
    // listTablesScoped maps to mockListTables(section) — the token is
    // stripped inside the vi.mock, so only the section is passed through.
    expect(mockListTables).toHaveBeenLastCalledWith('Patio');
  });

  it('shows the loading state while the first request is in flight (TBL-10)', async () => {
    let resolveTables: (v: Table[]) => void;
    mockListTables.mockReturnValue(new Promise((res) => { resolveTables = res; }));
    renderScreen();
    expect(screen.getByRole('status')).toBeDefined();
    resolveTables!([]);
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });

  it('shows the empty state after a successful zero-row load (TBL-10)', async () => {
    mockListTables.mockResolvedValue([]);
    renderScreen();
    await waitFor(() =>
      expect(screen.getByText('No tables configured yet.')).toBeDefined(),
    );
  });

  it('shows the filtered-empty state with an All action (TBL-10)', async () => {
    mockListSections.mockResolvedValue(['Main']);
    mockListTables.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Main')).toBeDefined());
    await userEvent.click(screen.getByText('Main'));
    await waitFor(() =>
      expect(screen.getByText('No tables in this section.')).toBeDefined(),
    );
  });

  it('shows a localized error and retries after a failed load (TBL-02)', async () => {
    mockListTables.mockRejectedValueOnce(new Error('db down'));
    renderScreen();
    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(screen.getByText('Could not load the floor plan.')).toBeDefined();

    mockListTables.mockResolvedValueOnce([makeTable()]);
    await userEvent.click(screen.getByText('Retry'));
    await waitFor(() => expect(screen.getByText('Table 1')).toBeDefined());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('drops a stale response that resolves after a newer request (TBL-02)', async () => {
    mockListSections.mockResolvedValue(['Main']);
    let resolveFirst: (v: Table[]) => void;
    // First request (mount, section undefined) stays pending.
    mockListTables.mockReturnValueOnce(new Promise((res) => { resolveFirst = res; }));
    renderScreen();
    await waitFor(() => expect(screen.getByText('Main')).toBeDefined());
    // Selecting a section fires a second request, which resolves first.
    mockListTables.mockResolvedValueOnce([makeTable({ id: 't-b', name: 'Table B' })]);
    await userEvent.click(screen.getByText('Main'));
    await waitFor(() => expect(screen.getByText('Table B')).toBeDefined());
    // The stale first response must be ignored, not overwrite Table B.
    resolveFirst!([makeTable({ id: 't-a', name: 'Table A' })]);
    await waitFor(() => expect(screen.queryByText('Table A')).toBeNull());
    expect(screen.getByText('Table B')).toBeDefined();
  });

  it('renders tables on the floor plan', async () => {
    mockListTables.mockResolvedValue([makeTable()]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Table 1')).toBeDefined());
  });

  it('shows the localized status on each table button (TBL-07)', async () => {
    mockListTables.mockResolvedValue([makeTable({ status: 'occupied' })]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Occupied')).toBeDefined());
  });

  it('falls back to a localized label for an unknown status (TBL-07)', async () => {
    mockListTables.mockResolvedValue([makeTable({ status: 'mystery' })]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Unknown status')).toBeDefined());
  });

  it('uses absolute positioning from pos_x/pos_y props', async () => {
    mockListTables.mockResolvedValue([makeTable({ pos_x: 25, pos_y: 50 })]);
    renderScreen();
    await waitFor(() => {
      const btns = document.querySelectorAll('.tables-table');
      expect(btns.length).toBe(1);
      const style = (btns[0] as HTMLElement).style;
      expect(style.left).toBe('25%');
      expect(style.top).toBe('50%');
    });
  });

  it('clamps sub-2% persisted geometry to a minimum interactive size (TBL-08)', async () => {
    mockListTables.mockResolvedValue([makeTable({ width: 0.5, height: 1 })]);
    renderScreen();
    await waitFor(() => {
      const btn = document.querySelector('.tables-table') as HTMLElement;
      expect(btn.style.width).toBe('2%');
      expect(btn.style.height).toBe('2%');
    });
  });

  it('applies status CSS class to table buttons', async () => {
    mockListTables.mockResolvedValue([
      makeTable({ id: 't-1', status: 'available' }),
      makeTable({ id: 't-2', status: 'occupied' }),
    ]);
    renderScreen();
    await waitFor(() => {
      const availableBtn = document.querySelector('.tables-table--available');
      const occupiedBtn = document.querySelector('.tables-table--occupied');
      expect(availableBtn).toBeDefined();
      expect(occupiedBtn).toBeDefined();
    });
  });

  it('applies shape CSS class', async () => {
    mockListTables.mockResolvedValue([
      makeTable({ shape: 'circle' }),
      makeTable({ id: 't-2', shape: 'rectangle' }),
    ]);
    renderScreen();
    await waitFor(() => {
      const circleBtn = document.querySelector('.tables-table--circle');
      const rectBtn = document.querySelector('.tables-table--rectangle');
      expect(circleBtn).toBeDefined();
      expect(rectBtn).toBeDefined();
    });
  });

  it('opens detail panel on table click', async () => {
    mockListTables.mockResolvedValue([makeTable()]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Table 1')).toBeDefined());

    const tableBtn = screen.getByText('Table 1').closest('button')!;
    await userEvent.click(tableBtn);

    await waitFor(() => {
      const detailHeading = document.querySelector('.tables-detail h2');
      expect(detailHeading?.textContent).toBe('Table 1');
    });
  });

  it('shows a Mark Reserved action for available tables in detail (TBL-01 hold model)', async () => {
    await openTableDetail(makeTable({ status: 'available' }));
    expect(screen.getByText('Mark Reserved')).toBeDefined();
  });

  it('shows Release button for occupied tables in detail', async () => {
    await openTableDetail(makeTable({ status: 'occupied' }));
    expect(screen.getByText('Release')).toBeDefined();
  });

  it('shows Mark Available for reserved tables in detail', async () => {
    await openTableDetail(makeTable({ status: 'reserved' }));
    expect(screen.getByText('Mark Available')).toBeDefined();
  });

  it('shows Mark Available for cleaning tables in detail', async () => {
    await openTableDetail(makeTable({ status: 'cleaning' }));
    expect(screen.getByText('Mark Available')).toBeDefined();
  });

  it('dismisses detail panel on Close click', async () => {
    mockListTables.mockResolvedValue([makeTable()]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Table 1')).toBeDefined());

    await userEvent.click(screen.getByText('Table 1').closest('button')!);
    await waitFor(() => expect(screen.getByText('Close')).toBeDefined());

    await userEvent.click(screen.getByText('Close').closest('button')!);
    await waitFor(() =>
      expect(document.querySelector('.tables-detail')).toBeNull(),
    );
  });

  // ── TBL-05: context menu opens the accessible detail (no direct mutation) ──

  it('context menu opens the detail panel instead of mutating (TBL-05)', async () => {
    mockListTables.mockResolvedValue([makeTable({ status: 'available' })]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Table 1')).toBeDefined());

    const tableBtn = screen.getByText('Table 1').closest('button')!;
    await userEvent.pointer({ keys: '[MouseRight]', target: tableBtn });

    await waitFor(() => expect(document.querySelector('.tables-detail')).toBeDefined());
    // No mutation fires from the context-menu gesture itself.
    expect(mockUpdateTableStatus).not.toHaveBeenCalled();
    expect(mockReleaseTable).not.toHaveBeenCalled();
  });

  // ── TBL-03: async pending-guarded, error-aware mutations ──

  it('applies the Mark Reserved action for an available table (TBL-01/03)', async () => {
    await openTableDetail(makeTable({ status: 'available' }));
    await userEvent.click(screen.getByText('Mark Reserved').closest('button')!);
    await waitFor(() =>
      expect(mockUpdateTableStatus).toHaveBeenCalledWith(MOCK_SESSION_TOKEN, 't-1', 'reserved'),
    );
  });

  it('releases an occupied table through the detail action (TBL-03)', async () => {
    await openTableDetail(makeTable({ status: 'occupied' }));
    await userEvent.click(screen.getByText('Release').closest('button')!);
    await waitFor(() =>
      expect(mockReleaseTable).toHaveBeenCalledWith(MOCK_SESSION_TOKEN, 't-1'),
    );
  });

  it('marks a reserved table available through the detail action (TBL-03)', async () => {
    await openTableDetail(makeTable({ status: 'reserved' }));
    await userEvent.click(screen.getByText('Mark Available').closest('button')!);
    await waitFor(() =>
      expect(mockUpdateTableStatus).toHaveBeenCalledWith(MOCK_SESSION_TOKEN, 't-1', 'available'),
    );
  });

  it('marks a cleaning table available through the detail action (TBL-03)', async () => {
    await openTableDetail(makeTable({ status: 'cleaning' }));
    await userEvent.click(screen.getByText('Mark Available').closest('button')!);
    await waitFor(() =>
      expect(mockUpdateTableStatus).toHaveBeenCalledWith(MOCK_SESSION_TOKEN, 't-1', 'available'),
    );
  });

  it('keeps the panel open with a localized error when a mutation fails (TBL-03)', async () => {
    mockUpdateTableStatus.mockRejectedValueOnce(new Error('occupied requires an active sale'));
    await openTableDetail(makeTable({ status: 'available' }));
    await userEvent.click(screen.getByText('Mark Reserved').closest('button')!);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
      expect(screen.getByText('Could not update this table.')).toBeDefined();
      expect(document.querySelector('.tables-detail')).toBeDefined();
    });
    // The panel did not silently close.
    expect(document.querySelector('.tables-detail h2')?.textContent).toBe('Table 1');
  });

  it('guards against duplicate clicks while a mutation is pending (TBL-03)', async () => {
    let resolveMutation: (v: Table) => void;
    mockUpdateTableStatus.mockReturnValueOnce(new Promise((res) => { resolveMutation = res; }));
    await openTableDetail(makeTable({ status: 'available' }));

    const actionBtn = screen.getByText('Mark Reserved').closest('button')!;
    await userEvent.click(actionBtn);
    await userEvent.click(actionBtn);

    await waitFor(() => expect(mockUpdateTableStatus).toHaveBeenCalledTimes(1));
    resolveMutation!(makeTable({ status: 'reserved' }));
    await waitFor(() =>
      expect(document.querySelector('.tables-detail h2')?.textContent).toBe('Table 1'),
    );
  });

  it('patches the floor plan in place after a successful mutation (TBL-03)', async () => {
    await openTableDetail(makeTable({ status: 'reserved' }));
    await userEvent.click(screen.getByText('Mark Available').closest('button')!);
    // No extra list fetch — the returned table is patched into the floor plan.
    await waitFor(() => expect(mockListTables).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('Available')).toBeDefined());
    expect(screen.queryByText('Reserved')).toBeNull();
  });

  it('does not clobber a section change that lands during a pending mutation (TBL-03/02)', async () => {
    // Mutation stays pending; the operator switches sections while it runs.
    let resolveMutation: (v: Table) => void;
    mockUpdateTableStatus.mockReturnValueOnce(new Promise((res) => { resolveMutation = res; }));
    mockListSections.mockResolvedValue(['Patio']);
    await openTableDetail(makeTable({ status: 'reserved', section: 'Patio' }));

    // Switch to Patio, then fire the mutation.
    await userEvent.click(screen.getByText('Patio'));
    await waitFor(() =>
      expect(mockListTables).toHaveBeenLastCalledWith('Patio'),
    );
    await userEvent.click(screen.getByText('Mark Available').closest('button')!);

    // The section-scoped load resolved with the table as reserved.
    resolveMutation!(makeTable({ status: 'available', section: 'Patio' }));
    await waitFor(() => expect(screen.getByText('Available')).toBeDefined());
    // The floor plan still shows the Patio table — the in-place patch does
    // not fire a stale full reload that would clobber the section's data.
    // (The dialog h2 also shows the name, so query for multiple matches.)
    expect(screen.getAllByText('Table 1').length).toBeGreaterThan(0);
    expect(mockListTables).toHaveBeenCalledTimes(2); // mount + section switch
  });

  // ── TBL-06: complete dialog interaction ──

  it('marks the detail panel as a modal dialog (TBL-06)', async () => {
    await openTableDetail(makeTable());
    const dialog = document.querySelector('.tables-detail');
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
  });

  it('moves focus into the dialog when opened (TBL-06)', async () => {
    await openTableDetail(makeTable({ status: 'available' }));
    // The shared focus trap auto-focuses the first focusable control — the
    // primary action button.
    await waitFor(() => expect(screen.getByText('Mark Reserved').closest('button')).toHaveFocus());
  });

  it('closes the dialog on Escape and restores focus to the trigger (TBL-06)', async () => {
    mockListTables.mockResolvedValue([makeTable()]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Table 1')).toBeDefined());
    const tableBtn = screen.getByText('Table 1').closest('button')!;
    await userEvent.click(tableBtn);
    await waitFor(() => expect(document.querySelector('.tables-detail')).toBeDefined());

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(document.querySelector('.tables-detail')).toBeNull());
    // Focus returns to the table button that opened the dialog.
    expect(tableBtn).toHaveFocus();
  });

  it('has region role with accessible label', async () => {
    renderScreen();
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Table management' })).toBeDefined(),
    );
  });

  it('shows capacity, localized status, and section in detail panel', async () => {
    await openTableDetail(makeTable({ capacity: 6, status: 'reserved', section: 'Patio' }));
    const detail = document.querySelector('.tables-detail');
    expect(detail?.textContent).toMatch(/6/);
    expect(detail?.textContent).toMatch(/Reserved/);
    expect(detail?.textContent).toMatch(/Patio/);
  });

  it('assigns selected table name to onSelectTable callback when Select for Order is clicked', async () => {
    const onSelectTable = vi.fn();
    mockListTables.mockResolvedValue([makeTable({ name: 'VIP 2' })]);
    renderWithWorkspace(
      <LocalizationProvider l10n={l10n}>
        <TableManagementScreen onSelectTable={onSelectTable} />
      </LocalizationProvider>,
    );
    await waitFor(() => expect(screen.getByText('VIP 2')).toBeDefined());
    await userEvent.click(screen.getByText('VIP 2').closest('button')!);
    await waitFor(() => expect(screen.getByTestId('tables-assign-to-order-btn')).toBeDefined());

    await userEvent.click(screen.getByTestId('tables-assign-to-order-btn'));
    expect(onSelectTable).toHaveBeenCalledWith('VIP 2');
    await waitFor(() => expect(document.querySelector('.tables-detail')).toBeNull());
  });

  it('identifies held cart for Table 2 (Bapak Budi) and renders active tab with Resume Tab / Order', async () => {
    mockListOpenBills.mockResolvedValue([
      {
        id: 'bill-1',
        label: 'Table 2 (Bapak Budi)',
        item_count: 2,
        total_minor: 50000,
        currency: 'IDR',
        created_at: '2026-10-09T14:00:00Z',
        bill_type: 'open_bill',
        customer_name: 'Bapak Budi',
      },
    ]);
    mockListTables.mockResolvedValue([makeTable({ id: 'tbl-2', name: 'Table 2' })]);
    const onSelectTable = vi.fn();
    renderWithWorkspace(
      <LocalizationProvider l10n={l10n}>
        <TableManagementScreen onSelectTable={onSelectTable} />
      </LocalizationProvider>,
    );

    await waitFor(() => expect(screen.getByText('Table 2')).toBeDefined());
    // Table button shows item count badge
    expect(screen.getByText('2 items')).toBeDefined();

    // Click to open detail dialog
    await userEvent.click(screen.getByText('Table 2').closest('button')!);
    await waitFor(() => expect(screen.getByText(/Active Tab:.*Table 2 \(Bapak Budi\)/)).toBeDefined());
    expect(screen.getByText(/2 items ·/)).toBeDefined();
    const resumeBtn = screen.getByRole('button', { name: 'Resume Tab / Order' });
    expect(resumeBtn).toBeDefined();

    await userEvent.click(resumeBtn);
    expect(onSelectTable).toHaveBeenCalledWith('Table 2');
  });

  it('opens Add Table modal when + Add Table button is clicked and creates table', async () => {
    mockListTables.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('tables-add-table-btn')).toBeDefined());

    await userEvent.click(screen.getByTestId('tables-add-table-btn'));
    await waitFor(() => expect(screen.getByLabelText('Table Name')).toBeDefined());

    await userEvent.type(screen.getByLabelText('Table Name'), 'Table 99');
    await userEvent.click(screen.getByRole('button', { name: 'Save Table' }));

    await waitFor(() => expect(mockCreateTable).toHaveBeenCalled());
    expect(mockCreateTable).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Table 99',
        capacity: 4,
        shape: 'circle',
      }),
    );
  });

  it('opens Edit Table modal from detail panel and updates table', async () => {
    mockListTables.mockResolvedValue([makeTable({ id: 't-1', name: 'Table 1' })]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Table 1')).toBeDefined());

    await userEvent.click(screen.getByText('Table 1').closest('button')!);
    await waitFor(() => expect(screen.getByTestId('tables-edit-table-btn')).toBeDefined());

    await userEvent.click(screen.getByTestId('tables-edit-table-btn'));
    await waitFor(() => expect(screen.getByLabelText('Table Name')).toBeDefined());

    const nameInput = screen.getByLabelText('Table Name');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Table 1 Edited');
    await userEvent.click(screen.getByRole('button', { name: 'Save Table' }));

    await waitFor(() => expect(mockUpdateTable).toHaveBeenCalled());
    expect(mockUpdateTable).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 't-1',
        name: 'Table 1 Edited',
      }),
    );
  });

  it('deletes table after confirmation in detail panel', async () => {
    mockListTables.mockResolvedValue([makeTable({ id: 't-1', name: 'Table 1', status: 'available' })]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Table 1')).toBeDefined());

    await userEvent.click(screen.getByText('Table 1').closest('button')!);
    await waitFor(() => expect(screen.getByTestId('tables-delete-table-btn')).toBeDefined());

    await userEvent.click(screen.getByTestId('tables-delete-table-btn'));
    await waitFor(() => expect(screen.getByText(/Are you sure you want to delete table/)).toBeDefined());

    const deleteBtn = screen.getByRole('button', { name: 'Delete' });
    await userEvent.click(deleteBtn);

    await waitFor(() => expect(mockDeleteTable).toHaveBeenCalledWith('t-1'));
  });

  it('invokes onBack when back button is clicked', async () => {
    const handleBack = vi.fn();
    renderWithWorkspace(
      <LocalizationProvider l10n={l10n}>
        <TableManagementScreen onBack={handleBack} />
      </LocalizationProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('tables-back-btn')).toBeDefined());
    await userEvent.click(screen.getByTestId('tables-back-btn'));
    expect(handleBack).toHaveBeenCalledTimes(1);
  });

  it('renders active bill indicators and tag for occupied table with open tab', async () => {
    mockListTables.mockResolvedValue([makeTable({ id: 't-1', name: 'Table 1', status: 'occupied' })]);
    mockListOpenBills.mockResolvedValue([
      {
        id: 'bill-1',
        label: 'Table 1 - Order #101',
        table_name: 'Table 1',
        item_count: 3,
        total_minor: 125000,
        currency: 'IDR',
        held_at: '2026-10-12T00:00:00Z',
      },
    ]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Table 1')).toBeDefined());
    const tableBtn = screen.getByText('Table 1').closest('button');
    expect(tableBtn).toHaveClass('tables-table--has-bill');

    // Open detail
    await userEvent.click(tableBtn!);
    await waitFor(() => expect(screen.getByText(/Active Tab:.*Table 1 - Order #101/)).toBeDefined());
    expect(screen.getAllByText(/3 items/)).toHaveLength(2);
  });

  it('prompts release confirmation when releasing occupied table with active tab', async () => {
    mockListTables.mockResolvedValue([makeTable({ id: 't-1', name: 'Table 1', status: 'occupied' })]);
    mockListOpenBills.mockResolvedValue([
      {
        id: 'bill-1',
        label: 'Table 1 - Order #101',
        table_name: 'Table 1',
        item_count: 2,
        total_minor: 85000,
        currency: 'IDR',
        held_at: '2026-10-12T00:00:00Z',
      },
    ]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Table 1')).toBeDefined());
    const tableBtn = screen.getByText('Table 1').closest('button');
    await userEvent.click(tableBtn!);

    await waitFor(() => expect(screen.getByText('Release')).toBeDefined());
    await userEvent.click(screen.getByText('Release').closest('button')!);

    // Warning banner is displayed
    await waitFor(() =>
      expect(screen.getByText(/Table has an active tab/)).toBeDefined(),
    );
    expect(screen.getByText('Confirm Release')).toBeDefined();

    // Cancel dismisses banner without calling mockReleaseTable
    await userEvent.click(screen.getByText('Cancel').closest('button')!);
    await waitFor(() =>
      expect(screen.queryByText(/Table has an active tab/)).toBeNull(),
    );
    expect(mockReleaseTable).not.toHaveBeenCalled();

    // Click Release again and confirm
    await userEvent.click(screen.getByText('Release').closest('button')!);
    await waitFor(() => expect(screen.getByText('Confirm Release')).toBeDefined());
    await userEvent.click(screen.getByText('Confirm Release').closest('button')!);

    await waitFor(() =>
      expect(mockReleaseTable).toHaveBeenCalledWith(MOCK_SESSION_TOKEN, 't-1'),
    );
  });

  it('calls onSelectTable when Resume Tab / Order is clicked for active bill table', async () => {
    const handleSelectTable = vi.fn();
    mockListTables.mockResolvedValue([makeTable({ id: 't-1', name: 'Table 1', status: 'occupied' })]);
    mockListOpenBills.mockResolvedValue([
      {
        id: 'bill-1',
        label: 'Table 1 - Order #101',
        table_name: 'Table 1',
        item_count: 2,
        total_minor: 85000,
        currency: 'IDR',
        held_at: '2026-10-12T00:00:00Z',
      },
    ]);
    renderWithWorkspace(
      <LocalizationProvider l10n={l10n}>
        <TableManagementScreen onSelectTable={handleSelectTable} />
      </LocalizationProvider>,
    );
    await waitFor(() => expect(screen.getByText('Table 1')).toBeDefined());
    const tableBtn = screen.getByText('Table 1').closest('button');
    await userEvent.click(tableBtn!);

    await waitFor(() => expect(screen.getByText('Resume Tab / Order')).toBeDefined());
    await userEvent.click(screen.getByText('Resume Tab / Order').closest('button')!);

    expect(handleSelectTable).toHaveBeenCalledWith('Table 1');
  });

  it('renders section badges with total and occupied counts', async () => {
    mockListSections.mockResolvedValue(['Main', 'Outdoor']);
    mockListTables.mockResolvedValue([
      makeTable({ id: 't-1', name: 'Table 1', section: 'Main', status: 'occupied' }),
      makeTable({ id: 't-2', name: 'Table 2', section: 'Main', status: 'available' }),
      makeTable({ id: 't-3', name: 'Table 3', section: 'Outdoor', status: 'available' }),
    ]);
    renderScreen();

    await waitFor(() => {
      const allBadge = screen.getByTestId('tables-section-badge-all');
      expect(allBadge.textContent).toBe('1/3');
      expect(allBadge).toHaveClass('tables-section-badge--occupied');

      const mainBadge = screen.getByTestId('tables-section-badge-Main');
      expect(mainBadge.textContent).toBe('1/2');

      const outdoorBadge = screen.getByTestId('tables-section-badge-Outdoor');
      expect(outdoorBadge.textContent).toBe('1');
    });
  });

  it('toggles the floorplan semantic status legend', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('tables-legend-toggle-btn')).toBeDefined());

    expect(screen.queryByTestId('tables-legend-bar')).toBeNull();

    await userEvent.click(screen.getByTestId('tables-legend-toggle-btn'));
    await waitFor(() => expect(screen.getByTestId('tables-legend-bar')).toBeDefined());
    expect(screen.getByText('Open Tab')).toBeDefined();

    await userEvent.click(screen.getByTestId('tables-legend-toggle-btn'));
    await waitFor(() => expect(screen.queryByTestId('tables-legend-bar')).toBeNull());
  });

  it('renders table capacity and active held bill amount on table card', async () => {
    mockListTables.mockResolvedValue([
      makeTable({ id: 't-1', name: 'Table 1', capacity: 6, status: 'occupied' }),
    ]);
    mockListOpenBills.mockResolvedValue([
      {
        id: 'bill-1',
        label: 'Table 1',
        table_name: 'Table 1',
        item_count: 4,
        total_minor: 150000,
        currency: 'IDR',
        held_at: '2026-10-12T00:00:00Z',
      },
    ]);
    renderScreen();

    await waitFor(() => expect(screen.getByText('Table 1')).toBeDefined());
    expect(screen.getByText('6p')).toBeDefined();
    expect(screen.getByText(/150\.000/)).toBeDefined();
  });

  it('prints interim bill check when Print Bill is clicked in table detail', async () => {
    const table = makeTable({ id: 't-1', name: 'Table 1', status: 'occupied' });
    mockListOpenBills.mockResolvedValue([
      {
        id: 'bill-1',
        label: 'Table 1',
        item_count: 2,
        total_minor: 50000,
        currency: 'IDR',
        created_at: '2026-10-12T00:00:00Z',
        bill_type: 'open_bill',
        customer_name: null,
      },
    ]);
    mockGetHeldCart.mockResolvedValue({
      id: 'bill-1',
      label: 'Table 1',
      cart_data: JSON.stringify({
        lines: [
          { sku: 'SKU-1', name: 'Nasi Goreng', qty: 2, unit_price: { minor_units: 25000, currency: 'IDR' } },
        ],
      }),
      item_count: 2,
      total_minor: 50000,
      currency: 'IDR',
      created_at: '2026-10-12T00:00:00Z',
      bill_type: 'open_bill',
      customer_name: null,
      deduction_location_id: null,
    });

    await openTableDetail(table);
    await waitFor(() => expect(screen.getByTestId('tables-print-bill-btn')).toBeDefined());

    await userEvent.click(screen.getByTestId('tables-print-bill-btn'));
    await waitFor(() => {
      expect(mockPrintSalesReceipt).toHaveBeenCalledTimes(1);
    });
    const receiptArg = mockPrintSalesReceipt.mock.calls[0]![0];
    expect(receiptArg.tableNumber).toBe('Table 1');
    expect(receiptArg.total.minorUnits).toBe(50000);
    expect(receiptArg.items).toHaveLength(1);
  });

  it('moves active tab to another available table when Move Table is confirmed', async () => {
    const table1 = makeTable({ id: 't-1', name: 'Table 1', status: 'occupied' });
    const table2 = makeTable({ id: 't-2', name: 'Table 2', status: 'available' });
    mockListTables.mockResolvedValue([table1, table2]);
    mockListOpenBills.mockResolvedValue([
      {
        id: 'bill-1',
        label: 'Table 1',
        item_count: 1,
        total_minor: 25000,
        currency: 'IDR',
        created_at: '2026-10-12T00:00:00Z',
        bill_type: 'open_bill',
        customer_name: null,
      },
    ]);
    mockGetHeldCart.mockResolvedValue({
      id: 'bill-1',
      label: 'Table 1',
      cart_data: JSON.stringify({
        lines: [
          { sku: 'SKU-1', name: 'Mie Goreng', qty: 1, unit_price: { minor_units: 25000, currency: 'IDR' } },
        ],
      }),
      item_count: 1,
      total_minor: 25000,
      currency: 'IDR',
      created_at: '2026-10-12T00:00:00Z',
      bill_type: 'open_bill',
      customer_name: null,
      deduction_location_id: null,
    });

    renderScreen();
    await waitFor(() => expect(screen.getByText('Table 1')).toBeDefined());
    await userEvent.click(screen.getByText('Table 1').closest('button')!);
    await waitFor(() => expect(screen.getByTestId('tables-move-table-btn')).toBeDefined());

    await userEvent.click(screen.getByTestId('tables-move-table-btn'));
    await waitFor(() => expect(screen.getByTestId('tables-move-confirm-btn')).toBeDefined());

    await userEvent.click(screen.getByTestId('tables-move-confirm-btn'));
    await waitFor(() => {
      expect(mockDeleteHeldCart).toHaveBeenCalledWith('bill-1');
      expect(mockHoldCart).toHaveBeenCalled();
      expect(mockReleaseTable).toHaveBeenCalledWith(MOCK_SESSION_TOKEN, 't-1');
      expect(mockUpdateTableStatus).toHaveBeenCalledWith(MOCK_SESSION_TOKEN, 't-2', 'occupied');
    });
  });

  it('toggles arrange mode on and off', async () => {
    const table = makeTable({ id: 't-1', name: 'Table 1' });
    mockListTables.mockResolvedValue([table]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Table 1')).toBeDefined());

    const arrangeBtn = screen.getByTestId('tables-arrange-mode-btn');
    expect(arrangeBtn.textContent).toContain('Arrange Tables');

    await userEvent.click(arrangeBtn);
    expect(arrangeBtn.textContent).toContain('Done Arranging');
    expect(document.querySelector('.tables-floorplan--arranging')).toBeDefined();
    expect(document.querySelector('.tables-table--arranging')).toBeDefined();

    await userEvent.click(arrangeBtn);
    expect(arrangeBtn.textContent).toContain('Arrange Tables');
    expect(document.querySelector('.tables-floorplan--arranging')).toBeNull();
  });

  it('creates a table with booth shape and appropriate dimensions', async () => {
    mockListTables.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('tables-add-table-btn')).toBeDefined());

    await userEvent.click(screen.getByTestId('tables-add-table-btn'));
    await waitFor(() => expect(screen.getByLabelText(/Table Name/i)).toBeDefined());

    await userEvent.type(screen.getByLabelText(/Table Name/i), 'Booth A');
    await userEvent.selectOptions(screen.getByLabelText(/Shape/i), 'booth');
    await userEvent.click(screen.getByText('Save Table'));

    await waitFor(() => {
      expect(mockCreateTable).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Booth A',
          shape: 'booth',
          width: 18,
          height: 14,
        }),
      );
    });
  });

  it('renders elapsed dining timer and applies SLA warning when over 60 minutes', async () => {
    const table = makeTable({ id: 't-1', name: 'Table 1', status: 'occupied' });
    const eightyMinsAgo = new Date(Date.now() - 80 * 60 * 1000).toISOString();
    mockListTables.mockResolvedValue([table]);
    mockListOpenBills.mockResolvedValue([
      {
        id: 'bill-1',
        label: 'Table 1',
        item_count: 2,
        total_minor: 50000,
        currency: 'IDR',
        created_at: eightyMinsAgo,
        bill_type: 'open_bill',
        customer_name: null,
      },
    ]);

    renderScreen();
    await waitFor(() => expect(screen.getByText('Table 1')).toBeDefined());

    const timer = screen.getByText(/⏱️ 80m/);
    expect(timer).toBeDefined();
    expect(timer.className).toContain('tables-table-timer--warn');

    const tableBtn = screen.getByText('Table 1').closest('button');
    expect(tableBtn?.className).toContain('tables-table--sla-warn');
  });

  it('merges active tabs from two tables when Merge Table is confirmed', async () => {
    const table1 = makeTable({ id: 't-1', name: 'Table 1', status: 'occupied' });
    const table2 = makeTable({ id: 't-2', name: 'Table 2', status: 'occupied' });
    mockListTables.mockResolvedValue([table1, table2]);
    mockListOpenBills.mockResolvedValue([
      {
        id: 'bill-1',
        label: 'Table 1',
        item_count: 1,
        total_minor: 25000,
        currency: 'IDR',
        created_at: '2026-10-12T00:00:00Z',
        bill_type: 'open_bill',
        customer_name: null,
      },
      {
        id: 'bill-2',
        label: 'Table 2',
        item_count: 2,
        total_minor: 50000,
        currency: 'IDR',
        created_at: '2026-10-12T00:10:00Z',
        bill_type: 'open_bill',
        customer_name: null,
      },
    ]);
    mockGetHeldCart.mockImplementation((id: string) => {
      if (id === 'bill-1') {
        return Promise.resolve({
          id: 'bill-1',
          label: 'Table 1',
          cart_data: JSON.stringify({
            lines: [{ sku: 'SKU-1', name: 'Mie Goreng', qty: 1, unit_price: { minor_units: 25000, currency: 'IDR' } }],
          }),
          item_count: 1,
          total_minor: 25000,
          currency: 'IDR',
          created_at: '2026-10-12T00:00:00Z',
          bill_type: 'open_bill',
          customer_name: null,
          deduction_location_id: null,
        });
      }
      return Promise.resolve({
        id: 'bill-2',
        label: 'Table 2',
        cart_data: JSON.stringify({
          lines: [
            { sku: 'SKU-2', name: 'Es Teh', qty: 2, unit_price: { minor_units: 10000, currency: 'IDR' } },
            { sku: 'SKU-3', name: 'Nasi Goreng', qty: 1, unit_price: { minor_units: 30000, currency: 'IDR' } },
          ],
        }),
        item_count: 2,
        total_minor: 50000,
        currency: 'IDR',
        created_at: '2026-10-12T00:10:00Z',
        bill_type: 'open_bill',
        customer_name: null,
        deduction_location_id: null,
      });
    });

    renderScreen();
    await waitFor(() => expect(screen.getByText('Table 1')).toBeDefined());
    await userEvent.click(screen.getByText('Table 1').closest('button')!);
    await waitFor(() => expect(screen.getByTestId('tables-merge-table-btn')).toBeDefined());

    await userEvent.click(screen.getByTestId('tables-merge-table-btn'));
    await waitFor(() => expect(screen.getByTestId('tables-merge-confirm-btn')).toBeDefined());

    await userEvent.click(screen.getByTestId('tables-merge-confirm-btn'));
    await waitFor(() => {
      expect(mockDeleteHeldCart).toHaveBeenCalledWith('bill-1');
      expect(mockDeleteHeldCart).toHaveBeenCalledWith('bill-2');
      expect(mockHoldCart).toHaveBeenCalledWith(
        expect.objectContaining({
          label: 'Table 2',
          item_count: 3,
          total_minor: 75000,
        }),
      );
      expect(mockReleaseTable).toHaveBeenCalledWith(MOCK_SESSION_TOKEN, 't-1');
    });
  });
});
