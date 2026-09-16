/**
 * useKdsRealtime - listener registration and teardown at the hook level.
 * Extracted from KdsScreen.tsx by 9fe87671b, where one subscription per mount
 * is the design (a rebuild costs two WebView2 IPC round trips - the 0x80070718
 * quota loop, PERF-KDS-01). KdsScreen.test.tsx:1278 counts subscriptions
 * through the whole screen and cannot see the visibilitychange pair, the
 * unlisten, or the arrival timer.
 *
 * TWO INVARIANTS, BECAUSE EITHER ONE ALONE IS A CONTROL THAT CANNOT FAIL:
 * mounted, adds === 1 + removes (NOT adds === N - a rerender never re-adds)
 * catches stacking, and it STAYS GREEN when the cleanup forgets to unlisten,
 * because adds=1/removes=0 satisfies it; only post-unmount removes === adds
 * fails that mutation. So both are asserted.
 *
 * First to fail per seeded mutation (measured, 7 cases): registration/2 +
 * registration/3 deps widened to fetchOrders · teardown/1 + teardown/2 +
 * late/1 unlisten deleted · late/1 ALONE (1 failed / 5 passed) fetchOrders
 * captured in a closure instead of read through the ref — that one is a
 * genuine sole catcher · late/2 ALONE (1 failed / 6 passed) the `.then` guard
 * at useKdsRealtime.ts:95-96 replaced by `unlisten = fn` unconditionally.
 *
 * late/2 IS THE ONLY ASSERTION IN THIS FILE OF THAT LATE-SETTLE BRANCH. Every
 * other case awaits settle() before unmounting, so the fake listen's already
 * resolved promise (see the mock below) always took the else-branch and :95
 * never ran. It asserts nothing about the other two places this guard shape
 * exists (ui/src/hooks/useUnsavedChangesGuard.ts:81,
 * ui/src/features/kds/ExpoScreen.tsx:195) — those stay uncovered here.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { MutableRefObject } from 'react';

// -- Seam: the Tauri event plugin ---------------------------------------
// The hook imports listen from @/api/tauri (the sanctioned re-export), so that
// is the module mocked. Every call records its event name and handler and hands
// back a per-call unlisten, so "unlisten called exactly once" is a statement
// about THE subscription this mount created, not about a shared stub.

interface FakeSub {
  event: string;
  handler: (payload: unknown) => void;
  unlisten: () => void;
  unlistenCount: () => number;
}

const m = vi.hoisted(() => {
  const subs: FakeSub[] = [];

  const listen = (event: string, handler: (payload: unknown) => void): Promise<() => void> => {
    let n = 0;
    const unlisten = (): void => {
      n += 1;
    };
    subs.push({ event, handler, unlisten, unlistenCount: () => n });
    return Promise.resolve(unlisten);
  };

  return { subs, listen };
});

vi.mock('@/api/tauri', () => ({ listen: m.listen }));

const { useKdsRealtime } = await import('@/features/kds/useKdsRealtime');

// -- Seam: document listeners + the arrival-timer clear ------------------
// Registrations are counted by wrapping the real EventTarget methods (the real
// ones still run, so a dispatched event still reaches the hook's handler).
// Counting the LIVE SET, not just the call counts, is what makes "zero live
// listeners" a claim about state: removing a function other than the one added
// leaves the original registered, and a Set sees that while a counter does not.

const VIS = 'visibilitychange';

type AddFn = (
  type: string,
  listener: EventListenerOrEventListenerObject | null,
  options?: boolean | AddEventListenerOptions,
) => void;
type RemoveFn = (
  type: string,
  listener: EventListenerOrEventListenerObject | null,
  options?: boolean | EventListenerOptions,
) => void;

const native = {
  add: document.addEventListener.bind(document) as unknown as AddFn,
  remove: document.removeEventListener.bind(document) as unknown as RemoveFn,
  clear: globalThis.clearTimeout.bind(globalThis) as unknown as (
    id: ReturnType<typeof setTimeout>,
  ) => void,
};

let adds: EventListener[] = [];
let removes: EventListener[] = [];
let live: Set<EventListener> = new Set();
let cleared: Array<ReturnType<typeof setTimeout>> = [];
let order: string[] = [];
/** The handle the current test installed in arrivalTimerRef (else null). */
let arrivalHandle: ReturnType<typeof setTimeout> | null = null;

const original = {
  add: document.addEventListener,
  remove: document.removeEventListener,
  clear: globalThis.clearTimeout,
};

