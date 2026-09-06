// ── IPC contract tests for memos.ts ───────────────────────────
//
// Verifies every exported function calls loggedInvoke with the
// correct IPC command name and argument shape (sessionToken + args),
// pinning the wire contract against the Rust scoped commands.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock('@/utils/logged-invoke', () => ({
  loggedInvoke: (cmd: string, args?: Record<string, unknown>) => mockInvoke(cmd, args),
}));

import { listActiveMemosScoped, acknowledgeMemoScoped } from '@/api/memos';

describe('memos.ts IPC contract', () => {
  beforeEach(() => mockInvoke.mockReset());

  it('listActiveMemosScoped → list_active_memos_scoped with sessionToken', async () => {
    mockInvoke.mockResolvedValue({ memos: [], cadence: { baseIntervalSecs: 900, kdsIntervalSecs: 1800 } });
    await listActiveMemosScoped('tok');
    expect(mockInvoke).toHaveBeenCalledWith('list_active_memos_scoped', { sessionToken: 'tok' });
  });

  it('acknowledgeMemoScoped → acknowledge_memo_scoped with sessionToken + memoId', async () => {
    mockInvoke.mockResolvedValue(null);
    await acknowledgeMemoScoped('tok', 'memo-1');
    expect(mockInvoke).toHaveBeenCalledWith('acknowledge_memo_scoped', {
      sessionToken: 'tok',
      memoId: 'memo-1',
    });
  });
});
