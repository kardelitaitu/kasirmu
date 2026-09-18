/**
 * Closes a single surface (modal, panel, pill) with a brief CSS exit
 * animation before calling the parent's close setter. Mirrors the
 * entry animation that brought the surface on-screen so the user
 * sees a coordinated fade-out instead of a snap to unmount.
 *
 * Per `.agents/skills/exit-animation-pattern/SKILL.md`:
 *   - Parent passes `open` (boolean state) and `onClose` (setter
 *     that flips it to false).
 *   - `requestClose()` is the dismiss handler: it sets `exiting=true`
 *     so the CSS mirror keyframe plays via the `--exiting` modifier
 *     class; after the fade, the hook calls `onClose` and the
 *     parent state flips, unmounting the gated JSX.
 *   - The host component renders the surface inside a gate of
 *     `shouldRender = open || exiting` so it stays in the DOM during
 *     the fade and the CSS keyframe actually runs.
 *   - `animDuration(ms)` returns 0 under `prefers-reduced-motion`
 *     so the surface snaps away as expected for users who suppress
 *     motion — no separate handling needed.
 *
 * Race semantics:
 *   - If `open` flips to false externally (parent bypasses the hook
 *     and unmounts directly), the surface simply unmounts as
 *     before — no fade. This is the intended behavior for
 *     "navigate to next state" flows (e.g. close-shift
 *     confirmation → success summary) where the new surface
 *     replaces the old one with its own entry animation, and
 *     adding an exit fade to the old one would visually double-up
 *     with the new entry.
 *   - If `open` flips back to true while `exiting` is still true
 *     (reopen during fade), the hook cancels the exit and resets
 *     `exiting` so the surface stays mounted.
 *   - Unmount during an in-flight exit: the timer effect's own
 *     cleanup clears the pending timer so we never setState on an
 *     unmounted component.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { animDuration } from '@/utils/animation';

export interface UseExitAnimationResult {
  /** True while the surface should be in the DOM (open OR fading). */
  shouldRender: boolean;
  /** True while the exit animation is playing. Apply as `--exiting` class. */
  exiting: boolean;
  /** Call this from dismiss handlers (cancel button, Escape, close X). */
  requestClose: () => void;
}

/**
 * Gate a dismiss through its CSS exit animation.
 *
 * `durationMs` MUST equal the `var(--duration-NNN)` on the surface's own
 * `--exiting` rule — this timer is what removes the element from the DOM, so a
 * timer shorter than the animation snaps the fade and a timer longer than it
 * leaves an invisible element (the exit rule's `animation-fill-mode: both` holds
 * the TO frame) pinned in the tree with `pointer-events: none` still applied.
 *
 * The default is 200 because that is the convention's canonical duration
 * (`exit-animation-pattern` rule 9 / its token table) and because the surfaces
 * that keep `var(--duration-200)` — UpdateBanner, SalesHistoryScreen,
 * StockTransfersScreen, RetailPosScreen, ProductManagementScreen,
 * PromotionManagementScreen — call this hook WITHOUT a duration. Retiming the
 * default silently retimes all of them while leaving their CSS at 200 ms; pass
 * an explicit duration instead, as Modal / RefundModal /
 * WorkspaceSettingsModal / QrisQrDisplay do.
 */
export function useExitAnimation(
  open: boolean,
  onClose: () => void,
  durationMs: number = 200,
): UseExitAnimationResult {
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Always-call-latest onClose without re-firing the timer effect on
  // every parent re-render (e.g. when the parent passes a fresh
  // inline arrow each render).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // If `open` flips back to true while we're exiting (reopen during
  // fade), cancel the exit so the surface stays mounted. The
  // surface simply re-renders without the `--exiting` class — no
  // re-entry animation needed because the entry animation already
  // played when `open` first became true.
  //
  // We intentionally only depend on `open` here. Depending on
  // `exiting` as well would cause this guard to fire on the
  // initial false→true transition of `exiting` (i.e. immediately
  // after `requestClose` schedules a fade) — cancelling the fade
  // the moment it starts. The `eslint-disable` is justified
  // because the intent is "only react to `open` changes".
  useEffect(() => {
    if (open && exiting) {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setExiting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Schedule the parent's onClose after the exit fade finishes.
  // The effect's own cleanup handles host unmount: when the host
  // unmounts, React fires all effect cleanups, which clears the
  // pending timer so we never setState on an unmounted component.
  useEffect(() => {
    if (!exiting) return;
    const timer = setTimeout(() => {
      setExiting(false);
      onCloseRef.current();
      timerRef.current = null;
    }, animDuration(durationMs));
    timerRef.current = timer;
    return () => clearTimeout(timer);
  }, [exiting, durationMs]);

  const requestClose = useCallback(() => {
    if (exiting) return; // already closing
    setExiting(true);
  }, [exiting]);

  return {
    shouldRender: open || exiting,
    exiting,
    requestClose,
  };
}
