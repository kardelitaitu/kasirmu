# New Tab kept the old tab's discounts — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 99 · status: 1 defect fixed ·
     branch: 0.0.41 · commit: `e22fe58e6` · plus a VALIDATED i18n sweep that found nothing -->

<!- - Scope: the New Tab reset path, reached by following the `requiredLocalized` thread
     flagged in round 98. Tree verified green at 811/811 (12,881 passed) going in. -->

## The defect

`CartPanel`'s New Tab button (`:768-776`) cleared the tab id, released the lease, and
reset the table and customer — **but not the promotions**.

Promotions are not cosmetic here. They ride to checkout as `promotionIds`
(`PosScreen.tsx:2210`) and pre-select in the promotions modal (`:2249`). So an operator
who ended a discounted tab with New Tab carried **that tab's discounts into the next
sale** — with an empty cart and no banner, nothing on screen invited a second look.

**The sibling reset is the reference, and it always cleared them:** the hold path in
`usePosHeldCarts` (`:302-307`) calls `setAppliedPromotions([])` beside exactly these
fields. New Tab is the same reset with one line missing.

**Why it survived:** there was **no test for New Tab at all** — a grep for
`pos-cart-new-tab-btn|New Tab` across `ui/src/__tests__` returned zero. The escape hatch
from a tab was the one control in that panel nobody had pinned.

Fixed by calling `setAppliedPromotions([])` — already a `CartPanelProps` member (:290),
so the fix is one line, not a new prop.

## A test that had to be corrected before it could be trusted

The first draft of the case invented an `onResetPromotions` prop name. It failed before
the fix (correctly, by luck) and **would have kept failing after it**, because the handler
never had such a prop to call. Rewritten against the real `setAppliedPromotions`, it now
fails only for the actual reason and passes once the line is added. Recorded because a
test that fails for the wrong reason is indistinguishable from one that fails for the
right reason until you check what it is asserting against.

## The i18n sweep: two wrong domains, then a validated clean result

Round 98 left a lead — `requiredLocalized` returns the RAW ID when a key is missing, so
any unresolvable key renders its own name to the operator. This round swept the 21
template-literal `l10n.getString(\`...\`)` sites the parity gate declares unresolvable.

**The first sweep reported 17 missing keys and was worthless.** I had guessed the value
domains — `sales-report-sales/items/tax/payment` — and the real union is
`'daily' | 'weekly' | 'monthly'` (`SalesReportScreen.tsx:61`). Every "missing" was my
invention.

**The second sweep was validated before it was believed:** it must first resolve three keys
known to exist, then use domains read from source (`GRANULARITIES`,
`type ViewMode`, the `stock-transfers-status-` family). Result:

- every dynamic family resolves in **both** bundles;
- **zero EN-only keys** across all nine families checked;
- `gift-cards-status-` carries `active/redeemed/expired/frozen` — my guessed
  `cancelled/void` were never part of the domain.

The blind spot is clean. Stated with its detector's validation, because two rounds running
the detector — not the code — was what needed fixing.

## Verification

- **Full suite: 811/811 files, 12,882 passed, 0 failed** (3 skipped, 3 todo).
- The new case fails pre-fix (`expected "vi.fn()" to be called with arguments: [ [] ]`,
  0 calls) and passes after; **kill test:** removing `setAppliedPromotions([])` fails
  exactly that case.
- `npm run typecheck` 0 errors; `npm run lint` 0 errors; `npm run lint:i18n` clean
  including bundle parity.

## Standing rule

> When a reset clears "most of" a feature's state, the remainder is the defect. Compare
> every reset against its siblings rather than reading one in isolation — here the hold
> path named the full field set, and New Tab was one line short of it. An untested escape
> hatch is where that difference hides.

> last audited 18-10-26 by autonomous-goal-round-99
