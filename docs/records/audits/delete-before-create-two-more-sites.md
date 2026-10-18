# The same delete-before-create reached two more sites, both on the hottest path (round 293)

## Round 292 named the next step, and this round took it

Round 292 fixed `TableManagementScreen.handleMoveTable` and `handleMergeTable`, and closed with:

> The same DELETE-then-CREATE shape should be searched for repo-wide rather than assumed
> limited to these two handlers.

The search found **three more sites**, all writing the same `held_cart` entity, and two of them
are on the restaurant POS's busiest code path.

## What the sweep covered

Every `await delete*` in `ui/src/features` (31 across 23 files), then filtered to the ones that
delete a *held cart* — because that is the write with no undo. The full set of held-cart write
sequences is small and was read in full:

| Site | Order found | Verdict |
|---|---|---|
| `TableManagementScreen.handleConfirmMoveTable` | hold -> delete | fixed in round 292 |
| `TableManagementScreen.handleConfirmMergeTable` | hold -> delete | fixed in round 292 |
| `TableManagementScreen` reservation path | hold -> delete | already safe |
| **`PosScreen.handleConfirmSplitBill`** | **delete -> hold** | **fixed here** |
| **`PosScreen.handleSendToKitchen`** | **delete -> hold** | **fixed here** |
| `usePosHeldCarts` (tab save) | delete -> hold, deliberately | see below |
| `RetailPosScreen.handleHold` | hold only | safe |
| `RetailPosScreen` corrupt-cart cleanup | delete only | safe |

### Why `usePosHeldCarts` is NOT the same bug

It also deletes first, and its comment says why that is deliberate: the delete is what prevents a
duplicate tab, and a rejected delete is fatal to the operation (it throws before the hold runs).
That protects against duplicates. It does NOT protect against a rejected *hold*, which still
leaves the tab deleted — but changing it is a product decision about which failure mode to
prefer on the primary save path, not a mechanical reorder, so **it is reported and left alone**.

## The two PosScreen sites, and why they are worse than round 292's

Both ran:

```tsx
if (activeOpenBillId) {
  await deleteHeldCartScoped(sessionToken, activeOpenBillId);   // tab destroyed
}
await holdCartScoped(sessionToken, { ... });                     // replacement
```

**`handleConfirmSplitBill`** — the catch toasts, and then execution CONTINUES to
`setShowPayment(true)`. So the sale proceeds to payment with the remaining lines destroyed: the
operator takes money for a tab that no longer exists.

**`handleSendToKitchen`** — this runs AFTER the kitchen has been told to cook (the dispatch
precedes the write). A rejected hold therefore left food being prepared for an order whose record
was gone. The `if (activeOpenBillId)` guard means this fires on **every update to an existing
tab**, so it is the most-travelled of the four sites.

Both now create first. `git diff` shows only the reorder plus its comments — 21 insertions, 7
deletions in one file.

## The guard, and the assertion that had to be structural

The two PosScreen handlers cannot be reached from a unit test without the whole POS screen, a
shift, a populated cart AND a satisfied button gate — `CartActionBar.tsx:210` requires
`(tableNumber || activeOpenBillId) && hasUndispatchedItems`. I tried three times to drive it
behaviourally and each attempt failed for a different gate, so I reverted the attempt rather than
leave a half-working case.

The repo already has the answer for exactly this: `posDispatchRecord.test.ts`'s header says it
pins its invariant at the source layer *"because the component body is not reachable from a unit
test without the whole POS screen"*. `heldCartReplacementOrder.test.ts` follows that precedent,
and covers **all four** sites uniformly so a fifth cannot be added wrong.

The assertion is on RELATIVE ORDER — `holdAt < deleteAt` within one sliced handler — not on
presence. A guard that merely looked for the delete would be satisfied by the buggy order.

## Kill-tested three ways, and one of them exposed a weak guard

| Injection | Result |
|---|---|
| `PosScreen` send-to-kitchen restored to delete-first | **1 failed**, the other 3 sites still pass |
| `TableManagementScreen` move restored to delete-first | **2 failed** — the ordering case AND the denominator |
| A `REPLACERS` entry deleted outright | **first version PASSED (4 tests) — the guard was weak** |

**That third row is the finding about the guard itself.** The first denominator compared
`REPLACERS.length` against a count of call sites, which passes when an entry is removed while its
call site remains — precisely the "satisfiable by not listing it" failure the comment claimed to
prevent. It now also asserts that every entry yields a non-empty handler body, so removing an
entry fails immediately. Re-kill-tested: **1 failed**, as intended.

This is the round-229/230 lesson at the level of the test rather than the code: a guard is
unproven until it has been shown to fail against the thing it claims to catch, and the failure
has to be induced for EACH mechanism, not just the first.

## Verified

| Item | Result |
|---|---|
| New ordering guard | **5 passed** |
| Kill-test: PosScreen site reverted | **1 failed**, then restored |
| Kill-test: table site reverted | **2 failed**, then restored |
| Kill-test: disabled entry | 1st version **passed (weak)**; fixed, then **1 failed** |
| `TableManagementScreen` suite | **61 passed** |
| Restaurant/POS suites by filter | **968 passed, 66 files, 0 failed** |
| eslint on both test files | 0 |
| `npm run typecheck` | **exit 0** |
| `PosScreen.tsx` | committed clean — `ee8b8e23e` |
| `TableManagementScreen.tsx` | **still NOT committed** — carries another session's hunk |

## ⚠️ The mixed file, unchanged from round 292

`TableManagementScreen.tsx` still carries an unrelated hunk adding `created_at: ''` /
`updated_at: ''` at `:410-411` that is not mine. Round 292 reported this rather than sweeping it
into a pathspec commit, and the same holds: **the round-292 fix in that file is verified but
still uncommitted.** The test that covers it IS committed (`ac783c291`).

`PosScreen.tsx` was checked the same way before committing and is clean, so its fix landed.

## Where this leaves the surface

Every place the restaurant POS replaces a held cart now creates before it deletes, except the
one in `usePosHeldCarts` where the order is a deliberate trade recorded in the source. The four
fixed sites are graded by one guard that fails if any of them is reordered back, or if a fifth is
added without being listed.

## Next

The same question applied to the OTHER irreversible write in these files — `releaseTableScoped`,
which frees a table and is called after the hold in both fixed handlers. A rejected release leaves
the bill on the new table and the old table still occupied, which is recoverable; the ordering
was checked here and is already the safe direction. No further work identified on this class.

> last audited 15-10-26 by docs-auditor
