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
// ── Dev-mock: a processed refund must be listable ────────────────────────
//
// WHY THIS FILE EXISTS
//
// process_refund minted a `refund-<now>` id and DISCARDED it, while
// list_refunds / list_refunds_scoped answered `[]` unconditionally. A refund
// therefore appeared to succeed and then vanished, and Sales History — which
// reads a sale's refunds through listRefundsScoped (SalesHistoryScreen.tsx:534)
// — showed none for every sale, including one just refunded.
//
// This is the SAME defect shape as the KDS create stub fixed in 0e2ddc7ac: a
// stateful command whose read-back disagrees with what the command did. Both
// are pinned the same way — assert that the write and the read AGREE, so
// satisfying one and breaking the other fails loudly.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { invoke } from '@/dev-mock/tauri-api';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

type RefundDto = {
  id: string;
  saleId: string;
  total: { minor_units: number; currency: string };
  reason: string;
  note: string;
  processedBy: string;
  createdAt: string;
  lines: Array<{ id: string; refundId: string; sku: string; qty: number }>;
};

const processRefund = (saleId: string, lines: Array<{ sku: string; qty: number; lineTotalMinor: number; currency: string }>) =>
  invoke<{ refundId: string; totalMinor: number }>('process_refund_scoped', {
    sessionToken: 'mock-token',
    args: { saleId, reason: 'Wrong item', note: 'customer changed mind', lines },
  });

const listRefunds = (saleId: string): Promise<RefundDto[]> =>
  invoke<RefundDto[]>('list_refunds_scoped', { sessionToken: 'mock-token', saleId });

describe('dev-mock refund persistence', () => {
  it('lists the refund it just processed (the write and read must agree)', async () => {
    const saleId = `sale-refund-${Date.now()}`;
    const before = await listRefunds(saleId);
    expect(before.length, 'a fresh sale has no refunds').toBe(0);

    const res = await processRefund(saleId, [
      { sku: 'NASI-GORENG', qty: 1, lineTotalMinor: 50000, currency: 'IDR' },
    ]);
    expect(res.refundId, 'the command must return a refundId').toBeTruthy();
    expect(res.totalMinor).toBe(50000);

    const after = await listRefunds(saleId);
    expect(
      after.length,
      'process_refund returned ' +
        res.refundId +
        ' but list_refunds_scoped reports ' +
        after.length +
        ' refund(s) — the command and the read-back disagree',
    ).toBe(1);
    expect(after[0]!.id).toBe(res.refundId);
  });

  it('answers with every field the RefundDto contract declares', async () => {
    // api/sales.ts:800. A renamed or dropped key typechecks (the mock returns
    // untyped literals) and then renders undefined in Sales History.
    const saleId = `sale-shape-${Date.now()}`;
    await processRefund(saleId, [{ sku: 'ES-TEH', qty: 2, lineTotalMinor: 16000, currency: 'IDR' }]);
    const [refund] = await listRefunds(saleId);
    expect(refund).toBeTruthy();
    expect(Object.keys(refund!).sort()).toEqual([
      'createdAt',
      'id',
      'lines',
      'note',
      'processedBy',
      'reason',
      'saleId',
      'total',
    ]);
    expect(refund!.saleId).toBe(saleId);
    expect(refund!.reason).toBe('Wrong item');
    expect(refund!.note).toBe('customer changed mind');
    expect(refund!.total.minor_units).toBe(16000);
    expect(refund!.createdAt).toBeTruthy();
    // The line items are what the history detail view renders.
    expect(refund!.lines.length).toBe(1);
    expect(refund!.lines[0]!.sku).toBe('ES-TEH');
    expect(refund!.lines[0]!.qty).toBe(2);
  });

  it('scopes the listing to the requested sale', async () => {
    // Two sales, one refund each: asking for one must not return the other's.
    const a = `sale-a-${Date.now()}`;
    const b = `sale-b-${Date.now()}`;
    await processRefund(a, [{ sku: 'NASI-GORENG', qty: 1, lineTotalMinor: 50000, currency: 'IDR' }]);
    await processRefund(b, [{ sku: 'ES-TEH', qty: 1, lineTotalMinor: 8000, currency: 'IDR' }]);

    const forA = await listRefunds(a);
    expect(forA.length).toBe(1);
    expect(forA[0]!.saleId).toBe(a);
    expect(forA[0]!.total.minor_units).toBe(50000);
  });
});
