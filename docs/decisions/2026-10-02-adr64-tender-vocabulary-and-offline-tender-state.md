---
num: 64
area: payments
title: "ADR-64: The Tender Vocabulary and the Offline Tender State — one classification per payment, and no electronic tender settles on trust"
status: Proposed (2026-10-02) — every decision below is TO BUILD; nothing in this record has landed
---

# ADR-64: The Tender Vocabulary and the Offline Tender State

**Status:** Proposed (2026-10-02) — every decision below is **TO BUILD**. The measurements in §1
were taken in this checkout on branch `0.0.41`; the decisions in §2 are not.
**Date:** 2026-10-02
**Recorded against:** branch `0.0.41`
**Scope of:** the draft formerly filed as `2026-10-02-adr64-global-kernel-and-region-pack.md`, now
demoted to `2026-10-02-global-kernel-and-region-pack-strategy.md` (a strategy note that decides
nothing). That draft's region-pack, tax-engine, residency and rollout material is **already
decided by ADR-59**, ADR-30 and ADR-48; this record keeps only the part no sibling record owns.
**Tags:** payments, offline-first, naming, schema, tender, rails

> Cite this record by filename, not by number (`docs/decisions/README.md`: numbering has
> collided before — #43 — and filename-plus-number is the only safe citation form).

## 1. Context

**1.1 There is no single payment-method vocabulary in the tree, and the four that exist disagree
with each other.** All four were read in this pass.

| Site | Declaration | Serialised as | Variants |
|---|---|---|---|
| `foundation/src/enums.rs:86-96` | `pub enum PaymentMethod` | **kebab-case** (`#[serde(rename_all = "kebab-case")]`, `:88`) | `Cash`, `Card`, `Other(String)` |
| `crates/kasirmu-payment/src/types.rs:16-27` | `pub enum PaymentMethod` (`#[non_exhaustive]`) | **PascalCase** (no `rename_all`) | `Cash`, `Card`, `Qr`, `Other(String)` |
| `ui/src/features/sales/PaymentModal.tsx:46` | `type PaymentMethod` | **snake_case** | `'cash'`, `'card'`, `'qris'`, `'other'`, `'open_bill'`, `'credit'` |
| `ui/src/features/sales/payment/SplitTenderRows.tsx:57` | `type SplitRowMethod` | **snake_case** | the same six, duplicated |
| `crates/kasirmu-core/migrations/20260813_init.sql:367` | `payments.method TEXT NOT NULL` | — | **free TEXT, no CHECK** |

Two Rust enums of the same name, one serialising `"cash"` and the other `"Cash"`, against a
TypeScript union that uses neither spelling for QR. **A tender name is a closed set nowhere**,
and the two TypeScript unions are byte-identical duplicates — a second place to edit.

**1.2 The method vocabulary is DECIDED and unimplemented.**
`docs/plans/_active/payment-methods-plan.md` §3 closes with eleven decided values: `cash`, `card`,
`card_debit`, `card_credit`, `qris_manual`, `qris`, `bank_transfer`, `ewallet`, `open_bill`,
`credit`, `pay_later`. Its §1.1 records the hardcoded UI array as fact #1 — re-measured today it
is **still hardcoded, still six values, and contains none of** `qris_manual`, `bank_transfer`,
`card_debit`, `card_credit`, `ewallet` or `pay_later`. The plan is the decision; this record does
not re-open it. It supplies the shape that makes it survive a second market (D1), which the plan's
flat list does not on its own.

**1.3 A tender has no state.** The lifecycle the draft proposed does not exist. What exists:

- `PaymentResult` is a **boolean plus optional strings** — `success: bool`, `transaction_id`,
  `auth_code`, `amount_charged`, `message` (`crates/kasirmu-payment/src/types.rs:55-69`). A QR
  *issued* and a QR *paid* are the same value of that boolean. `drivers/qris.rs:7` records the
  two-phase contract in prose ("success = QR issued") because the type cannot carry it.
- `payments.gateway_status TEXT` (`20260813_init.sql:371`) is **free TEXT with no CHECK**, and
  `settled_at` / `settled_by` / `gateway_reference` on the same row are written by nothing.
- The nearest thing to a state machine sits on the **error** path: `ErrorClass::Deferred`,
  documented as *"asynchronous / deferred state (e.g. QR issued, payment pending or awaiting
  external settlement)"* (`crates/kasirmu-payment/src/error.rs:21-22`). **A pending payment is
  currently modelled as an error**, which is why `execute_with_fallback` reads `Deferred` as a
  reason to try the next gateway (`registry.rs:151-157`).
- The house does write guarded statuses when it thinks to: `payment_settlements.status TEXT NOT
  NULL DEFAULT 'pending' CHECK (status IN ('pending', 'matched', 'discrepancy', 'reconciled'))`
  (`20260825_payment_infra.sql:33-34`). The per-settlement ledger has four guarded states; the
  per-payment row has none.

