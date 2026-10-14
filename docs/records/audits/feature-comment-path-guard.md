# Round 152's deleted guard comes back — the SCOPE was the error, not the idea (round 153)

## What round 152 got wrong

Round 152 wrote `restaurantCommentPaths.test.ts` to catch the defect it had just found by hand:
a corrected comment citing `.agents/resto-pos-ui-review.md`, which had moved to
`.agents/reviews/`. It fired on six citations, five of which the matcher should have skipped,
and concluded the idea was too broad.

**The scope was the error.** Grouping those six hits by directory:

```
ui/src/__tests__/            5   glob, two templates, a deleted path, its own file
ui/src/features/restaurant/  1   the REAL dangling path
```

Test traffic is full of synthetic path shapes **by construction** — a suite proves a fence
fires on planted violations, and cites the planted sheet to say so. Feature comments cite
files a reader will open, and mean it. The same finder scoped to `ui/src/features` fired on
**one** hit, with zero false positives.

## The guard now in the tree

`ui/src/__tests__/featureCommentPaths.test.ts` — resolves every backticked repo-relative path
in a comment under `ui/src/features`. Round 153's measurement: **8 cited paths across the whole
features tree**, so the self-check threshold is a floor against the finder silently shrinking to
nothing, not a guessed `> 20`.

Kill-test, in two halves, and this is the part worth reading:

| Injected defect | Result |
|---|---|
| the path written **bare**, as round 151's comment had it | **PASSED** — the finder is backtick-anchored |
| the same path **backticked**, as round 152's fix wrote it | **fails**, naming file and path |

So the guard covers the conventional spelling and is **blind to the bare spelling**. Round 151's
comment had written the path bare, so that shape is not hypothetical. The guard's docblock says
so, and names the two ways to close it — match bare paths, or lint the handful of citations by
hand — and why neither was taken here: matching bare paths reintroduces exactly the
false-positive rate that killed round 152's version.

## A second mistake, also recorded

Kill-testing `RestaurantMenu.tsx` through `fs.writeFileSync` after round 151 had edited it with
the edit tool **stripped all 759 CRLF line endings**. `git diff` then showed a two-line change
that was not a change. Detected by comparing `git hash-object` against
`git show HEAD:… | git hash-object`, and restored by rewriting with CRLF; the file is now
byte-identical to HEAD.

The lesson is §7.3's *"not every ` M` is content"* one step further: **not every restore is a
restore.** A write that changes a file's line endings reports as a content diff, and can be
committed as one.

## Verified

| Item | Result |
|---|---|
| Guard, healthy tree | 1 passed, zero false positives |
| Kill-test, backticked | fails, names `RestaurantMenu.tsx -> .agents/resto-pos-ui-review.md` |
| Kill-test, bare | passes — documented as a finding, not hidden |
| `RestaurantMenu.tsx` | byte-identical to HEAD after the restore |
| `tsc` / `eslint` | 0 / 0 |
| Full UI suite | 12,671 passed, 0 failed (up 1) |
| Commit | one file, `create mode` exactly the guard |