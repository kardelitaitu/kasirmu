// ── useInvalidSession tests ──────────────────────────────────────
//
// Covers: default false, triggering on an invalidSession IPC error,
// auto-clear after ~5s, re-triggering refreshes the window, ignoring
// non-invalidSession errors, and cleanup on unmount.
//
// Mocks: @/utils/app-error (captures the onIpcError listener so tests
// can fire events directly without normalizeError coupling).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useInvalidSession } from '@/hooks/useInvalidSession';
import { onIpcError, type NormalizedError } from '@/utils/app-error';

// ── Mocks ───────────────────────────────────────────────────────────

type IpcListener = Parameters<typeof onIpcError>[0];
let capturedListener: IpcListener | null = null;

vi.mock('@/utils/app-error', () => ({
  onIpcError: vi.fn((fn: IpcListener) => {
    capturedListener = fn;
    return () => { capturedListener = null; };
  }),
}));

/** Build a minimal NormalizedError with the given kind. */
function makeError(kind: string): NormalizedError {
  return {
    kind,
    rawMessage: `fake ${kind}`,
    retryClass: 'non-retryable',
    correlationId: 'test-cid',
    userKey: 'errors.generic',
  } as NormalizedError;
}

/** Fire a fake IPC error at the hook's listener. */
function emitError(kind: string, command = 'some_command'): void {
  if (capturedListener) capturedListener({ command, error: makeError(kind) });
}

// ── Tests ────────────────────────────────────────────────────────────

describe('useInvalidSession', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    capturedListener = null;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns false initially', () => {
    const { result } = renderHook(() => useInvalidSession());
    expect(result.current).toBe(false);
  });

  it('registers exactly one IPC error listener on mount', () => {
    renderHook(() => useInvalidSession());
    expect(onIpcError).toHaveBeenCalledTimes(1);
  });

  it('flips to true when an invalidSession error fires', () => {
    const { result } = renderHook(() => useInvalidSession());
    act(() => emitError('invalidSession'));
    expect(result.current).toBe(true);
  });

  it('auto-clears to false after 5 seconds', () => {
    const { result } = renderHook(() => useInvalidSession());
    act(() => emitError('invalidSession'));
    expect(result.current).toBe(true);

    act(() => vi.advanceTimersByTime(5000));
    expect(result.current).toBe(false);
  });

  it('does not clear before the 5-second window elapses', () => {
    const { result } = renderHook(() => useInvalidSession());
    act(() => emitError('invalidSession'));

    act(() => vi.advanceTimersByTime(4999));
    expect(result.current).toBe(true);
  });

  it('re-triggering refreshes the clear window', () => {
    const { result } = renderHook(() => useInvalidSession());

    act(() => emitError('invalidSession'));
    act(() => vi.advanceTimersByTime(3000));

    // Second failure inside the window — restarts the 5s timer.
    act(() => emitError('invalidSession'));
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current).toBe(true); // only 3s since the 2nd trigger

    act(() => vi.advanceTimersByTime(2000));
    expect(result.current).toBe(false); // 5s since the 2nd trigger
  });

  it('ignores non-invalidSession error kinds', () => {
    const { result } = renderHook(() => useInvalidSession());
    act(() => emitError('network'));
    act(() => emitError('serialization'));
    act(() => emitError('unexpected'));
    expect(result.current).toBe(false);
  });

  it('unsubscribes the listener on unmount', () => {
    const unsub = vi.fn();
    vi.mocked(onIpcError).mockImplementation((fn) => { capturedListener = fn; return unsub; });

    const { unmount } = renderHook(() => useInvalidSession());
    unmount();
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it('does not flip true after unmount (listener removed)', () => {
    const { result, unmount } = renderHook(() => useInvalidSession());
    unmount();
    act(() => emitError('invalidSession'));
    expect(result.current).toBe(false);
  });
});
