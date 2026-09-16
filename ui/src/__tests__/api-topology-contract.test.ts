// ── IPC contract tests for topology.ts ─────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock('@/utils/logged-invoke', () => ({
  loggedInvoke: (cmd: string, args?: Record<string, unknown>) => mockInvoke(cmd, args),
}));

import {
  canSaveTopology,
  loadTopology,
} from '@/api/topology';

describe('topology.ts IPC contract', () => {
  beforeEach(() => mockInvoke.mockReset());

  it('canSaveTopology → can_save_topology with sessionToken', async () => {
    mockInvoke.mockResolvedValue(true);
    await canSaveTopology('tok');
    expect(mockInvoke).toHaveBeenCalledWith('can_save_topology', { sessionToken: 'tok' });
  });

  it('loadTopology → load_topology with the session and no branch', async () => {
    mockInvoke.mockResolvedValue(null);
    await loadTopology('tok');
    // R1 (2026-09-16): the read carries the session; branchId undefined is
    // an ABSENT key on the wire, not the old whole-payload undefined.
    expect(mockInvoke).toHaveBeenCalledWith('load_topology', {
      sessionToken: 'tok',
      branchId: undefined,
    });
  });

  it('loadTopology with branchId → load_topology with session and branchId', async () => {
    mockInvoke.mockResolvedValue(null);
    await loadTopology('tok', 'branch-1');
    expect(mockInvoke).toHaveBeenCalledWith('load_topology', {
      sessionToken: 'tok',
      branchId: 'branch-1',
    });
  });

  it('propagates backend errors', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('invalid topology'));
    await expect(canSaveTopology('tok')).rejects.toThrow('invalid topology');
  });
});
