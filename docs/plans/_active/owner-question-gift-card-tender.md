# Owner question — gift card redemption: three questions that block the last third

> **RESOLVED 2026-11-07 — all three questions answered and shipped.**
> - **Q1:** Option A (gift split covers total). Rebuild migration `20261107_payments_gift_card_method.sql`
>   widens `payments.method` CHECK to include `'gift_card'`, re-creates both indexes, and updates `init.pg.sql`.
> - **Q2:** Option B (post-commit redemption with warning toast on failure, matching loyalty precedent)
>   wired in `ui/src/features/sales/PaymentModal.tsx`.
> - **Q3:** Option A (grant `GIFTCARDS_REDEEM` to checkout roles: `STAFF`, `MANAGER`, `ADMIN`) in
>   `platform/core/src/rbac_presets.rs`.
> - **Mount:** `GiftCardPayment.tsx` mounted in `PaymentModal.tsx` under `FEATURES.GIFT_CARDS`.

**Why this file exists.** `todo-gift-card-redemption-ordering.md` (241 lines) records the
gift-card tender as complete except for three parts that must be decided together. Those
questions are at the end of a long document; this file puts them where they can be answered
in one pass, in the shape `owner-question-2026-09-28-r4-r6-r7.md` established.

**What cannot be answered from the repo.** Each question below is a settlement or product
rule. A worker who picks one produces a migration and a money path the owner then has to
reject — the failure mode this file exists to prevent. Nothing is guessed here.

Measured state, 2026-10-26 (all four facts re-verified this round):

| Part | State |
|---|---|
| Ledger (`redeem_gift_card`, `gift_cards.rs:333`) | **complete**, with idempotency on `(card_id, sale_id)` |
| IPC on both shells | **registered**, 8 commands each |
| Tender panel `GiftCardPayment.tsx` | **complete**, 17 references — every one in its own test file; **nothing mounts it** |
| `payments.method` CHECK | **no gift member** (12 methods), live in `20261018:56-60` |
| `GIFTCARDS_REDEEM` in a preset | **no built-in preset grants it** — `rbac_presets.rs:419` is inside `ALL_ENFORCED`, not `ROLE_PRESETS` |

---

## Q1 — Does a gift split COVER the total, or REDUCE what the customer pays?

`validate_payment_splits_cover_total` (`crates/kasirmu-core/src/db/sales.rs:287-316`)
requires the splits to sum to `sale.total`, and `:309` is `if sum < total_minor`
with **no discount concept at all**. A gift tender is not a payment of new money, so it
fits neither side of that rule today.

- **A — covers.** Gift is a split like cash; the split sum still equals the total, and the
  gift leg reduces the card's balance. Simplest for the CHECK; every tender looks alike.
- **B — reduces.** Gift is applied against the total first, then the remaining balance is
  tendered. More truthful to the customer's receipt, and needs a new subtraction step in
  both checkout doors.

Recommended by the plan's own evidence: **A**, because the existing split machinery and
its tests already express it and B widens a money rule in two doors.

## Q2 — Is the redemption in-transaction against a pending sale, or post-commit with a toast?

`redeem_gift_card` opens its OWN transaction (`gift_cards.rs:424`), and the checkout door
writes the sale as `status=pending` (`sales_checkout.rs:778`) before committing (`:919`).

- **A — in-tx.** Extract a `_in_tx` core (`gift_cards.rs:421-485`, ~65 lines) and call it
  inside the sale transaction. The two commit or not at all — but it bakes in an
  irreversible balance deduction against a sale that is not yet final, and requires both
  checkout doors (`sales_checkout.rs:854-897`, `sales_lifecycle.rs:558-600`) to change
  together, which the code itself warns must move as one.
- **B — post-commit.** Redeem after the sale commits, in the same block that redeems
  loyalty points (`PaymentModal.tsx:1190`), with a warning toast on failure:
  `payment-toast-loyalty-redeem-failed` is the exact precedent — the customer keeps the
  goods, the balance is not deducted, and the cashier is told to settle by hand.

Recommended by precedent: **B**. The loyalty path on this same screen already solves the
identical `saleId` problem this way, and `PaymentModalSaleFlow.test.tsx` already drives it
with the redemption REJECTED and asserts the toast, so the test shape exists.

## Q3 — Does a built-in preset grant `giftcards:redeem`?

No preset does today. Without a grant the feature **ships dark**: the panel renders and
every redemption is refused.

- **A — add `GIFTCARDS_REDEEM` to STAFF.** Any cashier can redeem. Matches how
  `LOYALTY_REDEEM` is already granted at `rbac_presets.rs:184`.
- **B — leave it to MANAGER/ADMIN/OWNER.** Gift cards are bearer money; redeeming is
  closer to issuing than to taking payment.

The asymmetry is already real and recorded — a cashier may take money against a customer's
debt or redeem their points, and may not touch a gift card. Making that deliberate rather
than accidental is the whole of this question.

---

## What happens once these are answered

Change #1 (the migration alone) is **not** safe to do first. Widening the CHECK while Q1
and Q3 stay open turns `migrations_tests.rs:4107-4119` — which asserts all four gift
spellings are REFUSED — from a true guard into a test asserting a rule nobody has decided.
The migration is mechanical; the decision it encodes is not.

Order once answered: migration + registry + regenerated PG + that test rewrite → the
settlement arm per Q2 in both checkout doors → the RBAC grant per Q3 → mount
`GiftCardPayment.tsx` at `:1190`.

Note for whoever runs the migration: the live CHECK is in
`20261018_gateway_status_adr64_vocabulary.sql:56-60`, **not** `20261017`. A round-217 probe
widened the earlier file and its guard stayed green. The rebuild must copy all 12 columns,
keep both CHECKs, and **re-create both indexes** (`:91-92`) — `DROP TABLE` destroys them and
losing `idx_payments_idempotency_key` is a silent money-path defect.

> last audited 26-10-26 by docs-auditor