beforeEach(() => {
  adds = [];
  removes = [];
  cleared = [];
  order = [];
  live = new Set();
  arrivalHandle = null;
  m.subs.length = 0;

  // Typed through the plain DOM signatures above so no parameter is an implicit
  // any; the assignment still needs the cast because the real overloads are
  // narrower than what jsdom hands us at runtime.
  const addWrap: AddFn = (type, listener, options) => {
    if (type === VIS && typeof listener === 'function') {
      const fn = listener as EventListener;
      adds.push(fn);
      live.add(fn);
      order.push('add');
    }
    native.add(type, listener, options);
  };
  const removeWrap: RemoveFn = (type, listener, options) => {
    if (type === VIS && typeof listener === 'function') {
      const fn = listener as EventListener;
      removes.push(fn);
      live.delete(fn);
      order.push('remove');
    }
    native.remove(type, listener, options);
  };
  const clearWrap = (id: ReturnType<typeof setTimeout> | undefined): void => {
    if (arrivalHandle !== null && id === arrivalHandle) {
      cleared.push(id);
      order.push('clear');
    }
    native.clear(id as ReturnType<typeof setTimeout>);
  };

  document.addEventListener = addWrap as unknown as typeof document.addEventListener;
  document.removeEventListener = removeWrap as unknown as typeof document.removeEventListener;
  globalThis.clearTimeout = clearWrap as unknown as typeof globalThis.clearTimeout;
});

afterEach(() => {
  document.addEventListener = original.add;
  document.removeEventListener = original.remove;
  globalThis.clearTimeout = original.clear;
  live = new Set();
});

// -- Helpers -------------------------------------------------------------

type Fetch = (() => Promise<void>) & { label: string; hits: number };

/** A fetch whose IDENTITY and call count are both assertable. */
function makeFetch(label: string): Fetch {
  const fn = (() => {
    fn.hits += 1;
    return Promise.resolve();
  }) as Fetch;
  fn.label = label;
  fn.hits = 0;
  return fn;
}

type Timer = MutableRefObject<ReturnType<typeof setTimeout> | null>;

interface Props {
  fetchOrders: Fetch;
  arrivalTimerRef: Timer;
}

interface Counts {
  adds: number;
  removes: number;
}

