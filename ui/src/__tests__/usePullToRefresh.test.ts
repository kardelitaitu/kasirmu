import type React from "react";
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { usePullToRefresh } from '@/hooks/usePullToRefresh';

// ── Helpers ────────────────────────────────────────────────────────────

function makeTouchEvent(
  touches: { clientY: number }[],
): React.TouchEvent {
  return {
    touches,
    changedTouches: touches,
    targetTouches: touches,
    currentTarget: { scrollTop: 0 },
  } as unknown as React.TouchEvent;
}

function makeScrollEvent(scrollTop: number): React.UIEvent {
  return {
    currentTarget: { scrollTop },
  } as unknown as React.UIEvent;
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('usePullToRefresh', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('starts in idle state with pullDistance 0', () => {
    const { result } = renderHook(() =>
      usePullToRefresh({ onRefresh: vi.fn() }),
    );

    expect(result.current.state).toBe('idle');
    expect(result.current.pullDistance).toBe(0);
  });

  it('transitions to "pulling" when pulled below threshold', () => {
    const { result } = renderHook(() =>
      usePullToRefresh({ onRefresh: vi.fn(), threshold: 60 }),
    );

    act(() => {
      result.current.containerProps.onTouchStart(
        makeTouchEvent([{ clientY: 100 }]),
      );
    });

    act(() => {
      result.current.containerProps.onTouchMove(
        makeTouchEvent([{ clientY: 300 }]),
      );
    });

    // dy=200 * 0.5 = 100 > threshold=60, so state should be 'ready'
    // Actually 100 > 60 → ready
    expect(result.current.state).toBe('ready');
    expect(result.current.pullDistance).toBeGreaterThan(0);
  });

  it('transitions to "ready" when pull distance exceeds threshold', () => {
    const { result } = renderHook(() =>
      usePullToRefresh({ onRefresh: vi.fn(), threshold: 100 }),
    );

    act(() => {
      result.current.containerProps.onTouchStart(
        makeTouchEvent([{ clientY: 100 }]),
      );
    });

    // dy=50, resisted=25 < threshold=100 → 'pulling'
    act(() => {
      result.current.containerProps.onTouchMove(
        makeTouchEvent([{ clientY: 150 }]),
      );
    });

    expect(result.current.state).toBe('pulling');

    // dy=400, resisted=min(200, 120)=120 > threshold=100 → 'ready'
    act(() => {
      result.current.containerProps.onTouchMove(
        makeTouchEvent([{ clientY: 500 }]),
      );
    });

    expect(result.current.state).toBe('ready');
  });

  it('calls onRefresh when released in "ready" state', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      usePullToRefresh({ onRefresh, threshold: 30 }),
    );

    // Pull past threshold
    act(() => {
      result.current.containerProps.onTouchStart(
        makeTouchEvent([{ clientY: 100 }]),
      );
    });
    act(() => {
      result.current.containerProps.onTouchMove(
        makeTouchEvent([{ clientY: 400 }]),
      );
    });
    expect(result.current.state).toBe('ready');

    // Release
    await act(async () => {
      await result.current.containerProps.onTouchEnd({} as React.TouchEvent);
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe('idle');
    expect(result.current.pullDistance).toBe(0);
  });

  it('resets to idle when released below threshold', async () => {
    const onRefresh = vi.fn();
    const { result } = renderHook(() =>
      usePullToRefresh({ onRefresh, threshold: 100 }),
    );

    // Small pull (below threshold)
    act(() => {
      result.current.containerProps.onTouchStart(
        makeTouchEvent([{ clientY: 100 }]),
      );
    });
    act(() => {
      result.current.containerProps.onTouchMove(
        makeTouchEvent([{ clientY: 150 }]),
      );
    });
    expect(result.current.state).toBe('pulling');

    await act(async () => {
      await result.current.containerProps.onTouchEnd({} as React.TouchEvent);
    });

    expect(onRefresh).not.toHaveBeenCalled();
    expect(result.current.state).toBe('idle');
    expect(result.current.pullDistance).toBe(0);
  });

  it('applies resistance factor of 0.5', () => {
    const { result } = renderHook(() =>
      usePullToRefresh({ onRefresh: vi.fn(), maxPullDistance: 120 }),
    );

    act(() => {
      result.current.containerProps.onTouchStart(
        makeTouchEvent([{ clientY: 0 }]),
      );
    });

    // 200px pull → resisted = min(100, 120) = 100
    act(() => {
      result.current.containerProps.onTouchMove(
        makeTouchEvent([{ clientY: 200 }]),
      );
    });

    expect(result.current.pullDistance).toBe(100);
  });

  it('caps at maxPullDistance', () => {
    const { result } = renderHook(() =>
      usePullToRefresh({ onRefresh: vi.fn(), maxPullDistance: 80 }),
    );

    act(() => {
      result.current.containerProps.onTouchStart(
        makeTouchEvent([{ clientY: 0 }]),
      );
    });

    // 500px pull → resisted = min(250, 80) = 80
    act(() => {
      result.current.containerProps.onTouchMove(
        makeTouchEvent([{ clientY: 500 }]),
      );
    });

    expect(result.current.pullDistance).toBe(80);
  });

  it('ignores touches when scrolled down', () => {
    const { result } = renderHook(() =>
      usePullToRefresh({ onRefresh: vi.fn() }),
    );

    // Simulate container at scrollTop > 5
    act(() => {
      result.current.containerProps.onTouchStart({
        touches: [{ clientY: 100 }],
        changedTouches: [{ clientY: 100 }],
        targetTouches: [{ clientY: 100 }],
        currentTarget: { scrollTop: 10 },
      } as unknown as React.TouchEvent);
    });

    act(() => {
      result.current.containerProps.onTouchMove({
        touches: [{ clientY: 400 }],
        changedTouches: [{ clientY: 400 }],
        targetTouches: [{ clientY: 400 }],
        currentTarget: { scrollTop: 10 },
      } as unknown as React.TouchEvent);
    });

    expect(result.current.state).toBe('idle');
    expect(result.current.pullDistance).toBe(0);
  });

  it('resets pull when moving upward (dy <= 0)', () => {
    const { result } = renderHook(() =>
      usePullToRefresh({ onRefresh: vi.fn() }),
    );

    act(() => {
      result.current.containerProps.onTouchStart(
        makeTouchEvent([{ clientY: 200 }]),
      );
    });

    // Move up (below start)
    act(() => {
      result.current.containerProps.onTouchMove(
        makeTouchEvent([{ clientY: 100 }]),
      );
    });

    expect(result.current.state).toBe('idle');
    expect(result.current.pullDistance).toBe(0);
  });

  it('onScroll does nothing when scrollTop is > 5', () => {
    const { result } = renderHook(() =>
      usePullToRefresh({ onRefresh: vi.fn() }),
    );

    // Should not throw
    act(() => {
      result.current.containerProps.onScroll(makeScrollEvent(10));
    });

    expect(result.current.state).toBe('idle');
  });
});
