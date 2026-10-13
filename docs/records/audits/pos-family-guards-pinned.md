# The POS family's remaining sequence guards are all pinned (round 117)

## What was swept

Rounds 116-117 made "kill-test the guard, then check reachability" the established method.
This round enumerated **every** `SeqRef`/`seqRef`/`Seq.current` belt across `features/` — 22
files — and kill-tested the POS-family ones that had not already been audited.

| File | Guard | Prior audit |
|---|---|---|
| `PosScreen.tsx` (9 refs) | receipt / courseFiring / orderTypePrompt | rounds 82-84 |
| `usePosShifts.ts` (3) | interval stop | round 109 |
| `RetailPosScreen.tsx` (6) | **storeSettings + shift** | **this round** |
| `useAutoQr.ts` (3) | not a belt — an ID counter | this round |

## The result: both retail belts ARE pinned

Neutralising both — the `storeSettings` belt's `if (!stale())` and the `shift` belt's
`if (stale()) return;` — fails exactly two cases, each naming its own behaviour:

```
× ignores a slower earlier shift read after a token change
× ignores a slower earlier store-settings read after a token change
34 passed | 2 failed (36)
```

So `features/retail` already carries the coverage `features/sales` was missing. Nothing to
fix; recorded so the sweep is not repeated.

## `useAutoQr`'s three hits are not a guard

`autoIssueSeq` is a monotonic ID counter (`:178` `+= 1`, `:135` reset to 0) used to suffix a
QR reference (`:112`), not a staleness belt. Same class as `usePosState.ts`'s `nextLineId`,
ruled SOUND in round 103: it is a generator, its values are never compared for staleness,
and a reset re-uses a suffix only within one modal session.

## Method note

The sweep's first pass used a `grep` whose output was far wider than the question, and the
attempt to list the retail test files drowned in matches. The useful subset came from asking
a narrower question — *which POS-family files have belts not already audited* — rather than
grepping the whole tree for the pattern.

## Verified

| Gate | Result |
|---|---|
| Both retail belts removed | 2 cases fail, naming their own behaviour |
| Full suite | 12,657 passed, 0 failed |
| `tsc` | 0 |
| Tree | `RetailPosScreen.tsx` restored; `scratch-kill.py` deleted |