import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CartId } from '@/types/domain';

const mockInvoke = vi.fn();
vi.mock('@/utils/logged-invoke', () => ({
  loggedInvoke: (...args: unknown[]) => mockInvoke(...args),
}));

import {
  startSaleScoped,
  addLineScoped,
  completeSaleScoped,
  previewPromotedTotalScoped,
  holdCartScoped,
  voidSaleScoped,
  processRefundScoped,
  listSales,
  listSalesScoped,
  getSale,
  getSaleScoped,
  listHeldCartsScoped,
} from '@/api/sales';

describe('sales.ts API contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('startSaleScoped calls correct command', async () => {
    mockInvoke.mockResolvedValue({ saleId: 's1', cartId: 'c1' });
    await startSaleScoped('tok', { currency: 'IDR' });
    expect(mockInvoke).toHaveBeenCalledWith('start_sale_scoped', { sessionToken: 'tok', args: { currency: 'IDR' } });
  });

  it('addLineScoped calls correct command', async () => {
    mockInvoke.mockResolvedValue({ lineId: 'l1' });
    await addLineScoped('tok', { cartId: 'c1' as CartId, sku: 'SKU-1', qty: 1, unitPriceMinor: 1000 });
    expect(mockInvoke).toHaveBeenCalledWith('add_line_scoped', { sessionToken: 'tok', args: { cartId: 'c1', sku: 'SKU-1', qty: 1, unitPriceMinor: 1000 } });
  });

  // FRONTEND-03: the line's own currency must cross the IPC boundary so
  // the backend can enforce it against the cart currency.
  it('addLineScoped passes unitPriceCurrency through to the backend', async () => {
    mockInvoke.mockResolvedValue({ lineId: 'l1' });
    await addLineScoped('tok', { cartId: 'c1' as CartId, sku: 'SKU-1', qty: 1, unitPriceMinor: 1000, unitPriceCurrency: 'EUR' });
    expect(mockInvoke).toHaveBeenCalledWith('add_line_scoped', { sessionToken: 'tok', args: { cartId: 'c1', sku: 'SKU-1', qty: 1, unitPriceMinor: 1000, unitPriceCurrency: 'EUR' } });
  });

  it('completeSaleScoped calls correct command', async () => {
    mockInvoke.mockResolvedValue({ saleId: 's1' });
    await completeSaleScoped('tok', { cartId: 'c1' as CartId, paymentMethod: 'card', tenderedMinor: 5000 });
    expect(mockInvoke).toHaveBeenCalledWith('complete_sale_scoped', { sessionToken: 'tok', args: { cartId: 'c1', paymentMethod: 'card', tenderedMinor: 5000 } });
  });

  // PROMO-3: promotionIds must cross the IPC boundary on checkout attempts
  it('completeSaleScoped passes promotionIds through to the backend', async () => {
    mockInvoke.mockResolvedValue({ saleId: 's1' });
    await completeSaleScoped('tok', { cartId: 'c1' as CartId, paymentMethod: 'cash', tenderedMinor: 5000, promotionIds: ['promo-2'] });
    expect(mockInvoke).toHaveBeenCalledWith('complete_sale_scoped', { sessionToken: 'tok', args: { cartId: 'c1', paymentMethod: 'cash', tenderedMinor: 5000, promotionIds: ['promo-2'] } });
  });

  // F2-6: the estimate claim crosses the IPC boundary — the caller flags
  // a checkout whose displayed tax was not freshly computed; absent is
  // the no-stamp default and is covered by PaymentModalSaleFlow.
  it('completeSaleScoped passes taxEstimated through to the backend', async () => {
    mockInvoke.mockResolvedValue({ saleId: 's1' });
    await completeSaleScoped('tok', { cartId: 'c1' as CartId, paymentMethod: 'cash', tenderedMinor: 5000, taxEstimated: true });
    expect(mockInvoke).toHaveBeenCalledWith('complete_sale_scoped', { sessionToken: 'tok', args: { cartId: 'c1', paymentMethod: 'cash', tenderedMinor: 5000, taxEstimated: true } });
  });

  // PROMO-3: the preview command drives split construction before checkout
  it('previewPromotedTotalScoped calls correct command', async () => {
    mockInvoke.mockResolvedValue({ baseTotalMinor: 50000, totalMinor: 42500, discounts: [{ promotionId: 'promo-2', discountMinor: 7500, description: 'Happy Hour 15%: 7500 off' }] });
    await previewPromotedTotalScoped('tok', { cartId: 'c1', promotionIds: ['promo-2'] });
    expect(mockInvoke).toHaveBeenCalledWith('preview_promoted_total_scoped', { sessionToken: 'tok', args: { cartId: 'c1', promotionIds: ['promo-2'] } });
  });

  it('holdCartScoped calls correct command', async () => {
    mockInvoke.mockResolvedValue({ id: 'held-1' });
    await holdCartScoped('tok', { label: 'Table 2', cart_data: '{}', item_count: 1, total_minor: 3000, currency: 'IDR' });
    expect(mockInvoke).toHaveBeenCalledWith('hold_cart_scoped', { sessionToken: 'tok', args: { label: 'Table 2', cart_data: '{}', item_count: 1, total_minor: 3000, currency: 'IDR' } });
  });

  it('voidSaleScoped calls correct command', async () => {
    mockInvoke.mockResolvedValue({ voided: true });
    await voidSaleScoped('tok', 's1', 'Damaged');
    expect(mockInvoke).toHaveBeenCalledWith('void_sale_scoped', { sessionToken: 'tok', args: { saleId: 's1', reason: 'Damaged' } });
  });

  it('processRefundScoped calls correct command', async () => {
    mockInvoke.mockResolvedValue({ refundId: 'r1' });
    await processRefundScoped('tok', { saleId: 's1', reason: 'Wrong item', lines: [] });
    expect(mockInvoke).toHaveBeenCalledWith('process_refund_scoped', { sessionToken: 'tok', args: { saleId: 's1', reason: 'Wrong item', lines: [] } });
  });

  it('listSales calls correct command (no args)', async () => {
    mockInvoke.mockResolvedValue({ sales: [], total: 0 });
    await listSales();
    expect(mockInvoke).toHaveBeenCalledWith('list_sales');
  });

  it('listSalesScoped calls correct command', async () => {
    mockInvoke.mockResolvedValue({ sales: [], total: 0 });
    await listSalesScoped('tok');
    expect(mockInvoke).toHaveBeenCalledWith('list_sales_scoped', { sessionToken: 'tok' });
  });

  it('getSale calls correct command', async () => {
    mockInvoke.mockResolvedValue(null);
    await getSale('s1');
    expect(mockInvoke).toHaveBeenCalledWith('get_sale', { id: 's1' });
  });

  it('getSaleScoped calls correct command', async () => {
    mockInvoke.mockResolvedValue(null);
    await getSaleScoped('tok', 's1');
    expect(mockInvoke).toHaveBeenCalledWith('get_sale_scoped', { sessionToken: 'tok', id: 's1' });
  });

  it('listHeldCartsScoped calls correct command', async () => {
    mockInvoke.mockResolvedValue([]);
    await listHeldCartsScoped('tok');
    expect(mockInvoke).toHaveBeenCalledWith('list_held_carts_scoped', { sessionToken: 'tok' });
  });

  it('propagates errors', async () => {
    mockInvoke.mockRejectedValue(new Error('cart not found'));
    await expect(startSaleScoped('tok', { currency: 'IDR' })).rejects.toThrow('cart not found');
  });
});
