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
// ── IPC contract tests for loyalty.ts ─────────────────────────────
//
// Loyalty is financial and tenant-scoped. These tests prevent the UI
// boundary from silently reverting to the legacy global commands.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => mockInvoke(cmd, args),
}));

import {
  getLoyaltyAccount,
  listLoyaltyAccounts,
  earnLoyaltyPoints,
  redeemLoyaltyPoints,
  listLoyaltyTiers,
  updateLoyaltyTier,
  getPointsValue,
  getOrCreateLoyaltyAccount,
} from '@/api/loyalty';

const tier = {
  id: 'tier-1',
  name: 'Silver',
  min_points: 100,
  points_per_unit: 10,
  earn_multiplier_millionths: 1_250_000,
  colour: '#c0c0c0',
  sort_order: 1,
  created_at: '2026-01-01T00:00:00.000Z',
};

describe('loyalty.ts scoped IPC contract', () => {
  beforeEach(() => mockInvoke.mockReset());

  it('scopes account lookup to the active session', async () => {
    mockInvoke.mockResolvedValue(null);
    await getLoyaltyAccount('session-1', 'cust-1');
    expect(mockInvoke).toHaveBeenCalledWith('get_loyalty_account_scoped', {
      sessionToken: 'session-1',
      customerId: 'cust-1',
    });
  });

  it('scopes account listing and tier listing', async () => {
    mockInvoke.mockResolvedValue([]);
    await listLoyaltyAccounts('session-1');
    expect(mockInvoke).toHaveBeenLastCalledWith('list_loyalty_accounts_scoped', {
      sessionToken: 'session-1',
    });

    await listLoyaltyTiers('session-1');
    expect(mockInvoke).toHaveBeenLastCalledWith('list_loyalty_tiers_scoped', {
      sessionToken: 'session-1',
    });
  });

  it('scopes earn and redeem operations without a caller user id', async () => {
    mockInvoke.mockResolvedValue({});
    await earnLoyaltyPoints('session-1', 'cust-1', 'sale-1', 50000);
    expect(mockInvoke).toHaveBeenLastCalledWith('earn_loyalty_points_scoped', {
      sessionToken: 'session-1',
      customerId: 'cust-1',
      saleId: 'sale-1',
      totalMinor: 50000,
    });

    await redeemLoyaltyPoints('session-1', 'cust-1', 200, 'sale-1');
    expect(mockInvoke).toHaveBeenLastCalledWith('redeem_loyalty_points_scoped', {
      sessionToken: 'session-1',
      customerId: 'cust-1',
      points: 200,
      saleId: 'sale-1',
    });
  });

  it('scopes tier updates, points value, and account creation', async () => {
    mockInvoke.mockResolvedValue({});
    await updateLoyaltyTier('session-1', tier);
    expect(mockInvoke).toHaveBeenLastCalledWith('update_loyalty_tier_scoped', {
      sessionToken: 'session-1',
      tier,
    });

    await getPointsValue('session-1', 100);
    expect(mockInvoke).toHaveBeenLastCalledWith('get_points_value_scoped', {
      sessionToken: 'session-1',
      points: 100,
    });

    await getOrCreateLoyaltyAccount('session-1', 'cust-1');
    expect(mockInvoke).toHaveBeenLastCalledWith('get_or_create_loyalty_account_scoped', {
      sessionToken: 'session-1',
      customerId: 'cust-1',
    });
  });

  it('propagates backend errors', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('permission denied'));
    await expect(listLoyaltyAccounts('session-1')).rejects.toThrow('permission denied');
  });
});
