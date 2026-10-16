# A suspected defect that did not survive checking — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 115 · status: NO DEFECT in production;
     2 cases added pinning a real dependency, with a withdrawn claim recorded · branch:
     0.0.41 · commit: `53cf9fd34` -->

<!- - Scope: round 114's detector ("the code violated its own comment") applied deliberately
     — find comments stating an invariant, then check the code honours it. Tree verified
     green at 813/813 (12,903 passed) going in. -->

## The claim, and why it was withdrawn

`usePosState.ts:41-51` says the cart currency is a ref, kept in sync by an effect, because
*"refs avoid stale closures"*. I read the shape as round 114's defect:

- the ref is released only by that `useEffect` on `[lines]` (:49-51), which runs AFTER the
  render that emptied the cart;
- `removeLine` (:134) never touches the ref.

So between the removal and the effect flush the ref could still hold the old currency, and
`addProduct`'s guard (:82-85) reads exactly that — refusing a first line in a new currency
with no explanation. I wrote the failing case.

**It passed.** Checking instead of filing showed two reasons there is no defect:

1. **`addProduct` anchors synchronously** when the ref is null (:86-91), so a first add never
   depends on the effect. The existing comment says so and it is true.
2. **No reachable handler removes and adds in one tick.** Every `removeLine` call site is a
   click handler (usePosCartActions:218, RetailPosScreen:351, RefundModal's stepper) and every
   add is a separate interaction, so React flushes the effect in between.

Round 104 did the same thing in reverse and I nearly filed it; this is the third time this
session a suspected defect did not survive checking.

## What was added instead of a fix

The claim was wrong but the analysis located a REAL, undocumented dependency, so the case
was rewritten to pin it rather than deleted:

- **an emptied cart must release its anchor** — the outcome the comment at :46-48 promises
  ("an empty cart resets the anchor so a new cart can start in any currency");
- **a non-empty cart must still refuse a second currency** — pinned beside it so a future
  change cannot satisfy the first by breaking the guard it was written for.

**Kill-tested:** disabling the release in the effect fails the first case
(`expected false to be true`), which proves the effect IS load-bearing — the opposite of a
case that passes for snapshot-only reasons. Production code was modified for the kill run only
and restored byte-identical.

## The other files checked

- `nodeTopologyEditorWireCommit.ts:47-48` claims the gates read *"the CURRENT canvas, never the
  render closure"*. **Holds** — `const currentWires = wiresRef.current` (:148).
- The other 12 stale-closure comments were read; each matched its code.

## Verification

- **Full suite: 813/813 files, 12,905 passed, 0 failed** (3 skipped, 3 todo).
- `npm run typecheck` 0 errors; `npm run lint` 0 errors.
- No production file changed.

## Standing rule

> When a suspected defect's test passes, that is a finding about the CLAIM, not a
> worthless test. Check what makes it pass — here, a synchronous anchor and the absence of a
> same-tick path — then either pin the real dependency or withdraw the claim and say so. A
> withdrawn claim with its reasoning is worth more than a fix to working code.

> last audited 18-10-26 by autonomous-goal-round-115

