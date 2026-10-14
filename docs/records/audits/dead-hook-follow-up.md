# Round 107's follow-up: one real gap, and two guards that were not guards (round 108)

## What was checked

`dead-hook-tests-mask-live-gap.md` (round 107) found that `posScreenHooks.ts`'s three hooks
are imported only by tests, and that the DEAD `useCartWidth`'s 9 cases were masking an
unpinned LIVE `useCartResize`. It closed with a scoped next step: the other two exports.

This round kill-tested each live equivalent.

| Dead hook | Live equivalent | Killed the live behaviour? |
|---|---|---|
| `useCartWidth` | `useCartResize` | **SURVIVED (round 107)** — now fixed |
| `useShiftTimer` (the tick) | `usePosShifts` | **KILLED** — `PosScreen.test.tsx:770`, `PosScreen.integration:503` |
| `useShiftTimer` (the cleanup) | `usePosShifts` | **SURVIVED** — see below |
| `useLockedCartPersistence` | `PosScreen`'s inline lock path | **KILLED** — `PosScreenCoreFlow` :: *locks cart on logout and restores on next mount* |

So **one** of the three was masking. The other two live behaviours are properly covered.

## Ported, so the coverage survives the deletion

`useCartResizePersistence.test.tsx` gained five cases from the dead file: the minimum
clamp, the viewport-half clamp, the settled-bounds check, the resize cursor/body-class
lifecycle, and its cleanup. Kill-tested: removing `clampCartWidth` from the live hook's
initial state fails `clamps a saved value up to the minimum` and `...down to the viewport
half`. That file now has 8 cases.

The ported file keeps the dead file's own warning: assert against the CONSTANTS. Its case
read `toBe(320)` and kept passing after the floor moved to 400, because the hook carried a
private copy of the bounds — "the test and the code agreed with each other and neither
agreed with the shipped value".

## A gap I found, and could NOT close

Removing `window.clearInterval(id)` from `usePosShifts`' elapsed-shift timer leaves
**128 tests green** across the four suites that render it. The tick is pinned; the STOP is
not. An interval that outlives its component is a leak on a till left running through a
service.

**Two guards were written and both were removed, because neither discriminated:**

1. `expect(vi.getTimerCount()).toBeLessThan(before)` after `unmount()`. Instrumented: the
   count goes 10 → 6 on unmount EVEN WITH the cleanup removed, because other timers
   (keepalive, SLA tickers) unmount too. A whole-page count cannot isolate one interval.
2. `vi.spyOn(window, 'clearInterval')` and asserting the call count rose. Same problem:
   other unmounting effects call it, so the count rises either way.

Both passed with the mutation applied. Shipping either would have put a guard-shaped
assertion over an unpinned behaviour, which is the exact defect round 107 was about.

## What the next attempt needs

An observable that belongs to THIS interval. Options, none attempted far enough to claim:

* drive the timer incrementally so the tick's own effect is the only live one — a focused
  `renderHook` harness for `usePosShifts` rather than a whole `PosScreen`;
* count `setInterval` calls that return the specific handle, by spying on `setInterval` and
  clearing only that id;
* assert on the rendered duration NOT advancing across `advanceTimersByTime` AFTER unmount,
  which needs a reference to the unmounted output.

## Verified

| Gate | Result |
|---|---|
| `useCartResizePersistence` | 8 passed; the 2 clamp cases fail without the live clamp |
| Full suite | 12,671 passed, 0 failed |
| `tsc` | 0 |
| `PosScreen.test.tsx` | byte-identical to HEAD — the two abandoned guards were removed |

## Still not done

`posScreenHooks.ts` remains. Its cart-width coverage is now fully ported; its shift-timer
coverage is largely redundant with two production suites except the cleanup case above; its
draft-persistence coverage (6 cases) was not examined this round.