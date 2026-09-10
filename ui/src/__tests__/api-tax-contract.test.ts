import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('@/utils/logged-invoke', () => ({
  loggedInvoke: (...args: unknown[]) => mockInvoke(...args),
}));

import {
  CART_TAX_NO_SESSION_MESSAGE,
  computeCartTax,
  listTaxRatesScoped,
  createTaxRateScoped,
  updateTaxRateScoped,
  deleteTaxRateScoped,
  getTaxRateDependencyCountsScoped,
  listCategoryTaxRatesScoped,
  setCategoryTaxRatesScoped,
} from '@/api/tax';

describe('tax.ts API contract', () => {
  const TOKEN = 'tok_tax';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('computeCartTax calls correct command', async () => {
    const lines = [{ sku: 'SKU-001', qty: 2, unit_price_minor: 1000 }];
    mockInvoke.mockResolvedValue({ taxMinor: 0, hasExclusive: false });
    const result = await computeCartTax(TOKEN, lines, 'IDR');
    expect(mockInvoke).toHaveBeenCalledWith('compute_cart_tax_scoped', {
      sessionToken: TOKEN,
      lines,
      currency: 'IDR',
    });
    expect(result).toEqual({ taxMinor: 0, hasExclusive: false });
  });

  it('listTaxRatesScoped calls correct command', async () => {
    mockInvoke.mockResolvedValue([]);
    await listTaxRatesScoped(TOKEN);
    expect(mockInvoke).toHaveBeenCalledWith('list_tax_rates_scoped', {
      sessionToken: TOKEN,
    });
  });

  it('createTaxRateScoped calls correct command', async () => {
    const args = { name: 'PPN', rateBps: 1100, isDefault: false, isInclusive: false };
    mockInvoke.mockResolvedValue({ id: 't1', ...args });
    const result = await createTaxRateScoped(TOKEN, args);
    expect(mockInvoke).toHaveBeenCalledWith('create_tax_rate_scoped', {
      sessionToken: TOKEN,
      args,
    });
    expect(result.id).toBe('t1');
  });

  it('updateTaxRateScoped calls correct command', async () => {
    const args = { id: 't1', name: 'PPN Updated', rateBps: 1200, isDefault: false, isInclusive: false };
    mockInvoke.mockResolvedValue(args);
    await updateTaxRateScoped(TOKEN, args);
    expect(mockInvoke).toHaveBeenCalledWith('update_tax_rate_scoped', {
      sessionToken: TOKEN,
      args,
    });
  });

  it('deleteTaxRateScoped calls correct command', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await deleteTaxRateScoped(TOKEN, 't1');
    expect(mockInvoke).toHaveBeenCalledWith('delete_tax_rate_scoped', {
      sessionToken: TOKEN,
      id: 't1',
    });
  });

  it('getTaxRateDependencyCountsScoped calls correct command', async () => {
    mockInvoke.mockResolvedValue({ products: 5, categories: 2 });
    const result = await getTaxRateDependencyCountsScoped(TOKEN, 't1');
    expect(mockInvoke).toHaveBeenCalledWith('get_tax_rate_dependency_counts_scoped', {
      sessionToken: TOKEN,
      id: 't1',
    });
    expect(result.products).toBe(5);
  });

  it('listCategoryTaxRatesScoped calls correct command', async () => {
    mockInvoke.mockResolvedValue([]);
    await listCategoryTaxRatesScoped(TOKEN);
    expect(mockInvoke).toHaveBeenCalledWith('list_category_tax_rates_scoped', {
      sessionToken: TOKEN,
    });
  });

  it('setCategoryTaxRatesScoped calls correct command', async () => {
    const args = { categoryId: 'c1', taxRateIds: ['t1'] };
    mockInvoke.mockResolvedValue(undefined);
    await setCategoryTaxRatesScoped(TOKEN, args);
    expect(mockInvoke).toHaveBeenCalledWith('set_category_tax_rates_scoped', {
      sessionToken: TOKEN,
      args: {
        category_id: 'c1',
        tax_rate_ids: ['t1'],
      },
    });
  });

  it('propagates errors', async () => {
    mockInvoke.mockRejectedValue(new Error('invalid rate'));
    await expect(computeCartTax(TOKEN, [], 'IDR')).rejects.toThrow('invalid rate');
  });

  it('computeCartTax REJECTS on a null session token — the F2-2 silent-zero door', async () => {
    mockInvoke.mockClear();
    await expect(computeCartTax(null, [], 'IDR')).rejects.toThrow(
      CART_TAX_NO_SESSION_MESSAGE,
    );
    // The door closes BEFORE the IPC: no compute command is attempted,
    // so a caller can never mistake the missing session for a real zero.
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
