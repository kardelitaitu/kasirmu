# A guard whose result nobody read — and the key that was never written — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 98 · status: 3 call sites fixed,
     1 missing bundle key found · branch: 0.0.41 · commit: `a6096a820` -->

<!- - Scope: the standing rule round 97 recorded — "a guard is finished when every caller
     has been re-read for what its new return value means" — applied as a sweep across
     every function this session's changes touched. Tree verified green at 811/811
     (12,878 passed) going in. -->

## The sweep, and what it was for

Round 97 ended by recommending exactly this: audit whether any guard added earlier in the
session returns a value that a caller ignores. The sweep found **four** boolean-returning
functions in the touched files. One was mine (round 97's resume, already awaited). The other
three were pre-existing and **all three had their result discarded by every caller**.

## The three price-write sites

`usePosState.updateLinePrice` and `updateLineModifiers` both return `false` and write
nothing when the price's currency differs from the cart's anchor. Neither had a test — so
their `false` was never a thing a caller could be caught ignoring — and every call site
ignored it:

| Call site | Consequence of ignoring `false` |
|---|---|
| `PosScreen.handleConfirmEditModifiers` :1642 | **The modal closes.** A refused edit dismisses the dialog, which reads to the cashier as "saved". |
| `usePosCartActions.handleOverrideConfirm` :235 | The server has ALREADY accepted the override, so the recorded sale and the watched total now disagree. |
| `RetailPosScreen` :1293 | Same, plus its catch passed a hardcoded English fallback. |

The middle one is the worst of the three for a reason worth stating: the failure is not
"nothing happened". The backend took the money at the new price and the preview kept the
old one, so the operator is working from a total that no longer matches the sale.

**Fixed** by reading the result at all three, reporting it, and — for the modifier case —
leaving the modal open so the operator can correct it instead of being told it worked.

## The reachable state, pinned rather than asserted

Two of those guards had no test at all, which is *why* their return value went unread. The
tests added in `usePosState.test.ts` do not just check that `false` comes back; one builds
the state that reaches it — a cart holding a line whose currency differs from
`lines[0]` — and confirms the mixed cart actually forms.

That state is reachable: the restore paths fill `setLines` from a persisted payload with no
currency check (`usePosHeldCarts` :426 `unit_price: l.unit_price`, and the sibling in
`PosScreen` :229). A guard tested only against a state it cannot reach is theatre, so the
test constructs the reachable one.

## The gate found a string that does not exist

Fixing the retail site exposed something better than the original defect. That call site's
catch used `plainErrorMessage(err, 'Override failed')` — a hardcoded English literal, the
anti-pattern this campaign has recorded repeatedly. Replacing it with
`requiredLocalized(l10n, 'retail-toast-override-failed')` and running `npm run lint:i18n`
produced:

```
missing in BOTH en .ftl AND id .id.ftl (1 unique):
  [ui/src/features/retail/RetailPosScreen.tsx:1310] retail-toast-override-failed
```

**The key exists in no bundle.** `requiredLocalized` returns the RAW ID when a string is
missing (:21-23) — so the retail price-override failure path had been showing operators the
literal text `retail-toast-override-failed` in an error toast on a money path. It was only
visible because replacing the English literal with the correct localized call made the gate
able to see it.

Both strings (`retail-toast-override-failed` and the new
`pos-toast-line-price-currency-mismatch`) are now in `sales.ftl` and `sales.id.ftl`, and
`verify-bundle-parity` is clean — it also confirms no other caller is sitting on a missing
key.

## Verification

- **Full suite: 811/811 files, 12,881 passed, 0 failed** (3 skipped, 3 todo).
- The three new `usePosState` cases pass — the guards were already correct, which is the
  point: the defect was the callers, and the tests now make a future silent discard fail.
- `npm run typecheck` 0 errors; `npm run lint` 0 errors; `npm run lint:i18n` clean
  including bundle parity.

## Standing rule

> The hardest return value to notice is one every caller discards. A guard is only real
> once a test pins its `false` AND every call site reads it — and the second half is
> invisible to the first half's test suite, which is why it has to be swept.

> last audited 18-10-26 by autonomous-goal-round-98
