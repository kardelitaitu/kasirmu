# The dead `posScreenHooks` module is removed (round 111)

## What was deleted

```
ui/src/features/sales/posScreenHooks.ts                    197 lines
ui/src/__tests__/hooks/useCartWidth.test.tsx               127 lines
ui/src/__tests__/hooks/useLockedCartPersistence.test.tsx   219 lines
ui/src/__tests__/hooks/useShiftTimer.test.tsx             101 lines
```

Its three exports — `useShiftTimer`, `useCartWidth`, `useLockedCartPersistence` — had ZERO
production references. `PosScreen` uses `useCartResize`, `usePosShifts` and its own inline
lock/restore path instead.

## Why this was safe, and took four rounds to establish

The deletion is only safe once the behaviours those tests named are pinned against the LIVE
code. Rounds 107-110 established that one at a time, and **two of the three exports were
masking something**:

| Behaviour | Where it was pinned | Live? | Fixed |
|---|---|---|---|
| cart-width persistence | dead hook only | **NO** | round 107 |
| cart-width clamping | dead hook only | ported | round 108 |
| cart-width drag-end | dead hook only | ported | round 111 |
| shift tick | two production suites | yes | — |
| shift interval STOP | nothing | **NO** | round 109 |
| draft lock write | `PosScreenCoreFlow` | yes | — |
| draft corrupt-JSON | dead hook only | **NO** | round 110 |
| draft minimal payload | dead hook only | ported | round 111 |

## Two cases consciously NOT ported

`useShiftTimer.test.tsx`'s `resets anchor when shift changes` asserted
`result.current >= first` and `handles rapid shift changes` asserted `result.current > 0`.
Both are true of ANY timestamp, so neither can fail on the behaviour it names — porting them
would have ADDED two vacuous cases. The stop and the tick, which the live hook is now pinned
for in round 109's file, are the behaviours that matter.

## The registry needed correcting, and one correction is a real signal

`storageKeyPins.test.ts` names the module that declares each literal storage key:

* `'pos-locked-cart': 'features/sales/posScreenHooks.ts'` — repointed, then REMOVED. Round 104
  store-scoped the key to `'pos-locked-cart:${resolvedStoreId}'`, so it is a template literal
  and this literal-scanner cannot see it. The registry entry was already stale; the deletion
  exposed it. `posDraftStoreScoping.test.ts` covers the interpolated form instead, and the
  registry now carries a note explaining the absence.
* `'pos-cart-width'` was listed in the shared-owner expectation with TWO modules; it now has
  one, so that row was removed.

## Verified

| Gate | Result |
|---|---|
| `tsc` / `eslint` | 0 / 0 |
| Full suite | 12,654 passed, 0 failed |
| Test count | 12,675 -> 12,654: 22 removed, 2 ported in, net -21, no behaviour lost |
| Working tree | clean but for another lane's file |

## The pattern, four rounds on

> **A test that drives a module nothing imports is not coverage; it is the APPEARANCE of
> coverage, and the behaviour it names is very likely unpinned in the copy that ships.**

Two of three exports here were masking. The cheap screen is one `grep` for the module's
name outside `__tests__`; the expensive part is that the remedy is NOT deletion — it is
porting each named behaviour to the live code first, which is why rounds 107-110 existed.