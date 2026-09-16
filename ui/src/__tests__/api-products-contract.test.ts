import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('@/utils/logged-invoke', () => ({
  loggedInvoke: (...args: unknown[]) => mockInvoke(...args),
}));

import {
  createProductScoped,
  updateProductScoped,
  deleteProductScoped,
  lookupByBarcodeScoped,
  recordProductSearchScoped,
} from '@/api/products';

describe('products.ts API contract', () => {
  const TOKEN = 'tok_prod';

  beforeEach(() => {
    vi.clearAllMocks();
  });


  it('createProductScoped calls correct command', async () => {
    const args = {
      userId: 'u1',
      sku: 'SKU-002',
      name: 'Scoped Product',
      priceMinor: 5000,
      currency: 'IDR',
      initialStock: 5,
      taxRateIds: [],
    };
    mockInvoke.mockResolvedValue({ sku: 'SKU-002' });
    await createProductScoped(TOKEN, args);
    expect(mockInvoke).toHaveBeenCalledWith('create_product_scoped', {
      sessionToken: TOKEN,
      args,
    });
  });


  it('updateProductScoped calls correct command', async () => {
    const args = { sku: 'SKU-001', name: 'Updated', priceMinor: 15000, currency: 'IDR', taxRateIds: [] };
    mockInvoke.mockResolvedValue({ sku: 'SKU-001' });
    await updateProductScoped(TOKEN, args);
    expect(mockInvoke).toHaveBeenCalledWith('update_product_scoped', {
      sessionToken: TOKEN,
      args,
    });
  });


  it('deleteProductScoped calls correct command', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await deleteProductScoped(TOKEN, 'SKU-001');
    expect(mockInvoke).toHaveBeenCalledWith('delete_product_scoped', {
      sessionToken: TOKEN,
      args: { sku: 'SKU-001' },
    });
  });

  // Moved rather than dropped, and this was the ONLY wire-shape pin on barcode lookup: the suite
  // had no `lookupByBarcodeScoped` case at all, so the command both shells register went unwired
  // in tests while the one no shell registers had one. The `barcode` key name is the point --
  // Tauri converts the command's outer name and nothing inside the payload.
  it('lookupByBarcodeScoped calls correct command', async () => {
    mockInvoke.mockResolvedValue(null);
    await lookupByBarcodeScoped(TOKEN, '123456');
    expect(mockInvoke).toHaveBeenCalledWith('lookup_by_barcode_scoped', {
      sessionToken: TOKEN,
      barcode: '123456',
    });
  });

  it('recordProductSearchScoped calls correct command', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await recordProductSearchScoped(TOKEN, 'SKU-001');
    expect(mockInvoke).toHaveBeenCalledWith('record_product_search_scoped', {
      sessionToken: TOKEN,
      sku: 'SKU-001',
    });
  });

  it('propagates errors', async () => {
    mockInvoke.mockRejectedValue(new Error('sku duplicate'));
    await expect(
      createProductScoped(TOKEN, {
                sku: 'DUP',
        name: 'Dup',
        priceMinor: 0,
        currency: 'IDR',
        initialStock: 0,
        taxRateIds: [],
      })
    ).rejects.toThrow('sku duplicate');
  });

  it('passes return type through', async () => {
    mockInvoke.mockResolvedValue({ sku: 'SKU-NEW' });
    const result = await createProductScoped(TOKEN, {
            sku: 'SKU-NEW',
      name: 'Product',
      priceMinor: 10000,
      currency: 'IDR',
      initialStock: 10,
      taxRateIds: [],
    });
    expect(result.sku).toBe('SKU-NEW');
  });
});
