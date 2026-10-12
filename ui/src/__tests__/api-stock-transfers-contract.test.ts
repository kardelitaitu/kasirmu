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
// ── IPC contract tests for stockTransfers.ts ───────────────────────
//
// Transfers are tenant-scoped and actor fields must never come from the
// frontend. These tests pin command names and argument shapes at the IPC seam.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => mockInvoke(cmd, args),
}));

import {
  createStockTransfer,
  getStockTransfer,
  listStockTransfers,
  listInTransitTransfers,
  getStockTransferLines,
  addStockTransferLine,
  removeStockTransferLine,
  sendStockTransfer,
  receiveStockTransfer,
  cancelStockTransfer,
} from '@/api/stockTransfers';

const lines = [{
  id: '', transfer_id: '', sku: 'SKU-1', product_name: 'Widget', qty: 2, received_qty: 0,
}];

describe('stockTransfers.ts scoped IPC contract', () => {
  beforeEach(() => mockInvoke.mockReset());

  it('creates without a caller-supplied actor', async () => {
    mockInvoke.mockResolvedValue({});
    await createStockTransfer('tok', 'loc-a', 'loc-b', null, null, 'note', lines);
    expect(mockInvoke).toHaveBeenCalledWith('create_stock_transfer_scoped', {
      sessionToken: 'tok', sourceLocation: 'loc-a', destinationLocation: 'loc-b',
      sourceTerminalId: null, destinationTerminalId: null, notes: 'note', lines,
    });
  });

  it('scopes reads and line operations', async () => {
    mockInvoke.mockResolvedValue([]);
    await getStockTransfer('tok', 'transfer-1');
    expect(mockInvoke).toHaveBeenLastCalledWith('get_stock_transfer_scoped', { sessionToken: 'tok', id: 'transfer-1' });
    await listStockTransfers('tok');
    expect(mockInvoke).toHaveBeenLastCalledWith('list_stock_transfers_scoped', { sessionToken: 'tok' });
    await getStockTransferLines('tok', 'transfer-1');
    expect(mockInvoke).toHaveBeenLastCalledWith('get_stock_transfer_lines_scoped', { sessionToken: 'tok', transferId: 'transfer-1' });
    await addStockTransferLine('tok', 'transfer-1', 'SKU-1', 'Widget', 2);
    expect(mockInvoke).toHaveBeenLastCalledWith('add_stock_transfer_line_scoped', {
      sessionToken: 'tok', transferId: 'transfer-1', sku: 'SKU-1', productName: 'Widget', qty: 2,
    });
    await removeStockTransferLine('tok', 'line-1');
    expect(mockInvoke).toHaveBeenLastCalledWith('remove_stock_transfer_line_scoped', { sessionToken: 'tok', lineId: 'line-1' });
  });

  it('lists in-transit transfers with lines in one batch call (INV-09)', async () => {
    mockInvoke.mockResolvedValue([
      {
        transfer: { id: 't-1', transfer_number: 'TRF-1', status: 'in_transit' },
        lines: [],
      },
    ]);
    const result = await listInTransitTransfers('tok');
    expect(mockInvoke).toHaveBeenLastCalledWith('list_in_transit_transfers_scoped', { sessionToken: 'tok' });
    // The response carries transfer + lines together so the UI never issues
    // one line-fetch per transfer (the N+1 this command eliminates).
    expect(result[0]!.transfer.status).toBe('in_transit');
    expect(result[0]!.lines).toEqual([]);
  });

  it('scopes lifecycle operations and derives the receiver server-side', async () => {
    mockInvoke.mockResolvedValue({});
    await sendStockTransfer('tok', 'transfer-1');
    expect(mockInvoke).toHaveBeenLastCalledWith('send_stock_transfer_scoped', { sessionToken: 'tok', id: 'transfer-1' });
    await receiveStockTransfer('tok', 'transfer-1', [{ line_id: 'line-1', received_qty: 2 }]);
    expect(mockInvoke).toHaveBeenLastCalledWith('receive_stock_transfer_scoped', {
      sessionToken: 'tok', id: 'transfer-1', receivedLines: [{ line_id: 'line-1', received_qty: 2 }],
    });
    await cancelStockTransfer('tok', 'transfer-1');
    expect(mockInvoke).toHaveBeenLastCalledWith('cancel_stock_transfer_scoped', { sessionToken: 'tok', id: 'transfer-1' });
  });
});
