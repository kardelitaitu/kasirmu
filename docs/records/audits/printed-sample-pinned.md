# The printed receipt sample is pinned, and its tax mode documented (round 135)

## What was unasserted

Round 134 established that the on-screen preview and the Test Print payload price tax with
opposite conventions, and that this is correct — two configured modes, not drift. It also noted
the payload's figures were never asserted.

Both parts are now fixed.

**`RestaurantReceiptsScreen.tsx` gains the comment round 134 said was needed** — above the
payload, naming the mode it demonstrates and pointing at the Rust tests that establish it
(`sales_tests.rs:1161` exclusive, `:1284` inclusive), at the real receipt's read-back
(`completedSale.ts:154-161`), and at the preview's own convention in `receiptLogic.ts`. The
avoidable failure this removes: a reader comparing the two samples and "fixing" one to match
the other, which would have deleted a legitimate mode from the surface that demonstrates it.

## The new guard

`RestaurantReceiptsScreen.test.tsx` :: *prints a receipt sample whose items sum to its
subtotal, priced EXCLUSIVE tax*.

Two properties, both kill-tested:

| Mutation | Result |
|---|---|
| drift `subtotal` to `31000`, leave items at `25000 + 5000` | **fails** — *expected 30000 to be 31000* |
| recompute tax inclusive-style (`30000 - 30000*100/110`) | **fails** |

The first is the arithmetic drift: nothing else in the suite checks that the sample adds up,
and a silent mismatch would print a receipt that does not sum. The second pins the convention,
so an edit that switches the mode has to be a decision rather than an accident.

## Why the first run passing was not reassuring

The case passed immediately, which is the signature of a guard that asserts what the code
already does and cannot fail. Both kill-tests were run before treating it as coverage — and
both failed as intended, so the assertions do bind to behaviour.

This is the same discipline the goal has required all along (round 91: *"a kill-test passed"*
was actually the bug being intermittent), and it is worth repeating on any guard that goes
green on its first run.

## What is still unasserted, stated rather than implied

The guard checks the payload's ARITHMETIC, not what the printer receives: `printSalesReceipt` is
still mocked, so the receipt number, the two item names, the `pedas` note gate and the
`tableNumber` gate remain unchecked. Those are shape rather than arithmetic, and pinning every
field would make the case a transcript. The lines that matter for a wrong figure are pinned;
the rest is recorded here as deliberately not.

## Verified

| Gate | Result |
|---|---|
| New case | green on first run; both kill-tests fail |
| Full suite | 12,665 passed, 0 failed |
| `tsc` / `eslint` | 0 / 0 |
| Commit | `f5e1eddc0`, 2 files, +51 |