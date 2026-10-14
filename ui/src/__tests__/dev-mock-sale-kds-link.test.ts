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
// ── Dev-mock: a completed sale must appear on the Kitchen Display ────────
//
// WHY THIS FILE EXISTS
//
// Nothing covered this path, and it is the one that decides whether a kitchen
// ever learns an order exists. A live pass (docs/records/audits/
// restaurant-pos-kds-link-investigation.md) completed a real sale, opened the
// KDS, and found the board EMPTY. The dev-mock carries two independent pieces
// that both claim this responsibility, and they can disagree silently:
//
//   1. a SIDE EFFECT — complete_sale / complete_sale_scoped call
//      pushKdsOrderFromCart(lines, storeId), which mints a `kds-order-e2e-*`
//      order and seeds its line items; and
//   2. a COMMAND — create_kds_order_from_sale_scoped, which the client calls
//      explicitly to receive the created orders.
//
// `registerHandlers` is `Object.assign` (core/mockDispatcher.ts:35-36), so the
// LAST registered handler for a name wins. kdsHandlers is registered AFTER
// createSalesHandlers (tauri-api.ts:278 then :281) and stubs
// create_kds_order_from_sale_scoped to `() => []`. The assertions below pin
// BOTH halves so a future change cannot quietly satisfy one and break the other.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { invoke } from '@/dev-mock/tauri-api';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

type KdsOrder = Record<string, unknown>;

/** The commands the client actually issues, in the order the POS issues them. */
const startSale = () => invoke('start_sale_scoped', { sessionToken: 'mock-token' });
const addLine = (sku: string, qty: number) =>
  invoke('add_line_scoped', { sessionToken: 'mock-token', args: { cartId: 'c1', sku, qty } });
const completeSale = () => invoke<{ saleId: string }>('complete_sale_scoped', { sessionToken: 'mock-token' });
const createFromSale = (saleId: string): Promise<KdsOrder[]> =>
  invoke<KdsOrder[]>('create_kds_order_from_sale_scoped', { sessionToken: 'mock-token', saleId });
const listOpen = (): Promise<KdsOrder[]> =>
  invoke<KdsOrder[]>('list_kds_orders_scoped', { sessionToken: 'mock-token', status: 'pending' });

/** Ring up a one-line sale and return its id. */
async function ringUpSale(sku = 'NASI-GORENG', qty = 1): Promise<string> {
  await startSale();
  await addLine(sku, qty);
  const result = await completeSale();
  return String((result as { saleId?: string })?.saleId ?? '');
}

describe('dev-mock sale → KDS link', () => {
  it('puts the sale on the kitchen board (the side-effect half)', async () => {
    const before = (await listOpen()).length;
    const saleId = await ringUpSale('NASI-GORENG', 2);
    expect(saleId, 'complete_sale_scoped must return a saleId').toBeTruthy();

    const after = await listOpen();
    expect(
      after.length,
      'a completed sale must add at least one pending KDS order — ' +
        'pushKdsOrderFromCart is the only thing that does it',
    ).toBeGreaterThan(before);

    const mine = after.find((o) => String(o['id'] ?? '').startsWith('kds-order-e2e-'));
    expect(mine, 'the new order must be the sale-derived kds-order-e2e-* one').toBeTruthy();
    expect(mine!['status']).toBe('pending');
  });

  it('seeds the ticket line items so the card renders real names', async () => {
    await ringUpSale('NASI-GORENG', 2);
    const orders = await listOpen();
    const mine = orders.find((o) => String(o['id'] ?? '').startsWith('kds-order-e2e-'));
    expect(mine).toBeTruthy();

    const lines = await invoke<Array<Record<string, unknown>>>('get_kds_order_lines_scoped', {
      sessionToken: 'mock-token',
      orderId: mine!['id'],
    });
    expect(lines.length, 'the ticket must carry its line items').toBeGreaterThan(0);
    // The line items are what KdsTicketCard renders; a name-less line renders blank.
    expect(lines[0]!['display_name']).toBeTruthy();
    expect(lines[0]!['qty']).toBe(2);
  });

  it('answers create_kds_order_from_sale_scoped with the orders it created', async () => {
    // The client's own call. Today the KDS handler map stubs this to []
    // (handlers/kds.ts:576) and, being registered last, it wins. Pinned as a
    // REGRESSION TARGET: it must agree with the board, or the client is told
    // "no orders" about a sale it just placed while the board shows one.
    const saleId = await ringUpSale('NASI-GORENG', 1);
    const created = await createFromSale(saleId);
    expect(Array.isArray(created), 'the command must resolve to an array').toBe(true);

    const board = await listOpen();
    const boardFromSale = board.filter((o) => String(o['id'] ?? '').startsWith('kds-order-e2e-'));
    expect(
      created.length,
      'create_kds_order_from_sale_scoped returned ' +
        created.length +
        ' order(s) while the board holds ' +
        boardFromSale.length +
        ' sale-derived order(s) — the command and the side effect disagree',
    ).toBe(boardFromSale.length);
  });
});
