# Four regex bugs in one sweep, and the answer was zero — 2026-10-18

<!-- Audit stamp: 2026-10-18 · autonomous goal round 201 · status: tried to generalise round-200
     vacuity finding across 817 test files; FOUR successive regex bugs produced false
     accusations, and the validated answer is ZERO · commit: none (no change) -->

<!-- Scope: round 200 found 3 vacuous cases by mutating. Can that be found by scanning? -->

## The goal, and the honest outcome

Round 200 found three vacuous cases in my own suite **by mutating the handler**. The obvious
next step is to find that class statically across all 817 test files. I tried. The answer is
**zero**, and the interesting part is that it took four regex corrections to get there.

## The four bugs, in order

| # | classifier | reported | why it was wrong |
|---|---|---|---|
| 1 | `.not\.to(Be\|Contain\|Equal…)` = negative | 25 files | `.not.toBeNull()` is a POSITIVE existence check, not a negative |
| 2 | strip `.not.`, then look for a positive | 164 files | over-broad: any DOM negative counted as "no positive" |
| 3 | file-level: negatives > 0 && positives == 0 | **0 files** | `\.toHaveBeenCalled` matches INSIDE `.not.toHaveBeenCalled`, so every negative counted as a positive — the check could never fire |
| 4 | same, with `(?<!\.not)` lookbehind | 34 files | `toHaveBeenCalledTimes` was missing from the positive set |
| final | add `Times` | **7 files** | all 7 are file-level false positives (see below) |

## Every one of the four was caught by the control

The positive control — inject a genuinely vacuous case, confirm the detector fires — failed on
versions 2, 3 and 4, and each failure pointed at the bug:

* v3 returned "0 files", which is exactly the result that should make you suspicious, and the
  control refused to fire. That is how the `.not.` overlap was found: `\.toHaveBeenCalled` is a
  SUBSTRING of `.not.toHaveBeenCalled`, so the two counters were not disjoint.
* v4 reported 34 files; stripping the true positives from a control file also zeroed the
  negatives, which is the same overlap from the other side.
* Only after both were fixed did the control fire AND the population become plausible (7).

**Without the control, version 3 would have been recorded as a clean sweep** — "0 files with
vacuous cases, the tree is healthy" — which was false in the most dangerous direction: the check
was structurally incapable of detecting anything.

## The 7 survivors are false positives too, and the reason is granularity

All seven pair the negative with a DIFFERENT positive in the same case. For example
`i18n.test.ts`:

```ts
expect(bundle).toBeInstanceOf(FluentBundle);      // positive: the bundle built
expect(bundle.locales).toContain("en");           // positive: the right locale
expect(warnSpy).not.toHaveBeenCalled();           // the negative it flags on
```

A **file-level** scan sees "negatives present, no positive on THAT spy" and flags it. A
**case-level** reading shows the case proves the subject is live through another assertion. So the
correct granularity is neither the file nor the spy — it is the CASE, and even then only when the
whole case is negative, which is what round 200 actually had.

## Why this is not a detector I should ship

The final check has all four bugs fixed and still produced 7 false positives out of 7. A guard
with 0% precision is worse than none — the project settled this for the citation checker in
round 179. The finding is the negative result itself: **the round-200 shape does not occur
elsewhere in this tree.**

## Verified

| check | result |
|-|-|
| control at version 4 | FIRES (pos=0, neg=10 on a stripped file) |
| control file restored | byte-identical (`577c2ee605b95344`) |
| control file for v3/v4 threshold | `ItemModifierModal.test.tsx` restored (`06f6d2c2c889685e`) |
| final population | 7 files, **7/7 false positives**, verified per-case |
| production change | **none** |

## Carried forward

1. **The round-200 vacuity shape is not present elsewhere.** Do not rebuild this detector; it was
   built, four times corrected, and rejected on measurement.
2. **A detector whose own regexes overlap cannot be debugged by reading its output.** `.not.` and
   the bare call form are not disjoint by substring, and I made that mistake in three different
   spellings in one round. The lookbehind is the fix; the control is how you find out you need it.
3. **"0 findings" from a newly written check is a red flag, not a clean bill of health.** Round
   199 said run the control; this round is the first time the control caught a detector that
   could not have fired at all.

> last audited 18-10-26 by docs-auditor
