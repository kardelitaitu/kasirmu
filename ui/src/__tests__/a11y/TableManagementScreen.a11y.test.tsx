//! A11y regression tests for TableManagementScreen.
//!
//! The floor-plan screen is the last restaurant screen without axe coverage:
//! section tabs, the table grid, each table's status button, and the detail
//! panel with its status/reserve/release actions. Mounts with the tables + open
//! bill APIs stubbed and the REAL tables bundle, so the controls are named from
//! shipped copy.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import { renderWithProviders, checkA11y } from './axe-helper';
import TableManagementScreen from '@/features/tables/TableManagementScreen';
import tablesFtl from '@/locales/tables.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import type { Table } from '@/api/tables';
import type * as SalesApi from '@/api/sales';

const FTL = [sharedFtl, tablesFtl];

const mocks = vi.hoisted(() => ({
  listTables: vi.fn(),
  listSections: vi.fn(),
  updateTableStatus: vi.fn(),
  releaseTable: vi.fn(),
  listOpenBills: vi.fn(),
  createTable: vi.fn(),
  updateTable: vi.fn(),
  deleteTable: vi.fn(),
}));

vi.mock('@/api/sales', async (importOriginal) => {
  const actual = await importOriginal<typeof SalesApi>();
  return { ...actual, listOpenBillsScoped: () => mocks.listOpenBills() };
});

vi.mock('@/api/tables', () => ({
  listTables: (section?: string) => mocks.listTables(section),
  listTablesScoped: (_token: string, section?: string) => mocks.listTables(section),
  listSections: () => mocks.listSections(),
  listSectionsScoped: () => mocks.listSections(),
  updateTableStatus: (_u: string, id: string, status: string) => mocks.updateTableStatus(id, status),
  updateTableStatusScoped: (_t: string, id: string, status: string) => mocks.updateTableStatus(id, status),
  releaseTable: (_u: string, id: string) => mocks.releaseTable(id),
  releaseTableScoped: (_t: string, id: string) => mocks.releaseTable(id),
  createTable: (_t: string, table: Table) => mocks.createTable(table),
  createTableScoped: (_t: string, table: Table) => mocks.createTable(table),
  updateTable: (_t: string, table: Table) => mocks.updateTable(table),
  updateTableScoped: (_t: string, table: Table) => mocks.updateTable(table),
  deleteTable: (_t: string, id: string) => mocks.deleteTable(id),
  deleteTableScoped: (_t: string, id: string) => mocks.deleteTable(id),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ session: { user_id: 'user-1' } }),
}));

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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listTables.mockReset().mockResolvedValue([makeTable()]);
  mocks.listSections.mockReset().mockResolvedValue(['Main', 'Patio']);
  mocks.listOpenBills.mockReset().mockResolvedValue([]);
  mocks.updateTableStatus.mockReset().mockResolvedValue(makeTable({ status: 'reserved' }));
  mocks.releaseTable.mockReset().mockResolvedValue(makeTable({ status: 'cleaning' }));
  mocks.createTable.mockReset();
  mocks.updateTable.mockReset();
  mocks.deleteTable.mockReset();
});

describe('TableManagementScreen a11y', () => {
  it('has no axe violations on the floor plan', async () => {
    const { container } = renderWithProviders(<TableManagementScreen />, ...FTL);

    // Let the tables read settle, then pin that the real grid rendered rather
    // than an empty/loading state axe would also clear.
    await waitFor(() => {
      expect(container.querySelector('.tables-grid, [class*="table-"]')).toBeTruthy();
    });
    await checkA11y(container);

    expect(container.textContent).toContain('Table 1');
  });
});
