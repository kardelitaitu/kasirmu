import { useEffect, useRef } from 'react';
import { useSound } from '@/components/useSound';
import type { KdsOrder } from '@/api/kds';

/** Minimum interval between new-ticket chimes (ms). */
const DEBOUNCE_MS = 5000;

/**
 * `useNewTicketSound` — monitors the orders array on every render and
 * plays a short chime when new tickets arrive.
 *
 * Tracks known order IDs in a `Set<string>` ref. On each update,
 * detects IDs not in the known set and schedules a chime. Chimes are
 * debounced to max 1 per `DEBOUNCE_MS` (5 seconds) to avoid a
 * notification storm when the kitchen receives a batch of orders.
 *
 * Trailing catch-up: the leading-only debounce previously SWALLOWED a
 * whole burst — orders arriving inside the window updated the known set
 * but never re-chimed, so a rush of 5 tickets played exactly one chime.
 * Now one trailing chime plays when the window closes if anything arrived
 * during it, so a burst is announced as "one chime now + one catch-up",
 * still bounded to 2 per burst.
 *
 * The sound can be toggled on/off via the `enabled` parameter.
 *
 * @param orders  Current list of KDS orders.
 * @param enabled Whether sounds are currently enabled (default true).
 */
export function useNewTicketSound(orders: KdsOrder[], enabled = true): void {
  const { playBeep } = useSound();
  const knownIdsRef = useRef<Set<string>>(new Set());
  const lastPlayedRef = useRef(0);
  const enabledRef = useRef(enabled);
  const trailingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the enabled ref in sync without triggering re-renders.
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => () => {
    if (trailingTimerRef.current !== null) clearTimeout(trailingTimerRef.current);
  }, []);

  useEffect(() => {
    if (!enabledRef.current || orders.length === 0) return;

    const known = knownIdsRef.current;
    let foundNew = false;

    for (const order of orders) {
      if (!known.has(order.id)) {
        foundNew = true;
        known.add(order.id);
      }
    }

    if (!foundNew) return;

    // Debounce: only play if enough time has elapsed since the last chime.
    const now = Date.now();
    const elapsed = now - lastPlayedRef.current;
    if (elapsed >= DEBOUNCE_MS) {
      // The lead chime closes any pending catch-up.
      if (trailingTimerRef.current !== null) {
        clearTimeout(trailingTimerRef.current);
        trailingTimerRef.current = null;
      }
      lastPlayedRef.current = now;
      playBeep();
    } else if (trailingTimerRef.current === null) {
      // Arrivals inside the window schedule exactly one trailing chime.
      trailingTimerRef.current = setTimeout(() => {
        trailingTimerRef.current = null;
        if (!enabledRef.current) return;
        lastPlayedRef.current = Date.now();
        playBeep();
      }, DEBOUNCE_MS - elapsed);
    }
  }, [orders, playBeep]);
}
