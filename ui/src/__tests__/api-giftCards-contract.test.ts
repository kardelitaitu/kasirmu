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
  issueGiftCard,
  getGiftCard,
  listGiftCards,
  getGiftCardBalance,
  redeemGiftCard,
  topUpGiftCard,
  freezeGiftCard,
  unfreezeGiftCard,
} from '@/api/giftCards';

describe('giftCards.ts API contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('issueGiftCard calls correct command', async () => {
    const input = {
      card_number: 'GC-001',
      initial_amount_minor: 100000,
      currency: 'IDR',
      created_by: 'u1',
    };
    mockInvoke.mockResolvedValue({ card: { card_number: 'GC-001', balance: 100000 }, transactions: [] });
    const result = await issueGiftCard('tok-1', input);
    expect(mockInvoke).toHaveBeenCalledWith('issue_gift_card_scoped', { sessionToken: 'tok-1', input });
    expect(result.card.card_number).toBe('GC-001');
  });

  it('getGiftCard calls correct command', async () => {
    mockInvoke.mockResolvedValue(null);
    await getGiftCard('tok-1', 'GC-001');
    expect(mockInvoke).toHaveBeenCalledWith('get_gift_card_scoped', { sessionToken: 'tok-1', cardNumberOrId: 'GC-001' });
  });

  it('listGiftCards calls correct command', async () => {
    mockInvoke.mockResolvedValue([]);
    await listGiftCards('tok-1', {});
    expect(mockInvoke).toHaveBeenCalledWith('list_gift_cards_scoped', { sessionToken: 'tok-1', filter: {} });
  });

  it('getGiftCardBalance calls correct command', async () => {
    mockInvoke.mockResolvedValue({ balance_minor: 50000, currency: 'IDR', status: 'active' });
    const result = await getGiftCardBalance('tok-1', 'GC-001');
    expect(mockInvoke).toHaveBeenCalledWith('get_gift_card_balance_scoped', { sessionToken: 'tok-1', cardNumberOrId: 'GC-001' });
    expect(result?.balance_minor).toBe(50000);
  });

  it('redeemGiftCard calls correct command', async () => {
    mockInvoke.mockResolvedValue({ card: { card_number: 'GC-001', balance: 30000 }, transactions: [] });
    await redeemGiftCard('tok-1', 'GC-001', 20000, 'sale-1');
    expect(mockInvoke).toHaveBeenCalledWith('redeem_gift_card_scoped', {
      sessionToken: 'tok-1',
      cardNumberOrId: 'GC-001',
      amountMinor: 20000,
      saleId: 'sale-1',
    });
  });

  it('topUpGiftCard calls correct command', async () => {
    mockInvoke.mockResolvedValue({ card: { card_number: 'GC-001', balance: 150000 }, transactions: [] });
    await topUpGiftCard('tok-1', 'GC-001', 50000);
    expect(mockInvoke).toHaveBeenCalledWith('top_up_gift_card_scoped', {
      sessionToken: 'tok-1',
      cardNumberOrId: 'GC-001',
      amountMinor: 50000,
    });
  });

  it('freezeGiftCard calls correct command', async () => {
    mockInvoke.mockResolvedValue({ card_number: 'GC-001', status: 'frozen', balance: 150000 });
    await freezeGiftCard('tok-1', 'GC-001');
    expect(mockInvoke).toHaveBeenCalledWith('freeze_gift_card_scoped', { sessionToken: 'tok-1', cardNumberOrId: 'GC-001' });
  });

  it('unfreezeGiftCard calls correct command', async () => {
    mockInvoke.mockResolvedValue({ card_number: 'GC-001', status: 'active', balance: 150000 });
    await unfreezeGiftCard('tok-1', 'GC-001');
    expect(mockInvoke).toHaveBeenCalledWith('unfreeze_gift_card_scoped', { sessionToken: 'tok-1', cardNumberOrId: 'GC-001' });
  });

  it('propagates errors', async () => {
    mockInvoke.mockRejectedValue(new Error('card not found'));
    await expect(getGiftCard('bad', 'GC-001')).rejects.toThrow('card not found');
  });
});
