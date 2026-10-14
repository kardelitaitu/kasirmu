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


---

## Round 154 (2026-10-14): the bare spelling is CLOSED, and it found two live defects

The gap recorded above — *"the guard covers the CONVENTIONAL spelling and is blind to the bare
spelling"* — is closed. The finder is now two passes over the same file, kept separate because
they answer different questions:

| pass | what it matches | why separate |
|---|---|---|
| `backticked()` | a path in backticks | unambiguous: the author meant a citation, including one pointing at a deleted file |
| `barePrefixed()` | a bare token carrying a repo-relative prefix | shape-inferred, so it carries its own exemption and its own measured miss rate |

**The discriminator, and why it is not "match every path".** Round 152's version matched every
path-shaped token and died of false positives. Re-measured 2026-10-14: **568 comment lines under
`ui/src/features` name a file**, and almost all are a NAME, not a citation — `components.css`,
`AnalyticsScreen.css`, `<feature>/register.tsx`. The line that makes the new pass safe is that a
bare token only counts **when it starts with a repo-relative prefix** (`.agents/`, `ui/src/`,
`crates/`, `docs/`, `scripts/`, `shared-ui/`). A bare filename is prose about a sibling; a bare
token with a prefix is the author writing a path from the repo root, which is the only shape that
can dangle because a file MOVED.

**Measured over the whole features tree: 81 distinct prefixed tokens, 78 resolve, 3 do not.** The
find pass found two of the three; the third (`docs/guides/EXTENDING.md` in `LocalApiSection.tsx`)
is inside a JSX `<span>`, not a comment, so it is out of scope for a comment guard.

**That third one is now FIXED too, by the same measurement.** `EXTENDING.md` does exist — at
`docs/guides/developer/EXTENDING.md`; the citation had lost the `developer/` segment the guides
restructure added. Repointed at `LocalApiSection.tsx:421`. A sibling search for the flat spelling
found one more **live** stale citation, in a file that is not source at all:
`docs/decisions/README.md:41` cited `docs/guides/EXTENDING.md` while discussing ADR #43's
ambiguity — also repointed. The remaining hits for the old spelling are all **dated audit
stamps** that *describe* the move ("two developer-doc checkboxes pointed at … which now live
under `docs/guides/developer/`"), which is this corpus's convention and correctly left verbatim.

**Still out of scope, and named so the next reader does not think the sweep was silent:**
`docs/plans/_active/documentation-portal-plan.md:127,141` cite `guides/admin-guide.md` — but those
are **mdBook-relative** links inside a portal config discussion, not repo-root paths, and the guard's
prefix model does not apply to them.

### The two defects it found, and both were live

1. **`ui/src/features/workspaces/tools.tsx:35`** cited `docs/records/audit-open-findings.md`.
   The file is at `docs/records/findings/audit-open-findings.md` — the record subtree gained a
   `findings/` level and the comment kept the pre-move path. **Fixed.**
2. **`ui/src/features/retail/ScaleIndicator.css:6`** cited `ui/src/features/sales/WeightScaleWidget.css`
   as its *predecessor*. That predecessor was **deleted** in `338c15c01` (*refactor(sales): retire
   the weight-scale widget its replacement superseded*), so the sheet's provenance note pointed at
   a file that no longer exists. **Fixed** by naming the deletion and its commit — the absence is
   the claim, which is the same exemption the backticked pass already carried.

**A bug in the first version of the new pass, found by running it rather than reading it.** The
comment extractor was line-local (`indexOf('//')`, `indexOf('/*')`), so it found **1 of the 3**
known dangling paths: `ScaleIndicator.css`'s citation sits on the sixth line of a `/* */` block,
where there is no marker of any kind on the line. Replaced with block-comment **state tracking**,
after which it finds both comment-shaped ones. Recorded because the same trap will catch the next
line-local comment matcher in this tree.

### Kill-tested, both passes, on the exact round-153 shape

| Injected into a scanned feature file | Result |
|---|---|
| `// … in .agents/gone-file-xyz.md` — **bare**, the spelling round 153 proved invisible | **fails**, naming file and path |
| `// … in \`.agents/gone-file-xyz.md\`` — backticked | **fails**, naming file and path |
| probe removed | PASS again |

| Verified | Result |
|---|---|
| Guard, healthy tree | 1 passed |
| `tsc` / `eslint` (guard + tools.tsx) | 0 / 0 |
| Both repaired files | no other change; HTML comment block in the CSS left intact |

> last audited 14-10-26 by docs-auditor
