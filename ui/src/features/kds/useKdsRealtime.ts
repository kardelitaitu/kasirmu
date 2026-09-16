/**
 * useKdsRealtime — the KDS board's realtime subscription block: the
 * `fetchOrdersRef` indirection, the `kds:orders-changed` subscribe effect with
 * its cancel/unlisten guard, the `visibilitychange` fallback re-fetch, the
 * mount/dep re-fetch effect, and the unmount cleanup that tears all three down.
 *
 * Extracted verbatim from KdsScreen.tsx:200-249 (the ref at :205-206, the
 * subscribe effect at :213-244, the dep fetch at :247-249). The effect bodies
 * and the `.then`/`.catch` chain are the sed output: no event name, no guard,
 * no `addEventListener`/`removeEventListener` pair and no `clearTimeout` was
 * retyped, and the declaration order (subscribe effect first, dep fetch second)
 * is unchanged, so they still run at the same point in the screen's effect
 * sequence.
 *
 * WHY THE REF INDIRECTION IS THE POINT OF THIS FILE — read this before
 * "simplifying" it. `fetchOrders` changes identity whenever the session, the
 * store scope, the zone preference or the offline wrapper changes. Were the
 * subscribe effect to depend on it directly, every such change would tear down
 * and rebuild the Tauri event listener; each rebuild costs two extra WebView2
 * IPC round trips (`plugin:event|listen` + `unlisten`), and before the fix the
 * listener's own re-fetch produced a new `wrapFetch`, which re-subscribed,
 * which re-fetched — an unbounded loop that exhausted the WebView2 PostMessage
 * queue on Windows (0x80070718, "Not enough quota is available to process this
 * command") and made opening KDS lag. The listener reads the latest fetch
 * through `fetchOrdersRef` instead, and the effect keeps an empty dependency
 * list. Dropping the ref and putting `fetchOrders` in the deps re-imposes
 * exactly that cost.
 *
 * CONTRACT WIDTH IS TWO, DELIBERATELY. `fetchOrders` is the only piece of
 * screen logic this hook calls; `arrivalTimerRef` crosses because the highlight
 * timer is STARTED by `fetchOrders` — which stayed in the screen, on hold — but
 * must still be cleared on unmount, and clearing it here keeps that clear in
 * exactly one place: the same cleanup that unlistens. Nothing else crosses the
 * seam — no `sessionToken`, no `prefs`, no `wrapFetch`, no setters — and the
 * hook returns nothing. Both global listeners (the Tauri subscription and
 * `visibilitychange`) are added and removed by the same effect, so each can
 * only ever be registered once per mount and is always torn down on unmount.
 *
 * TWO ADDITIONS OVER THE ORIGINAL, both lint-only, neither behavioural: the
 * timer ref is read through a local `arrivalTimer` alias inside the effect (the
 * v7 exhaustive-deps rule warns on a PROP ref's `.current` in a cleanup; the
 * alias is the same object, so the clear still reads the handle `fetchOrders`
 * last wrote), and the empty dep array carries one scoped eslint-disable. The
 * clear is still in exactly ONE place — this cleanup — and `fetchOrders` still
 * owns the start, so there is neither a double-clear nor a lost timer.
 */

import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { listen } from '@/api/tauri';

export interface UseKdsRealtimeOptions {
  /**
   * The board's fetch callback. Held in a ref and read through it at event
   * time, never taken as an effect dependency — see the WebView2 note above.
   */
  fetchOrders: () => Promise<void>;
  /**
   * The 3s arrival-highlight timer, owned by the screen because `fetchOrders`
   * starts it. This hook only clears it, once, in the unmount cleanup.
   */
  arrivalTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
}

export function useKdsRealtime({
  fetchOrders,
  arrivalTimerRef,
}: UseKdsRealtimeOptions): void {
  // PERF-KDS-01: the realtime subscription must not be torn down and rebuilt
  // whenever `fetchOrders` changes identity — each rebuild costs two extra
  // WebView2 IPC round trips (`plugin:event|listen` + `unlisten`), and the
  // old code re-subscribed on every fetch. The listener reads the latest
  // fetch through this ref instead.
  const fetchOrdersRef = useRef(fetchOrders);
  fetchOrdersRef.current = fetchOrders;

  // 1a: Real-time push via Tauri events — replaces adaptive polling.
  // Listens for kds:orders-changed emitted by the Rust backend after
  // order creation or status updates. Falls back to re-fetch on tab
  // visibility change to catch any events missed while hidden.
  // Subscribes exactly once per mount.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    // Local alias for the screen's arrival-highlight timer ref, so the cleanup
    // below reads its CURRENT handle rather than a captured value.
    const arrivalTimer = arrivalTimerRef;

    // Subscribe to real-time KDS order changes (push, not poll).
    listen<null>('kds:orders-changed', () => {
      void fetchOrdersRef.current();
    }).then((fn) => {
      // The component may already have unmounted while `listen` was in
      // flight; without this guard the subscription would leak.
      if (cancelled) fn();
      else unlisten = fn;
    }).catch(() => {
      /* event plugin unavailable (e.g. plain browser) — push is optional */
    });

    // Visibility change fallback — re-fetch when tab becomes visible
    // to catch any events missed while the tab was hidden.
    const onVisibilityChange = () => {
      if (!document.hidden) {
        void fetchOrdersRef.current();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (arrivalTimer.current !== null) clearTimeout(arrivalTimer.current);
    };
    // Both refs this effect reads are useRef results — stable for the life of
    // the mount — so an empty list keeps the once-per-mount subscription the
    // whole ref indirection exists to provide. A non-empty list here would put
    // the WebView2 re-subscribe cost back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch whenever the query inputs change (mount, session, store, zone).
  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);
}
