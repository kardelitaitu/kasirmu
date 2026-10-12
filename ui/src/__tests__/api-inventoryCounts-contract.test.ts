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
  createStockCount,
  listStockCounts,
  getStockCount,
  addCountLine,
  updateCountLine,
  removeCountLine,
  completeStockCount,
} from '@/api/inventoryCounts';

describe('inventoryCounts.ts API contract', () => {
  const TOKEN = 'tok_count';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createStockCount calls correct command', async () => {
    const args = { countType: 'full', notes: 'Monthly count' };
    mockInvoke.mockResolvedValue({ id: 'sc1', ...args });
    await createStockCount(TOKEN, args);
    expect(mockInvoke).toHaveBeenCalledWith('create_stock_count_scoped', {
      sessionToken: TOKEN,
      args,
    });
  });

  it('listStockCounts calls correct command', async () => {
    mockInvoke.mockResolvedValue([]);
    await listStockCounts(TOKEN);
    expect(mockInvoke).toHaveBeenCalledWith('list_stock_counts_scoped', {
      sessionToken: TOKEN,
    });
  });

  it('getStockCount calls correct command', async () => {
    mockInvoke.mockResolvedValue(null);
    await getStockCount(TOKEN, 'sc1');
    expect(mockInvoke).toHaveBeenCalledWith('get_stock_count_scoped', {
      sessionToken: TOKEN,
      id: 'sc1',
    });
  });

  it('addCountLine calls correct command', async () => {
    const args = { countId: 'sc1', sku: 'SKU-001', productName: 'Widget', expectedQty: 10 };
    mockInvoke.mockResolvedValue({ id: 'line1', ...args });
    await addCountLine(TOKEN, args);
    expect(mockInvoke).toHaveBeenCalledWith('add_count_line_scoped', {
      sessionToken: TOKEN,
      args,
    });
  });

  it('updateCountLine calls correct command', async () => {
    const args = { lineId: 'line1', countedQty: 12, notes: 'counted manually' };
    mockInvoke.mockResolvedValue(undefined);
    await updateCountLine(TOKEN, args);
    expect(mockInvoke).toHaveBeenCalledWith('update_count_line_scoped', {
      sessionToken: TOKEN,
      args,
    });
  });

  it('removeCountLine calls correct command', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await removeCountLine(TOKEN, { lineId: 'line1' });
    expect(mockInvoke).toHaveBeenCalledWith('remove_count_line_scoped', {
      sessionToken: TOKEN,
      args: { lineId: 'line1' },
    });
  });

  it('completeStockCount calls correct command', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await completeStockCount(TOKEN, { countId: 'sc1' });
    expect(mockInvoke).toHaveBeenCalledWith('complete_stock_count_scoped', {
      sessionToken: TOKEN,
      args: { countId: 'sc1' },
    });
  });

  it('propagates errors', async () => {
    mockInvoke.mockRejectedValue(new Error('count not found'));
    await expect(getStockCount(TOKEN, 'bad')).rejects.toThrow('count not found');
  });
});
