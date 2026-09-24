import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSplashExit } from '@/hooks/useSplashExit';

describe('useSplashExit hook (T3 Boot Splash Crossfade)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps splash mounted and non-exiting while loading=true', () => {
    const { result } = renderHook(({ loading }) => useSplashExit(loading), {
      initialProps: { loading: true },
    });

    expect(result.current.splashMounted).toBe(true);
    expect(result.current.splashExiting).toBe(false);
  });

  it('transitions to exiting=true immediately when loading flips from true to false', () => {
    const { result, rerender } = renderHook(({ loading }) => useSplashExit(loading), {
      initialProps: { loading: true },
    });

    expect(result.current.splashMounted).toBe(true);
    expect(result.current.splashExiting).toBe(false);

    // Flip loading to false
    rerender({ loading: false });

    // Splash remains mounted for crossfade, but is marked exiting
    expect(result.current.splashMounted).toBe(true);
    expect(result.current.splashExiting).toBe(true);
  });

  it('unmounts the splash after 200ms when motion is preferred', () => {
    const { result, rerender } = renderHook(({ loading }) => useSplashExit(loading), {
      initialProps: { loading: true },
    });

    rerender({ loading: false });
    expect(result.current.splashMounted).toBe(true);
    expect(result.current.splashExiting).toBe(true);

    // Advance halfway through animation
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current.splashMounted).toBe(true);
    expect(result.current.splashExiting).toBe(true);

    // Advance past 200ms
    act(() => {
      vi.advanceTimersByTime(101);
    });
    expect(result.current.splashMounted).toBe(false);
    expect(result.current.splashExiting).toBe(false);
  });

  it('cancels exit timer and restores splash if loading becomes true again', () => {
    const { result, rerender } = renderHook(({ loading }) => useSplashExit(loading), {
      initialProps: { loading: true },
    });

    rerender({ loading: false });
    expect(result.current.splashExiting).toBe(true);

    // Loading flips back to true mid-animation
    rerender({ loading: true });
    expect(result.current.splashMounted).toBe(true);
    expect(result.current.splashExiting).toBe(false);

    // Even after 500ms, splash stays mounted because loading=true
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.splashMounted).toBe(true);
    expect(result.current.splashExiting).toBe(false);
  });
});
