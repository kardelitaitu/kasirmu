# Resuming a second tab silently ate the first — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 96 · status: 1 defect fixed,
     1 guard scoped twice before it was safe · branch: 0.0.41 · commit: `cc7df9c6b` -->

<!- - Scope: the held-tab resume path on the restaurant POS. Tree verified green at
     811/811 (12,873 passed) going in. -->

## The defect

`handleResumeOpenBill` loads a held tab with `setLines(data.lines.map(...))`
(usePosHeldCarts.ts:399) — a WHOLESALE REPLACE. With a cart already holding an order it
did not ask, warn, or stash: it replaced. **Measured:** resuming a second tab while a
first was open called `setLines` once with the second tab's lines and fired no toast, so
the first tab's order was gone.

The hook is even handed `lines`, `subtotal` and `resetCart` and used none of them on
this path. Its neighbours all stop and report — holding refuses without a shift, the
lease check raises a conflict banner — and this one did neither.

## The guard took THREE attempts, and the first two were wrong

This is the part worth recording, because each wrong version was caught by a different
mechanism and the distinction is what makes the final rule correct.

**v1 — refuse whenever the cart is non-empty.** Broke three existing cases immediately.
Opening a tab while the cart already holds items for THAT table is the PRIMARY flow: it
is how an operator opens a tab at all. The existing cases at :468 and :547 resume
exactly that way.

**v2 — exempt `activeOpenBillId === id`.** Still red, and the instrumentation said why:
`setLines` was called with the resumed line and **no toast fired**, so the guard never
ran. `activeOpenBillId` is internal `useState` (:127), not a prop — nothing can seed it
from outside, and my test's attempt to pass it was silently ignored. A test that cannot
set the precondition is not testing the guard.

**v3 — the rule that holds.** Refuse only when a DIFFERENT tab is already open:

```ts
const resumingActiveTab = !!activeOpenBillId && activeOpenBillId === id;
const alreadyEditingATab = !!activeOpenBillId && !resumingActiveTab;
if (lines.length > 0 && alreadyEditingATab) { toast('…'); return; }
```

That leaves exactly the destruction case — two tabs' worth of order in one cart, with
the first silently discarded — and exempts both legitimate shapes: the first open of a
session, and re-opening the tab already loaded (a refresh).

**The test had to change too.** It now opens tab 1 with an EMPTY cart, re-renders with
rows in the cart, then mis-taps tab 2 — the only construction that reaches the branch.
A companion case asserts the same-tab refresh still works with a full cart, so the guard
cannot be widened into a dead end.

## Verification

- **Full suite: 811/811 files, 12,876 passed, 0 failed** (3 skipped, 3 todo).
- The new case fails pre-fix (`expected "vi.fn()" to not be called at all, but actually
  been called 1 times`) and passes after; the companion refresh case passes both ways.
- **Kill test:** forcing `alreadyEditingATab = false` fails exactly the one case that
  names the behaviour.
- New toast string added to BOTH bundles — `pos-toast-resume-cart-not-empty` was absent
  from `sales.ftl` and `sales.id.ftl`, which is what `lint:i18n` and the orphan lint
  exist to catch.
- `npm run typecheck` 0 errors; `npm run lint` 0 errors; `npm run lint:i18n` clean.

## Standing rule

> A guard written against "the cart is not empty" is measuring the wrong thing. The
> question is never whether state exists — it is whether the operation would DESTROY
> something the operator cannot get back. Here that meant "a different tab is already
> open", which is narrower than "the cart has items", and the difference is the
> difference between a safety net and a dead end.

> last audited 18-10-26 by autonomous-goal-round-96
