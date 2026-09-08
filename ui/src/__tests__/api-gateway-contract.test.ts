// ── IPC contract tests for gateway.ts ───────────────────────────
//
// Verifies every exported function calls loggedInvoke with the
// correct IPC command name and argument shape, and that the value
// resolved by the backend is passed through untouched.
//
// UI-1: the backend computes configured/online server-side, so this
// module must forward the payload unchanged and must NOT swallow
// errors into a synthetic fallback array.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock('@/utils/logged-invoke', () => ({
  loggedInvoke: (cmd: string, args?: Record<string, unknown>) => mockInvoke(cmd, args),
}));

import { getGatewayStatus, type GatewayStatus } from '@/api/gateway';

const PAYLOAD: GatewayStatus[] = [
  { name: 'stripe', configured: true, online: true },
  { name: 'square', configured: false, online: false },
  { name: 'midtrans', configured: true, online: false },
];

describe('gateway.ts IPC contract', () => {
  beforeEach(() => mockInvoke.mockReset());

  it('getGatewayStatus → gateway_status (no args)', async () => {
    mockInvoke.mockResolvedValue(PAYLOAD);
    await getGatewayStatus();
    expect(mockInvoke).toHaveBeenCalledWith('gateway_status', undefined);
  });

  it('getGatewayStatus passes the backend array through unchanged', async () => {
    mockInvoke.mockResolvedValue(PAYLOAD);
    const result = await getGatewayStatus();
    expect(result).toEqual(PAYLOAD);
    expect(result).toHaveLength(3);
  });

  it('getGatewayStatus does not invent entries when the backend returns an empty list', async () => {
    mockInvoke.mockResolvedValue([]);
    const result = await getGatewayStatus();
    expect(result).toEqual([]);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('propagates backend errors instead of returning a synthetic fallback', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('settings table unavailable'));
    await expect(getGatewayStatus()).rejects.toThrow('settings table unavailable');
  });
});
