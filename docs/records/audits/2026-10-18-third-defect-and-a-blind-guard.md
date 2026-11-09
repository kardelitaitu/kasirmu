# The third defect under the same comment — and a guard that had gone blind — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 114 · status: 1 defect fixed,
     1 vacuous guard repaired · branch: 0.0.41 · commit: `395d87406` -->

<!- - Scope: finishing the verification pass over this session's own fixes — round 102's
     persist-block change, read in SHIPPED form. Tree verified green at 813/813
     (12,903 passed) going in. -->

## The defect: the saved tab recorded the PRE-send dispatchedQty

`handleSendToKitchen` awaits the kitchen dispatch (:1169) and then builds the hold's
`cartData` by mapping `lines` (:1257) — the render closure captured **before** that await.
Round 102 fixed the `setLines` write to resolve against committed state, so LIVE state is
correct; the persisted record then saved the stale value. My own round-102 comment
describes this precisely — *"it mapped `updatedLines` — the SAME pre-await closure"* — I
removed the **variable** and left the **closure read**.

```
cart: A qty 2, dispatchedQty 0
Send  -> setLines advances A to 2      (live state correct)
Hold  -> cartData recorded A as 0
Resume-> A reads as NOT sent, though the kitchen has it
```

The opposite error from the over-record round 102 fixed, and the same root cause.

**Fixed** by applying the dispatch's own advance — `sentById`, already in scope — to the
same array it was applied to, so the payload stays a pure function of the values the send
used and needs no second await.

## Why the sibling hook is NOT the same case

Worth stating because round 103 examined the same shape and found it correct:
`usePosHeldCarts` recomputes `linesToSave` as `dispatchedQty: l.qty` after its own dispatch
(:226-228). Its record **intends** to mark what it just sent, so it is internally
consistent. `PosScreen` copied `l.dispatchedQty` from the stale array and never reconciled.
**Same shape, different intent — and only the second is a defect.**

## The guard that had gone blind, and how it was proved

The new assertion **passed on the first run**, which I did not accept. Debugging showed why:
the guard scanned `src.slice(at, at + 4200)`, a bound sized before the dispatch fixes added
~1,400 characters of comments to the same function. Comments are stripped *after* the slice,
so the window stopped **before** `const cartData` — the assertion had nothing to match and
passed vacuously.

Two repairs, both needed:

1. the window widened to cover the whole callback;
2. **an assertion that the block is inside the window at all** — so the same tightening
   cannot silently blind the guard again. A guard whose subject can drift out of scope is
   worse than no guard, because it reports clean.

With the window fixed, the case failed on the real defect (`expected true to be false`) and
passes after the fix. **Kill-tested:** restoring `lines:` in the payload fails it.

## Verification

- **Full suite: 813/813 files, 12,903 passed, 0 failed** (3 skipped, 3 todo).
- New case fails pre-fix, passes after; kill test restores the failure; file byte-identical.
- `npm run typecheck` 0 errors; `npm run lint` 0 errors; `npm run lint:i18n` clean.

> last audited 18-10-26 by autonomous-goal-round-114
