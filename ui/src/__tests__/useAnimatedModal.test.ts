import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAnimatedModal } from '@/hooks/useAnimatedModal';

describe('useAnimatedModal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns mounted=false and exiting=false when show is false initially', () => {
    const { result } = renderHook(() => useAnimatedModal(false));

    expect(result.current.mounted).toBe(false);
    expect(result.current.exiting).toBe(false);
  });

  it('returns mounted=true immediately when show becomes true', () => {
    const { result } = renderHook(() => useAnimatedModal(true));

    expect(result.current.mounted).toBe(true);
    expect(result.current.exiting).toBe(false);
  });

  it('transitions through exiting→unmounted when show goes false after being true', () => {
    const { result, rerender } = renderHook(
      ({ show }) => useAnimatedModal(show),
      { initialProps: { show: true } },
    );

    expect(result.current.mounted).toBe(true);
    expect(result.current.exiting).toBe(false);

    // Close the modal
    rerender({ show: false });

    // Should be in exiting phase
    expect(result.current.mounted).toBe(true);
    expect(result.current.exiting).toBe(true);

    // After the default 200ms duration, should unmount
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current.mounted).toBe(false);
    expect(result.current.exiting).toBe(false);
  });

  it('stays mounted during exit animation until duration elapses', () => {
    const { result, rerender } = renderHook(
      ({ show }) => useAnimatedModal(show),
      { initialProps: { show: true } },
    );

    rerender({ show: false });

    // At 199ms, still mounted + exiting
    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(result.current.mounted).toBe(true);
    expect(result.current.exiting).toBe(true);

    // At 200ms, unmounted
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.mounted).toBe(false);
    expect(result.current.exiting).toBe(false);
  });

  it('respects a custom duration', () => {
    const { result, rerender } = renderHook(
      ({ show }) => useAnimatedModal(show, 500),
      { initialProps: { show: true } },
    );

    rerender({ show: false });

    // At 400ms, still exiting
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(result.current.mounted).toBe(true);

    // At 500ms, unmounted
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current.mounted).toBe(false);
  });

  it('re-opens cleanly after closing', () => {
    const { result, rerender } = renderHook(
      ({ show }) => useAnimatedModal(show),
      { initialProps: { show: true } },
    );

    // Close
    rerender({ show: false });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.mounted).toBe(false);

    // Re-open
    rerender({ show: true });
    expect(result.current.mounted).toBe(true);
    expect(result.current.exiting).toBe(false);
  });

  it('re-opens after full close cycle with no residual exiting state', () => {
    const { result, rerender } = renderHook(
      ({ show }) => useAnimatedModal(show),
      { initialProps: { show: true } },
    );

    expect(result.current.mounted).toBe(true);
    expect(result.current.exiting).toBe(false);

    // Close and wait for full unmount
    rerender({ show: false });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.mounted).toBe(false);
    expect(result.current.exiting).toBe(false);

    // Re-open after being fully closed
    act(() => {
      rerender({ show: true });
    });
    expect(result.current.mounted).toBe(true);
    expect(result.current.exiting).toBe(false);
  });

  it('handles initial render with show=false then toggling', () => {
    const { result, rerender } = renderHook(
      ({ show }) => useAnimatedModal(show),
      { initialProps: { show: false } },
    );

    expect(result.current.mounted).toBe(false);

    // Open
    rerender({ show: true });
    expect(result.current.mounted).toBe(true);
    expect(result.current.exiting).toBe(false);

    // Close
    rerender({ show: false });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.mounted).toBe(false);
  });

  // ── Reopen DURING the exit window ─────────────────────────────────
  //
  // The two tests above reopen only AFTER the 200ms unmount, which is why
  // they passed while this one fails. Reopening inside the window is a
  // different transition: React runs the previous effect's cleanup (so the
  // pending unmount is cancelled and `mounted` survives), but the close
  // branch `return`s before `prevShow.current = show`, so the ref still
  // reads `true`. On the reopen neither branch matches, nothing clears
  // `exiting`, and the surface is left wearing its `--exiting` class —
  // whose keyframes are declared `animation: … forwards` — i.e. pinned at
  // opacity 0 with the focus trap disabled (`mOpen && !eOpen`).
  //
  // ShiftManagementScreen owns five modals driven by this hook
  // (ShiftManagementScreen.tsx:213-217); a fast second tap on a tablet
  // lands squarely inside the window.
  it('cancels the exit when show flips back true DURING the exit window', () => {
    const { result, rerender } = renderHook(
      ({ show }) => useAnimatedModal(show),
      { initialProps: { show: true } },
    );

    expect(result.current).toEqual({ mounted: true, exiting: false });

    // Close — starts the exit and schedules the unmount.
    rerender({ show: false });
    expect(result.current).toEqual({ mounted: true, exiting: true });

    // Reopen 50ms into the 200ms window.
    rerender({ show: true });
    act(() => {
      vi.advanceTimersByTime(50);
    });

    // The surface must be fully live again: mounted, and NOT stuck exiting.
    expect(result.current.mounted).toBe(true);
    expect(result.current.exiting).toBe(false);
  });

  it('survives a reopen-during-exit and then closes cleanly a second time', () => {
    const { result, rerender } = renderHook(
      ({ show }) => useAnimatedModal(show),
      { initialProps: { show: true } },
    );

    rerender({ show: false });
    rerender({ show: true });
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(result.current).toEqual({ mounted: true, exiting: false });

    // Second close, past the full duration, must still unmount.
    rerender({ show: false });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toEqual({ mounted: false, exiting: false });
  });
});
