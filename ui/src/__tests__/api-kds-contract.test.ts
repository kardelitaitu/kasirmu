// ── IPC contract tests for kds.ts ─────────────────────────────
//
// Verifies every exported function calls loggedInvoke with the
// correct IPC command name and argument shape.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock('@/utils/logged-invoke', () => ({
  loggedInvoke: (cmd: string, args?: Record<string, unknown>) => mockInvoke(cmd, args),
}));

import {
  listKdsOrders,
  listKdsOrdersScoped,
  getKdsQueue,
  getKdsQueueScoped,
  updateKdsStatus,
  updateKdsStatusScoped,
  createKdsOrderFromSale,
  createKdsOrderFromSaleScoped,
  publishCourseFiredScoped,
  getKdsOrder,
  getKdsOrderScoped,
  updateKdsOrderItemsScoped,
  printKdsChitScoped,
  getKdsOrderLinesScoped,
  updateKdsLineItemStatusScoped,
} from '@/api/kds';

describe('kds.ts IPC contract', () => {
  beforeEach(() => mockInvoke.mockReset());

  // ── List Orders (session-scoped — ADR #7) ───────────────────

  it('listKdsOrders → list_kds_orders_scoped with sessionToken', async () => {
    mockInvoke.mockResolvedValue([]);
    await listKdsOrders('tok');
    expect(mockInvoke).toHaveBeenCalledWith('list_kds_orders_scoped', { sessionToken: 'tok', status: null });
  });

  it('listKdsOrders with status → list_kds_orders_scoped with status', async () => {
    mockInvoke.mockResolvedValue([]);
    await listKdsOrders('tok', 'pending');
    expect(mockInvoke).toHaveBeenCalledWith('list_kds_orders_scoped', { sessionToken: 'tok', status: 'pending' });
  });

  it('listKdsOrdersScoped → list_kds_orders_scoped with sessionToken', async () => {
    mockInvoke.mockResolvedValue([]);
    await listKdsOrdersScoped('tok');
    expect(mockInvoke).toHaveBeenCalledWith('list_kds_orders_scoped', { sessionToken: 'tok', status: null });
  });

  it('listKdsOrdersScoped with status → list_kds_orders_scoped with status', async () => {
    mockInvoke.mockResolvedValue([]);
    await listKdsOrdersScoped('tok', 'ready');
    expect(mockInvoke).toHaveBeenCalledWith('list_kds_orders_scoped', { sessionToken: 'tok', status: 'ready' });
  });

  // ── Queue (session-scoped — ADR #7) ─────────────────────────

  it('getKdsQueue → get_kds_queue_scoped with sessionToken', async () => {
    mockInvoke.mockResolvedValue([]);
    await getKdsQueue('tok');
    expect(mockInvoke).toHaveBeenCalledWith('get_kds_queue_scoped', { sessionToken: 'tok', kdsZone: null });
  });

  it('getKdsQueue with zone → get_kds_queue_scoped with kdsZone', async () => {
    mockInvoke.mockResolvedValue([]);
    await getKdsQueue('tok', 'front');
    expect(mockInvoke).toHaveBeenCalledWith('get_kds_queue_scoped', { sessionToken: 'tok', kdsZone: 'front' });
  });

  it('getKdsQueueScoped → get_kds_queue_scoped with sessionToken', async () => {
    mockInvoke.mockResolvedValue([]);
    await getKdsQueueScoped('tok');
    expect(mockInvoke).toHaveBeenCalledWith('get_kds_queue_scoped', { sessionToken: 'tok', kdsZone: null });
  });

  // ── Update Status (session-scoped — ADR #7) ─────────────────

  it('updateKdsStatus → update_kds_status_scoped with sessionToken + id + status', async () => {
    mockInvoke.mockResolvedValue({ id: 'o1', status: 'preparing' });
    await updateKdsStatus('tok', 'o1', 'preparing');
    expect(mockInvoke).toHaveBeenCalledWith('update_kds_status_scoped', { sessionToken: 'tok', id: 'o1', status: 'preparing' });
  });

  it('updateKdsStatusScoped → update_kds_status_scoped with sessionToken', async () => {
    mockInvoke.mockResolvedValue({ id: 'o1', status: 'ready' });
    await updateKdsStatusScoped('tok', 'o1', 'ready');
    expect(mockInvoke).toHaveBeenCalledWith('update_kds_status_scoped', { sessionToken: 'tok', id: 'o1', status: 'ready' });
  });

  // ── Create from Sale (session-scoped — ADR #7) ──────────────

  it('createKdsOrderFromSale → create_kds_order_from_sale_scoped', async () => {
    mockInvoke.mockResolvedValue([]);
    await createKdsOrderFromSale('tok', 's1');
    expect(mockInvoke).toHaveBeenCalledWith('create_kds_order_from_sale_scoped', { sessionToken: 'tok', saleId: 's1' });
  });

  it('createKdsOrderFromSaleScoped → create_kds_order_from_sale_scoped', async () => {
    mockInvoke.mockResolvedValue([]);
    await createKdsOrderFromSaleScoped('tok', 's1');
    expect(mockInvoke).toHaveBeenCalledWith('create_kds_order_from_sale_scoped', { sessionToken: 'tok', saleId: 's1' });
  });

  // ── Publish fired course (session-scoped — ADR #7) ─────────────

  it('publishCourseFiredScoped → publish_course_fired_scoped with sale + course + items', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await publishCourseFiredScoped('tok', {
      saleId: 's1',
      courseId: 'main',
      displayNumber: 7,
      items: [{ sku: 'STEAK', qty: 1, name: 'Ribeye' }],
    });
    expect(mockInvoke).toHaveBeenCalledWith('publish_course_fired_scoped', {
      sessionToken: 'tok',
      args: {
        saleId: 's1',
        courseId: 'main',
        displayNumber: 7,
        items: [{ sku: 'STEAK', qty: 1, name: 'Ribeye' }],
      },
    });
  });

  // ── Get Order (session-scoped — ADR #7) ─────────────────────

  it('getKdsOrder → get_kds_order_scoped with sessionToken + id', async () => {
    mockInvoke.mockResolvedValue(null);
    await getKdsOrder('tok', 'o1');
    expect(mockInvoke).toHaveBeenCalledWith('get_kds_order_scoped', { sessionToken: 'tok', id: 'o1' });
  });

  it('getKdsOrderScoped → get_kds_order_scoped with sessionToken', async () => {
    mockInvoke.mockResolvedValue(null);
    await getKdsOrderScoped('tok', 'o1');
    expect(mockInvoke).toHaveBeenCalledWith('get_kds_order_scoped', { sessionToken: 'tok', id: 'o1' });
  });

  // ── Update Items (scoped — ADR #7) ──────────────────────────

  it('updateKdsOrderItemsScoped → update_kds_order_items_scoped with sessionToken', async () => {
    mockInvoke.mockResolvedValue({ id: 'o1' });
    await updateKdsOrderItemsScoped('tok', { id: 'o1', items_summary: '1x Latte', item_count: 1 });
    expect(mockInvoke).toHaveBeenCalledWith('update_kds_order_items_scoped', { sessionToken: 'tok', args: { id: 'o1', items_summary: '1x Latte', item_count: 1 } });
  });

  // ── Print / Lines / Line Status ───────────────────────────

  it('printKdsChitScoped → print_kds_chit_scoped with sessionToken + orderId', async () => {
    mockInvoke.mockResolvedValue(true);
    await printKdsChitScoped('tok', 'o1');
    expect(mockInvoke).toHaveBeenCalledWith('print_kds_chit_scoped', { sessionToken: 'tok', orderId: 'o1' });
  });

  it('getKdsOrderLinesScoped → get_kds_order_lines_scoped with sessionToken + orderId', async () => {
    mockInvoke.mockResolvedValue([]);
    await getKdsOrderLinesScoped('tok', 'o1');
    expect(mockInvoke).toHaveBeenCalledWith('get_kds_order_lines_scoped', { sessionToken: 'tok', orderId: 'o1' });
  });

  it('updateKdsLineItemStatusScoped → update_kds_line_item_status_scoped', async () => {
    mockInvoke.mockResolvedValue({ id: 'li1', item_status: 'ready' });
    await updateKdsLineItemStatusScoped('tok', 'li1', 'ready');
    expect(mockInvoke).toHaveBeenCalledWith('update_kds_line_item_status_scoped', { sessionToken: 'tok', itemId: 'li1', status: 'ready' });
  });

  // ── Error propagation ─────────────────────────────────────

  it('propagates backend errors', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('order not found'));
    await expect(listKdsOrders('tok')).rejects.toThrow('order not found');
  });
});
