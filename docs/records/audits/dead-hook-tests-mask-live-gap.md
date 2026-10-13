# A dead hook's tests were covering the live hook's behaviour (round 107)

## The finding

`features/sales/posScreenHooks.ts` exports three hooks — `useShiftTimer`, `useCartWidth`,
`useLockedCartPersistence` — and **all three are imported only by tests**:

```
useShiftTimer               0 production references
useCartWidth                0 production references
useLockedCartPersistence    0 production references
```

`PosScreen` imports `useCartResize` from `hooks/useCartResize.ts` instead (`:61`), and the
live replacements exist for all three: `usePosShifts` (21 refs), `useCartResize` (6), and
the inline restore/lock path in `PosScreen` itself. The file header still says it was
"Extracted hooks from PosScreen.tsx for testability" — the extraction was superseded and
the file was left behind.

## Why it matters — the dead tests MASK a gap

The two cart-width implementations are byte-for-byte the same logic, including:

```ts
localStorage.setItem('pos-cart-width', String(clamped));
```

The DEAD one has `__tests__/hooks/useCartWidth.test.tsx` with **9 cases**, one of which
asserts `localStorage.getItem('pos-cart-width')` is truthy after a drag — against the dead
hook.

The LIVE one has **no test file**. Its only coverage is 3 cases in
`PosScreen.integration.test.tsx`.

Measured: removing BOTH `localStorage.setItem` calls from the LIVE hook leaves the suite
green — **88 tests across `PosScreen.integration` + `useCartWidth`**. So the persistence
the product relies on was unpinned, and a green suite said otherwise.

## Fixed

`__tests__/hooks/useCartResizePersistence.test.tsx` drives the LIVE hook: a saved width is
read and clamped on mount, the default applies when nothing is saved, a DRAG writes the
clamped geometry, and a window resize re-clamps and re-persists.

The drag case is the one that matters — it is the behaviour nothing else pinned. Kill-tested:
disabling the live hook's `setItem` fails it with
"the drag did not persist the width, so the operator's resize is lost on reload."

## Verified

| Gate | Result |
|---|---|
| New file | 4 passed; 1 fails when the live `setItem` is removed |
| Full suite | 12,667 passed, 0 failed |
| `tsc` / `eslint` | 0 / 0 |

## NOT done, and why

`posScreenHooks.ts` was left in place. Deleting it is the obvious next step, but it is 197
lines of production-path-looking code whose only consumers are three test files carrying
**22 cases** — cart-width clamping (9), draft persistence (6), shift timer (7). Removing
the file means either deleting that coverage or porting it to the live equivalents first,
and `useCartResize` is now the only one of the three with any coverage at all. That port is
the work, not the deletion.

`storageKeyPins.test.ts:61` also names `posScreenHooks.ts` as the owner of `pos-locked-cart`,
which is a second thing to repoint.

So the deliverable this round is the missing coverage plus the measurement that shows the gap
was real. The dead-file removal is left as a scoped, evidence-backed next step rather than a
deletion made on the assumption that tests without production consumers are worthless.