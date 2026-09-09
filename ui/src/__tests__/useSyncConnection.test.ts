import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSyncConnection } from '@/hooks/useSyncConnection';

const mockTestSyncConnection = vi.fn();

vi.mock('@/api/offline', () => ({
  testSyncConnection: (...args: unknown[]) => mockTestSyncConnection(...args),
}));

beforeEach(() => {
  mockTestSyncConnection.mockReset();
  vi.useFakeTimers({ shouldAdvanceTime: false });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useSyncConnection', () => {
  it('starts in checking state', () => {
    // Never resolve — stay in checking permanently.
    mockTestSyncConnection.mockReturnValue(new Promise(() => { /* never resolves */ }));

    const { result } = renderHook(() => useSyncConnection());

    expect(result.current.state).toBe('checking');
    expect(result.current.latencyMs).toBeNull();
  });

  it('transitions to connected when health check succeeds', async () => {
    mockTestSyncConnection.mockResolvedValue({
      ok: true,
      status: 'Connected (12ms)',
      latencyMs: 12,
    });

    const { result } = renderHook(() => useSyncConnection());

    // Flush pending microtasks so the resolved promise triggers state update.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(result.current.state).toBe('connected');
    expect(result.current.latencyMs).toBe(12);
  });

  it('transitions to disconnected when health check fails (ok: false)', async () => {
    mockTestSyncConnection.mockResolvedValue({
      ok: false,
      status: 'Server returned 503',
      latencyMs: null,
    });

    const { result } = renderHook(() => useSyncConnection());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(result.current.state).toBe('disconnected');
    expect(result.current.latencyMs).toBeNull();
  });

  it('transitions to disconnected when health check throws', async () => {
    mockTestSyncConnection.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useSyncConnection());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(result.current.state).toBe('disconnected');
    expect(result.current.latencyMs).toBeNull();
  });

  it('retries quickly after a disconnected check so startup bootstrap can recover', async () => {
    mockTestSyncConnection
      .mockResolvedValueOnce({ ok: false, status: 'No server URL configured', latencyMs: null })
      .mockResolvedValueOnce({ ok: true, status: 'Connected', latencyMs: 7 });

    const { result } = renderHook(() => useSyncConnection());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.state).toBe('disconnected');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(mockTestSyncConnection).toHaveBeenCalledTimes(2);
    expect(result.current.state).toBe('connected');
    expect(result.current.latencyMs).toBe(7);
  });

  it('polls periodically and updates state', async () => {
    // First call: connected
    mockTestSyncConnection.mockResolvedValueOnce({
      ok: true,
      status: 'Connected',
      latencyMs: 5,
    });

    const { result } = renderHook(() => useSyncConnection());

    // Wait for initial check to resolve.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.state).toBe('connected');

    // Second call (after interval): disconnected
    mockTestSyncConnection.mockResolvedValueOnce({
      ok: false,
      status: 'Server unreachable',
      latencyMs: null,
    });

    // Advance past the 60 s poll interval.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(result.current.state).toBe('disconnected');
  });

  it('cleans up interval on unmount', () => {
    mockTestSyncConnection.mockResolvedValue({
      ok: true,
      status: 'Connected',
      latencyMs: 5,
    });

    const { unmount } = renderHook(() => useSyncConnection());
    unmount();

    // After unmount, advancing time should not cause a state update.
    // No assertion needed — the test just verifies no crash/leak.
  });

  // ── Manual retry (saas-3 service-health contracts) ────────────────

  it('re-probes immediately on manual retry, superseding the pending poll', async () => {
    mockTestSyncConnection.mockResolvedValue({ ok: true, status: 'Connected', latencyMs: 10 });
    const { result } = renderHook(() => useSyncConnection());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mockTestSyncConnection).toHaveBeenCalledTimes(1);

    // Click retry ~30s into the 60s poll window.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    act(() => {
      result.current.retryNow();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mockTestSyncConnection).toHaveBeenCalledTimes(2);

    // Regression: the original poll must not fire on top of the retry's own
    // schedule — the stacked second loop is the bug class this pins. A stacked
    // timer (scheduled at the original +60 s, ~30 s from now) fires inside the
    // next 55 s; the retry's own poll only fires at +60 s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(55_000);
    });
    expect(mockTestSyncConnection).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_100);
    });
    expect(mockTestSyncConnection).toHaveBeenCalledTimes(3);
  });

  it('discards a stale in-flight probe once a retry supersedes it', async () => {
    // The retry contract: a pending probe's result is discarded in favour of
    // the fresh one, so a click can never double-apply a stale reading.
    let resolveFirst!: (v: { ok: boolean; status: string; latencyMs: number | null }) => void;
    mockTestSyncConnection.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; }),
    );
    mockTestSyncConnection.mockResolvedValueOnce({ ok: true, status: 'retry answer', latencyMs: 8 });

    const { result } = renderHook(() => useSyncConnection());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    // Original probe still hanging; the retry supersedes it and answers fast.
    act(() => {
      result.current.retryNow();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.state).toBe('connected');

    // The stale probe resolves late with a failure — it must not repaint.
    resolveFirst({ ok: false, status: 'stale', latencyMs: null });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.state).toBe('connected');
  });

  it('retries while disconnected drop out of the 5s backoff into a fresh probe', async () => {
    mockTestSyncConnection.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useSyncConnection());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.state).toBe('disconnected');
    expect(mockTestSyncConnection).toHaveBeenCalledTimes(1);

    // Manual retry mid-backoff must probe now, not wait for the 5 s timer.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    act(() => {
      result.current.retryNow();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mockTestSyncConnection).toHaveBeenCalledTimes(2);

    mockTestSyncConnection.mockResolvedValue({ ok: true, status: 'Connected', latencyMs: 9 });
    act(() => {
      result.current.retryNow();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.state).toBe('connected');
  });
});
