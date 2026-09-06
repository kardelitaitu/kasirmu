import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { MEMO_POLL_INTERVAL_MS, useMemos } from '@/features/memo/useMemos';
import type { ActiveMemo } from '@/api/memos';

const { mockList, mockAck } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockAck: vi.fn(),
}));

vi.mock('@/api/memos', () => ({
  listActiveMemosScoped: (token: string) => mockList(token),
  acknowledgeMemoScoped: (token: string, memoId: string) => mockAck(token, memoId),
}));

function activeMemo(id: string, over: Partial<ActiveMemo> = {}): ActiveMemo {
  return {
    memo: {
      id,
      tenantId: 'default',
      locationId: null,
      authorUserId: 'user-1',
      authorRole: 'role-owner',
      title: `Memo ${id}`,
      body: 'body',
      status: 'published',
      duration: '24h',
      revision: 1,
      publishedAt: '2026-09-08T09:00:00.000Z',
      expiresAt: '2026-09-09T09:00:00.000Z',
      createdAt: '2026-09-08T09:00:00.000Z',
    },
    deliveryStatus: 'pending',
    ...over,
  };
}

beforeEach(() => {
  vi.useRealTimers();
  mockList.mockReset();
  mockAck.mockReset();
  mockAck.mockResolvedValue(undefined);
  // Reset the workspace token every test: the no-token case overrides it with
  // mockReturnValue, which would otherwise leak into later tests.
  vi.mocked(useWorkspace).mockReturnValue({
    sessionToken: 'test-token',
  } as unknown as ReturnType<typeof useWorkspace>);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useMemos', () => {
  it('fetches active memos on mount', async () => {
    mockList.mockResolvedValue([activeMemo('m1'), activeMemo('m2')]);
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.memos).toHaveLength(2));
    expect(mockList).toHaveBeenCalledWith(expect.any(String));
  });

  it('filters out memos already acknowledged by this terminal', async () => {
    mockList.mockResolvedValue([
      activeMemo('m1'),
      activeMemo('m2', { deliveryStatus: 'acknowledged' }),
    ]);
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.memos.length).toBeGreaterThan(0));
    expect(result.current.memos.map((m) => m.memo.id)).toEqual(['m1']);
  });

  it('dismiss hides a memo locally without calling the ack api', async () => {
    mockList.mockResolvedValue([activeMemo('m1'), activeMemo('m2')]);
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.memos).toHaveLength(2));
    act(() => result.current.dismiss('m1'));
    expect(result.current.memos.map((m) => m.memo.id)).toEqual(['m2']);
    expect(mockAck).not.toHaveBeenCalled();
  });

  it('acknowledge calls the api and drops the memo from view', async () => {
    mockList.mockResolvedValue([activeMemo('m1'), activeMemo('m2')]);
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.memos).toHaveLength(2));
    act(() => result.current.acknowledge('m1'));
    expect(result.current.memos.map((m) => m.memo.id)).toEqual(['m2']);
    await waitFor(() => expect(mockAck).toHaveBeenCalledWith(expect.any(String), 'm1'));
  });

  it('re-fetches on the poll cadence', async () => {
    vi.useFakeTimers();
    mockList.mockResolvedValue([activeMemo('m1')]);
    renderHook(() => useMemos());
    // Initial fetch.
    await act(async () => {
      vi.advanceTimersByTime(0);
    });
    expect(mockList).toHaveBeenCalledTimes(1);
    // Advance one full interval → a second fetch.
    await act(async () => {
      vi.advanceTimersByTime(MEMO_POLL_INTERVAL_MS);
    });
    expect(mockList).toHaveBeenCalledTimes(2);
    // Not yet a third.
    await act(async () => {
      vi.advanceTimersByTime(MEMO_POLL_INTERVAL_MS - 1);
    });
    expect(mockList).toHaveBeenCalledTimes(2);
  });

  it('clears memos and skips fetching when there is no session token', async () => {
    vi.mocked(useWorkspace).mockReturnValue({
      sessionToken: null,
    } as unknown as ReturnType<typeof useWorkspace>);
    mockList.mockResolvedValue([activeMemo('m1')]);
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.memos).toHaveLength(0));
    expect(mockList).not.toHaveBeenCalled();
  });

  it('surfaces a fetch error and keeps prior memos', async () => {
    mockList.mockResolvedValueOnce([activeMemo('m1')]);
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.memos).toHaveLength(1));
    mockList.mockRejectedValueOnce(new Error('ipc down'));
    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => expect(result.current.error).toBe('ipc down'));
    // Prior memos retained (error path does not clear the list).
    expect(result.current.memos.map((m) => m.memo.id)).toEqual(['m1']);
  });
});
