/**
 * @vitest-environment node
 *
 * This file's import graph is free of browser globals (no render, no
 * `document`/`window`/`localStorage`), so it does not need a jsdom window. Vitest
 * spawns a fresh jsdom per test FILE, which measured ~0.4-0.9s each; under the node
 * environment the same files report `environment: 0ms`.
 *
 * Do not copy this directive onto a file that renders or touches browser state —
 * it will fail with "document is not defined" rather than silently degrade.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('@/utils/logged-invoke', () => ({
  loggedInvoke: (...args: unknown[]) => mockInvoke(...args),
}));

import {
  listTables,
  listTablesScoped,
  createTable,
  createTableScoped,
  updateTable,
  deleteTable,
  updateTableStatus,
  updateTableStatusScoped,
} from '@/api/tables';

describe('tables.ts API contract', () => {
  const TOKEN = 'tok_tables';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const table = {
    id: 't1', name: 'Table 1', capacity: 4, pos_x: 100, pos_y: 200,
    shape: 'rect', width: 80, height: 60, status: 'available',
    active_sale_id: null, section: 'main', active: true, sort_order: 1,
  };

  it('listTables calls correct command (session-scoped)', async () => {
    mockInvoke.mockResolvedValue([]);
    await listTables(TOKEN);
    expect(mockInvoke).toHaveBeenCalledWith('list_tables_scoped', { sessionToken: TOKEN, section: null });
  });

  it('listTablesScoped calls correct command', async () => {
    mockInvoke.mockResolvedValue([]);
    await listTablesScoped(TOKEN);
    expect(mockInvoke).toHaveBeenCalledWith('list_tables_scoped', { sessionToken: TOKEN, section: null });
  });

  it('createTable calls correct command (session-scoped)', async () => {
    mockInvoke.mockResolvedValue(table);
    const result = await createTable(TOKEN, table);
    expect(mockInvoke).toHaveBeenCalledWith('create_table_scoped', { sessionToken: TOKEN, table });
    expect(result.id).toBe('t1');
  });

  it('createTableScoped calls correct command', async () => {
    mockInvoke.mockResolvedValue(table);
    await createTableScoped(TOKEN, table);
    expect(mockInvoke).toHaveBeenCalledWith('create_table_scoped', { sessionToken: TOKEN, table });
  });

  it('updateTable calls correct command (session-scoped)', async () => {
    mockInvoke.mockResolvedValue(table);
    await updateTable(TOKEN, table);
    expect(mockInvoke).toHaveBeenCalledWith('update_table_scoped', { sessionToken: TOKEN, table });
  });

  it('deleteTable calls correct command (session-scoped)', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await deleteTable(TOKEN, 't1');
    expect(mockInvoke).toHaveBeenCalledWith('delete_table_scoped', { sessionToken: TOKEN, id: 't1' });
  });

  it('updateTableStatus calls correct command (session-scoped)', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await updateTableStatus(TOKEN, 't1', 'occupied');
    expect(mockInvoke).toHaveBeenCalledWith('update_table_status_scoped', { sessionToken: TOKEN, id: 't1', status: 'occupied' });
  });

  it('updateTableStatusScoped calls correct command', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await updateTableStatusScoped(TOKEN, 't1', 'cleaning');
    expect(mockInvoke).toHaveBeenCalledWith('update_table_status_scoped', { sessionToken: TOKEN, id: 't1', status: 'cleaning' });
  });

  it('propagates errors', async () => {
    mockInvoke.mockRejectedValue(new Error('table in use'));
    await expect(updateTableStatus(TOKEN, 't1', 'occupied')).rejects.toThrow('table in use');
  });
});