/** Flush the listen(...).then(...) chain. Real timers, microtasks only. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function tauriSubs(): FakeSub[] {
  return m.subs.filter((s) => s.event === 'kds:orders-changed');
}

function tauriCounts(): Counts {
  const list = tauriSubs();
  return {
    adds: list.length,
    removes: list.reduce((sum, s) => sum + s.unlistenCount(), 0),
  };
}

function visCounts(): Counts {
  return { adds: adds.length, removes: removes.length };
}

function mountHook(first: Fetch, timer: Timer) {
  // renderHook<Result, Props>: the hook returns void, Props is the second arg.
  return renderHook<void, Props>(
    ({ fetchOrders, arrivalTimerRef }) => useKdsRealtime({ fetchOrders, arrivalTimerRef }),
    { initialProps: { fetchOrders: first, arrivalTimerRef: timer } },
  );
}

// -- 1 + 2. Registration -------------------------------------------------

describe('useKdsRealtime - registration', () => {
  it('registers one kds:orders-changed listener and one visibilitychange listener on mount', async () => {
    const f1 = makeFetch('f1');
    const { unmount } = mountHook(f1, { current: null });
    await settle();

    expect(tauriCounts()).toEqual({ adds: 1, removes: 0 });
    expect(visCounts()).toEqual({ adds: 1, removes: 0 });
    expect(live.size).toBe(1);
    // The mount fetch happens exactly once, from the OTHER effect.
    expect(f1.hits).toBe(1);

    unmount();
  });

  it('does not stack registrations across 3 rerenders with a FRESH fetchOrders identity each time', async () => {
    const f = [makeFetch('f1'), makeFetch('f2'), makeFetch('f3'), makeFetch('f4')];
    const timer: Timer = { current: null };
    const { rerender, unmount } = mountHook(f[0] as Fetch, timer);
    await settle();

    // Each rerender passes a DIFFERENT function object. If the subscribe effect
    // depended on fetchOrders, every one of these would tear the Tauri listener
    // down and rebuild it - the re-subscribe cost the ref exists to pay away.
    // This is the assertion that makes the suite a design guard, not a smoke
    // test: identity churn must be free at the listener seam.
    for (const next of [f[1] as Fetch, f[2] as Fetch, f[3] as Fetch]) {
      const fresh: Fetch = Object.assign(() => next(), {
        label: 'fresh-' + next.label,
        hits: 0,
      });
      act(() => {
        rerender({ fetchOrders: fresh, arrivalTimerRef: timer });
      });
      await settle();
    }

    expect(tauriCounts()).toEqual({ adds: 1, removes: 0 });
    expect(visCounts()).toEqual({ adds: 1, removes: 0 });
    expect(live.size).toBe(1);
    // The dep-fetch effect still saw the last identity - the single registration
    // is not bought by never re-running anything.
    expect((f[3] as Fetch).hits).toBe(1);

    unmount();
  });

  it('holds the invariant adds === 1 + removes at mount and after each of 3 rerenders', async () => {
    // NOT adds === N: the empty dep list means a rerender never re-adds. What
    // must hold at every instant while mounted is exactly ONE live
    // subscription per seam.
    const f = [makeFetch('f1'), makeFetch('f2'), makeFetch('f3'), makeFetch('f4')];
    const timer: Timer = { current: null };
    const { rerender, unmount } = mountHook(f[0] as Fetch, timer);
    await settle();

    const samples: Array<{ at: string; tauri: Counts; vis: Counts }> = [];
    const take = (at: string): void => {
      samples.push({ at, tauri: tauriCounts(), vis: visCounts() });
    };

    take('after mount');
    for (const next of [f[1] as Fetch, f[2] as Fetch, f[3] as Fetch]) {
      act(() => {
        rerender({ fetchOrders: next, arrivalTimerRef: timer });
      });
      await settle();
      take('after rerender to ' + next.label);
    }

    expect(samples).toHaveLength(4);
    // Sample-by-sample, so a failure names the render that broke it.
    for (const s of samples) {
      expect(s.tauri.adds, s.at + ' tauri').toBe(1 + s.tauri.removes);
      expect(s.vis.adds, s.at + ' visibility').toBe(1 + s.vis.removes);
    }
    // Stated explicitly, because this is what a widened dep array breaks:
    // adds never reaches 4.
    expect(samples.map((s) => s.tauri.adds)).toEqual([1, 1, 1, 1]);
    expect(samples.map((s) => s.vis.adds)).toEqual([1, 1, 1, 1]);

    // Unmount closes the gap: the invariant becomes adds === removes.
    unmount();
    const t = tauriCounts();
    const v = visCounts();
    expect(t.removes).toBe(t.adds);
    expect(v.removes).toBe(v.adds);
  });
});

// -- 3. Teardown ---------------------------------------------------------

describe('useKdsRealtime - teardown', () => {
  it('on unmount: removes === adds, unlisten called once, zero live listeners', async () => {
    const f1 = makeFetch('f1');
    const timer: Timer = { current: null };
    const { rerender, unmount } = mountHook(f1, timer);
    await settle();
    act(() => {
      rerender({ fetchOrders: makeFetch('f2'), arrivalTimerRef: timer });
    });
    await settle();
    expect(live.size).toBe(1);

    const before = tauriCounts();
    unmount();
    const after = tauriCounts();

    expect(after.adds).toBe(after.removes);
    expect(visCounts().adds).toBe(visCounts().removes);
    // Exactly once - not zero (leak) and not twice (double teardown).
    expect(after.removes - before.removes).toBe(1);
    expect(tauriSubs()[0]?.unlistenCount()).toBe(1);
    // The handler removed IS the handler added, so nothing stays registered.
    expect(removes[0]).toBe(adds[0]);
    expect(live.size).toBe(0);
    // And the removed listener really is gone: firing the event fetches nothing.
    expect(after.adds).toBe(1);
  });

  it('clears the arrival timer from the SAME cleanup that unlistens, once, and never while mounted', async () => {
    const f1 = makeFetch('f1');
    const timer: Timer = { current: null };
    const { rerender, unmount } = mountHook(f1, timer);
    await settle();

    // fetchOrders owns the START; the screen installs the handle here. This hook
    // only clears it, and the hook's contract says that clear has ONE home.
    arrivalHandle = setTimeout(() => {}, 5000);
    timer.current = arrivalHandle;

    // A rerender with a fresh identity must NOT clear it: a second cleanup path
    // (an effect that also clears, or a re-run of this one) shows up right here.
    act(() => {
      rerender({ fetchOrders: makeFetch('f2'), arrivalTimerRef: timer });
    });
    await settle();
    expect(cleared).toHaveLength(0);

    order.length = 0;
    unmount();

    expect(cleared).toHaveLength(1);
    expect(cleared[0]).toBe(arrivalHandle);
    // One cleanup ran, and it did all three things: unlisten, remove, clear.
    expect(order).toEqual(['remove', 'clear']);
    expect(tauriCounts().removes).toBe(1);
    expect(visCounts().removes).toBe(1);
    expect(live.size).toBe(0);
  });

});

// -- 4. The indirection resolves late ------------------------------------

describe('useKdsRealtime - late resolution', () => {
  it('dispatching visibilitychange calls the LATEST fetch, not the mount-time one', async () => {
    const mountTime = makeFetch('mount');
    const second = makeFetch('second');
    const latest = makeFetch('latest');
    const timer: Timer = { current: null };
    const { rerender, unmount } = mountHook(mountTime, timer);
    await settle();

    act(() => {
      rerender({ fetchOrders: second, arrivalTimerRef: timer });
    });
    await settle();
    act(() => {
      rerender({ fetchOrders: latest, arrivalTimerRef: timer });
    });
    await settle();

    // Still exactly one registration on each seam. That is what makes the rest
    // of this test a statement about WHICH fetch the long-lived handler calls,
    // rather than about a handler that was re-attached with a newer closure.
    expect(tauriCounts().adds).toBe(1);
    expect(visCounts().adds).toBe(1);

    mountTime.hits = 0;
    second.hits = 0;
    latest.hits = 0;

    // jsdom reports document.hidden === false, i.e. the visible branch.
    act(() => {
      document.dispatchEvent(new Event(VIS));
    });
    expect(latest.hits).toBe(1);
    expect(mountTime.hits).toBe(0);
    expect(second.hits).toBe(0);

    // Same for the push handler: it was BUILT against the mount render but must
    // still read the newest fetch through the ref.
    latest.hits = 0;
    act(() => {
      tauriSubs()[0]?.handler({ event: 'kds:orders-changed', payload: null });
    });
    expect(latest.hits).toBe(1);
    expect(mountTime.hits).toBe(0);
    expect(second.hits).toBe(0);

    unmount();
    expect(tauriCounts()).toEqual({ adds: 1, removes: 1 });
  });

  it('calls the unlisten ITSELF when listen settles after the hook already unmounted', async () => {
    // THE LATE-SETTLE BRANCH: useKdsRealtime.ts:95 `if (cancelled) fn();`.
    // No other case in this file can reach it, because the fake listen above
    // returns Promise.resolve(unlisten) and every case awaits settle() BEFORE
    // unmounting - so the .then always takes the else at :96 and the cleanup
    // at :112 is the thing that unlistens. Here the hook is mounted and
    // unmounted with NO await between them: microtasks cannot run in between,
    // so cleanup executes while `unlisten` is still undefined (:112 is a
    // no-op) and :111 has set cancelled = true. Once settle() lets the .then
    // fire, :95 is the ONLY remaining code that can call the resolved fn. If
    // the guard is not there, the subscription leaks and removes stays 0.
    const f1 = makeFetch('f1');
    const { unmount } = mountHook(f1, { current: null });

    // Synchronous: no await, therefore no microtask boundary, therefore the
    // .then has not run yet.
    unmount();

    // The visibilitychange half of the same cleanup DID run, so this is a real
    // unmount - but the Tauri side cannot have been released yet: nothing had
    // handed the hook an unlisten to call.
    expect(visCounts()).toEqual({ adds: 1, removes: 1 });
    expect(live.size).toBe(0);
    expect(tauriCounts()).toEqual({ adds: 1, removes: 0 });
    expect(tauriSubs()[0]?.unlistenCount()).toBe(0);

    // Now let the in-flight promise resolve, after the mount is gone.
    await settle();

    // The guard ran: exactly one release, from the late .then, and the counted
    // add/remove seam is balanced with nothing live left behind.
    expect(tauriSubs()[0]?.unlistenCount()).toBe(1);
    expect(tauriCounts()).toEqual({ adds: 1, removes: 1 });
    expect(visCounts()).toEqual({ adds: 1, removes: 1 });
    expect(live.size).toBe(0);
    // Nothing re-subscribed on the way out: the late .then released the ONE
    // subscription this mount created, so the seam is closed, not rebuilt.
    expect(tauriSubs()).toHaveLength(1);
  });
});
