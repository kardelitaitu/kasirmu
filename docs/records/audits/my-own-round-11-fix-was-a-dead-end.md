# My own round-11 fix was a dead end, and the probe that found it (round 299)

## Auditing my own fix, which is the step that kept being skipped

Rounds 297, 298 and 299 all turned on one question: *when a refusal is added, list the callers and
ask whether refusing is the right answer THERE.* Round 297 applied it to someone else's code, 298
to a caller nobody checked, and this round to **my own round-11 fix** — the one whose lesson I
wrote down and then did not apply to myself.

## What round 11 did wrong

Round 11 found `handleResumeOpenBill` stealing a foreign lease, so the conflict warning could never
appear. The fix: **refuse the resume** when a conflict exists. That removes the silent takeover. It
also removes every route to the tab.

The warning `pos-cart-conflict-alert` renders on `activeOpenBillId && tabConflict`
(`CartPanel.tsx:775`). Refusing the resume means `activeOpenBillId` is never set — so the banner, and
its Take Over button, stay unreachable. And the only other Take Over in the codebase lives on the
**Tables screen**, which is feature-gated off for this profile:

```
PROBE resumed=false cartBanner=false toast=true tablesRow=0
```

Resume blocked, banner unreachable, Tables row absent. The refusal message told the operator to
*"use Take Over on the tab"* — pointing at a control they cannot reach. That is round 297's dead
end, rebuilt by my own fix, and the reason it went uncaught was that round 11 asserted the *lease
was still held* and the *toast fired*, both of which the refusal satisfies.

## The correct shape, which is neither

Two defects have now lived on this line in opposite directions — take too much and take nothing. The
fix is to **resume, but not steal**:

```tsx
setActiveOpenBillId(id);            // makes the banner renderable
if (!conflict) {
  await claimLease(id, data.tableNumber);   // nobody else holds it — claim normally
} else {
  addToast({ ... 'pos-toast-tab-held-by-other', { terminal } });   // name the holder
}
```

Setting `activeOpenBillId` is what makes the warning renderable; **leaving the foreign lease intact
is what makes it true.** The operator then sees who has the tab and chooses between asking them to
finish and pressing Take Over — which is precisely what `forceTakeover`'s button was built for, and
it can only work if something else put the warning on screen first.

The refusal kept a toast, because a resumed tab that somebody else is editing is still worth flagging
— it is information now, not a gate.

## Why round 11's own tests did not catch it

Round 11 asserted two things: the lease survives, and a toast names the holder. **Both remain true
under the dead-end version**, so the suite stayed green while the fix was wrong in exactly the way
it was written to prevent.

The assertion that discriminates is the one added now — that the resume **proceeds**:

```ts
expect(vi.mocked(getHeldCartScoped)).toHaveBeenCalledWith('tok', 'bill-conflict');
```

One line, and it is the difference between a guard that removes the bad behaviour and a guard that
removes the feature. The general rule follows: **when a fix blocks something, the test must assert
the blocking did not remove the capability the block was protecting.**

## Kill-tested against BOTH defects

| Injected defect | Result |
|---|---|
| unconditional claim (the ORIGINAL bug, pre-round-11) | **1 failed / 1 passed** |
| refuse-the-resume (ROUND 11's OWN fix) | **1 failed / 1 passed** |

A guard that fails in both directions. The second row is the reason this file is worth its keep —
it is what would have caught my own over-correction, and the assertion that produces it was missing
for an entire round.

## Verified

| Item | Result |
|---|---|
| Discriminating assertion | passes for the fix, fails for both kills |
| Kill A — unconditional claim | **1 failed / 1 passed**, then restored |
| Kill B — refuse the resume | **1 failed / 1 passed**, then restored |
| `usePosHeldCarts.leaseConflict.test.tsx` | **2 passed** |
| POS / restaurant / payment / tab unit suites | **1182 passed, 85 files, 0 failed** |
| E2E tab-conflict x2, tab-resume, open-bills-cycle | **8 passed, 4 skipped** (both projects) |
| `restaurant-open-bills-cycle` | passes — the everyday resume path is untouched |
| `npm run typecheck` | exit 0 |
| eslint | 0 |
| Commits | `5c629de3a` (fix) + `dc4edd74d` (test) |

## The lesson, stated plainly

**A guard that removes a behaviour is not automatically a fix — sometimes it removes the feature.**
The test that would have caught round 11 costs one line and asserts the capability still works.

And the reason this round existed at all: I audited someone else's guard in 297, audited a caller in
298, and did not audit **my own** 298 fix until a session had already closed on it. The question
*"when a refusal is added, ask whether it is the right answer HERE"* has to be asked of your own
changes the same round they are made, because that is the round that still has the context to know
what the refusal costs.

> last audited 15-10-26 by docs-auditor
