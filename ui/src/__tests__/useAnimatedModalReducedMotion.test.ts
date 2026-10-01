import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * `useAnimatedModal` under `prefers-reduced-motion: reduce`.
 *
 * Every other exit path in the app routes its unmount delay through
 * `animDuration()` (`utils/animation.ts`), which collapses to 0 when the OS
 * asks for reduced motion — so the surface snaps away instead of lingering
 * behind an animation the media query has already suppressed. This hook was
 * the one that did not: it passed the raw `duration` straight to
 * `setTimeout`, which left a 200ms window where the modal is still mounted,
 * its `--exiting` class applied, and the caller's focus trap switched off
 * (`mOpen && !eOpen` in ShiftManagementScreen) with nothing on screen to
 * justify it.
 *
 * `utils/animation.ts` reads `window.matchMedia` at MODULE top level, so the
 * stub has to be installed before that module is first evaluated. Vitest
 * isolates modules per test file, hence the dynamic `await import(...)` below
 * rather than a static import — the same shape `animation.test.ts` uses.
 */

let reducedMotion = false;

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: vi.fn().mockImplementation(() => ({
    get matches() {
      return reducedMotion;
    },
    media: '(prefers-reduced-motion: reduce)',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
});

const { useAnimatedModal } = await import('@/hooks/useAnimatedModal');

describe('useAnimatedModal under prefers-reduced-motion: reduce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reducedMotion = true;
  });

  afterEach(() => {
    reducedMotion = false;
    vi.useRealTimers();
  });

  it('unmounts on the same tick as the close instead of waiting out the duration', () => {
    const { result, rerender } = renderHook(
      ({ show }) => useAnimatedModal(show, 200),
      { initialProps: { show: true } },
    );

    expect(result.current.mounted).toBe(true);

    rerender({ show: false });

    // No perceptible delay: a single macrotask tick clears it. The old
    // behaviour held `mounted === true` here for the full 200ms.
    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(result.current.mounted).toBe(false);
    expect(result.current.exiting).toBe(false);
  });

  it('does not leave the focus trap off for the duration', () => {
    const { result, rerender } = renderHook(
      ({ show }) => useAnimatedModal(show),
      { initialProps: { show: true } },
    );

    rerender({ show: false });
    act(() => {
      vi.advanceTimersByTime(1);
    });

    // `exiting` is what callers mask their focus trap with; under reduce it
    // must never linger once the surface is gone.
    expect(result.current.exiting).toBe(false);
  });
});
