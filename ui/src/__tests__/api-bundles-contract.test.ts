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
  createBundle,
  listBundles,
  getBundle,
  lookupBundleBySku,
  updateBundle,
  deleteBundle,
} from '@/api/bundles';

describe('bundles.ts API contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createBundle calls correct command', async () => {
    const args = {
      bundle_sku: 'BUNDLE-001',
      name: 'Drink Combo',
      items: [{ sku: 'COKE', qty: 2 }],
    };
    const bundleWithItems = { bundle: { id: 'b1', ...args, bundle_price_minor: null, currency: 'IDR', description: '', active: true, created_at: '2026-01-01', updated_at: '2026-01-01' }, items: args.items };
    mockInvoke.mockResolvedValue(bundleWithItems);
    const result = await createBundle('tok-1', args);
    expect(mockInvoke).toHaveBeenCalledWith('create_bundle_scoped', { sessionToken: 'tok-1', args });
    expect(result.bundle.bundle_sku).toBe('BUNDLE-001');
  });

  it('listBundles calls correct command (no args)', async () => {
    mockInvoke.mockResolvedValue([]);
    await listBundles('tok-1');
    expect(mockInvoke).toHaveBeenCalledWith('list_bundles_scoped', { sessionToken: 'tok-1' });
  });

  it('getBundle calls correct command', async () => {
    mockInvoke.mockResolvedValue(null);
    await getBundle('tok-1', 'b1');
    expect(mockInvoke).toHaveBeenCalledWith('get_bundle_scoped', { sessionToken: 'tok-1', id: 'b1' });
  });

  it('lookupBundleBySku calls correct command', async () => {
    mockInvoke.mockResolvedValue(null);
    await lookupBundleBySku('tok-1', 'BUNDLE-001');
    expect(mockInvoke).toHaveBeenCalledWith('lookup_bundle_by_sku_scoped', { sessionToken: 'tok-1', sku: 'BUNDLE-001' });
  });

  it('updateBundle calls correct command', async () => {
    const bundleWithItems = { bundle: { id: 'b1', bundle_sku: 'B-001', name: 'Updated', bundle_price_minor: null, currency: 'IDR', description: '', active: true, created_at: '2026-01-01', updated_at: '2026-01-01' }, items: [] };
    mockInvoke.mockResolvedValue(bundleWithItems);
    await updateBundle('tok-1', bundleWithItems);
    expect(mockInvoke).toHaveBeenCalledWith('update_bundle_scoped', { sessionToken: 'tok-1', bundle: bundleWithItems });
  });

  it('deleteBundle calls correct command', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await deleteBundle('tok-1', 'b1');
    expect(mockInvoke).toHaveBeenCalledWith('delete_bundle_scoped', { sessionToken: 'tok-1', id: 'b1' });
  });

  it('propagates errors', async () => {
    mockInvoke.mockRejectedValue(new Error('sku exists'));
    await expect(
      createBundle('tok-1', { bundle_sku: 'DUP', name: 'Dup', items: [] })
    ).rejects.toThrow('sku exists');
  });
});
