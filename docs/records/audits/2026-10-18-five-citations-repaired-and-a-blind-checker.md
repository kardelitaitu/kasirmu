# Five drifted citations re-pointed, and the checker cannot see the fix — 2026-10-18

<!- - Audit stamp: 2026-10-18 - autonomous goal round 175 - status: 5 drifted citations
     repaired in RetailPosScreen (the burndown second file); the checker own heuristic
     shown to be BLIND to a correct repair - branch: 0.0.41 - commit: e733b8927 -->

<!- - Scope: the burndown round 174 sized and ranked. Second file in the ranking:
     `features/retail/RetailPosScreen.tsx`, 22 flagged. -->

## The repairs

Five citations, all verified by reading BOTH the citing comment and the cited line:

| cites | was at | actually at | the claim |
|---|---|---|---|
| `:189` | `:189` = `return next;` | `:184` | where sessionToken is read |
| `:201` | self-reference | `:196` | the serial-capture comment |
| `:549` | `}, [sessionToken, …]);` | `:591` | the optimistic product replace |
| `:554` | `const loadProductsAbortRef` | `:596` | the editor close |
| `:548` | `loadProductsAndCategories(sessionToken);` | `:590` | where prev is captured |
| `:606` | `currency: updatedProduct.price.currency,` | `:687` | the optimistic row insert |

Two of the originals were **self-referential**: `:201` cited `:189` while `:203` cited
"the comment at `:201`" — a pair pointing at each other rather than at the code they
described. That is what drift looks like when a block shifts twice: the offsets survive relative
to each other while both leave the content behind.

One citation was LEFT ALONE because it is correct: `:898` cites `:145` for
`linesRef.current = lines`, and line 145 is exactly that. Verified rather than assumed —
the same discipline as round 173, where three of four had drifted and the fourth had not.

## The finding that matters more than the repairs

After the repair the checker STILL flags all five. Its count moved only 159 -> 156, and
`RetailPosScreen` still lists 19 entries including the five I just proved correct:

```
RetailPosScreen.tsx:633 cites :591, which reads: setProducts((prevList) =>
RetailPosScreen.tsx:714 cites :687, which reads: setProducts((prev) => [newProd, ...prev]);
```

Those two are now RIGHT, and the checker reports them as wrong. The reason is its own documented
design: it is an IDENTIFIER heuristic — it flags a citation when the cited line carries no
identifier named in the prose. My comment says "the product was replaced at" and the line it now
correctly points at says `setProducts((prevList) =>`; there is no shared identifier, so the
heuristic fires on a correct citation.

**This is the more useful result than the five fixes.** Round 174 concluded from a four-case
sample that "the flagged set is mostly real, not heuristic noise". That conclusion still holds for
the WHY-flagged population, but the flag is not a verdict: a repair can be correct and still
flagged, so the count is a floor on drift rather than a measure of it. Any future decision to
enforce must not use the raw count as the metric — enforcing 156 would fail citations that are
demonstrably correct, and the number would not move no matter how much of the burndown landed.

## Why I stopped at five rather than clearing the file

The remaining 14 in this file need the same read-both-lines treatment, and several are
multi-line ranges (`:1343-1345`) or point at large regions. Doing them properly is a
per-citation verification, not a sweep, and I would rather land five verified than twenty
guessed. The burndown is a background task, not this goal.

## Evidence

- Each of the five verified by content after the edit: `:591` holds `setProducts((prevList) =>`,
  `:596` holds `setEditingProduct(null);`, `:687` holds the insert, `:184` holds the
  `sessionToken` read, `:196` holds the serial-capture comment.
- Checker count 159 -> 156; `RetailPosScreen` 22 -> 19 entries.
- `npm run typecheck` PASS (0 errors).
- Commit `e733b8927` -> exactly 6 lines changed in one file (6 insertions, 6 deletions).

## Carried forward

1. The burndown metric is now known to be a FLOOR, not a count. Record that before anyone
   proposes a gate on it.
2. `RetailPosScreen` has 14 genuinely remaining; `TableManagementScreen` (19) is next by rank and is
   clean, so it is editable.
3. `PosScreen.tsx` is still held by another lane and remains untouchable.

> last audited 18-10-26 by docs-auditor
