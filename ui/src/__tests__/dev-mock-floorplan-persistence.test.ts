// ── Dev-mock: table status mutations must be readable back ───────────────
//
// FOURTH instance of one defect shape (after the KDS order create stub,
// refund persistence, and KDS device registration): a command whose read-back
// disagrees with what it did.
//
// floorplanHandlers returned a FROZEN snapshot from list_tables while every
// mutation answered `null` and changed nothing — so the restaurant floor plan
// could not be edited in the preview at all.
//
// This one is worse than a silent no-op, and that is why it is worth pinning:
// TableManagementScreen.statusAction does
//     const updated = await updateTableStatusScoped(...);
//     setSelected(updated);
//     setTables((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
// so a `null` return dereferences `updated.id` on the next line and throws
// inside the try, surfacing as the generic action-error banner. The cashier
// sees an error for an operation the mock claimed nothing about.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { invoke } from '@/dev-mock/tauri-api';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

type Table = {
  id: string;
  name: string;
  capacity: number;
  status: string;
  section: string;
  active: boolean;
  active_sale_id: string | null;
  sort_order: number;
};

const list = (): Promise<Table[]> =>
  invoke<Table[]>('list_tables_scoped', { sessionToken: 'mock-token' });
const setStatus = (id: string, status: string): Promise<Table> =>
  invoke<Table>('update_table_status_scoped', { sessionToken: 'mock-token', id, status });
const release = (id: string): Promise<Table> =>
  invoke<Table>('release_table_scoped', { sessionToken: 'mock-token', tableId: id });

describe('dev-mock floor plan mutations', () => {
  it('returns the updated table rather than null', async () => {
    const [table] = await list();
    expect(table, 'the floor plan must start with at least one table').toBeTruthy();
    const updated = await setStatus(table!.id, 'reserved');
    expect(
      updated,
      'update_table_status_scoped returned ' +
        String(updated) +
        ' — the screen dereferences updated.id immediately, so null throws',
    ).toBeTruthy();
    expect(updated.id).toBe(table!.id);
    expect(updated.status).toBe('reserved');
  });

  it('reflects the new status in the next listing', async () => {
    const [table] = await list();
    await setStatus(table!.id, 'reserved');
    const after = await list();
    const found = after.find((t) => t.id === table!.id);
    expect(found, 'the table must still exist after a status change').toBeTruthy();
    expect(
      found!.status,
      'the listing still reports ' + found!.status + ' after a change to reserved',
    ).toBe('reserved');
  });

  it('releases an occupied table and keeps the change', async () => {
    const tables = await list();
    const occupied = tables.find((t) => t.status === 'occupied');
    expect(occupied, 'the seed must include an occupied table').toBeTruthy();

    const released = await release(occupied!.id);
    expect(released).toBeTruthy();
    // release_table's contract (api/tables.ts:81) hands back the table; the seed
    // documents 'cleaning' as the post-release state a busier then turns over.
    expect(released.status).toBe('cleaning');

    const after = await list();
    expect(after.find((t) => t.id === occupied!.id)!.status).toBe('cleaning');
  });

  it('creates and deletes a table, and the listing follows', async () => {
    const before = (await list()).length;
    const created = await invoke<Table>('create_table_scoped', {
      sessionToken: 'mock-token',
      table: { name: 'Table 99', capacity: 2, section: 'Patio' },
    });
    expect(created, 'create_table_scoped must return the new table').toBeTruthy();
    expect((await list()).length, 'the created table must appear').toBe(before + 1);

    await invoke('delete_table_scoped', { sessionToken: 'mock-token', id: created.id });
    expect((await list()).length, 'the deleted table must disappear').toBe(before);
  });

  it('finds a table by id', async () => {
    const [table] = await list();
    const fetched = await invoke<Table | null>('get_table_scoped', {
      sessionToken: 'mock-token',
      id: table!.id,
    });
    expect(fetched, 'get_table_scoped must return a table the listing shows').toBeTruthy();
    expect(fetched!.id).toBe(table!.id);
  });
});
