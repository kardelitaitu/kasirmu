# The interval stop is now observable — by isolating the hook (round 109)

## The gap this closes

`dead-hook-follow-up.md` (round 108) measured that removing `window.clearInterval(id)` from
`usePosShifts`' elapsed-shift timer leaves **128 tests green**. The tick was pinned; the
STOP was not. Two guards were written there and both were deleted for not discriminating:

* `vi.getTimerCount()` after a whole-page unmount — the count falls 10 -> 6 either way,
  because keepalive and SLA tickers unmount too;
* `vi.spyOn(window, 'clearInterval')` — other unmounting effects call it, so it rises
  either way.

## What made the difference

Both observables are sound. **The harness was wrong.** A whole-page count cannot isolate one
interval, but the SAME count is exact when the hook is the only thing mounted.

`__tests__/hooks/usePosShiftsTimerLifecycle.test.tsx` renders `usePosShifts` on its own with
only `@/api/shifts` mocked, and asserts three things:

| Case | Kill-tested by |
|---|---|
| the clock ADVANCES while a shift is open | removing `setInterval` -> fails |
| it STOPS when the shift closes | removing the cleanup -> fails |
| it STOPS on unmount | removing the cleanup -> fails, with `left 1 timer(s) scheduled after unmount` |

The first is the precondition that keeps the other two honest: if the clock never moved,
"it stops" would be vacuous.

## The correction to round 108's reasoning

Round 108 rejected `vi.getTimerCount()` as "too coarse" and was right about the
**measurement it had** — a page with four other timers on it. Concluding that the observable
was unusable was the overreach. With the interval isolated the count reads **exactly 1**, and
the failure message names the leak.

The generalisable form: **when an observable cannot isolate the subject, change the harness,
not the subject — and do not discard the observable until a harness that isolates it has
been tried.**

## A mistake of mine

My first version called `result.current.handleCloseShift(...)`, which does not exist. The
hook exposes `handleConfirmCloseShift` and reads `closingBalance` from its own state, so the
case has to set the balance first. The corrected case also asserts `activeShift` became
`null`, so a close that silently failed cannot make the "it stops" assertion pass for the
wrong reason.

## Verified

| Gate | Result |
|---|---|
| New file | 3 passed; each case fails under its own mutation |
| Full suite | 12,674 passed, 0 failed (+3) |
| `tsc` / `eslint` | 0 / 0 |
| `usePosShifts.ts` | restored, verified clean |