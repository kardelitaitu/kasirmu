# A finding I withdrew, and the rule that decides it — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 103 · status: NO DEFECT in the
     path audited; 1 claimed defect WITHDRAWN on the algebra; 1 test added ·
     branch: 0.0.41 · commit: `a8ce322f6` -->

<!- - Scope: acting on round 102's own rule ("a comment claiming a fix is not the fix"),
     by hunting comments that assert a fix and checking each against the code. Tree
     verified green at 812/812 (12,890 passed) going in. -->

## The claim I made, and why it was wrong

`usePosHeldCarts.handleOpenBill` computes the unsent delta correctly (:214-216) and
dispatches exactly that (:220) — then writes the saved tab with:

```ts
const linesToSave = shouldDispatch && deltaLines.length > 0
  ? lines.map((l) => ({ ...l, dispatchedQty: l.qty }))   // every line, full qty
  : lines;
```

I read that as the same over-record round 102 fixed in `PosScreen`, especially because the
comment immediately below says the sibling builders *"were both fixed"*. **It is not, and
the algebra settles it:**

```
delta = qty - dispatched
advance-by-delta:  dispatched + delta = qty
```

For any line in the SAME array the two forms are **identical**. My first test could not
detect a difference because there is none — it passed, and a passing test for a non-bug is
the correct outcome.

PosScreen differed for one reason: its delta and its write were separated by an **await**
during which the operator could change the cart, and the write went back into **live
state**. Here the delta and the map read one frozen render closure, so they cannot disagree.

## The rule that actually decides it

The same code shape is a defect in one place and correct in another, and the discriminator
is **the write target**:

| Site | Writes to | Stale snapshot means |
|---|---|---|
| `PosScreen.handleSendToKitchen` | **live cart state** (`setLines`) | OVERWRITES newer data → the operator's line is lost |
| `usePosHeldCarts.handleOpenBill` | **a persisted tab** (`holdCartScoped`) | "what the cart held when Hold was pressed" — the CORRECT semantics for a tab |

All four uses of `lines` in the hold path (:214 delta, :227 save, :248 cartData, :294
itemCount) share one snapshot, so the record is internally consistent. A line added during
the dispatch await is absent from the saved tab, which is coherent: the tab records the
cart as it was when the operator held it.

**No production code changed.** I would have introduced a defect by "fixing" this.

## What was added

One test, asserting the two things that are true and worth protecting:

- the DISPATCH carries only the outstanding amounts (a fully-sent line is not re-sent to
  the kitchen);
- the SAVED tab agrees with it, per line.

Its comment records the withdrawn claim and the algebra, so the next reader does not
re-derive the same false positive — including the note that a `vi.fn()` with no declared
parameter makes `mock.calls[0][0]` `undefined` at the type level, which the typecheck
caught.

## Verification

- **Full suite: 812/812 files, 12,892 passed, 0 failed** (3 skipped, 3 todo).
- `npm run typecheck` 0 errors (it caught the mock-typing error my first draft had).
- `npm run lint` 0 errors.

## Standing rule

> Before treating a stale-snapshot read as a bug, ask what it WRITES TO. A snapshot written
> back into live state loses data; a snapshot written into a persisted record is the point.
> The code shape does not distinguish them — only the destination does. And when a test for
> a suspected defect passes, that is evidence about the claim, not a failed test.

> last audited 18-10-26 by autonomous-goal-round-103
