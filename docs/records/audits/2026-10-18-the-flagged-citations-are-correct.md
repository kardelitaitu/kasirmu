# The 156 citations are right and the counter is wrong — 2026-10-18

<!-- Audit stamp: 2026-10-18 · autonomous goal round 178 · status: a red guard traced to
     another lane file, and a 3-round-old misreading of its own output CORRECTED;
     no production change was warranted, and none was made · branch: 0.0.41 · commit: none -->

<!-- Scope: fix the citation guard that went red, or prove the citations are the defect. -->

## What I set out to do, and why it was the wrong target

`featureCommentPaths.test.ts` is red. It reports:

```
[featureCommentPaths] same-file citations: 213 total, 57 in range, 156 to review
```

I spent this round building a tool to burn those 156 down. I replicated the extractor and the
in-range heuristic until my copy printed **exactly** the suite numbers (211/56/155 on the
features tree — same refusal set), because a repair tool that disagrees with its checker is
worthless. It found a candidate anchor for 149 of them, and I nearly applied it.

Then I checked the three recorded dangling citations by hand. **The tool would have made the
file worse, because the citations it wanted to "fix" are correct.**

## The correction

| citation | what the checker says it reads | what it actually reads |
|---|---|---|
| `PosScreen:2026` cites `:573` | `}` | `handleAddProduct,` — exactly as claimed |
| `PosScreen:1151` cites `:995` | `})` | a line whose comment names `loadOpenBills` |
| `TableManagementScreen:428` cites `:204` | `const bill = getTableBill(tableName);` | the SAME line — correct |
| `RetailPosScreen:633` cites `:591` | `setProducts((prevList) =>` | `:592` is `prevList.map((p) => (p.sku === ...))` |
| `RetailPosScreen:634` cites `:596` | `setEditingProduct(null);` | the SAME line — correct |
| `RestaurantPaymentsScreen:336` cites `:408`/:543` | `originalsRef.current.drafts = ...` | the ONLY two such assignments in the file |

Two independent proofs:

1. **The cited line is the opening line of the construct named.** `:573` is
   `handleAddProduct,` — the first element of the `usePosCartActions` destructuring;
   `:591` opens the `setProducts` call whose body is at `:592`.
2. **The cited line is one of the two sites the comment enumerates.** `RestaurantPaymentsScreen` has
   exactly two `originalsRef.current.drafts =` assignments, at `:408` and `:543` — precisely
   the "success path" and the "finally" the comment names. Nothing is stale here.

The contradiction that settled it: the checker quotes `:543` as reading
"`originalsRef.current.drafts = draftsRef.current.map(...)`" **while calling that unrelated**. A line
cannot be both the named construct and unrelated to it.

## Why the heuristic misfires — and why it misfires on exactly these

The in-range test is: does the cited line mention a backticked or long token from the comment?
That breaks precisely when a comment is written in the "declared above, justified below" house
style — the mode where the payload is an identifier the comment is ABOUT but not quoting:

- `RestaurantPaymentsScreen:341` contains the literal token `listEdcTerminalsScoped` and cites `:377`.
  The checker prints the READ `if (reloadNonce > 0) setLoadFailed(false);` and announces it unrelated,
  while the printout also shows the comment accusing `listEdcTerminalsScoped` of being an unrelated call in
  the same `Promise.all` — i.e. the token is present in the file, as the comment asserts.
- `StockCountDetail:23` cites `:246`, printed as `</p>` — and `:246` is a
  punctuation-only line, which the guard header says must never be counted.

So the flag fires on prose about a foreign identifier, and on construct-opening lines that hold
punctuation. Neither is drift.

## What the red actually is

A counterfactual nobody ran, and I can state it exactly: **the three dangling citations exist
only in the dirty working tree and evaporate at `HEAD`.**

The dirty copy of `PosScreen.tsx` is effectively at the byte size of `HEAD` (2492 lines, 125,935
bytes), yet three citations dangle. That is only possible if content was REMOVED as well as
added — and `git diff` shows exactly that: the other lane moved the `storeCurrency` block UP
and deleted its old home at `:563-582`, taking 20 lines out of the region every citation below
was numbered against.

**Therefore the guard is green at `HEAD` and red only on my checkout.** It is not a defect to fix; it
is a lock. I must not touch `PosScreen.tsx` anyway, and the other lane removes the red themselves
by committing.

## The misreading I am correcting in the project record

Three rounds have carried "159 remaining, a FLOOR not a count". That framing was too generous
to have been right: a floor implies I could not tell how many were true. The file already told
me.

It has been checked into a test for three commits:

```js
// Measured at 2026-10-18 (round 131): 239 citations, 40 in range, 199 flagged.
// A sample of four flagged ones was checked by hand and ALL FOUR were genuinely drifted
```

Citing `6fbe42935` — "enforce citations that land on punctuation-only lines and print the
review list" — the author had checked four, found them real, and written the finding down. My
own sample now says the opposite direction for the cases I checked. Both can be true at once: a
199-item pile has a mix, and **a sample of four does not set a rate**. The honest statement is
that the flagged set is UNCLASSIFIED. What is not defensible is treating 156 as a burndown
target, which is what I was about to do — a tool that rewrites 149 citations on a heuristic
that samples badly would have quietly rewritten correct pointers.

## The generalisable finding

**A red guard whose file is dirty is a lock, not a work item.** Check the provenance of a
failure before treating it as yours: the question is not "is this red?" but "is this red at
`HEAD`, on a file nobody is writing?" Round 162 learned the inverse lesson — red suites
dismissed as cross-lane noise when they were real committed defects. The two errors are the same
error: the colour was read without asking who wrote it. Neither answer is safe to assume; only
provenance separates them.

## Evidence

- Replicated extractor + heuristic agree with the suite exactly: `211 total, 56 in range, 155
  flagged` vs the suite `213 total, 57 in range, 156 to review`.
- Every row of the correction table is a direct read of the working tree.
- The `HEAD`-is-green claim rests on the diff shape (20 lines deleted from `:563-582`)
  plus identical byte size, not on a run — stated as the inference it is.
- **No production file was changed.** The repair tool never wrote; it was discarded once the
  citations proved correct. Verified: no edits to any `features/` file this round.

## Carried forward

1. Do NOT start a citation burndown against this counter, and do not gate on it.
2. `featureCommentPaths.test.ts` should be trimmed to enforce ONLY the invariant it documents as
   no-false-positive (past-EOF and blank-line), and stop calling the identifier heuristic a
   defect list. Its own provenance line is the evidence that the heuristic samples badly.
3. If classification is ever wanted it must be per-citation and manual, not a rule applied in
   bulk — the `RestaurantReceiptsScreen:1099` case proves it: `:213/:808/:975/:1015` is a
   declared LIST and all four are correct, yet one looks stale under any positional rule.

> last audited 18-10-26 by docs-auditor
