# Verifying my own fix found a defect in it — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 111 · status: 1 defect found BY
     the verification pass, in round 102's own fix · branch: 0.0.41 · commit: `8f39095c7` -->

<!- - Scope: a verification pass over this session's own commits, which round 110
     recommended after two rounds found their defect in the previous round's fix.
     Tree verified green at 813/813 (12,901 passed) going in. -->

## What the pass found

Round 102 fixed the dispatch write to resolve against committed state. Re-reading the
SHIPPED code rather than the commit message showed the fix keys its record by **`sku`**:

```ts
const sentBySku = new Map(deltaLines.map((d) => [d.sku, d.qty]));
setLines((prev) => prev.map((l) => {
  const sentQty = sentBySku.get(l.sku);
  ...
}));
```

**A cart can hold two lines with one SKU.** `addProduct` merges only lines that agree on
course, coursing status, note AND modifiers (usePosState.ts:94-102) — so the same dish as a
MAIN and as a DESSERT is two lines sharing one SKU. A SKU-keyed map collapses them and then
applies one line's quantity to the other:

```
A (main):    qty 2, dispatched 0  -> in the delta with qty 2
B (dessert): qty 1, dispatched 1  -> nothing outstanding, NOT in the delta

sentBySku = { SKU: 2 }   =>   B: 1 + 2 = 3  on a line of qty 1
```

A `dispatchedQty` ABOVE `qty` is the 'Sent' badge lying in its worst form, and the held
tab persists that value — so the corruption outlives the session.

**Fixed by keying on the line id**, which is what identifies a cart line everywhere else in
this codebase.

## Why round 102's guard could not catch it

`posDispatchRecord.test.ts` mirrors the component in pure functions **because its own header
says the component body "is not reachable from a unit test"** — and the helper is SKU-keyed
too. So the copy and the code were **wrong in the same way**, and every case passed. Only
re-keying the helper by `id` exposed the divergence; the component stayed broken until the
source guard was extended to read it.

That is round 102's own lesson (a copy says nothing about the component) applying to round
102's own fix — the second time in three rounds that a fix has been the next round's defect.

## What was added

- A case with **two lines sharing one SKU**, asserting the untouched sibling stays at its own
  value and that `dispatchedQty <= qty` holds for every line — the invariant that makes the
  badge trustworthy.
- The `Line` fixture gains an `id`, because a SKU **cannot** express line identity and its
  absence is what let the wrong key look right.
- The source guard now fails if the component keys by SKU again.

## Verification

- **Full suite: 813/813 files, 12,902 passed, 0 failed** (3 skipped, 3 todo).
- The SKU-keyed helper **fails** the new case; the id-keyed one passes.
- **Kill test:** restoring `sentBySku` in the component fails the guard on exactly the
  keying assertion; file restored byte-identical.
- `npm run typecheck` 0 errors; `npm run lint` 0 errors; `npm run lint:i18n` clean.

## Standing rule

> A verification pass must read the SHIPPED CODE, not the commit message or the record. And
> when a test file mirrors production logic, the mirror can be wrong in the SAME way as the
> code — which makes the suite pass and hides the defect from the only place it could have
> been seen. Key identity on the identifier the rest of the system uses, never on a
> coincidental attribute.

> last audited 18-10-26 by autonomous-goal-round-111
