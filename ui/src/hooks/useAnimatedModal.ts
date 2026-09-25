import { useState, useEffect, useRef } from 'react';
import { animDuration } from '@/utils/animation';

/**
 * Manages entering/exiting animation phases for modal overlays.
 *
 * When `show` becomes `true`, the modal is immediately mounted.
 * When `show` becomes `false`, `exiting` is set to `true` and the
 * modal stays mounted for `duration` ms before being unmounted.
 * This allows CSS exit animations (fade-out, slide-down, etc.) to
 * play before the element is removed from the DOM.
 *
 * The unmount delay goes through `animDuration()`, so it collapses to 0 under
 * `prefers-reduced-motion` — every other exit path in the app does the same
 * (`useExitAnimation`, `useSplashExit`, `FastPINOverlay`, the toast queue).
 * Without it a reduced-motion user sat behind a 200ms window in which the
 * surface was still mounted, still wearing its `--exiting` class, and still
 * masking its caller's focus trap — with no animation to justify it.
 *
 * @param show     Whether the modal should be visible (user-controlled).
 * @param duration Duration of the exit animation in ms (default 200).
 * @returns `{ mounted, exiting }` — render the modal if `mounted` is
 *          true, and add an exit CSS class when `exiting` is true.
 */
export function useAnimatedModal(show: boolean, duration = 200) {
  const [mounted, setMounted] = useState(false);
  const [exiting, setExiting] = useState(false);
  const prevShow = useRef(show);

  useEffect(() => {
    if (show && !prevShow.current) {
      // Opening — mount immediately, no exit phase. This branch is also the
      // landing site for a REOPEN DURING the exit window, so clearing
      // `exiting` here is what takes the `--exiting` class back off.
      setMounted(true);
      setExiting(false);
    } else if (!show && prevShow.current && mounted) {
      // Closing — start exit animation, delay unmount.
      //
      // `prevShow.current = show` MUST run on this path too. It used to be
      // unreachable here because the branch returned early to hand back the
      // timer cleanup, so the ref kept reading `true` through the whole exit:
      // a reopen inside the window then matched neither branch, nothing
      // cleared `exiting`, and the surface was pinned at opacity 0 forever
      // (its `--exiting` keyframes are `animation: … forwards`) with the
      // focus trap disabled. Recording the edge here is what lets the
      // opening branch above fire on the way back in.
      prevShow.current = show;
      setExiting(true);
      const timer = setTimeout(() => {
        setMounted(false);
        setExiting(false);
      }, animDuration(duration));
      return () => clearTimeout(timer);
    }
    prevShow.current = show;
  }, [show, duration, mounted]);

  // Handle initial mount
  useEffect(() => {
    if (show && !mounted) {
      setMounted(true);
    }
  }, [show]); // eslint-disable-line react-hooks/exhaustive-deps

  return { mounted, exiting };
}
