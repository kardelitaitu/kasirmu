# Gift card redemption: the ledger is finished, the TENDER VOCABULARY is not

> **CORRECTED 2026-10-25 (round 160), same day it was filed.** The first version of this file
> said the backend was complete and only the UI wiring was missing. A follow-up audit found
> that understated it twice: the `payments.method` CHECK is a CLOSED vocabulary with no gift
> member, so a gift tender cannot even be RECORDED without a migration; and the RBAC preset
> for the checkout role does not carry `giftcards:redeem`. Both are verified below, with the
> exact lines. The `saleId` mismatch this file already described is real and remains the
> smaller half of the problem.

**Measured 2026-10-25 (round 160) at HEAD `f4177215d`.** Supersedes the round-158 subagent's
recommendation to "compose as a tender panel in sales/PaymentModal.tsx", which is not possible
as stated.

## The backend is complete on BOTH shells

```
$ grep -n 'gift_card' apps/desktop-tauri/src/lib.rs
1789: commands::gift_cards::issue_gift_card_scoped,
1790: commands::gift_cards::get_gift_card_scoped,
1791: commands::gift_cards::list_gift_cards_scoped,
1792: commands::gift_cards::get_gift_card_balance_scoped,
1793: commands::gift_cards::redeem_gift_card_scoped,
1794: commands::gift_cards::top_up_gift_card_scoped,
1795: commands::gift_cards::freeze_gift_card_scoped,
1796: commands::gift_cards::unfreeze_gift_card_scoped,

$ grep -n 'gift_card' apps/mobile-tauri/src/lib.rs
1275-1282: the same eight, including redeem_gift_card_scoped.
```

`Store::redeem_gift_card` (`crates/kasirmu-core/src/db/gift_cards.rs:333`) is implemented with
an idempotency check on `(card_id, sale_id)` and a PA-01 atomic conditional UPDATE. Nothing is
missing in Rust. So this is a UI job -- but not the job round 158 described.

## THE TWO BLOCKERS THIS FILE ORIGINALLY MISSED (verified 2026-10-25)

### 1. `payments.method` is a closed CHECK with no gift member

```
crates/kasirmu-core/migrations/20261017_payments_method_check.sql:41-45
    method TEXT NOT NULL CHECK (method IN (
        'cash', 'card', 'card_debit', 'card_credit',
        'qris_manual', 'qris', 'bank_transfer', 'ewallet',
        'open_bill', 'credit', 'pay_later', 'other'
    )),
```

**WHICH FILE OWNS THIS LIST, added round 222.** The snippet above is from `20261017`, but that
migration is not the live definition: `20261018_gateway_status_adr64_vocabulary.sql:56-60`
REBUILDS the `payments` table with an identical method list, so 20261018 is the one a new
migration must follow. A round-217 probe added `'gift'` to `20261017` and the guarding test
stayed GREEN — the mutation had touched a superseded file. The current guard is the `gift` arm
of `payments_method_check_and_gateway_status_constraints_enforced`
(`crates/kasirmu-core/src/migrations_tests.rs`), which covers four spellings and reddens when
20261018 is widened. The latest migration in the tree is `20261029_...`, so a new one would be
`20261030_*`, and `scripts/generate-pg-migration.py` must be re-run after it.

Twelve methods, no gift. `ui/src/api/types/payment.ts:8-20` mirrors it as a `PaymentMethod` union,
and `PaymentModal.tsx:76` is a `Record<PaymentMethod, string>` of message ids -- so widening the
union is a compile error until the id is mapped, which is the good half: tsc will not let a gift
tender exist in the UI alone. But the SQL is the authority, and without it a gift `payments` row
raises a CHECK violation that ROLLS BACK THE WHOLE CHECKOUT TRANSACTION -- the failure mode
already documented at ui/src/api/types/payment.ts:30-43 for `gateway_status`.

A migration is an owner decision under AGENTS.md, so this file stops there.

### 2. The checkout role cannot redeem

`redeem_gift_card_scoped` enforces `giftcards:redeem`
(crates/kasirmu-bridge/src/gift_cards.rs:135, constant at platform/core/src/rbac.rs:608).

**CORRECTED 2026-10-25 (round 222).** The sentence here said the key is "granted to
OWNER/MANAGER/ADMIN (rbac_presets.rs:419)". It is not, and `:419` is not a preset: it is a line
in `ALL_ENFORCED`, the constant inventory, and it sits between `:327` (Custom, `permissions:
&[]`) and `:340`. Measured: `ROLE_PRESETS` contains ZERO occurrences of the gift-card family
across all six presets, so the key is granted to NOBODY by default — redemption is reachable
only through a Custom role an owner builds by hand. The difference matters for this plan's
cost estimate: "add a key to one preset" and "this whole feature ships dark until someone
hand-builds a role" are not the same decision. `no_builtin_preset_grants_a_giftcard_key`
(`permission_registry_tests.rs`) now pins the measured state and reddens if any preset gains it.
A cashier tapping a gift tender would get PermissionDenied even after every other piece landed.

### 3. The checkout path has no gift concept at all

