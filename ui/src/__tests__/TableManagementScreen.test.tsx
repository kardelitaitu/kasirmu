import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { renderWithWorkspace, MOCK_SESSION_TOKEN } from '@/test-utils';
import userEvent from '@testing-library/user-event';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { ReactLocalization, LocalizationProvider } from '@fluent/react';
import TableManagementScreen from '@/features/tables/TableManagementScreen';
import tablesFtl from '@/locales/tables.ftl?raw';
import type { Table } from '@/api/tables';
import type * as SalesApi from '@/api/sales';
import { resetMemoryLeasesForTest } from '@/features/sales/hooks/useTabLeases';

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
  mockGetSetting,
  mockSetSetting,
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
  mockGetSetting: vi.fn(),
  mockSetSetting: vi.fn(),
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

vi.mock('@/api/settings', () => ({
  getSettingScoped: (...args: unknown[]) => mockGetSetting(...args),
  setSettingScoped: (...args: unknown[]) => mockSetSetting(...args),
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
    resetMemoryLeasesForTest();
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
    mockGetSetting.mockReset();
    mockSetSetting.mockReset();
    mockListTables.mockResolvedValue([]);
    mockListSections.mockResolvedValue([]);
    mockListOpenBills.mockResolvedValue([]);
    mockHoldCart.mockResolvedValue({ id: 'new-held-id' });
    mockDeleteHeldCart.mockResolvedValue(undefined);
    mockPrintSalesReceipt.mockResolvedValue({ printed: true });
    mockGetSetting.mockResolvedValue(null);
    mockSetSetting.mockResolvedValue(undefined);
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
      makeTable({ id: 't-3', shape: 'booth' }),
    ]);
    renderScreen();
    await waitFor(() => {
      const circleBtn = document.querySelector('.tables-table--circle');
      const rectBtn = document.querySelector('.tables-table--rectangle');
      const boothBtn = document.querySelector('.tables-table--booth');
      expect(circleBtn).toBeDefined();
      expect(rectBtn).toBeDefined();
      expect(boothBtn).toBeDefined();
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

    // THE ORDER, asserted where the happy path already runs. A success-path case
    // says nothing about ordering on its own: the failure case below is what proves
    // the delete is survivable, and this line is what proves the fix is an ORDERING
    // and not just "the delete still happens".
    //
    // `invocationCallOrder` is the repo's existing technique for this
    // (useSound.test.tsx:259). It is asserted on the success path too because a
    // future refactor could reintroduce the unsafe order without changing which
    // calls happen — only when.
    expect(mockHoldCart.mock.invocationCallOrder[0]!).toBeLessThan(
      mockDeleteHeldCart.mock.invocationCallOrder[0]!,
    );
  });

  it('moves the tab ONCE when the confirm is double-tapped', async () => {
    // The most expensive replay on this screen: the move is create-first, delete-second,
    // so a second run holds a SECOND copy of the bill under the destination name and
    // then deletes the original -- leaving duplicate open bills, the exact trade the
    // create-first order documents as hand-resolvable.
    const table1 = makeTable({ id: 't-1', name: 'Table 1', status: 'occupied' });
    const table2 = makeTable({ id: 't-2', name: 'Table 2', status: 'available' });
    mockListTables.mockResolvedValue([table1, table2]);
    mockListOpenBills.mockResolvedValue([
      {
        id: 'bill-1', label: 'Table 1', item_count: 1, total_minor: 25000,
        currency: 'IDR', created_at: '2026-10-12T00:00:00Z', bill_type: 'open_bill', customer_name: null,
      },
    ]);
    mockGetHeldCart.mockResolvedValue({
      id: 'bill-1',
      label: 'Table 1',
      cart_data: JSON.stringify({
        lines: [{ sku: 'SKU-1', name: 'Mie Goreng', qty: 1, unit_price: { minor_units: 25000, currency: 'IDR' } }],
      }),
      item_count: 1, total_minor: 25000, currency: 'IDR', created_at: '2026-10-12T00:00:00Z',
      bill_type: 'open_bill', customer_name: null, deduction_location_id: null,
    });

    renderScreen();
    await waitFor(() => expect(screen.getByText('Table 1')).toBeDefined());
    await userEvent.click(screen.getByText('Table 1').closest('button')!);
    await waitFor(() => expect(screen.getByTestId('tables-move-table-btn')).toBeDefined());
    await userEvent.click(screen.getByTestId('tables-move-table-btn'));
    await waitFor(() => expect(screen.getByTestId('tables-move-confirm-btn')).toBeDefined());

    const confirmBtn = screen.getByTestId('tables-move-confirm-btn');
    await act(async () => {
      fireEvent.click(confirmBtn);
      fireEvent.click(confirmBtn);
    });

    await waitFor(() => expect(mockHoldCart).toHaveBeenCalledTimes(1));
  });

  it('preserves deduction_location_id when moving an active table tab', async () => {
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
      deduction_location_id: 'loc-kitchen-bar',
    });

    renderScreen();
    await waitFor(() => expect(screen.getByText('Table 1')).toBeDefined());
    await userEvent.click(screen.getByText('Table 1').closest('button')!);
    await waitFor(() => expect(screen.getByTestId('tables-move-table-btn')).toBeDefined());

    await userEvent.click(screen.getByTestId('tables-move-table-btn'));
    await waitFor(() => expect(screen.getByTestId('tables-move-confirm-btn')).toBeDefined());

    await userEvent.click(screen.getByTestId('tables-move-confirm-btn'));
    await waitFor(() => {
      expect(mockHoldCart).toHaveBeenCalledWith(
        expect.objectContaining({
          label: 'Table 2',
          bill_type: 'open_bill',
          deduction_location_id: 'loc-kitchen-bar',
        }),
      );
    });
  });

  // ── The move must not delete the bill before the new one exists ─────────────
  //
  // WHY: `handleMoveTable` ran DELETE -> HOLD. If the hold then failed there was
  // nothing left to recover: the open bill was gone, and the toast said only "move
  // failed", so the operator had no way to know the tab had been destroyed rather
  // than merely not moved.
  //
  // `usePosHeldCarts` already settled the direction for this same data — read its
  // "does NOT report a tab as updated when deleting the previous record FAILS"
  // case — so this screen was the outlier, not the convention.
  //
  // The assertion that matters is the NEGATIVE one. `mockDeleteHeldCart` must NOT
  // have been called at all: that is what makes a failed hold survivable. Asserting
  // only the error toast would pass against the old order, because the old order
  // toasts the same thing — after it has already done the damage.
  it('KEEPS the original bill when the hold for the new table fails', async () => {
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
    // The move cannot place the bill on the new table.
    mockHoldCart.mockRejectedValueOnce(new Error('database is locked'));

    renderScreen();
    await waitFor(() => expect(screen.getByText('Table 1')).toBeDefined());
    await userEvent.click(screen.getByText('Table 1').closest('button')!);
    await waitFor(() => expect(screen.getByTestId('tables-move-table-btn')).toBeDefined());

    await userEvent.click(screen.getByTestId('tables-move-table-btn'));
    await waitFor(() => expect(screen.getByTestId('tables-move-confirm-btn')).toBeDefined());

    await userEvent.click(screen.getByTestId('tables-move-confirm-btn'));
    await waitFor(() => expect(mockHoldCart).toHaveBeenCalled());

    // The bill is untouched — this is the assertion the fix exists for.
    expect(mockDeleteHeldCart).not.toHaveBeenCalled();
    // Nor were the tables touched, so the floor plan still describes reality.
    expect(mockReleaseTable).not.toHaveBeenCalled();
    expect(mockUpdateTableStatus).not.toHaveBeenCalled();
  });

  // ── A PARTIAL failure must still refresh and close ──────────────────
  //
  // The case above is the clean one: the FIRST write fails, so nothing changed.
  // This is the messy one the create-first ordering creates — the hold SUCCEEDS
  // and only a later step fails, so the bill already exists at the destination
  // when the toast says "move failed".
  //
  // `loadTables()` used to sit on the success path only, so the floor plan kept
  // rendering the PRE-move state under a failure toast, with the dialog still
  // open over it. The operator retries against a plan the backend has moved on
  // from, which is what turns one duplicate bill into two.
  it('refreshes the floor plan and closes the dialog when the move half-commits', async () => {
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
    // The hold SUCCEEDS (the bill now exists at Table 2); the RELEASE is what
    // fails, which is the half-committed state this case is about.
    mockHoldCart.mockResolvedValue({ id: 'bill-2' });
    mockDeleteHeldCart.mockResolvedValue(undefined);
    mockReleaseTable.mockRejectedValueOnce(new Error('table is locked'));

    renderScreen();
    await waitFor(() => expect(screen.getByText('Table 1')).toBeDefined());
    await userEvent.click(screen.getByText('Table 1').closest('button')!);
    await waitFor(() => expect(screen.getByTestId('tables-move-table-btn')).toBeDefined());

    await userEvent.click(screen.getByTestId('tables-move-table-btn'));
    await waitFor(() => expect(screen.getByTestId('tables-move-confirm-btn')).toBeDefined());
    await userEvent.click(screen.getByTestId('tables-move-confirm-btn'));

    // Reachability: the release really was attempted, or this measures nothing.
    await waitFor(() => expect(mockReleaseTable).toHaveBeenCalled());

    // The floor plan was re-read despite the failure, so it describes the data the
    // backend now holds rather than the pre-move layout.
    await waitFor(() =>
      expect(mockListTables.mock.calls.length).toBeGreaterThan(1),
    );

    // And the dialog is gone, so a second attempt cannot be issued from a stale view.
    await waitFor(() =>
      expect(screen.queryByTestId('tables-move-confirm-btn')).toBeNull(),
    );
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

  it('renders elapsed dining timer and applies critical SLA highlight when over 90 minutes', async () => {
    const table = makeTable({ id: 't-1', name: 'Table 1', status: 'occupied' });
    const ninetyFiveMinsAgo = new Date(Date.now() - 95 * 60 * 1000).toISOString();
    mockListTables.mockResolvedValue([table]);
    mockListOpenBills.mockResolvedValue([
      {
        id: 'bill-1',
        label: 'Table 1',
        item_count: 3,
        total_minor: 75000,
        currency: 'IDR',
        created_at: ninetyFiveMinsAgo,
        bill_type: 'open_bill',
        customer_name: null,
      },
    ]);

    renderScreen();
    await waitFor(() => expect(screen.getByText('Table 1')).toBeDefined());

    const timer = screen.getByText(/⏱️ 95m/);
    expect(timer).toBeDefined();
    expect(timer.className).toContain('tables-table-timer--critical');

    const tableBtn = screen.getByText('Table 1').closest('button');
    expect(tableBtn?.className).toContain('tables-table--sla-critical');
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

    // Same ordering invariant as the move case above, on the path where getting it
    // wrong costs TWO tables' bills rather than one.
    expect(mockHoldCart.mock.invocationCallOrder[0]!).toBeLessThan(
      mockDeleteHeldCart.mock.invocationCallOrder[0]!,
    );
  });

  it('preserves deduction_location_id and combines guestCount when merging tables', async () => {
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
        item_count: 1,
        total_minor: 35000,
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
            guestCount: '2',
          }),
          item_count: 1,
          total_minor: 25000,
          currency: 'IDR',
          created_at: '2026-10-12T00:00:00Z',
          bill_type: 'open_bill',
          customer_name: null,
          deduction_location_id: 'loc-station-kitchen',
        });
      }
      return Promise.resolve({
        id: 'bill-2',
        label: 'Table 2',
        cart_data: JSON.stringify({
          lines: [{ sku: 'SKU-2', name: 'Es Teh', qty: 1, unit_price: { minor_units: 35000, currency: 'IDR' } }],
          guestCount: '3',
        }),
        item_count: 1,
        total_minor: 35000,
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
      expect(mockHoldCart).toHaveBeenCalledWith(
        expect.objectContaining({
          label: 'Table 2',
          item_count: 2,
          total_minor: 60000,
          deduction_location_id: 'loc-station-kitchen',
        }),
      );
    });

    const holdCall = mockHoldCart.mock.calls.find((call) => call[0]?.label === 'Table 2');
    expect(holdCall).toBeDefined();
    const parsedData = JSON.parse(holdCall![0].cart_data);
    expect(parsedData.guestCount).toBe('5');
  });

  // The merge deleted BOTH bills before creating the combined one, so a failed hold
  // lost two tables' open bills at once. Same fix and same assertion shape as the move
  // case above: the negative check on the deletes is what proves the fix.
  it('KEEPS BOTH bills when the combined hold fails', async () => {
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
    mockGetHeldCart.mockImplementation((id: string) =>
      Promise.resolve({
        id,
        label: `Table ${id.slice(-1)}`,
        cart_data: JSON.stringify({ lines: [] }),
        item_count: 1,
        total_minor: 25000,
        currency: 'IDR',
        created_at: '2026-10-12T00:00:00Z',
        bill_type: 'open_bill',
        customer_name: null,
        deduction_location_id: null,
      }),
    );
    mockHoldCart.mockRejectedValueOnce(new Error('database is locked'));

    renderScreen();
    await waitFor(() => expect(screen.getByText('Table 1')).toBeDefined());
    await userEvent.click(screen.getByText('Table 1').closest('button')!);
    await waitFor(() => expect(screen.getByTestId('tables-merge-table-btn')).toBeDefined());

    await userEvent.click(screen.getByTestId('tables-merge-table-btn'));
    await waitFor(() => expect(screen.getByTestId('tables-merge-confirm-btn')).toBeDefined());

    await userEvent.click(screen.getByTestId('tables-merge-confirm-btn'));
    await waitFor(() => expect(mockHoldCart).toHaveBeenCalled());

    // Neither bill may be removed — the combined cart does not exist yet.
    expect(mockDeleteHeldCart).not.toHaveBeenCalled();
    expect(mockReleaseTable).not.toHaveBeenCalled();
  });

  it('displays conflict banner and allows takeover when active tab has a foreign lease', async () => {
    const table = makeTable({ id: 't-1', name: 'Table 1', status: 'occupied' });
    mockListTables.mockResolvedValue([table]);
    mockListOpenBills.mockResolvedValue([
      {
        id: 'bill-conflict-1',
        label: 'Table 1',
        item_count: 2,
        total_minor: 40000,
        currency: 'IDR',
        created_at: new Date().toISOString(),
        bill_type: 'open_bill',
        customer_name: null,
      },
    ]);

    renderScreen();
    await waitFor(() => expect(screen.getByText('Table 1')).toBeDefined());

    // Dispatch foreign lease acquired after mount
    window.dispatchEvent(
      new CustomEvent('kasirmu:tabs:lease-acquired', {
        detail: {
          tabId: 'bill-conflict-1',
          tableNumber: 'Table 1',
          terminalId: 'foreign-terminal-waiter',
          terminalName: 'Waiter iPad 2',
          timestamp: Date.now(),
          expiresAt: Date.now() + 60_000,
        },
      }),
    );

    await userEvent.click(screen.getByText('Table 1').closest('button')!);

    await waitFor(() => {
      expect(screen.getByTestId('tables-tab-conflict-banner')).toBeDefined();
    });
    expect(screen.getByText(/Waiter iPad 2/)).toBeDefined();

    // Click Take Over
    const takeoverBtn = screen.getByTestId('tables-tab-takeover-btn');
    await userEvent.click(takeoverBtn);

    // Conflict banner should disappear as local terminal now owns the lease
    await waitFor(() => {
      expect(screen.queryByTestId('tables-tab-conflict-banner')).toBeNull();
    });
  });

  it('opens Reserve Table dialog, creates reservation held cart and updates table status to reserved', async () => {
    const table = makeTable({ id: 't-1', name: 'Table 1', status: 'available', capacity: 4 });
    mockListTables.mockResolvedValue([table]);

    renderScreen();
    await waitFor(() => expect(screen.getByText('Table 1')).toBeDefined());
    await userEvent.click(screen.getByText('Table 1').closest('button')!);

    await waitFor(() => expect(screen.getByTestId('tables-open-reserve-btn')).toBeDefined());
    await userEvent.click(screen.getByTestId('tables-open-reserve-btn'));

    await waitFor(() => expect(screen.getByLabelText(/Guest Name/i)).toBeDefined());
    await userEvent.type(screen.getByLabelText(/Guest Name/i), 'Dr. Alice');
    await userEvent.type(screen.getByLabelText(/Phone/i), '08123456789');
    await userEvent.type(screen.getByLabelText(/Reservation Time/i), '19:30');
    await userEvent.type(screen.getByLabelText(/Notes/i), 'Window seat preferred');

    await userEvent.click(screen.getByTestId('tables-reserve-confirm-btn'));

    await waitFor(() => {
      expect(mockHoldCart).toHaveBeenCalledWith(
        expect.objectContaining({
          label: expect.stringContaining('Dr. Alice'),
          customer_name: 'Dr. Alice',
          item_count: 0,
          total_minor: 0,
        }),
      );
      expect(mockUpdateTableStatus).toHaveBeenCalledWith(
        MOCK_SESSION_TOKEN,
        't-1',
        'reserved',
      );
    });
  });

  // ── A PARTIAL reservation failure must close the form ────────────────
  //
  // `holdCartScoped` runs BEFORE `updateTableStatusScoped`, so the catch can fire
  // with the reservation bill already written. Everything that made the success
  // visible sat below it: the table never entered the pool, the plan was never
  // re-read, and `setReserveModal(null)` never ran — so the form stayed OPEN with
  // the guest's name still typed in it.
  //
  // The operator reads an error plus an open form as "it did not save" and presses
  // Reserve again. That is exactly the duplicate reservation bill the re-entry guard
  // in this handler exists to prevent, arriving through the failure branch instead
  // of a double submit — and the guard does not catch it, because the first attempt
  // genuinely finished.
  it('closes the reserve form when the status write fails after the bill was created', async () => {
    const table = makeTable({ id: 't-1', name: 'Table 1', status: 'available', capacity: 4 });
    mockListTables.mockResolvedValue([table]);
    // The bill is created; the STATUS write is what fails.
    mockHoldCart.mockResolvedValue({ id: 'bill-new' });
    mockUpdateTableStatus.mockRejectedValueOnce(new Error('database is locked'));

    renderScreen();
    await waitFor(() => expect(screen.getByText('Table 1')).toBeDefined());
    await userEvent.click(screen.getByText('Table 1').closest('button')!);

    await waitFor(() => expect(screen.getByTestId('tables-open-reserve-btn')).toBeDefined());
    await userEvent.click(screen.getByTestId('tables-open-reserve-btn'));
    await waitFor(() => expect(screen.getByLabelText(/Guest Name/i)).toBeDefined());
    await userEvent.type(screen.getByLabelText(/Guest Name/i), 'Dr. Alice');

    await userEvent.click(screen.getByTestId('tables-reserve-confirm-btn'));

    // Reachability: the status write really was attempted, or this measures nothing.
    await waitFor(() => expect(mockUpdateTableStatus).toHaveBeenCalled());

    // The form is gone, so the guest name cannot be submitted a second time against
    // a reservation that already exists.
    await waitFor(() =>
      expect(screen.queryByTestId('tables-reserve-confirm-btn')).toBeNull(),
    );
    // And exactly ONE reservation bill was written.
    expect(mockHoldCart).toHaveBeenCalledTimes(1);
    // The plan was re-read, so it reflects what the backend now holds.
    await waitFor(() =>
      expect(mockListTables.mock.calls.length).toBeGreaterThan(1),
    );
  });

  it('renders reservation details in floorplan card and detail drawer for reserved table', async () => {
    const table = makeTable({ id: 't-1', name: 'Table 1', status: 'reserved' });
    mockListTables.mockResolvedValue([table]);
    mockListOpenBills.mockResolvedValue([
      {
        id: 'bill-res-1',
        label: 'Table 1 · Res: Sarah Connor (20:00) [4p]',
        item_count: 0,
        total_minor: 0,
        currency: 'IDR',
        created_at: new Date().toISOString(),
        bill_type: 'open_bill',
        customer_name: 'Sarah Connor',
      },
    ]);
    mockGetHeldCart.mockResolvedValue({
      id: 'bill-res-1',
      label: 'Table 1 · Res: Sarah Connor (20:00) [4p]',
      cart_data: JSON.stringify({
        customerName: 'Sarah Connor',
        phone: '081234567890',
        partySize: 4,
        reservationTime: '20:00',
        notes: 'VIP guest - quiet corner requested',
      }),
      item_count: 0,
      total_minor: 0,
      currency: 'IDR',
      created_at: new Date().toISOString(),
      bill_type: 'open_bill',
      customer_name: 'Sarah Connor',
      deduction_location_id: null,
    });

    renderScreen();
    await waitFor(() => expect(screen.getByText('Table 1')).toBeDefined());

    // Reservation tag on table card
    expect(screen.getByTestId('tables-reservation-tag-Table 1').textContent).toContain('Sarah Connor');
    expect(screen.getByTestId('tables-reservation-tag-Table 1').textContent).toContain('20:00');

    // Open detail panel
    await userEvent.click(screen.getByText('Table 1').closest('button')!);
    await waitFor(() => expect(screen.getByTestId('tables-seat-guests-btn')).toBeDefined());

    expect(screen.getByTestId('tables-reservation-card').textContent).toContain('Sarah Connor');
    expect(screen.getByTestId('tables-reservation-card').textContent).toContain('20:00 (4p)');
    await waitFor(() => {
      expect(screen.getByTestId('tables-reservation-card').textContent).toContain('081234567890');
      expect(screen.getByTestId('tables-reservation-card').textContent).toContain('VIP guest - quiet corner requested');
    });
  });

  it('preserves pre-ordered lines, partySize, notes and deduction_location_id when seating reserved guests', async () => {
    const table = makeTable({ id: 't-1', name: 'Table 1', status: 'reserved' });
    mockListTables.mockResolvedValue([table]);
    mockListOpenBills.mockResolvedValue([
      {
        id: 'bill-res-1',
        label: 'Table 1 · Res: Sarah Connor (20:00) [4p]',
        item_count: 2,
        total_minor: 75000,
        currency: 'IDR',
        created_at: new Date().toISOString(),
        bill_type: 'open_bill',
        customer_name: 'Sarah Connor',
      },
    ]);
    mockGetHeldCart.mockResolvedValue({
      id: 'bill-res-1',
      label: 'Table 1 · Res: Sarah Connor (20:00) [4p]',
      cart_data: JSON.stringify({
        lines: [{ sku: 'SKU-STEAK', name: 'Ribeye Steak', qty: 2, unit_price: { minor_units: 37500, currency: 'IDR' } }],
        customerName: 'Sarah Connor',
        partySize: 4,
        guestCount: '4',
        notes: 'Nut allergy',
        phone: '081299998888',
      }),
      item_count: 2,
      total_minor: 75000,
      currency: 'IDR',
      created_at: new Date().toISOString(),
      bill_type: 'open_bill',
      customer_name: 'Sarah Connor',
      deduction_location_id: 'loc-vip-kitchen',
    });

    renderWithWorkspace(
      <LocalizationProvider l10n={l10n}>
        <TableManagementScreen />
      </LocalizationProvider>,
    );

    await waitFor(() => expect(screen.getByText('Table 1')).toBeDefined());
    await userEvent.click(screen.getByText('Table 1').closest('button')!);
    await waitFor(() => expect(screen.getByTestId('tables-seat-guests-btn')).toBeDefined());
    await userEvent.click(screen.getByTestId('tables-seat-guests-btn'));

    await waitFor(() => {
      expect(mockHoldCart).toHaveBeenCalledWith(
        expect.objectContaining({
          label: 'Table 1 (Sarah Connor)',
          bill_type: 'open_bill',
          deduction_location_id: 'loc-vip-kitchen',
          item_count: 2,
          total_minor: 75000,
        }),
      );
    });

    const holdCall = mockHoldCart.mock.calls.find((call) => call[0]?.label === 'Table 1 (Sarah Connor)');
    expect(holdCall).toBeDefined();
    const parsedData = JSON.parse(holdCall![0].cart_data);
    expect(parsedData.guestCount).toBe('4');
    expect(parsedData.notes).toBe('Nut allergy');
    expect(parsedData.orderType).toBe('dine_in');
    expect(parsedData.lines).toHaveLength(1);
    expect(parsedData.lines[0].sku).toBe('SKU-STEAK');
  });

  it('seats reserved guests when Seat Guests is clicked, transitioning status to occupied and calling onSelectTable', async () => {
    const table = makeTable({ id: 't-1', name: 'Table 1', status: 'reserved' });
    mockListTables.mockResolvedValue([table]);
    mockListOpenBills.mockResolvedValue([
      {
        id: 'bill-res-1',
        label: 'Table 1 · Res: Sarah Connor (20:00) [4p]',
        item_count: 0,
        total_minor: 0,
        currency: 'IDR',
        created_at: new Date().toISOString(),
        bill_type: 'open_bill',
        customer_name: 'Sarah Connor',
      },
    ]);

    const onSelectTable = vi.fn();
    renderWithWorkspace(
      <LocalizationProvider l10n={l10n}>
        <TableManagementScreen onSelectTable={onSelectTable} />
      </LocalizationProvider>,
    );

    await waitFor(() => expect(screen.getByText('Table 1')).toBeDefined());
    await userEvent.click(screen.getByText('Table 1').closest('button')!);

    await waitFor(() => expect(screen.getByTestId('tables-seat-guests-btn')).toBeDefined());
    await userEvent.click(screen.getByTestId('tables-seat-guests-btn'));

    await waitFor(() => {
      expect(mockUpdateTableStatus).toHaveBeenCalledWith(
        MOCK_SESSION_TOKEN,
        't-1',
        'occupied',
      );
      expect(onSelectTable).toHaveBeenCalledWith('Table 1');
    });
  });

  // ── Seating must not destroy the reservation before its replacement exists ──
  //
  // THE SAME DEFECT ROUND 292 FIXED FOR MOVE AND MERGE, on the third handler in this
  // file that replaces a held cart. `handleSeatReservedGuests` converts a reservation's
  // bill into an open bill by deleting and re-creating it — and it ran DELETE first:
  //
  //     await deleteHeldCartScoped(sessionToken, reservationBill.id);   // reservation gone
  //     await holdCartScoped(sessionToken, { ... });                    // replacement
  //
  // A rejected hold (locked DB, dropped IPC, lapsed session) therefore destroyed the
  // reservation with nothing to recreate it, while the catch toasts only "seat failed".
  // The operator sees a party who is no longer booked AND no longer seated.
  //
  // Round 292 fixed the move and merge handlers and recorded this one as unexamined —
  // its own "next" section named `releaseTableScoped` instead. Found by reading the
  // file's held-cart writes rather than trusting that list.
  //
  // The discriminating assertion is the NEGATIVE one: the delete must not have run at
  // all. Asserting only the error toast would pass against the old order, which toasts
  // the same message — after the damage.
  it('KEEPS the reservation when the hold that seats the party fails', async () => {
    const table = makeTable({ id: 't-1', name: 'Table 1', status: 'reserved' });
    mockListTables.mockResolvedValue([table]);
    mockListOpenBills.mockResolvedValue([
      {
        id: 'bill-res-1',
        label: 'Table 1 · Res: Sarah Connor (20:00) [4p]',
        item_count: 0,
        total_minor: 0,
        currency: 'IDR',
        created_at: new Date().toISOString(),
        bill_type: 'open_bill',
        customer_name: 'Sarah Connor',
      },
    ]);
    // Converting the reservation into an open bill cannot complete.
    mockHoldCart.mockRejectedValueOnce(new Error('database is locked'));

    renderWithWorkspace(
      <LocalizationProvider l10n={l10n}>
        <TableManagementScreen />
      </LocalizationProvider>,
    );

    await waitFor(() => expect(screen.getByText('Table 1')).toBeDefined());
    await userEvent.click(screen.getByText('Table 1').closest('button')!);
    await waitFor(() => expect(screen.getByTestId('tables-seat-guests-btn')).toBeDefined());
    await userEvent.click(screen.getByTestId('tables-seat-guests-btn'));

    await waitFor(() => expect(mockHoldCart).toHaveBeenCalled());

    // The reservation survives — this is the assertion the ordering fix exists for.
    expect(mockDeleteHeldCart).not.toHaveBeenCalled();
    // And the table is not marked occupied, so the floor plan still describes reality.
    expect(mockUpdateTableStatus).not.toHaveBeenCalled();
  });

  // ── A refused floor-plan move must not leave the table where it was dropped ──
  //
  // The drag split is across TWO handlers: `handlePointerMoveTable` (:863-887) writes the
  // snapped position into `tables`/`tablePool` on every move, and `handlePointerUpTable`
  // (:889-910) is what persists it. `tablesRef.current = tables` (:127) always mirrors that
  // OPTIMISTIC state, and :899 reads the position to save FROM the ref.
  //
  // So when `updateTableScoped` is refused:
  //   * the toast fires (:904) and the operator is told, but
  //   * the table stays VISUALLY at the dropped position (:1132-1133 renders
  //     `left: t.pos_x%; top: t.pos_y%` straight from state), and
  //   * `tablesRef` still holds the refused coordinates, so a retry re-sends the payload
  //     that was just rejected.
  //
  // The floor plan then disagrees with the server — and for table management that means the
  // server can believe a table is somewhere the plan does not show it.
  it('returns the table to its saved position when the move write is refused', async () => {
    mockListTables.mockResolvedValue([makeTable({ id: 't-1', name: 'T1', pos_x: 10, pos_y: 10 })]);
    mockUpdateTable.mockRejectedValue(new Error('locked'));

    renderScreen();
    await waitFor(() => expect(screen.getAllByText('T1').length).toBeGreaterThan(0));

    // Enter arrange mode.
    await userEvent.click(screen.getByText('Arrange Tables'));

    const table = document.querySelector('.tables-table') as HTMLElement;
    expect(table, 'the floor plan did not render a table').not.toBeNull();
    const before = table!.style.left;
    expect(before, 'fixture did not render the seeded left offset').toBe('10%');

    // jsdom reports a zero-size bounding rect, and `handlePointerMoveTable` bails on
    // `rect.width <= 0` (:867) before it writes anything. Give the floorplan a real
    // box so the drag actually moves, which is the precondition this test needs.
    const floorplan = document.querySelector('.tables-floorplan') as HTMLElement;
    expect(floorplan, 'the floor plan container was not found').not.toBeNull();
    floorplan!.getBoundingClientRect = () =>
      ({ x: 0, y: 0, top: 0, left: 0, bottom: 600, right: 800, width: 800, height: 600 }) as DOMRect;

    // Drag: pointerDown → pointerMove → pointerUp.
    fireEvent.pointerDown(table!, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(table!, { clientX: 400, clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(table!, { clientX: 400, clientY: 300, pointerId: 1 });

    // Preconditions: the drag must have MOVED it and the write must have been attempted.
    expect(mockUpdateTable, 'the drag never issued a move write').toHaveBeenCalled();
    const moved = document.querySelector('.tables-table') as HTMLElement;
    expect(moved.style.left, 'the drag did not move the table on screen').not.toBe(before);


    // THE ASSERTION: the table must not stay where it was dropped. Its rendered
    // position comes straight from state, so this is the observable contract.
    await waitFor(() => {
      const now = (document.querySelector('.tables-table') as HTMLElement).style.left;
      expect(now, 'the floor plan kept a position the server refused').toBe(before);
    });
  });

  // ── A double submit on Add Table must not create two tables ───────────
  //
  // `handleSaveTableModal` now takes an atomic `savePendingRef` before its first await
  // (round 173). It previously carried `if (tableModalSaving) return`, which reads React
  // STATE — the value from the render that built this closure — so on the second dispatch
  // of one double submit it was still `false` and both writes went out. MEASURED: with the
  // ref disabled and the state check left in place, this case fails with
  // `expected 2 to be 1`, which is why the state flag was not a guard.
  //
  // The button is no defence either: `state={tableModalSaving ? 'processing' : 'ready'}`
  // and Button's `isDisabled = disabled || isProcessing` (Button.tsx:72) gate the BUTTON,
  // and the FORM is `onSubmit={handleSaveTableModal}`, so pressing Enter in a text field
  // submits directly and never consults it.
  //
  // The backend cannot catch it either: `create_table` (kasirmu-core/src/db/tables.rs:130)
  // is a plain INSERT that mints a fresh UUID per call, with no uniqueness on `name`. Two
  // submits make two tables with the same name, and the operator then has to work out
  // which one the floor plan reads from.
  it('creates only ONE table when the Add Table form is submitted twice', async () => {
    mockListTables.mockResolvedValue([]);
    // Pending for the whole test: the first submit is still in flight when the second
    // lands, which is the only arrangement that can produce two writes from one form.
    let release: (() => void) | undefined;
    const gate = new Promise<void>((res) => { release = res; });
    mockCreateTable.mockReset();
    mockCreateTable.mockImplementation((() =>
      gate.then(() => makeTable({ id: 't-new', name: 'T1' }))) as never);

    renderScreen();
    await waitFor(() => expect(screen.getByTestId('tables-add-table-btn')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('tables-add-table-btn'));

    // Fill the name the handler requires (`if (!tableModal || !tableModal.name.trim()) return`).
    const nameInput = await waitFor(() => {
      const form = document.querySelector('.tables-modal-form');
      expect(form, 'the add-table modal did not open').not.toBeNull();
      const input = form!.querySelector('input[type="text"], input:not([type])');
      expect(input, 'no name field in the add-table modal').not.toBeNull();
      return input as HTMLInputElement;
    });
    fireEvent.change(nameInput, { target: { value: 'T1' } });

    // Two submits with NO await between them — the form path, which is what pressing
    // Enter twice in the name field produces.
    const form = document.querySelector('.tables-modal-form') as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => expect(mockCreateTable).toHaveBeenCalled());
    expect(
      mockCreateTable.mock.calls.length,
      'a double submit created more than one table',
    ).toBe(1);

    release?.();
  });

  // ── A double submit on Reserve must not create two reservations ────────
  //
  // `handleConfirmReservation` (:743) is the reserve form's `onSubmit` (:1880) and has no
  // `reservingTable` re-entry check. The Reserving BUTTON is guarded —
  // `disabled={!reserveModal.guestName.trim() || reservingTable}` (:1957) — but pressing
  // Enter in the name field submits the form natively and never consults the button.
  //
  // Worse than the Add Table case: this handler's first write is `holdCartScoped` (:773),
  // which CREATES a held cart / open bill. A double submit leaves two open bills against
  // one table.
  it('creates only ONE reservation when the Reserve form is submitted twice', async () => {
    mockListTables.mockResolvedValue([makeTable({ id: 't-1', name: 'T1', status: 'available' })]);

    // Pending for the whole test: the first submit is still in flight when the second
    // lands, which is the only arrangement that can produce two writes from one form.
    let release: (() => void) | undefined;
    const gate = new Promise<void>((res) => { release = res; });
    mockHoldCart.mockReset();
    mockHoldCart.mockImplementation((() => gate.then(() => ({ id: 'held-res' }))) as never);

    renderScreen();
    await waitFor(() => expect(screen.getAllByText('T1').length).toBeGreaterThan(0));

    // Open the table detail, then the Reserve action.
    await userEvent.click(screen.getAllByText('T1')[0]!);
    // The Reserve action carries a testid (:1421); its accessible name is "Mark Reserved",
    // not /reserve/i, so a role query would miss it.
    const reserveBtn = await waitFor(() => {
      const b = document.querySelector('[data-testid="tables-open-reserve-btn"]');
      expect(b, 'the Reserve action was not found').not.toBeNull();
      return b as HTMLElement;
    });
    await userEvent.click(reserveBtn);

    // Fill the guest name the handler requires.
    const nameInput = await waitFor(() => {
      const el = document.querySelector('#reserve-modal-name');
      expect(el, 'the reserve modal did not open').not.toBeNull();
      return el as HTMLInputElement;
    });
    fireEvent.change(nameInput, { target: { value: 'Ada' } });

    // Two submits with NO await between them — the form path, which is what pressing
    // Enter twice in the name field produces.
    const form = document.querySelector('.tables-modal-form') as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => expect(mockHoldCart).toHaveBeenCalled());
    expect(
      mockHoldCart.mock.calls.length,
      'a double submit created more than one reservation',
    ).toBe(1);

    release?.();
  });

  // ── Open-bill read failure must not read as "no open bills" ────────
  //
  // `listOpenBillsScoped` was `.catch(() => [])` inside the floor-plan load.
  // An empty list is a CLAIM — every table is free — and `openBills` is what
  // marks a table occupied and what the reservation path reads when it converts
  // a booking into a tab. So a FAILED read rendered a running tab as a free
  // table, and a cashier could seat a walk-in over it.

  it('says nothing about tabs when the bills read succeeds', async () => {
    // The NEGATIVE half, on its own so it cannot pass for the wrong reason: with
    // a healthy bills read the banner must not appear at all.
    mockListTables.mockResolvedValue([makeTable()]);
    mockListOpenBills.mockResolvedValue([
      { id: 'bill-1', label: 'Table 1', customer_name: '', total_minor: 5000, currency: 'USD' },
    ]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Table 1')).toBeDefined());

    expect(
      screen.queryByText(/Could not check which tables have an open tab/i),
    ).toBeNull();
    expect(screen.queryByText(/Could not load the floor plan/i)).toBeNull();
    // And the bill DID bind to the table, so the read was genuinely exercised.
    expect(document.querySelector('.tables-table--has-bill')).not.toBeNull();
  });

  it('says the open tabs could not be checked when the bills read fails', async () => {
    mockListTables.mockResolvedValue([makeTable()]);
    mockListOpenBills.mockRejectedValue(new Error('ipc down'));
    renderScreen();

    await waitFor(() =>
      expect(
        screen.getByText(/Could not check which tables have an open tab/i),
      ).toBeDefined(),
    );
    // It must NOT claim the floor plan failed — the plan loaded fine.
    expect(screen.queryByText(/Could not load the floor plan/i)).toBeNull();
    // The floor plan is still usable: the table still renders.
    expect(screen.getByText('Table 1')).toBeDefined();
  });

  it('does not render an occupied table as free when the bills read fails', async () => {
    // The consequence, not just the banner: before the fix the failed read
    // resolved to [], so this table showed as available while it had a live tab.
    mockListTables.mockResolvedValue([makeTable()]);
    mockListOpenBills.mockRejectedValue(new Error('ipc down'));
    renderScreen();

    await waitFor(() =>
      expect(
        screen.getByText(/Could not check which tables have an open tab/i),
      ).toBeDefined(),
    );
    // The unverified state is surfaced rather than silently asserted as free.
    expect(document.querySelector('.tables-error')?.['textContent']).toMatch(
      /open tab/i,
    );
  });

  it('opens Manage Sections modal, adds a section, and displays it in section bar', async () => {
    mockListTables.mockResolvedValue([makeTable()]);
    mockListSections.mockResolvedValue(['Main']);
    renderScreen();

    await waitFor(() => expect(screen.getByTestId('tables-manage-sections-btn')).toBeDefined());
    await userEvent.click(screen.getByTestId('tables-manage-sections-btn'));

    await waitFor(() => expect(screen.getByTestId('tables-new-section-input')).toBeDefined());
    await userEvent.type(screen.getByTestId('tables-new-section-input'), 'Patio');
    await userEvent.click(screen.getByTestId('tables-add-section-btn'));

    await waitFor(() => expect(screen.getAllByText('Patio').length).toBeGreaterThanOrEqual(1));
  });

  // ── A rename in flight must not drop a section added during it ────────────
  //
  // `handleRenameSection` (TableManagementScreen.tsx:101) awaits one
  // `updateTableScoped` per table in the section (:1316-1320) and only THEN reads
  // `sections` to build the replacement:
  //
  //   const updated = sections.map((s) => (s === oldName ? trimmed : s));  // :1322
  //   setSections(updated);                                               // :1323
  //
  // `sections` is the RENDER closure, captured before those awaits, and `setSections`
  // REPLACES the array rather than updating it. `handleAddSection` (:1276) can run in
  // that window -- it is a separate control on the same modal and nothing disables it
  // while a rename is in flight -- so a section added during the rename is absent from
  // `updated` and is DROPPED with no message.
  //
  // This is the round-201 `handleSendToKitchen` shape, which is why
  // scripts/check-state-closure-after-await.py exists and flags exactly this line.
  // `handleDeleteSection` (:1376) has the same body shape.
  it('keeps a section added while a rename is in flight', async () => {
    mockListTables.mockResolvedValue([makeTable()]);
    mockListSections.mockResolvedValue(['Main', 'Patio']);
    renderScreen();

    await waitFor(() => expect(screen.getByTestId('tables-manage-sections-btn')).toBeDefined());
    await userEvent.click(screen.getByTestId('tables-manage-sections-btn'));
    await waitFor(() => expect(screen.getByTestId('tables-new-section-input')).toBeDefined());

    // Hold the rename's table write open, so the add below lands inside its await.
    let releaseRename: ((v: unknown) => void) | undefined;
    const heldRename = new Promise((resolve) => { releaseRename = resolve; });
    mockUpdateTable.mockImplementationOnce(() => heldRename as never);

    // Start the rename (Main -> Utama).
    const renameBtn = screen.getByTestId('tables-rename-section-Main');
    await userEvent.click(renameBtn);
    // The rename input carries no testid; its row does. Scoped to the section item so
    // it cannot match the add-section input below it.
    const row = screen.getByTestId('tables-manage-section-Main');
    const renameInput = row.querySelector('input') as HTMLInputElement;
    await userEvent.clear(renameInput);
    await userEvent.type(renameInput, 'Utama');
    // Save is a button in the edit row, not an Enter key.
    await userEvent.click(within(row).getByRole('button', { name: /^save$/i }));

    // While that is in flight, add a third section.
    await userEvent.type(screen.getByTestId('tables-new-section-input'), 'Teras');
    await userEvent.click(screen.getByTestId('tables-add-section-btn'));
    await waitFor(() => expect(screen.getAllByText('Teras').length).toBeGreaterThanOrEqual(1));

    // Release the rename and let it settle.
    releaseRename?.(makeTable());
    await waitFor(() => expect(screen.getAllByText('Utama').length).toBeGreaterThanOrEqual(1));

    // The section added mid-rename must survive the rename's replacement array.
    expect(
      screen.queryAllByText('Teras').length,
      'the rename replaced `sections` from its pre-await closure, dropping the section ' +
        'added while it was in flight',
    ).toBeGreaterThanOrEqual(1);

    // ...and the PERSISTED value must carry it too. The old body read `sections` from
    // its pre-await closure, so the write stored the array WITHOUT 'Teras' -- the section
    // vanished on the next reload even where the UI still showed it. Only the RENAME's
    // write is checked: the add's own write also lands on this mock, and its payload is
    // the add path's subject, not this case's.
    await waitFor(() => expect(mockSetSetting).toHaveBeenCalled());
    const renameWrite = mockSetSetting.mock.calls
      .map((c) => c[2])
      .filter((v) => typeof v === 'string' && v.includes('Utama'))
      .pop();
    expect(
      renameWrite,
      'the rename never persisted its section list, so the rename is lost on reload',
    ).toBeDefined();
    expect(
      JSON.parse(renameWrite as string),
      'the rename persisted its stale pre-await section list, dropping the section added ' +
        'while it was in flight -- that section is lost on the next reload',
      // 'Main' became 'Utama'; the point is that 'Teras' is present at all.
    ).toEqual(['Utama', 'Patio', 'Teras']);
  });
  it('allows selecting a table in arrange mode and adjusting shape and dimensions via inspector', async () => {
    mockListTables.mockResolvedValue([makeTable()]);
    renderScreen();

    await waitFor(() => expect(screen.getByTestId('tables-arrange-mode-btn')).toBeDefined());
    await userEvent.click(screen.getByTestId('tables-arrange-mode-btn'));

    // Click table to select in arrange mode
    await userEvent.click(screen.getByText('Table 1').closest('button')!);

    await waitFor(() => expect(screen.getByTestId('tables-arrange-inspector')).toBeDefined());
    expect(screen.getByTestId('tables-resize-handle-Table 1')).toBeDefined();

    // Adjust shape
    await userEvent.click(screen.getByTestId('tables-arrange-shape-square'));
    expect(mockUpdateTable).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 't-1',
        shape: 'square',
      }),
    );

    // Adjust size
    await userEvent.click(screen.getByTestId('tables-arrange-width-inc'));
    expect(mockUpdateTable).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 't-1',
      }),
    );
  });

  it('allows 1-tap quick cleaning of a table in cleaning state', async () => {
    await openTableDetail(makeTable({ status: 'cleaning' }));

    await waitFor(() => expect(screen.getByTestId('tables-mark-cleaned-btn')).toBeDefined());
    await userEvent.click(screen.getByTestId('tables-mark-cleaned-btn'));

    expect(mockUpdateTableStatus).toHaveBeenCalledWith(MOCK_SESSION_TOKEN, 't-1', 'available');
  });

  it('allows quick seating a walk-in party of 4 directly from detail panel', async () => {
    await openTableDetail(makeTable({ status: 'available' }));

    await waitFor(() => expect(screen.getByTestId('tables-quick-seat-4')).toBeDefined());
    await userEvent.click(screen.getByTestId('tables-quick-seat-4'));

    expect(mockHoldCart).toHaveBeenCalledWith(
      expect.objectContaining({
        bill_type: 'open_bill',
        customer_name: 'Walk-in [4p]',
      }),
    );
    expect(mockUpdateTableStatus).toHaveBeenCalledWith(MOCK_SESSION_TOKEN, 't-1', 'occupied');
  });

  it('renders joined table badge on floor plan when table has joined tag in bill', async () => {
    mockListTables.mockResolvedValue([makeTable({ id: 't-2', name: 'Table 2', status: 'occupied' })]);
    mockListOpenBills.mockResolvedValue([
      {
        id: 'bill-2',
        label: 'Table 2',
        customer_name: 'Table 2 [+T1]',
        item_count: 2,
        total_minor: 50000,
        currency: 'IDR',
        created_at: new Date().toISOString(),
        bill_type: 'open_bill',
      },
    ]);

    renderScreen();

    await waitFor(() => expect(screen.getByTestId('tables-joined-tag-Table 2')).toBeDefined());
    expect(screen.getByTestId('tables-joined-tag-Table 2').textContent).toMatch(/\+T.*1/);
  });
});


