# The 50 test-file citations in sales + kds, and the regex that invented a defect (round 175)

## The check

Round 174 checked the restaurant components' docblock claims. The named extension was the
same check for `features/sales` and `features/kds` — but those features use no `Invariants:`
section, so the check was re-aimed at the claim shape they DO use: comments naming a test
file. There are **50** of them, and a citation to a file that no longer exists is round 152's
class, so verifying them was worth doing on its own.

## The false alarm, in full

The first pass reported **14 unresolved citations** — `ItemModifierModal.test.ts,
`ModifierBadge.test.ts`, and so on — and named the files precisely. Running a SECOND pass
after "fixing" them reported the same 14 again, which is when the instrument should have
been suspected rather than the tree.

The bug was the regex:

```ts
/[A-Za-z0-9_]+(\.(?:test|spec))\.(ts|tsx)/g     // WRONG
```

Given `ModifierBadge.test.tsx`, the alternation `(ts|tsx)` matches the SHORTER branch
(`ts`), leaving a bare `x` behind — so the captured name is `ModifierBadge.test.ts` and the
lookup fails. Every `.tsx` file produced a phantom `.ts` citation, and 14 happened to fall in
the two features being scanned.

The corrected regex captures the extension in one alternation and matches it whole, and the
actual answer is **0 of 50 unresolved**. Every citation in `features/sales` and
`features/kds` names a file that exists.

## What the round cost, and what it left

Three passes were spent on a defect the regex invented, and along the way a `split().join()`
chain double-replaced occurrences and produced `ModifierBadge.test.tsxx` in ten files. Caught
by reading the diff rather than trusting the run, and every file was restored — verified with
`git hash-object` against `git show HEAD:… | git hash-object`, all four checked byte-identical.

**The tree is unchanged.** Nothing was committed, because nothing was wrong.

## The lesson, which is a repeat of round 152's

Round 152 was: a guard read 5 false positives from `ui/src/__tests__` because test suites cite
synthetic path shapes. Round 175 is: an audit read 14 false positives from `ui/src/features`
because a regex split `.tsx`. Different mechanism, same class — **the instrument produced the
finding**. Both times the tell was a second run reporting the same thing after a fix that
should have changed it.

The practice this argues for, now recorded twice: when a sweep finds a suspicious number of
defects, RE-READ the finding's own text before acting on it. `ModifierBadge.test.tsxx` was
the tell; so was the unchanged count.

## Verified

| Item | Result |
|---|---|
| Test-file citations in sales + kds | **50** |
| Actually unresolved | **0** |
| `Invariants:` sections in those features | none — the claim shape differs |
| Tree | unchanged; 4 files verified byte-identical to HEAD |
| Source changed | none |