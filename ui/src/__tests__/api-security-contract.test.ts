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

import { getKeyRotationInfo } from '@/api/security';

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

  // Three rotateEncryptionKey cases closed this file before: they pinned a
  // wrapper for the UNGATED rotate_encryption_key command, and the wrapper and
  // the command are both gone. A test asserting that a wrapper exists for it
  // would be a test that resurrects the bypass, so nothing replaces them here;
  // what is left pins get_key_rotation_info only. Note that the surviving gated
  // command rotate_encryption_key_scoped has no ui/ wrapper at all — key
  // rotation currently has no front door, which is the point, not an oversight.
});
