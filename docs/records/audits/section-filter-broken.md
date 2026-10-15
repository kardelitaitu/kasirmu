# The section filter narrowed the counts, not the floor plan (round 244)

## The defect

`tables-section-badge-all` and the chips beside it looked like the last small coverage gap on the
tables screen. They were covering a real usability defect.

The chips computed their counts from a filtered list (`:500`, `:506`) while the floor plan rendered
the **unfiltered** `tables` (`:1045` before this fix). Measured on the seeded plan:

```
CHIPS: [0] "All 5/12"   [1] "Indoor 5/6"   [2] "Patio 6"
after clicking "Indoor":  .tables-table count = 12      ← unchanged
```

**Selecting a section changed the numbers and did nothing else.** Two further consequences the
raw list hid:

| Consequence | Cause |
|---|---|
| the "no tables in this section" branch (`:1035`) was unreachable | `showEmpty` keyed on `tables.length` (`:492`), so it could never be true while any table existed |
| a section whose tables were all deleted showed the wrong empty message | same cause, opposite branch |

## The fix

One derived list, used by both consumers:

```ts
const visibleTables =
  section === null ? tables : tables.filter((t) => (t.section || 'Main') === section);
const showEmpty = !loading && !error && visibleTables.length === 0;

and `:1045` maps `visibleTables`.

The `(t.section || 'Main')` fallback matches `getSectionCounts` at `:500` exactly — a second
spelling there would let the counts and the grid disagree again, which is the bug itself.

**Kill-tested**: `section === null ? tables : tables` fails the filter case. Restored and re-verified.

## What the spec pins — 4 passed, both projects

| Case | Asserts |
|---|---|
| the All badge | the text is `\d+/\d+`, the denominator equals the tile count, and the numerator is strictly between 0 and the total |
| the filter | a section chip **reduces** the tile count, and `All` restores it |

The badge asserts the **shape and the arithmetic** rather than the literal `5/12`, so the seed can
change without the test lying — while still failing if the badge rendered the wrong mode (a bare
total where a fraction belongs, or a fraction when nothing is occupied).

The filter case is a pair: `less than before` **and** `back to before`. Asserting only the first
would pass on a chip that dropped tiles and lost them.

## Verified

| Item | Result |
|---|---|
| New spec | 4 passed (2 cases x desktop/tablet) |
| Kill-test | 1 failed |
| Tables + cart specs | 38 passed, 2 skipped, **0 failed** |
| eslint | 0 |
| Full UI suite | 12,716 passed — the render-list change regressed nothing |

## Two defects in two rounds, both found through E2E

| Round | Defect |
|---|---|
| 243 | the tablet cart sheet sat above every modal, so the price-override dialog was unusable |
| 244 | the section filter narrowed the counts, not the floor plan |

Neither would have been found by a unit test of a list derivation: both are about **what the
operator sees**, and both were invisible until something was asserted against the rendered output.
Round 243's needed a real canvas to prove stacking order; this one needed a count that would only
move if the filter actually filtered.

## Tables coverage, complete

| Surface | Round |
|---|---|
| form + Save gate | 165, 167 |
| floor plan | 177 |
| release, delete, move, merge | 193-195 |
| toolbar, arrange, assign | 219 |
| edit form + prefill | 220 |
| Print Bill, success and failure | 221 |
| reserve | 240 |
| seat | 241 |
| **section filter** | **244** |

The only control left is the tab-conflict banner, which needs a second terminal — the round-216
constraint, unchanged across twenty-eight rounds.

> last audited 15-10-26 by docs-auditor
