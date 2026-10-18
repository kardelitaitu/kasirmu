# A table move deleted the bill before it existed, and a merge deleted two (round 292)

## A different axis, on purpose

Rounds 288-291 found controls no test names, and round 291 established that the id-coverage
axis is closed on every restaurant surface measured (sales 43/43, tables 21/21). This round went
after **reliability defects in write sequences** instead — the class that costs a merchant data.

## The defect, found by reading the move handler

`TableManagementScreen.handleMoveTable` moved an open bill to another table by:

```tsx
await deleteHeldCartScoped(sessionToken, activeBill.id);   // OLD bill destroyed
await holdCartScoped(sessionToken, { ... });               // NEW bill created
```

**The delete comes first, so a failed hold loses the bill.** A locked SQLite write, a dropped
connection or a lapsed session at that moment destroys the merchant's only copy of that open bill,
and the catch path toasts only "move failed" — the operator has no signal that the tab is gone
rather than unmoved. A held cart has no undo.

`handleMergeTable` had the same shape and was worse: it deleted **both** source bills before
creating the combined one, so a failed hold lost two tables' open bills at once.

## The repo had already settled the ordering question

`usePosHeldCarts` resolves the same two-write problem for the same data in the SAFE direction,
and pins it with a test named *"does NOT report a tab as updated when deleting the previous record
FAILS"*. So the convention existed; `TableManagementScreen` was the outlier, on the same entity.

That asymmetry is what made this a bug rather than a design choice.

## The fix: create first, delete second

Both handlers now write the new record before removing the old one. The asymmetry is deliberate and
the reasoning is recorded at the call site:

| Order | A failed write leaves | Recoverable? |
|---|---|---|
| delete -> hold | **no bill at all** | **no** |
| hold -> delete | two open bills | yes — the operator deletes one |

The docs note that the expense of the safe order (a duplicate row on a second failure) is bounded
and hand-fixable, while the damage of the unsafe order is neither. No product information is lost
either way; only the ordering changes.

## Two tests, and why the negative assertions carry them

`KEEPS the original bill when the hold for the new table fails` and `KEEPS BOTH bills when the
combined hold fails`, both rejecting the hold with `database is locked`.

The assertion that does the work is `expect(mockDeleteHeldCart).not.toHaveBeenCalled()` — **and
asserting only the error toast would have passed against the old code**, because the old order
toasts the same message, after the damage. This is the round-229/230 pairing rule applied to
state: the positive symptom is not discriminating, the negative one is.

## Both fixes kill-tested against the original order

| Restored to DELETE-first | Result |
|---|---|
| `handleMoveTable` | **1 failed** — `mockDeleteHeldCart` had been called with `["bill-1"]` |
| `handleMergeTable` | **1 failed** — `Number of calls: 2`, both bills destroyed |

Both were restored and the tests returned to green. `git diff` on the source shows only the
reorder plus its comments.

## ⚠️ A mixed file, and why the source commit is not in this round

`TableManagementScreen.tsx` now carries **another session's work in the same file**: an
unrelated hunk adding `created_at: ''` / `updated_at: ''` to the optimistic table creation at
`:410-411`, which appeared in the working tree during this round and is not mine.

AGENTS.md 7.3 is explicit that a pathspec commit records the working-tree copy of every listed
path, so committing this file would sweep that agent's change into my commit. **The source fix is
therefore staged but uncommitted, and the test (which is uncontaminated) is committed alone** —
`93de2532c`.

The fix is real and verified; the commit simply belongs to whoever lands the whole file. This is
recorded rather than papered over because the alternative — silently committing someone else's
hunk — is the exact failure the shared-index rule exists to prevent.

## Verified

| Item | Result |
|---|---|
| New move-failure case | **1 passed** |
| New merge-failure case | **1 passed** |
| Kill-test, move (restored to delete-first) | **1 failed**, then restored |
| Kill-test, merge (restored to delete-first) | **1 failed**, then restored |
| `TableManagementScreen` suite | **61 passed** (was 59) |
| Restaurant/payment suites | **675 passed, 48 files, 0 failed** |
| eslint on both edited files | 0 |
| `npm run typecheck` | **exit 0** |
| Existing move/merge happy-path cases | still pass — the reorder does not change what happens on success |
| Source committed | **no** — mixed with another session's hunk, reported instead |

## What this changes about the surface

Move Table and Merge Table can no longer destroy an open bill through an ordinary transport
failure. That is the highest-consequence data loss on the restaurant tables surface, and it was
reachable without any mistake by the operator — only a failed IPC between two consecutive writes.

## The next round's obvious target

The same DELETE-then-CREATE shape should be searched for repo-wide rather than assumed limited to
these two handlers. `mirrorBeforeAwait.test.ts` is an existing static scanner for a sibling of this
pattern; the question worth answering next is whether there are other two-write sequences ordered
the unsafe direction.

> last audited 15-10-26 by docs-auditor
