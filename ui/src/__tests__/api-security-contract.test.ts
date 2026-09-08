// ── IPC contract tests for security.ts ──────────────────────────
//
// Verifies every exported function calls loggedInvoke with the
// correct IPC command name and argument shape, and that the value
// resolved by the backend is passed through untouched.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock('@/utils/logged-invoke', () => ({
  loggedInvoke: (cmd: string, args?: Record<string, unknown>) => mockInvoke(cmd, args),
}));

import { getKeyRotationInfo, rotateEncryptionKey } from '@/api/security';

describe('security.ts IPC contract', () => {
  beforeEach(() => mockInvoke.mockReset());

  it('getKeyRotationInfo → get_key_rotation_info (no args)', async () => {
    const status = { hasKey: true, createdAt: '2026-01-01T00:00:00Z', ageDays: 246 };
    mockInvoke.mockResolvedValue(status);
    const result = await getKeyRotationInfo();
    expect(mockInvoke).toHaveBeenCalledWith('get_key_rotation_info', undefined);
    expect(result).toEqual(status);
  });

  it('getKeyRotationInfo passes through the "no key yet" shape', async () => {
    mockInvoke.mockResolvedValue({ hasKey: false, createdAt: null, ageDays: null });
    const result = await getKeyRotationInfo();
    expect(result.hasKey).toBe(false);
    expect(result.createdAt).toBeNull();
    expect(result.ageDays).toBeNull();
  });

  it('rotateEncryptionKey → rotate_encryption_key (no args, no payload)', async () => {
    const rotation = {
      keyName: 'oz-pos/encryption-key',
      createdAt: '2026-09-06T00:00:00Z',
      keyBytes: 32,
    };
    mockInvoke.mockResolvedValue(rotation);
    const result = await rotateEncryptionKey();
    expect(mockInvoke).toHaveBeenCalledWith('rotate_encryption_key', undefined);
    expect(result).toEqual(rotation);
  });

  it('never sends key material over the wire', async () => {
    mockInvoke.mockResolvedValue({ keyName: 'k', createdAt: 'now', keyBytes: 32 });
    await rotateEncryptionKey();
    const call = mockInvoke.mock.calls[0];
    expect(call?.[1]).toBeUndefined();
  });

  it('propagates backend errors', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('keyring unavailable'));
    await expect(rotateEncryptionKey()).rejects.toThrow('keyring unavailable');
  });
});
