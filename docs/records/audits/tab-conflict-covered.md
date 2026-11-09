# The four-round "blocked" is now a passing test (round 278)

## What was blocked, and why the blocker was soft

`pos-cart-conflict-alert` and `pos-cart-conflict-takeover-btn` were recorded as blocked in rounds 256,
258, 262 and 263, each time citing `getConflict`'s terminal check (`useTabLeases.ts:199`).

Round 277 measured the mechanism and found the lease is a module-level object whose only external
write path is a documented DOM event. **This round finishes it.**

**2 passed, desktop and tablet, first run.**

## The route, in three steps

1. a **table number** in `.pos-cart-table-input` — the kitchen-dispatch button is gated on it
   (`CartActionBar.tsx:210`), and the dispatch is what sets `activeOpenBillId`
   (`PosScreen.tsx:1160`). This was the step round 277's incomplete spec was missing.
2. **send to kitchen**, which holds the cart — and the held cart's id is read back from
   `localStorage`, because that id is the join key the lease's `tabId` must match.
3. **dispatch `kasirmu:tabs:lease-acquired`** with a `terminalId` that is not ours.

Step 2's read-back matters: **a lease against an invented id would fire the event while exercising no
branch.** The spec asserts the holding first, so it cannot pass vacuously.

## Two kills, both controls

| Mutation | Result |
|---|---|
| `getConflict`'s terminal check removed | **1 failed** |
| `forceTakeover` made inert | **1 failed** |

So the case binds on **both** controls, not just the alert's presence. Restored to HEAD after each,
byte-identical.

The second kill is what proves Take Over does something: the alert holds while the lease belongs to
another terminal, and clears once this terminal claims it.

## Verified

| Item | Result |
|---|---|
| New spec | 2 passed (desktop + tablet) |
| Kill-test, the guard | 1 failed |
| Kill-test, the takeover | 1 failed |
| `useTabLeases.ts` | restored, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,716 passed |

## Coverage, and where the screen now stands

```
CartPanel      9/10    9/10     1    0
```

**`none 0` — nothing on the cart panel is unasserted anywhere.** The tenth id is `pos-cart-kds-btn`,
which round 262 double-classified as feature-gated AND workspace-gated.

## The seventh surface, closed

CartPanel's behavioural coverage is now complete: tab banner and New Tab, the held-tab badge, the
resize handle, the deduction badge by relocation (243, verified 274), the price override that starts
that cart scope (243), and the conflict pair that four rounds said was blocked.

## What the four rounds of "blocked" actually cost

The blocker was re-verified in 258 and re-asserted in 262 and 263, each time by reading the guard and
stopping. **A guard expresses a precondition, not an impossibility** — and the guard's precondition
was satisfied by construction, because a spec chooses the other terminal's id.

| Blocker | Seam | Round |
|---|---|---|
| a memo stack of 3 bubbles | `?memos=3` | 255 |
| an empty floor plan | `?plan=empty` | 267-268 |
| a second terminal leasing a tab | `kasirmu:tabs:lease-acquired` | 277, **278** |

**All three were "needs another X", and all three were one dispatch away.** The session's method
had a standing rule against this shape — prove the guarded state is reachable before pinning a
guard — and it had been applied to every control on this screen except the one the summary had
already explained away.

> last audited 15-10-26 by docs-auditor