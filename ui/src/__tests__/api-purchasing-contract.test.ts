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
  listSuppliers,
  createSupplier,
  updateSupplier,
  getSupplier,
  listPurchaseOrders,
  createPurchaseOrder,
  receivePurchaseOrder,
  listPurchaseOrdersScoped,
  updatePoStatusScoped,
  receivePurchaseOrderScoped,
  receivePurchaseOrderWithLinesScoped,
} from '@/api/purchasing';

describe('purchasing.ts API contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listSuppliers calls correct command (session-scoped)', async () => {
    mockInvoke.mockResolvedValue([]);
    await listSuppliers('tok-1');
    expect(mockInvoke).toHaveBeenCalledWith('list_suppliers_scoped', { sessionToken: 'tok-1' });
  });

  it('createSupplier calls correct command', async () => {
    const args = { code: 'SUP-001', name: 'PT Supplier', contact_person: 'Budi', email: 'budi@pt.com' };
    mockInvoke.mockResolvedValue({ id: 'sup1', ...args, phone: null, address: null, tax_id: null, payment_terms: null, notes: null });
    const result = await createSupplier('tok-1', args);
    expect(mockInvoke).toHaveBeenCalledWith('create_supplier_scoped', { sessionToken: 'tok-1', args });
    expect(result.id).toBe('sup1');
  });

  it('updateSupplier calls correct command', async () => {
    const args = { id: 'sup1', code: 'SUP-001', name: 'Updated Supplier' };
    mockInvoke.mockResolvedValue(args);
    await updateSupplier('tok-1', args);
    expect(mockInvoke).toHaveBeenCalledWith('update_supplier_scoped', { sessionToken: 'tok-1', args });
  });

  it('getSupplier calls correct command', async () => {
    mockInvoke.mockResolvedValue(null);
    await getSupplier('tok-1', 'sup1');
    expect(mockInvoke).toHaveBeenCalledWith('get_supplier_scoped', { sessionToken: 'tok-1', id: 'sup1' });
  });

  it('listPurchaseOrders calls correct command (session-scoped)', async () => {
    mockInvoke.mockResolvedValue([]);
    await listPurchaseOrders('tok-1');
    expect(mockInvoke).toHaveBeenCalledWith('list_purchase_orders_scoped', { sessionToken: 'tok-1' });
  });

  it('createPurchaseOrder calls correct command', async () => {
    const args = {
      po_number: 'PO-001',
      supplier_id: 'sup1',
      lines: [{ sku: 'SKU-001', product_name: 'Widget', qty: 10, unit_cost_minor: 5000 }],
    };
    mockInvoke.mockResolvedValue({ id: 'po1', ...args, status: 'draft', created_at: '2026-01-01' });
    const result = await createPurchaseOrder('tok-1', args);
    expect(mockInvoke).toHaveBeenCalledWith('create_purchase_order_scoped', { sessionToken: 'tok-1', args });
    expect(result.id).toBe('po1');
  });

  it('receivePurchaseOrder calls correct command', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await receivePurchaseOrder('tok-1', 'po1');
    expect(mockInvoke).toHaveBeenCalledWith('receive_purchase_order_scoped', { sessionToken: 'tok-1', id: 'po1' });
  });

  // ── Scoped variants (review F-005): desktop registers only *_scoped ──

  it('listPurchaseOrdersScoped calls correct command', async () => {
    mockInvoke.mockResolvedValue([]);
    await listPurchaseOrdersScoped('tok-1');
    expect(mockInvoke).toHaveBeenCalledWith('list_purchase_orders_scoped', { sessionToken: 'tok-1' });
  });

  it('updatePoStatusScoped calls correct command', async () => {
    const args = { id: 'po1', status: 'approved' };
    mockInvoke.mockResolvedValue({ id: 'po1' });
    await updatePoStatusScoped('tok-1', args);
    expect(mockInvoke).toHaveBeenCalledWith('update_po_status_scoped', { args, sessionToken: 'tok-1' });
  });

  it('receivePurchaseOrderScoped calls correct command', async () => {
    mockInvoke.mockResolvedValue({ id: 'po1' });
    await receivePurchaseOrderScoped('tok-1', 'po1');
    expect(mockInvoke).toHaveBeenCalledWith('receive_purchase_order_scoped', { id: 'po1', sessionToken: 'tok-1' });
  });

  it('receivePurchaseOrderWithLinesScoped calls correct command', async () => {
    const lines = [{ line_id: 'l1', received_qty: 5, damaged_qty: 0 }];
    mockInvoke.mockResolvedValue({ id: 'po1' });
    await receivePurchaseOrderWithLinesScoped('tok-1', 'po1', lines);
    expect(mockInvoke).toHaveBeenCalledWith('receive_purchase_order_with_lines_scoped', {
      id: 'po1',
      lines,
      sessionToken: 'tok-1',
    });
  });

  it('propagates errors', async () => {
    mockInvoke.mockRejectedValue(new Error('supplier not found'));
    await expect(listSuppliers('tok-1')).rejects.toThrow('supplier not found');
  });
});
