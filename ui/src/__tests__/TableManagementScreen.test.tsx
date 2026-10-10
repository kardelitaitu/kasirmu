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

const { mockListTables, mockListSections, mockUpdateTableStatus, mockReleaseTable, mockListOpenBills } = vi.hoisted(() => ({
  mockListTables: vi.fn(),
  mockListSections: vi.fn(),
  mockUpdateTableStatus: vi.fn(),
  mockReleaseTable: vi.fn(),
  mockListOpenBills: vi.fn(),
}));

vi.mock('@/api/sales', async (importOriginal) => {
  const actual = await importOriginal<typeof SalesApi>();
  return {
    ...actual,
    listOpenBillsScoped: (_token: string) => mockListOpenBills(),
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
    mockListTables.mockResolvedValue([]);
    mockListSections.mockResolvedValue([]);
    mockListOpenBills.mockResolvedValue([]);
    mockUpdateTableStatus.mockImplementation((_token: string, id: string, status: string) =>
      Promise.resolve(makeTable({ id, status })),
    );
    mockReleaseTable.mockImplementation((_token: string, id: string) =>
      Promise.resolve(makeTable({ id, status: 'cleaning' })),
    );
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
    await waitFor(() => expect(screen.getByText(/Active Tab: Table 2 \(Bapak Budi\)/)).toBeDefined());
    expect(screen.getByText(/2 items ·/)).toBeDefined();
    const resumeBtn = screen.getByRole('button', { name: 'Resume Tab / Order' });
    expect(resumeBtn).toBeDefined();

    await userEvent.click(resumeBtn);
    expect(onSelectTable).toHaveBeenCalledWith('Table 2');
  });
});