**1.4 Offline is the case the type cannot express, and one shipped decision contradicts the fix.**
kasir.mu is offline-first. `qris_manual` — a printed static QR confirmed by the cashier watching
their own phone — is the canonical offline electronic tender, and `payment-methods-plan.md` §1.3
specifies it as *"Record: method=qris_manual, settled immediately"*. **Settled at the moment of
recording, not the moment of confirmation.** Defensible for a printed static QR, whose money lands
in the merchant's QRIS account and is reconciled daily — but it is currently the *only* rule, so
every future rail inherits it, including rails where it is wrong. Nothing in the tree distinguishes
*received* from *believed*.

**1.5 Method, rail and gateway are three different things, and the tree already separates them.**
ADR-59 §2.3 places local payment rails as **data**: `local_payment_methods`
(`20260924_local_payment_methods.sql:40-52`) is a per-scope list of `rail_code`, `label`,
`is_enabled`, `parameters`, owned by legal entity with location overrides. Its header separates
it from the tier grant (`supports_qris`) and from gateway credentials (`payment_gateways`)
(:17-28). `PaymentProcessor` is the **code** seam
(`crates/kasirmu-payment/src/processor.rs:43`), with drivers for Stripe, Square and QRIS and one
Paddle stub.

## 2. Decision

**D1 — a payment carries a classification in two country-neutral closed sets plus a rail, and
separately a merchant-chosen label.** The eleven values in `payment-methods-plan.md` §3 are a list
of **market instances, not tender kinds**. A CHECK over that list would make every new market cost
a SQLite table rebuild — a per-market tax, which is the opposite of what this record is for. They
factor cleanly:

| Decided value | `method_kind` | `method_mode` | `rail_code` |
|---|---|---|---|
| `cash` | `cash` | `physical` | NULL |
| `card`, `card_debit`, `card_credit` | `card` | `online` | NULL — the EDC device, not a rail |
| `qris_manual` | `qr` | `manual` | `QRIS_STATIC` |
| `qris` | `qr` | `online` | `QRIS_DYNAMIC` |
| `ewallet` | `wallet` | `online` | market row |
| `bank_transfer` | `bank_transfer` | `manual` | NULL |
| `open_bill`, `pay_later` | `deferred` | `deferred` | NULL |

- `method_kind` — CHECK over **`cash | card | qr | wallet | bank_transfer | deferred | other`**
- `method_mode` — CHECK over **`physical | manual | online | deferred`**
- `rail_code TEXT NULL` — resolves to `local_payment_methods.rail_code`
  (`20260924_local_payment_methods.sql:45`)
- `method` **stays**, as the merchant's *label* for the tender: what the receipt prints, what the
  cashier saw. Free text by design — a label is not a classification.

**The property that justifies the split: a new market adds `local_payment_methods` rows, not a
migration.** A printed PIX QR is `kind=qr, mode=manual, rail=PIX_RECEBIDO`; a static UPI QR is
`kind=qr, mode=manual, rail=UPI_STATIC`; PromptPay is `kind=qr, mode=online, rail=PROMPTPAY`.
Neither CHECK changes. `method_kind='other'` is **not** the old escape hatch — it requires a
`rail_code` resolving to a configured market row, so "other" becomes a rail the merchant declared
rather than a string nothing validates.

**Migration shape.** Additive columns plus the rebuild (`CREATE TABLE …_new` / `INSERT … SELECT` /
`DROP` / `ALTER … RENAME`; precedent `20260928_document_kind_check.sql:31-55`), with
`migrations.rs` registry order updated. The backfill maps every existing row through the table
above; an unrecognised `method` becomes `kind='other', mode='manual', rail_code=NULL` **and is
logged**, because silently reclassifying historical money is the one failure this migration can
cause. `method` is retained so the backfill is lossless and nothing breaks on day one: reports
(`db/reports/sales_summary.rs`) and shift reconciliation that compare against `"cash"` keep
working until they move to `method_kind` deliberately. Measured, and it lowers the risk:
**no statement in `crates/kasirmu-core/migrations/` filters on `method`**.

**D2 — The Rust enums stop being vocabularies and become presentation types.** Neither
`foundation::PaymentMethod` nor `kasirmu_payment::PaymentMethod` is the system of record, and
neither serde spelling (`kebab-case`, `PascalCase`) survives the DB boundary. Each keeps its
current shape in this decision — widening either is a separate, larger change — and gains an
explicit doc statement of which of D1's kinds it can express (**`Card` alone**; neither can
express `qr` manual vs online, `card` debit vs credit, or `deferred`) and of the wire spelling it
produces. **A tender read out of the DB is D1's classification — `method_kind` + `method_mode` +
`rail_code` — not an enum decode; `method` is its label.** The duplicated TypeScript unions become
one shared type in the same change: two copies of a union about to grow from six values to eleven
is the failure mode, not a style choice.

