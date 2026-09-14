/**
 * useKdsTabIndicator — the Open/Completed tab pill: the measure-and-animate
 * effect that moves it to the active tab button, the `resize` re-measure effect
 * that keeps it aligned, and the refs plus the `isTabMountedRef` latch they read.
 *
 * Extracted verbatim from KdsScreen.tsx:447-466 (measure + squeeze/overshoot
 * animation) and :468-479 (the window `resize` listener). Both effect bodies are
 * the sed output: no keyframe, no `offset`, no duration, no easing, no
 * `typeof … .animate === 'function'` guard and no add/removeEventListener pair
 * was retyped, and the declaration order (measure effect first, resize effect
 * second) is unchanged, so they still run at the same point in the screen's
 * effect sequence. The resize listener is added and removed by the same effect,
 * so it can only ever be registered once per mount and is always torn down by
 * that effect's cleanup on unmount.
 *
 * MEASUREMENT TIMING PRESERVED: the originals used no ResizeObserver and no
 * requestAnimationFrame, and none was added here — `offsetLeft`/`offsetWidth`
 * are read inside `useEffect`, i.e. after the commit, when layout has already
 * been flushed, and the re-measure happens synchronously in the `resize`
 * handler. The animation trigger condition is likewise untouched: it is gated on
 * `isTabMountedRef.current`, so the pill is placed without animating on the
 * first pass and only slides on subsequent tab changes.
 *
 * WHAT MOVES AND WHAT DOES NOT: `tabIndicator` is the one state in the screen's
 * page-level block that legitimately MOVES — written by nothing but these two
 * effects and read in exactly one render place (`style={{ left, width }}` on the
 * indicator span) — and it comes back out, the same way `kdsRef` came back out
 * of useKdsShortcuts. The four refs move here and are also handed back out,
 * because the tab markup that binds them stayed in the screen. `activeTab`
 * crosses as a VALUE only (the tab buttons and the swipe pager both read and
 * write it), and `orders.length` crosses as `orderCount` — the value that
 * second effect already depended on, passed as a number so the hook does not
 * have to own the queue.
 *
 * NO MARKUP, NO STRINGS, NO CLASS NAMES: it is a .ts logic file, so the
 * extraction and tooltip guards have nothing to re-register.
 */
import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

export interface UseKdsTabIndicatorOptions {
  /** Which tab is active — the value only; the state itself stays in the screen. */
  activeTab: 'open' | 'completed';
  /** `orders.length`: a new queue can change the track width, so re-measure on it. */
  orderCount: number;
}

export interface UseKdsTabIndicatorResult {
  /** The measured pill position, applied as an inline style by the screen. */
  tabIndicator: { left: number; width: number };
  /** The `.kds-tabs` track the pill is absolutely positioned inside. */
  tabsTrackRef: RefObject<HTMLDivElement>;
  tabOpenRef: RefObject<HTMLButtonElement>;
  tabCompletedRef: RefObject<HTMLButtonElement>;
  /** The animated `.kds-tab-indicator` span. */
  tabIndicatorRef: RefObject<HTMLSpanElement>;
}

export function useKdsTabIndicator({
  activeTab,
  orderCount,
}: UseKdsTabIndicatorOptions): UseKdsTabIndicatorResult {
  const tabsTrackRef = useRef<HTMLDivElement>(null);
  const tabOpenRef = useRef<HTMLButtonElement>(null);
  const tabCompletedRef = useRef<HTMLButtonElement>(null);
  const tabIndicatorRef = useRef<HTMLSpanElement>(null);
  const isTabMountedRef = useRef(false);
  const [tabIndicator, setTabIndicator] = useState<{ left: number; width: number }>({ left: 3, width: 0 });

  // Open/Completed tab indicator: measure the active tab button inside
  // the track and slide the blue pill to it (prototype .kds-tab-indicator).
  useEffect(() => {
    const tab = activeTab === 'open' ? tabOpenRef.current : tabCompletedRef.current;
    if (!tab) return;
    setTabIndicator({
      left: tab.offsetLeft,
      width: tab.offsetWidth,
    });
    if (isTabMountedRef.current && tabIndicatorRef.current && typeof tabIndicatorRef.current.animate === 'function') {
      /* 2-axis motion: squeeze (narrow+short) mid-flight → overshoot on landing → settle */
      tabIndicatorRef.current.animate([
        { transform: 'scale(1, 1)' },
        { transform: 'scale(0.82, 0.85)', offset: 0.45 },
        { transform: 'scale(1.08, 1.18)', offset: 0.85 },
        { transform: 'scale(1, 1)' },
      ], { duration: 340, easing: 'ease-in-out' });
    }
    isTabMountedRef.current = true;
  }, [activeTab]);

  useEffect(() => {
    const updateIndicator = () => {
      const tab = activeTab === 'open' ? tabOpenRef.current : tabCompletedRef.current;
      if (!tab) return;
      setTabIndicator({
        left: tab.offsetLeft,
        width: tab.offsetWidth,
      });
    };
    window.addEventListener('resize', updateIndicator);
    return () => window.removeEventListener('resize', updateIndicator);
  }, [activeTab, orderCount]);

  return { tabIndicator, tabsTrackRef, tabOpenRef, tabCompletedRef, tabIndicatorRef };
}
