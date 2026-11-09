# Two hypotheses tested and refuted, one type error fixed — 2026-10-18

<!-- Audit stamp: 2026-10-18 · autonomous goal round 195 · status: a coverage scan produced two
     candidate defects and BOTH were refuted by measurement; the run that refuted the second
     surfaced a real type error in my own round-194 test · branch: 0.0.41 · commit: bf49f730f -->

<!-- Scope: pivot from coverage work to defect hunting. -->

## The scan, and why its first output was wrong

To find thin coverage objectively I counted, per production file, how often its basename appears
across all test files. The first version walked only `src/__tests__` and `e2e` — which
reported `splitDistribution.ts` as having **zero** references.

It has a co-located suite, `splitDistribution.test.ts`, in the same directory. **The scan
measured my own path assumption, not the code.** Corrected to walk the whole `src` tree, the
population went from 125 files to 196 and the false "zero" disappeared.

That is the third time this session that a filename-scoped query produced a confident empty
answer — the same error class the project record already documents four times.

## Candidate 1 — the three "structural twin" interfaces (REFUTED)

The corrected scan pointed at `useSplitTenderState.ts` (6KB) with one reference, on
money-facing split-tender code. Reading the neighbourhood found something more interesting:
**three separately-declared interfaces that must stay field-compatible, held together by
comments alone.**

```
useSplitTenderState.ts:61   export interface SplitRow        { id; method; otherLabel; amountMinor }
SplitTenderRows.tsx:54      /** Structural twin of useSplitTenderState SplitRow (:63)… */
useTenderMath.ts:64         /** Structural twin of useSplitTenderState SplitRow (:63)… */
```

Three declarations, zero tests referencing any of them. If one drifted, would anything notice?

**Yes — the compiler.** I renamed `amountMinor` in the LOCAL interface and its reads, the way a
careless refactor would, and `tsc` failed at the call site:

```
src/features/sales/PaymentModal.tsx(575,5): error TS2322:
  Type SplitRow[] is not assignable to type readonly SplitTenderRow[].
```

The interfaces are **structural**, so TypeScript checks compatibility across the hop. The
comment says "structural twin" and the type system actually enforces it. Not a defect — and the
word "structural" in the comment is doing real work rather than decorating.

## Candidate 2 — KDS gesture coverage (REFUTED, and already known)

The same scan listed `useKdsKeyboardShortcuts.ts` (7KB) and `useCartKeyboardNav.ts` (4KB) as
thin. Checking them against the existing suite showed KDS already drives its keyboard path and
its swipe with real touch events (`KdsScreen.test.tsx:970`), and the KDS E2E suite is 10/10
green. No action.

## What the refutation run actually found

The `tsc` run that refuted candidate 1 printed a second error, in a file I had written the
round before:

```
src/__tests__/CartPanel.test.tsx(613,71): error TS2322:
  Type string is not assignable to type "dine_in" | "takeaway" | "delivery" | undefined
```

My round-194 `press` helper was typed `(orderType: string, …)` while the prop is a narrowed
union. The test **passed** — vitest does not typecheck — so nothing in the round-194 run could
have caught it. Only the type gate could, and I had not run it that round.

Fixed in one line; `npx tsc --noEmit` is now **fully clean repo-wide** (the other lane error
from round 191 is gone too).

## The lesson

**A passing test suite is not a type check, and the difference is exactly where a helper is looser
than the thing it feeds.** Five rounds of coverage additions took care to kill-test behaviour and
never once ran `tsc`; a loose parameter type slipped in behind green tests. Running the type
gate after adding a harness is not optional polish — it is the only gate that reads the
declarations, and declarations are what a test helper quietly weakens.

## Verified

| check | result |
|---|---|
| `CartPanel.test.tsx` | **6 passed** (order-type cases) |
| `npx tsc --noEmit` repo-wide | **0 errors** |
| `npm run lint` | 0 errors (116 warnings, baseline) |
| drift mutation on `useTenderMath` | caught by tsc, restored byte-identical (`eb9f057a29fc5c2b`) |
| KDS E2E (3 specs) | 10 passed |

## Carried forward

1. The corrected scan is the reusable artifact: **a coverage query must walk the whole source
   tree, because co-located suites exist.** Three false empties this session came from scoping a
   query to a directory that could not contain the answer.
2. Run `npx tsc --noEmit` after adding or editing any test helper. It is the only gate that
   sees a weakened parameter type; vitest passes regardless.

> last audited 18-10-26 by docs-auditor
