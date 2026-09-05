// ── useAuthConnection tests ──────────────────────────────────────
//
// Covers: initial 'checking' state, connected/disconnected mapping,
// thrown-error handling, the two-tier polling cadence (60 s while
// connected, 5 s retry while disconnected), recovery to connected,
// and unmount stopping the poll loop.
//
// Mocks: @/api/license (testAuthConnection). Fake timers control the
// polling schedule deterministically.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAuthConnection } from '@/hooks/useAuthConnection';
import { testAuthConnection } from '@/api/license';

vi.mock('@/api/license', () => ({
  testAuthConnection: vi.fn(),
}));

/** Flush pending microtasks so the in-flight async check() settles. */
async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe('useAuthConnection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(testAuthConnection).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── Initial state ─────────────────────────────────────────────

  it('starts in the checking state with unknown latency', () => {
    vi.mocked(testAuthConnection).mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useAuthConnection());
    expect(result.current.state).toBe('checking');
    expect(result.current.latencyMs).toBeNull();
  });

  // ── Connected path ────────────────────────────────────────────

  it('becomes connected with latency when the ping succeeds', async () => {
    vi.mocked(testAuthConnection).mockResolvedValue({ ok: true, status: 'healthy', latencyMs: 42 });

    const { result } = renderHook(() => useAuthConnection());
    await flush();

    expect(result.current.state).toBe('connected');
    expect(result.current.latencyMs).toBe(42);
  });

  // ── Disconnected paths ────────────────────────────────────────

  it('becomes disconnected when the ping returns ok:false', async () => {
    vi.mocked(testAuthConnection).mockResolvedValue({ ok: false, status: 'error', latencyMs: null });

    const { result } = renderHook(() => useAuthConnection());
    await flush();

    expect(result.current.state).toBe('disconnected');
    expect(result.current.latencyMs).toBeNull();
  });

  it('becomes disconnected when the ping throws', async () => {
    vi.mocked(testAuthConnection).mockRejectedValue(new Error('invoke failed'));

    const { result } = renderHook(() => useAuthConnection());
    await flush();

    expect(result.current.state).toBe('disconnected');
    expect(result.current.latencyMs).toBeNull();
  });

  // ── Polling cadence ───────────────────────────────────────────

  it('re-polls after 60 s while connected', async () => {
    vi.mocked(testAuthConnection).mockResolvedValue({ ok: true, status: 'healthy', latencyMs: 10 });
    renderHook(() => useAuthConnection());
    await flush();
    expect(testAuthConnection).toHaveBeenCalledTimes(1);

    // Just under the 60 s poll interval — no new call yet.
    await act(async () => { await vi.advanceTimersByTimeAsync(59_999); });
    expect(testAuthConnection).toHaveBeenCalledTimes(1);

    // The 60 s mark fires the next poll.
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(testAuthConnection).toHaveBeenCalledTimes(2);
  });

  it('retries after 5 s while disconnected', async () => {
    vi.mocked(testAuthConnection).mockRejectedValue(new Error('down'));
    renderHook(() => useAuthConnection());
    await flush();
    expect(testAuthConnection).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(4_999); });
    expect(testAuthConnection).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(testAuthConnection).toHaveBeenCalledTimes(2);
  });

  it('recovers to connected when a retry succeeds', async () => {
    vi.mocked(testAuthConnection)
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue({ ok: true, status: 'healthy', latencyMs: 33 });

    const { result } = renderHook(() => useAuthConnection());
    await flush();
    expect(result.current.state).toBe('disconnected');

    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    await flush();

    expect(result.current.state).toBe('connected');
    expect(result.current.latencyMs).toBe(33);
  });

  // ── Unmount ───────────────────────────────────────────────────

  it('stops polling after unmount', async () => {
    vi.mocked(testAuthConnection).mockResolvedValue({ ok: true, status: 'healthy', latencyMs: 10 });
    const { unmount } = renderHook(() => useAuthConnection());
    await flush();
    expect(testAuthConnection).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });

    expect(testAuthConnection).toHaveBeenCalledTimes(1);
  });

  it('ignores a late ping resolution after unmount', async () => {
    vi.mocked(testAuthConnection).mockReturnValue(new Promise(() => {}));
    const { result, unmount } = renderHook(() => useAuthConnection());

    unmount();

    // Resolve the pending ping after unmount — must not setState.
    vi.mocked(testAuthConnection).mockResolvedValue({ ok: true, status: 'healthy', latencyMs: 10 });
    await flush();

    expect(result.current.state).toBe('checking');
    expect(result.current.latencyMs).toBeNull();
  });
});
