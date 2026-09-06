import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useMemos } from '@/features/memo/useMemos';
import type { ActiveMemosResponse } from '@/api/memos';

const { mockList, mockAck } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockAck: vi.fn(),
}));

vi.mock('@/api/memos', () => ({
  listActiveMemosScoped: (token: string) => mockList(token),
  acknowledgeMemoScoped: (token: string, memoId: string) => mockAck(token, memoId),
}));

function activeMemo(id: string, over: Partial<ActiveMemosResponse['memos'][number]> = {}) {
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
  } as ActiveMemosResponse['memos'][number];
}

/** The server-served cadence the tests assert against (mirrors
 * `oz_core::memo`: base 900s, KDS derived as 2 × base). */
const CADENCE = { baseIntervalSecs: 900, kdsIntervalSecs: 1800 };

function envelope(memos: ActiveMemosResponse['memos']): ActiveMemosResponse {
  return { memos, cadence: CADENCE };
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
    mockList.mockResolvedValue(envelope([activeMemo('m1'), activeMemo('m2')]));
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.memos).toHaveLength(2));
    expect(mockList).toHaveBeenCalledWith(expect.any(String));
  });

  it('filters out memos already acknowledged by this terminal', async () => {
    mockList.mockResolvedValue(
      envelope([
        activeMemo('m1'),
        activeMemo('m2', { deliveryStatus: 'acknowledged' }),
      ]),
    );
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.memos.length).toBeGreaterThan(0));
    expect(result.current.memos.map((m) => m.memo.id)).toEqual(['m1']);
  });

  it('dismiss hides a memo locally without calling the ack api', async () => {
    mockList.mockResolvedValue(envelope([activeMemo('m1'), activeMemo('m2')]));
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.memos).toHaveLength(2));
    act(() => result.current.dismiss('m1'));
    expect(result.current.memos.map((m) => m.memo.id)).toEqual(['m2']);
    expect(mockAck).not.toHaveBeenCalled();
  });

  it('acknowledge calls the api and drops the memo from view', async () => {
    mockList.mockResolvedValue(envelope([activeMemo('m1'), activeMemo('m2')]));
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.memos).toHaveLength(2));
    act(() => result.current.acknowledge('m1'));
    expect(result.current.memos.map((m) => m.memo.id)).toEqual(['m2']);
    await waitFor(() => expect(mockAck).toHaveBeenCalledWith(expect.any(String), 'm1'));
  });

  it('polls at the server-sent base interval', async () => {
    vi.useFakeTimers();
    mockList.mockResolvedValue(envelope([activeMemo('m1')]));
    renderHook(() => useMemos());
    // Initial fetch.
    await act(async () => {
      vi.advanceTimersByTime(0);
    });
    expect(mockList).toHaveBeenCalledTimes(1);
    // Advance one full base interval → a second fetch.
    await act(async () => {
      vi.advanceTimersByTime(CADENCE.baseIntervalSecs * 1000);
    });
    expect(mockList).toHaveBeenCalledTimes(2);
    // Not yet a third.
    await act(async () => {
      vi.advanceTimersByTime(CADENCE.baseIntervalSecs * 1000 - 1);
    });
    expect(mockList).toHaveBeenCalledTimes(2);
  });

  it('polls at the doubled interval on KDS surfaces', async () => {
    vi.useFakeTimers();
    mockList.mockResolvedValue(envelope([activeMemo('m1')]));
    renderHook(() => useMemos({ kds: true }));
    await act(async () => {
      vi.advanceTimersByTime(0);
    });
    expect(mockList).toHaveBeenCalledTimes(1);
    // The base interval alone must NOT trigger the second fetch — the KDS
    // surface runs at the server's doubled value (the spec's "2× the shared
    // base interval", never a second tuned constant).
    await act(async () => {
      vi.advanceTimersByTime(CADENCE.baseIntervalSecs * 1000);
    });
    expect(mockList).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(CADENCE.kdsIntervalSecs * 1000 - CADENCE.baseIntervalSecs * 1000);
    });
    expect(mockList).toHaveBeenCalledTimes(2);
  });

  it('does not schedule a poll before the server cadence arrives', async () => {
    // No fallback literal: until the first response delivers the cadence,
    // nothing schedules a poll. A client-side default here would silently
    // drift from the backend.
    vi.useFakeTimers();
    mockList.mockReturnValue(new Promise(() => {}));
    renderHook(() => useMemos());
    await act(async () => {
      vi.advanceTimersByTime(0);
    });
    expect(mockList).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(10 * 60 * 1000);
    });
    expect(mockList).toHaveBeenCalledTimes(1);
  });

  it('clears memos and skips fetching when there is no session token', async () => {
    vi.mocked(useWorkspace).mockReturnValue({
      sessionToken: null,
    } as unknown as ReturnType<typeof useWorkspace>);
    mockList.mockResolvedValue(envelope([activeMemo('m1')]));
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.memos).toHaveLength(0));
    expect(mockList).not.toHaveBeenCalled();
  });

  it('surfaces a fetch error and keeps prior memos', async () => {
    mockList.mockResolvedValueOnce(envelope([activeMemo('m1')]));
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
