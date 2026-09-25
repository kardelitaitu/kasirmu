import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

/**
 * `useKdsTabIndicator` drives the Open/Completed pill with the Web Animations
 * API: `tabIndicatorRef.current.animate([...], { duration: 340 })`.
 *
 * WAAPI animations are NOT CSS animations. The blanket reduced-motion kill in
 * `reset.css` (`animation-duration: 0.01ms !important` on `*`) and the
 * `animation: none` in `tokens.css` both address CSS animations only —
 * `Element.animate()` runs unconditionally at whatever duration it is handed.
 * So a user who asked the OS for reduced motion got a full-speed 340ms
 * squeeze-and-overshoot on every KDS tab change: WCAG 2.1 §2.3.3.
 *
 * This is the same defect class already repaired once for the topology
 * editor's simulation pulse (JOURNAL 2026-08-12), which was gated with a
 * module-scope `prefersReducedMotion()` helper — except here the state churn
 * is a single imperative call, so the gate belongs on the call itself.
 *
 * `utils/animation.ts` reads `window.matchMedia` at MODULE top level, so the
 * stub must be installed before that module is first evaluated; hence the
 * dynamic `await import(...)` rather than a static import (same shape as
 * `animation.test.ts`).
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

const { useKdsTabIndicator } = await import('@/features/kds/useKdsTabIndicator');

/** jsdom ships no WAAPI; the hook feature-detects it, so install a stub. */
let animateSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  animateSpy = vi.fn();
  (Element.prototype as unknown as { animate: unknown }).animate = animateSpy;
});

afterEach(() => {
  delete (Element.prototype as unknown as { animate?: unknown }).animate;
  reducedMotion = false;
});

function Host({ activeTab }: { activeTab: 'open' | 'completed' }) {
  const { tabIndicator, tabsTrackRef, tabOpenRef, tabCompletedRef, tabIndicatorRef } =
    useKdsTabIndicator({ activeTab, orderCount: 3 });
  return (
    <div ref={tabsTrackRef}>
      <button type="button" ref={tabOpenRef}>Open</button>
      <button type="button" ref={tabCompletedRef}>Completed</button>
      <span
        ref={tabIndicatorRef}
        style={{ left: tabIndicator.left, width: tabIndicator.width }}
      />
    </div>
  );
}

describe('useKdsTabIndicator WAAPI under prefers-reduced-motion', () => {
  it('CONTROL: plays the squeeze/overshoot when motion is allowed', () => {
    reducedMotion = false;
    const { rerender } = render(<Host activeTab="open" />);
    animateSpy.mockClear();

    act(() => {
      rerender(<Host activeTab="completed" />);
    });

    expect(animateSpy).toHaveBeenCalledTimes(1);
    expect(animateSpy.mock.calls[0]?.[1]).toMatchObject({ duration: 340 });
  });

  it('does NOT run the WAAPI animation when the user asked for reduced motion', () => {
    reducedMotion = true;
    const { rerender } = render(<Host activeTab="open" />);
    animateSpy.mockClear();

    act(() => {
      rerender(<Host activeTab="completed" />);
    });

    // The pill still MOVES (it is driven by state, not by the animation) —
    // only the decorative 340ms flourish must be suppressed.
    expect(animateSpy).not.toHaveBeenCalled();
  });
});