`complete_sale_deduction_core` (db/sales_checkout.rs:280) and
`complete_sale_with_resolved_shortfalls` (db/sales_lifecycle.rs:183) contain ZERO gift-card
references, and `ui/src/features/sales/` has zero gift references. The gift card is a standalone
ledger sidecar that no tender input reaches. The loyalty path is the precedent for post-sale
accounting (PaymentModal.tsx:1186-1211) -- but it cannot be copied directly, because a gift
amount must REDUCE WHAT THE CUSTOMER PAYS, not merely record a discount afterwards.

### What is genuinely done

`Store::redeem_gift_card` (db/gift_cards.rs:333-511) is complete and careful: positive-amount,
unknown-card, non-active, expiry and insufficient-balance guards; `(card_id, sale_id)`
idempotency backstopped by the partial unique index `uq_gift_card_redeem_sale`
(migrations/20260901_gift_card_redeem_idempotency.sql:8-10); and an atomic conditional
`UPDATE ... WHERE current_balance_minor >= ?1` inside a transaction (PA-01, no lost update).
The domain is not the gap.

## Why it cannot be a pre-sale tender

`redeem_gift_card` **requires a `sale_id`** (gift_cards.rs:337). `GiftCardPayment` is written
as a checkout tender: its `handleApply` (GiftCardPayment.tsx:75-99) redeems at
`:87` and then calls `onApplied` / `onComplete`. That is coherent only if a sale already
exists.

`PaymentModal` does not have one. It obtains `saleResult.saleId` **after**
`completeSaleScoped` (PaymentModal.tsx:969), and only then reads the sale back (`:1025`).
At the moment a cashier would tap "Pay with gift card", there is no sale row to redeem
against.

So the component's own contract and the modal's lifecycle disagree. Two ways to reconcile,
and they are different products:

1. **Post-completion redemption.** Complete the sale, then redeem the card against the real
   `saleId` in the same post-checkout block that publishes course-fired events and creates
   the KDS order (PaymentModal.tsx:819-844). Requires deciding what happens if the
   redemption then fails: the sale is already committed and paid for, so this is a
   reconciliation problem, not a checkout guard.
2. **Pre-authorise, then settle.** Hold the amount at tender time and redeem on completion.
   This needs a reserve/void pair on the backend; `redeem_gift_card` has no hold semantics
   today, so this IS backend work.

Option 1 is smaller but has a failure mode at the worst moment; option 2 is correct but
unbuilt. Choosing between them is a money-flow ruling, not a mounting decision.

## RULED 2026-10-25 (round 202): option 1, and the ruling is already shipped — for LOYALTY

**The precedent exists, on this screen, and it settled the identical question.** `PaymentModal`
redeems loyalty points AFTER `completeSaleScoped`, in the post-checkout block that publishes
course-fired events and creates the KDS order — the exact slot option 1 names. Two call sites:
`PaymentModal.tsx:1190` (direct checkout) and `:1834` (the shared QRIS/gateway tail), both
reading `saleResult.saleId` obtained at :969 after the sale commits. `redeem_loyalty_points_scoped`
has the same `saleId` requirement this plan called a blocker
(`crates/kasirmu-bridge/src/loyalty.rs:148-156`), so the modal's lifecycle ALREADY solved it.

What the loyalty path also shows is how option 1's failure mode is handled, and it is not a
reconciliation problem so much as a visible one: the redemption is inside a try/catch that
leaves the sale intact and adds a WARNING toast — `payment-toast-loyalty-redeem-failed`,
"loyalty points were NOT deducted" (:1206-1209 and :1849-1852). The customer keeps the discount
and the points stay in the account, which the toast tells the cashier to settle by hand. That is
the honest version of option 1, and round 180's finding that the gateway copy of that catch had an
EMPTY body ("non-blocking") is the proof that the toast is the part worth getting right:
`PaymentModalSaleFlow.test.tsx` drives both paths with the redemption REJECTED and asserts the
toast appears, plus `redeemAttempted` so the case cannot pass on a redemption that never ran.

So a gift-card redemption would be option 1, in the same block, with the same toast discipline —
and it would also inherit the RBAC question the plan already answered in the other direction:
`LOYALTY_REDEEM` IS in the STAFF preset (`rbac_presets.rs:184`, with `RECEIVABLES_VIEW`/`COLLECT`
at :197-198 for the same reason), while `GIFTCARDS_REDEEM` is granted only to MANAGER/ADMIN/OWNER
(`:419`). A cashier may take money in against a customer's debt or points and may not touch a
gift card — that asymmetry is a real decision and it is already recorded.

**What is still blocked is unchanged and smaller than it was:** the `payments.method` CHECK
(no gift member), and the absence of a gift arm in `complete_sale_deduction_core`. Those two are
what make option 1 unbuilt, and neither is settled by the loyalty precedent — the loyalty
discount is a DISCOUNT, which the payment vocabulary already carries, while a gift amount
REDUCES WHAT THE CUSTOMER PAYS. **The plan's remaining ask is now exactly one migration plus one
settlement decision, and the shape to copy is :1190 with its toast.**

## What is NOT the blocker

Not the IPC (registered twice over), not the component (170 lines, i18n-clean, with explicit
hot-swap reasoning in its dependency comments), and not the gift-card feature generally --
issue/top-up/freeze all work and the gift-cards screen is registered. Only REDEMPTION lacks
a path.

## Filed by

The round-160 lane. No production file edited for this item.
