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
// ── gateway.ts error-propagation TDD test ─────────────────────────
//
// Contract (after the UI-1 fix): getGatewayStatus() makes a SINGLE
// loggedInvoke('gateway_status') call. The backend computes the
// configured/online booleans server-side so raw credential values
// (stripe.api_key, square.api_key, midtrans.server_key) never reach
// the renderer — the keys are on the SECRET_KEY_DENY_LIST in both
// clients.
//
// Error propagation: the function propagates backend errors instead
// of returning a synthetic fallback — the caller can distinguish a
// backend outage from a genuine empty-keys state.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args: Record<string, unknown>) => mockInvoke(cmd, args),
}));

import { getGatewayStatus } from '@/api/gateway';

describe('getGatewayStatus error propagation', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('invokes the backend gateway_status command exactly once', async () => {
    mockInvoke.mockResolvedValue([
      { name: 'Stripe', configured: true, online: true },
      { name: 'Square', configured: false, online: false },
      { name: 'QRIS (Midtrans)', configured: true, online: true },
    ]);
    const result = await getGatewayStatus();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    // loggedInvoke('gateway_status') forwards args as undefined.
    expect(mockInvoke).toHaveBeenCalledWith('gateway_status', undefined);
    expect(result.map((g) => g.name)).toEqual(['Stripe', 'Square', 'QRIS (Midtrans)']);
    expect(result.map((g) => g.configured)).toEqual([true, false, true]);
  });

  it('never invokes get_setting with a payment credential key (UI-1)', async () => {
    mockInvoke.mockResolvedValue([
      { name: 'Stripe', configured: true, online: true },
      { name: 'Square', configured: false, online: false },
      { name: 'QRIS (Midtrans)', configured: true, online: true },
    ]);
    await getGatewayStatus();
    const invokedCmds = mockInvoke.mock.calls.map((c) => c[0] as string);
    expect(invokedCmds).not.toContain('get_setting');
  });

  it('PROPAGATES the error when the backend fails (does not swallow)', async () => {
    // Simulate a backend failure: DB locked, session expired, etc.
    // The invoke rejects with a real error.
    mockInvoke.mockRejectedValue(new Error('database is locked'));

    // The fix: propagate the error so callers can surface it
    // (error toast, retry UI) instead of silently showing "offline".
    await expect(getGatewayStatus()).rejects.toThrow('database is locked');
  });

  it('does not return a synthetic "Gateway" fallback on error', async () => {
    mockInvoke.mockRejectedValue(new Error('backend unreachable'));
    // After the fix, the function throws, so no array is returned at all.
    let threw = false;
    let caught: unknown = null;
    try {
      await getGatewayStatus();
    } catch (e) {
      threw = true;
      caught = e;
    }
    expect(threw).toBe(true);
    expect(caught).toBeInstanceOf(Error);
  });
});
