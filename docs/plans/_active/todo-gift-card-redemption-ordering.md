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

Twelve methods, no gift. `ui/src/api/types/payment.ts:8-20` mirrors it as a `PaymentMethod` union,
and `PaymentModal.tsx:76` is a `Record<PaymentMethod, string>` of message ids -- so widening the
union is a compile error until the id is mapped, which is the good half: tsc will not let a gift
tender exist in the UI alone. But the SQL is the authority, and without it a gift `payments` row
raises a CHECK violation that ROLLS BACK THE WHOLE CHECKOUT TRANSACTION -- the failure mode
already documented at ui/src/api/types/payment.ts:30-43 for `gateway_status`.

A migration is an owner decision under AGENTS.md, so this file stops there.

### 2. The checkout role cannot redeem

`redeem_gift_card_scoped` enforces `giftcards:redeem`
(crates/kasirmu-bridge/src/gift_cards.rs:135, constant at platform/core/src/rbac.rs:608). It is
granted to OWNER/MANAGER/ADMIN (rbac_presets.rs:419) and NOT to the staff/checkout preset
(:167-200). A cashier tapping a gift tender would get PermissionDenied even after every other
piece landed.

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

## What is NOT the blocker

Not the IPC (registered twice over), not the component (170 lines, i18n-clean, with explicit
hot-swap reasoning in its dependency comments), and not the gift-card feature generally --
issue/top-up/freeze all work and the gift-cards screen is registered. Only REDEMPTION lacks
a path.

## Filed by

The round-160 lane. No production file edited for this item.