**D3 — Method, rail and gateway stay three things, and the draft's `PaymentRail` trait is
declined.** A **method** is what the cashier records on a sale; a **rail** is what moves the money
(`local_payment_methods.rail_code`); a **gateway** is the counterparty (`payment_gateways.name`).
The draft's six-method trait is declined because four of its six already have named owners —
`refund` and `capture` by `PaymentProcessor` (`processor.rs:102`, `:73`), signature verification by
`WebhookVerifier` (`webhook.rs:36`), settlement reconciliation by `payment_settlements`
(`20260825_payment_infra.sql:24-37`) — and because `payment_methods()` on a rail is the category
error this record exists to stop. What survives is a **registry keyed by rail**, which
`PaymentProcessorRegistry` already is: `register_method_fallback(method, chain)` and
`execute_with_fallback` (`registry.rs:59-163`). The remaining work is **wiring** —
`build_from_config` is a PLANNED stub returning `Unsupported` for every gateway
(`registry.rs:171-178`) — not a new trait. **One collision this decision does not fix and a later
one must:** the registry's parameter is named `method` while the chain it holds is a *gateway*
fallback.

**D4 — A tender gains a state, and an electronic tender never settles on trust.**
`payments.gateway_status` becomes CHECK-constrained over:

```text
pending | authorized | confirmed | settled | failed | voided | refunded | disputed | unconfirmed
```

`unconfirmed` is the value the tree cannot express today and the reason this record exists: **the
cashier believes it happened and nothing has corroborated it.** The rules:

1. **`cash` is the only method that may be written `settled` at record time.**
2. Any other method written `settled` sets `settled_at`, and `settled_by` names the confirmer —
   a cashier, a supervisor PIN, or the literal `gateway`.
3. **`unconfirmed` is written, never inferred.** A sale completed with no connectivity on an
   electronic tender is `unconfirmed`, and the sale still completes: revenue recognised, drawer
   balanced, tender flagged.
4. `failed`, `voided` and `disputed` are terminal for that tender and never become `settled`; a
   correction is a **new** payment row against the same sale.

**This contradicts `payment-methods-plan.md` §1.3 for `qris_manual` as written, and the
contradiction is deliberate.** Under rule 3 a static-QR tender is `unconfirmed` until the cashier
taps confirm — a UI state, not a second payment. The plan's "settled immediately" is preserved for
the reconciliation report by D5's `confirmed` → `settled` promotion. **The plan is not edited by
this decision**; this record names the conflict so the next reader of either file sees it.

**§2.1 — Why this is the compliance anchor, not merely the offline rule.** The tender state machine
is the one place in the POS where an event has an unambiguous, ordered, persisted point of no
return, and a fiscal integrity chain (`previous_receipt_hash`) needs exactly that. **Where the
chain attaches is this record's to decide** — it attaches here, on the payment/sale state
transition, because a chain built on document *numbering* proves order without proving content.
`unconfirmed` is also the fact a regulator asks about first: a receipt issued for a payment nothing
corroborated. **The chain itself is neither built nor decided here** — ADR-65 owns whether it ships
and against which market, and ADR-59 §2.4's rule (do not build against an imagined market) still
binds.

**D5 — Reconciliation owns the `confirmed` → `settled` edge; its scheduler is not decided here.**
`payment_settlements` exists with four guarded states and `expected_minor` / `actual_minor`
(`20260825_payment_infra.sql:24-37`); a daily sweep against it is the natural promoter. **Who
schedules it** is owned by `docs/plans/_active/payment-resilience-design.md` §6, which already
lists the scheduler among the six things it does not decide (§9 item 2).

**D6 — Model A: software-only.** kasir.mu never holds a merchant's funds. Money goes customer →
gateway → merchant, and kasir.mu charges a subscription. The one flow where money passes through us
is **our own** Midtrans subscription billing (ADR-39) — us paying ourselves, explicitly outside
this rule. Operational consequence, and the reason D4's `unconfirmed` is rare rather than
universal: **no `payment_gateways` row is required for `cash`, a static QR, `open_bill`,
`credit` or `pay_later`**, so those tenders work on a terminal that has never synced.

## 3. Consequences

- **Good:** one classification per payment, checked by the database, in a form a new market
  extends with **rows instead of migrations**. The offline case becomes a first-class value instead
  of a boolean meaning "a QR exists", and it is the anchor a fiscal chain can attach to (§2.1).
