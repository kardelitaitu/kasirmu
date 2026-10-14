# Three sweeps, three clean results: the restaurant controls are well-gated (round 167)

Round 166 closed the silent-save class by proving no fourth instance existed. This round ran
three more mechanical sweeps for a similar systemic property, and each came back clean. The
negative results are the deliverable, so they are recorded rather than merely acted on.

## Sweep 1 — `aria-disabled` with no blocking

`aria-disabled` is advisory: it does not stop a click, so a control that sets it without
guarding its handler is a silent no-op waiting to happen. The restaurant feature has exactly
one — `MenuItemTile.tsx:223`, `aria-disabled={!product.inStock}` for the 86'd tile.

It is guarded, and better than the silent-save pattern would have been. `MenuItemTile.tsx:279-283`
renders a **`role="status"` live region** announcing the refusal
(`restaurant-card-unavailable-tap`), and the comment at `:276-278` says why: *"aria-disabled, and
a silent no-op is the one outcome a cashier cannot diagnose."* Round 150 verified the unit suite
kills on it — removing the availability guard fails four cases.

## Sweep 2 — disabled controls with no explanation

Fifteen `disabled={…}` in the restaurant feature. Fourteen are transient (`saving`,
`bulkUpdating`, `testingEdc`) where the reason is self-evident from the button's own state.

The one that needs a reason is `RestaurantReceiptsScreen.tsx:2837` — the kitchen-printer
connection, `disabled={!hasKdsFeature}` — and it has one: a visible `Pro Plan or KDS Required`
badge at `:2820` and an explanatory paragraph at `:2826-2831`, immediately above the control.
A regex looking for `title=`/`aria-label=` misses both because they are sibling elements, so the
sweep's heuristic was weaker than the code it was measuring.

## Sweep 3 — the 14 flat `resto_rcpt_*` keys, and a suspected cross-store leak

This one looked like a real finding. `RestaurantReceiptsScreen.tsx` uses **14 flat, un-scoped
localStorage keys** (`resto_rcpt_header_title`, `..._tax_rate`, ...) — the same class round 104
(F44) fixed for the POS cart. The screen is store-shared and has **no store scoping**
(`useWorkspace()` is read for `sessionToken` only), reading them at `:295` and writing at `:421`.
So store A's configured receipt header would appear in store B on the same device.

**Checked before claiming it, and it did not hold as a defect.**

* the keys are pinned in `storageKeyPins.test.ts`, so a rename must be a deliberate edit;
* `receiptPreviewPrintAgreement.test.ts:87` records that *every `resto_rcpt_*` value is a UI-only
  preference*, and that audit covers a different axis (preview vs printer);
* `RestaurantReceiptsScreen.test.tsx:742-756` seeds them and its `finally` clears them.

So the scoping question is real but unrecorded — a **design decision waiting to be made**, with
a live risk: a store with two terminals would share receipt headers. **Not changed this round**:
the fix is a scoped-key derivation across 28 call sites plus a migration of existing values,
which is the kind of change that should be a deliberate slice rather than something landed from
a sweep.

## Conclusion

Three sweeps, no defect found. The restaurant controls are gated more carefully than the
silent-save class was, and the one weakness — the unscoped receipt keys — is a design question
that already has guards on it.

## Verified

| Sweep | Result |
|---|---|
| `aria-disabled` without a guard | 1 instance, guarded, announced, kill-tested in round 150 |
| disabled without a reason | 15 gates, all transient or explained by siblings |
| flat `resto_rcpt_*` keys | 14 keys, pinned, test-cleaned, scoping decision open |
| Tree | no source changed this round |