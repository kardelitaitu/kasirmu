# The dead hook's LAST masked behaviour: corrupt-draft resilience (round 110)

## The third and final export checked

`dead-hook-follow-up.md` (round 108) checked two of `posScreenHooks.ts`'s three exports
against their live equivalents and left the third — `useLockedCartPersistence`, 6 cases —
unexamined. This round checked it.

## What was found

Round 108 had already kill-tested the live LOCK write (`PosScreen.tsx:1159`) and found it
covered by `PosScreenCoreFlow` :: *locks cart on logout and restores on next mount*.

The live RESTORE (`PosScreen.tsx:197-247`) was not. Specifically the `try/catch` around its
`JSON.parse`:

```
grep 'not valid json|malformed'
  PosScreenCoreFlow.test.tsx            0
  hooks/useLockedCartPersistence.test.tsx   2   <- the DEAD hook
```

**Round 107's pattern again**: the corrupt-draft resilience was pinned only against the
dead copy. The behaviour in the live one was correct — probed, no error boundary — but
nothing asserted it.

## Why it matters

A corrupt draft is reachable. The key is written with `JSON.stringify`, but a partial write,
a storage-quota failure mid-`setItem`, or a tampered value all leave unparseable content.
Without the catch the `SyntaxError` escapes the effect, React commits the error, and the
operator gets an error screen instead of a usable POS.

## Added

`PosScreenCoreFlow.test.tsx` :: *boots to a usable POS when the draft is unparseable* —
seeds `{not valid json`, renders, asserts the POS screen mounted AND no error boundary
exists.

Kill-tested by NEUTRALISING the catch (turning `try {` into `{` and dropping the `} catch`:

```
SyntaxError: Expected property name or '}' in JSON at position 1
  at captureCommitPhaseError (react-dom)
× boots to a usable POS when the draft is unparseable
```

My first kill-test was invalid: it added an unguarded `JSON.parse` INSIDE the existing `try`,
so the catch still absorbed it and the case passed. The probe has to remove the protection,
not duplicate the protected call.

## The dead-hook audit, complete

| Export | Live equivalent | Verdict |
|---|---|---|
| `useCartWidth` | `useCartResize` | masked a real gap — **fixed round 107**, clamps **ported round 108** |
| `useShiftTimer` (tick) | `usePosShifts` | covered |
| `useShiftTimer` (cleanup) | `usePosShifts` | unpinned — **fixed round 109** |
| `useLockedCartPersistence` (lock) | `PosScreen` inline | covered |
| `useLockedCartPersistence` (restore) | `PosScreen` inline | unpinned — **fixed this round** |

Two of the three exports were masking something. That is a high enough hit rate that the
pattern is worth stating plainly:

> **A test that drives a module nothing imports is not coverage; it is the APPEARANCE of
> coverage, and the behaviour it names is very likely unpinned in the copy that ships.**

## Verified

| Gate | Result |
|---|---|
| New case | passes; fails when the live `try/catch` is neutralised |
| Full suite | 12,675 passed, 0 failed (+1) |
| `tsc` / `eslint` | 0 / 0 |
| `PosScreen.tsx` | restored, verified clean; the probe script deleted |