- **Cost, accepted:** two migrations, each a SQLite table rebuild with a backfill (D1, D4); a
  shared TypeScript type plus two import rewrites (D2); reports and shift reconciliation migrate
  from `method` to `method_kind` when they are next touched, not all at once (D1); a plan document
  that now contradicts this record on one line (§1.4). The rebuild is the known-expensive shape,
  and D1 names the precedent rather than rediscovering it.
- **Cost, named:** a static-QR tender gains a confirm tap it does not have today. Real cashier
  friction, bought with a truthful ledger. That is the price of D4 and it is not free.
- **Not decided here:** the reconciliation scheduler (D5 — the resilience design owns it); breaker
  keying (`payment-resilience-design.md` §4, option (b) recommended); whether `capture` / `void`
  grow an idempotency parameter (§9 item 5, a trait change); a SQLite counterpart for
  `payment_gateways` (§9 item 3). This record touches none of them.
- **Not decided here:** whether a fiscal integrity chain ships at all, and against which market —
  ADR-65.
- **Not decided here:** the region pack. ADR-59 §1.6 and §2.3 already rule that a market profile
  is data with no lifecycle and that only certification/signing is module-shaped. Building
  `plugins/regions/<cc>/` would re-open a decision that record closed, in the direction it closed
  it against.
- **Verification required before this may be called Implemented:** the D1 and D4 migrations run
  clean against a database seeded with one row per line of D1's table, with an out-of-set legacy
  label, and with a **second market seeded as `local_payment_methods` rows only** — which is the
  proof that adding a market needs no migration; the classification backfill asserted value by
  value; `migrations.rs` registry order updated;
  `python3 scripts/generate-pg-migration.py` re-run so `20260813_init.pg.sql` carries both CHECKs
  (pre-commit step 5 fails on drift); `cargo test -p kasirmu-core` green; `npm run lint` and
  `npm run typecheck` from `ui/` after the union is unified.

## 4. Non-Goals

- **Not a payment-provider integration.** Adding PIX, UPI or M-Pesa drivers is ordinary work
  against `PaymentProcessor` (`processor.rs:43`) and needs no decision from here.
- **Not a tax engine, fiscal numbering, or receipts.** ADR-59 §4 scopes those out and §2.3
  records the tables as built.
- **Not the resilience rules.** `payment-resilience-design.md` §2 owns the keyed-retry contract;
  this record neither restates nor relaxes it.
- **Not a region pack and not a market rollout.** See §3.

## References

- `crates/kasirmu-payment/src/processor.rs:43` — `trait PaymentProcessor`; `:73` `capture` takes
  no idempotency key; `:102-107` `refund` does
- `crates/kasirmu-payment/src/types.rs:16-27`, `:55-69` — the PascalCase enum, the boolean
  `PaymentResult`
- `foundation/src/enums.rs:86-96` — the kebab-case enum of the same name
- `crates/kasirmu-payment/src/error.rs:14-23` — `ErrorClass`; `:21-22` `Deferred` as "pending"
- `crates/kasirmu-payment/src/registry.rs:59-163`, `:171-178` — the chain, the `method`-named
  parameter, the `build_from_config` stub
- `crates/kasirmu-payment/src/webhook.rs:36`, `:51-64` — `WebhookVerifier`,
  `UnverifiedWebhookGuard`
- `ui/src/features/sales/PaymentModal.tsx:46`, `ui/src/features/sales/payment/SplitTenderRows.tsx:57`
  — the duplicated unions
- `crates/kasirmu-core/migrations/20260813_init.sql:364-371` — `payments`; `:367` the
  unconstrained `method`; `:371` the empty gateway columns
- `crates/kasirmu-core/migrations/20260825_payment_infra.sql:24-37` — `payment_settlements` and
  its CHECK
- `crates/kasirmu-core/migrations/20260924_local_payment_methods.sql:40-52`, `:17-28`, `:45` —
  the rail axis, its three separations, and the `rail_code` column D1 joins to
- `crates/kasirmu-core/migrations/20260928_document_kind_check.sql:31-55` — the rebuild precedent
- `crates/kasirmu-core/src/db/reports/sales_summary.rs` — the `payment_method` reader D1 defers
- `docs/plans/_active/payment-methods-plan.md` §1.1 (fact #1), §1.3, §3 — the decided vocabulary
  and the line D4 contradicts
- `docs/plans/_active/payment-resilience-design.md` §1.3 (two different `idempotency_key`), §2,
  §6, §9 — the sibling owning reconciliation, keying and the scheduler
- ADR-59 §1.6, §2.3, §2.4, §4 — market profiles as data; ADR-39 — our own subscription billing;
  ADR-65 — whether a fiscal chain ships
- `docs/decisions/2026-10-02-global-kernel-and-region-pack-strategy.md` — the demoted draft

> last audited 02-10-26 by DSH
