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
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (command: string, args?: Record<string, unknown>) => mockInvoke(command, args),
}));

import {
  createTaxRateScoped,
  deleteTaxRateScoped,
  getTaxRateDependencyCountsScoped,
  listCategoryTaxRatesScoped,
  listTaxRatesScoped,
  setCategoryTaxRatesScoped,
  updateTaxRateScoped,
} from '@/api/tax';

describe('tax.ts scoped IPC contract (TAX-01)', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(undefined);
  });

  it('passes the session token to every scoped tax command', async () => {
    await createTaxRateScoped('session-1', {
      name: 'VAT',
      rateBps: 1100,
      isDefault: true,
      isInclusive: false,
    });
    expect(mockInvoke).toHaveBeenCalledWith('create_tax_rate_scoped', {
      sessionToken: 'session-1',
      args: { name: 'VAT', rateBps: 1100, isDefault: true, isInclusive: false },
    });

    mockInvoke.mockClear();
    await updateTaxRateScoped('session-1', {
      id: 'tax-1',
      name: 'VAT 11%',
      rateBps: 1100,
      isDefault: true,
      isInclusive: false,
    });
    expect(mockInvoke).toHaveBeenCalledWith('update_tax_rate_scoped', {
      sessionToken: 'session-1',
      args: { id: 'tax-1', name: 'VAT 11%', rateBps: 1100, isDefault: true, isInclusive: false },
    });

    mockInvoke.mockClear();
    await deleteTaxRateScoped('session-1', 'tax-1');
    expect(mockInvoke).toHaveBeenCalledWith('delete_tax_rate_scoped', {
      sessionToken: 'session-1',
      id: 'tax-1',
    });

    mockInvoke.mockClear();
    await listTaxRatesScoped('session-1');
    expect(mockInvoke).toHaveBeenCalledWith('list_tax_rates_scoped', {
      sessionToken: 'session-1',
    });

    mockInvoke.mockClear();
    await listCategoryTaxRatesScoped('session-1');
    expect(mockInvoke).toHaveBeenCalledWith('list_category_tax_rates_scoped', {
      sessionToken: 'session-1',
    });

    mockInvoke.mockClear();
    await getTaxRateDependencyCountsScoped('session-1', 'tax-1');
    expect(mockInvoke).toHaveBeenCalledWith('get_tax_rate_dependency_counts_scoped', {
      sessionToken: 'session-1',
      id: 'tax-1',
    });

    mockInvoke.mockClear();
    await setCategoryTaxRatesScoped('session-1', {
      categoryId: 'cat-1',
      taxRateIds: ['tax-1'],
    });
    expect(mockInvoke).toHaveBeenCalledWith('set_category_tax_rates_scoped', {
      sessionToken: 'session-1',
      args: { category_id: 'cat-1', tax_rate_ids: ['tax-1'] },
    });
  });

  it('preserves the category-assignment wire shape for the scoped setter', async () => {
    await setCategoryTaxRatesScoped('session-2', {
      categoryId: 'cat-9',
      taxRateIds: ['tax-1', 'tax-2'],
    });
    expect(mockInvoke).toHaveBeenCalledWith(
      'set_category_tax_rates_scoped',
      expect.objectContaining({
        args: { category_id: 'cat-9', tax_rate_ids: ['tax-1', 'tax-2'] },
      }),
    );
  });
});
