---
num: 64
area: payments
title: "ADR-64: The Tender Vocabulary and the Offline Tender State — one classification per payment, and no electronic tender settles on trust"
status: Proposed (2026-10-02) — MOSTLY LANDED. D1's `method` vocabulary, D2's union unification, D3's two-phase `PaymentResult` and D4's `gateway_status` vocabulary have SHIPPED (migrations `20261017_payments_method_check.sql` and `20261018_gateway_status_adr64_vocabulary.sql`; the UI side landed in `4de069c47`, the payment types in `e2a323dfa`). STILL TO BUILD: D1's `method_kind`/`method_mode` classification columns do NOT exist anywhere (0 hits tree-wide), and D4's RULES 1–4 (who may write `settled`, what sets `settled_at`/`settled_by`) are not enforced by anything. Read this record as: the vocabulary and the presentation types shipped; the classification axis and the state machine did not. Amended 2026-10-07 and re-measured 2026-10-11 — see §2.2.
---

<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (1 major, 4 minor) · Re-audit of a record whose STATUS had gone stale in the favourable direction: it read "mostly TO BUILD … D1's method_kind/method_mode columns do not exist", but four of six decisions have SHIPPED — the twelve-value method CHECK (20261017_payments_method_check.sql), the nine-value gateway_status CHECK (20261018), the canonical UI union (ui/src/api/types/payment.ts:8, replacing the two duplicates this record tabulates), and the two-phase PaymentResult with PaymentPhase (kasirmu-payment/src/types.ts:54/:110, plus the Deferred fallback fix at registry.rs:147). Repaired: the front-matter and body status lines; the §1.1 table's two TypeScript rows; §1.2's "still hardcoded, still six values" (now false — the array is gone, replaced by useLocalPaymentRails); §1.3 scoped to its date; D1/D2/D4 gained dated status notes; and a new §2.2 tabulates all ten decision parts with per-row evidence. Kept deliberately unchanged: every measurement in §1 that was true on 2026-10-02, and the argument of every decision. Also verified and left alone — the two claims this record is built on still hold: §1.3's boolean PaymentResult (success: bool is still at types.rs:108) and §1.1's unconstrained columns (20260813_init.sql:367 and :371 still show them). STILL UNBUILT and recorded as such: method_kind/method_mode (zero tree-wide hits), D4's four state rules (no production path writes gateway_status; payments.settled_at has one narrow writer, method='credit'), and TenderState (defined at types.rs:69, referenced outside its own test by nothing). NOT re-measured: whether the migrations run clean from a zero state, the backfill assertion, and the second-market proof. -->

# ADR-64: The Tender Vocabulary and the Offline Tender State

**Status:** Proposed (2026-10-02) — **mostly landed, re-measured 2026-10-11** (§2.2 tabulates
decision by decision). D1's `method` closed set, D2's union unification, D3's two-phase
`PaymentResult` and D4's `gateway_status` vocabulary are all SHIPPED. D1's
`method_kind`/`method_mode` classification columns and D4's four state rules are still unbuilt:
nothing enforces "only `cash` may be written `settled` at record time", and no production path
drives the tender state at all. So the **vocabulary** halves of D1 and D4 landed; the
**classification axis** and the **state machine** did not. The two extremes to avoid reading into
this line: it is no longer "everything is TO BUILD", and it is not "D1–D4 are done".
The measurements in §1 were taken in this checkout on branch `0.0.41`; the rest of §2 was not.
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
| ~~`ui/src/features/sales/PaymentModal.tsx:46`~~ — **superseded 2026-10-11**: `:46` is now an import; the canonical union is `ui/src/api/types/payment.ts:8` (12 values) | `import type { PaymentMethod }` | **snake_case** | `'cash'` … `'other'` (12, closed set) |
| `ui/src/features/sales/payment/SplitTenderRows.tsx:52` — **no longer a duplicate** (2026-10-11): `type SplitRowMethod = PaymentMethod`, imported from the canonical module | alias of the canonical union | **snake_case** | none of its own |
| `crates/kasirmu-core/migrations/20260813_init.sql:367` | `payments.method TEXT NOT NULL` | — | **free TEXT, no CHECK** |

Two Rust enums of the same name, one serialising `"cash"` and the other `"Cash"`, against a
TypeScript union that uses neither spelling for QR. **A tender name is a closed set nowhere**,
and the two TypeScript unions are byte-identical duplicates — a second place to edit.

**1.2 The method vocabulary was DECIDED and is now SHIPPED as a closed set — re-measured 2026-10-11.**
`docs/plans/_active/payment-methods-plan.md` §3 closes with eleven decided values: `cash`, `card`,
`card_debit`, `card_credit`, `qris_manual`, `qris`, `bank_transfer`, `ewallet`, `open_bill`,
`credit`, `pay_later` — plus `other`, which D1's vocabulary adds for the backfill, making the
enforced set **twelve**. (This paragraph, written 2026-10-02, recorded the hardcoded UI array as
fact #1 and measured "still hardcoded, still six values"; **that reading is now superseded.**) As of
2026-10-11 the array is gone: `PaymentModal.tsx:131` reads
`const { rails: paymentRails } = useLocalPaymentRails(sessionToken)`, the canonical union
(`ui/src/api/types/payment.ts:8`) carries all twelve members, and
`20261017_payments_method_check.sql` enforces the same set as a SQLite `CHECK`. What remains
undone is D1's *classification* axis — see §2.2.

**1.3 A tender has no state.** *(Context preserved as the 2026-10-02 reading; for what has since
shipped see §2.2 — a `TenderState` enum now exists in `kasirmu-payment`, but nothing drives it and
no payment row carries a state transition, so the substance of this section still holds.)* What
existed at the time of writing:

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

> **Status 2026-10-11 — the vocabulary half of D1 shipped, the classification half did not.**
> `method` is now CHECK-constrained over the twelve values (migration
> `20261017_payments_method_check.sql`, which also backfilled legacy labels to `'other'` and
> rebuilt the table with both indexes). The `method_kind` / `method_mode` columns this decision is
> principally about **do not exist**: a tree-wide grep for either name returns zero hits, in
> migrations and in Rust alike. So a new market still costs a migration today — the property below
> is the argument for building the axis, not a report that it was built.

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
is the failure mode, not a style choice. *Status 2026-10-11: **done** — the canonical union is
`ui/src/api/types/payment.ts:8` and both former duplicates (`SplitTenderRows.tsx:52`,
`useSplitTenderState.ts:58`) are now `type SplitRowMethod = PaymentMethod`. The enum doc notes on
both Rust types (`foundation/src/enums.rs:88`, `kasirmu-payment/src/types.rs:17`) also landed.*

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
`payments.gateway_status` becomes CHECK-constrained over (*status 2026-10-11: **the vocabulary
shipped**, across two migrations — `20261017_payments_method_check.sql` first constrained it to
seven values and rejected `unconfirmed`, and `20261018_gateway_status_adr64_vocabulary.sql`
rebuilt it to the nine below. The four **rules** are still unbuilt; see §2.2*):

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

**§2.2 — Re-measured 2026-10-11: what landed since 2026-10-02, decision by decision.**

This record is unusual in that its **vocabulary** halves shipped and its structural halves did not,
which makes "is it implemented?" a question that cannot be answered from the status line alone. The
table below is the answer, with the evidence each row rests on.

| Decision | State 2026-10-11 | Evidence |
|---|---|---|
| D1 — closed-set `method` (twelve values) | **SHIPPED** | `20261017_payments_method_check.sql` (rebuild + CHECK + legacy backfill to `'other'` + both indexes recreated); registered `migrations.rs:449` |
| D1 — `method_kind` / `method_mode` classification columns | **NOT BUILT** | zero hits for either name anywhere in the tree (migrations, Rust, TS) |
| D2 — Rust enums documented as presentation types | **SHIPPED** | `foundation/src/enums.rs:88`, `kasirmu-payment/src/types.rs:17` both carry the "ADR-64 D1 & D2 … NOT the persistence authority" note |
| D2 — the duplicated TS unions unified | **SHIPPED** | canonical `ui/src/api/types/payment.ts:8`; `SplitTenderRows.tsx:52` and `useSplitTenderState.ts:58` are now `type SplitRowMethod = PaymentMethod` |
| D3 — two-phase `PaymentResult` | **SHIPPED (as `PaymentPhase`)** | `PaymentResult.phase` at `types.rs:110`; `PaymentPhase::{Issued, Confirmed}` at `:54`; constructors `issued` `:142`, `confirmed` `:124`. Note the name: the decision says "phase", the enum is `PaymentPhase`, and the boolean `success` is **retained** alongside it |
| D3 — the `Deferred` fallback bug | **FIXED** | `registry.rs:147` returns `Err(err)` on `ErrorClass::Deferred` with a comment citing ADR-64 |
| D4 — `gateway_status` vocabulary (nine values) | **SHIPPED** | `20261018_gateway_status_adr64_vocabulary.sql`; note it took **two** migrations — `20261017` first shipped a seven-value set that *rejected* `unconfirmed`, and `20261018` repaired it to the nine decided here |
| D4 — rules 1–4 (who may write `settled`; `settled_at`/`settled_by`) | **NOT BUILT** | no production path writes `payments.gateway_status` at all. The only writer is the sync replay (`platform/sync/src/queue/appliers.rs:784`, verbatim from a peer payload, which is why `unconfirmed` had to be admitted). `payments.settled_at` is written by exactly one narrow path — `UPDATE payments SET settled_at … WHERE method = 'credit'` in `kasirmu-bridge/src/settings.rs:650` and `apps/mobile-tauri/src/commands/settings.rs:627` — for credit settlement, not for a tender transition, and it sets no `gateway_status` |
| D4 — `TenderState` as a type | **BUILT, UNUSED** | `kasirmu-payment/src/types.rs:69` defines all nine variants; outside its own test it is referenced only by the crate's `lib.rs:84` re-export. Nothing in the product constructs one |
| D5 — reconciliation owns `confirmed` → `settled` | **NOT BUILT** | `payment_settlements` table and its four-state CHECK exist (`20260825_payment_infra.sql:33-34`); no sweep promotes a tender |
| D6 — software-only, non-custodial | **HOLDS** | unchanged |

**The deadline this record set implicitly has not passed, and that is the actionable line.** §3's
named risk is that extending the hashed transition becomes a migration *after* D4 ships. The state
machine did **not** ship — only its vocabulary did — so D1's classification axis may still be
changed cheaply. The cost of leaving it is the one the decision already names: every new market
keeps paying a migration until `method_kind` exists.

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
- **Verification required before this may be called Implemented:** *(2026-10-11: four of these
already pass — both migrations exist and are registered, `generate-pg-migration.py` output carries
both CHECKs, and the UI union is unified. What has not been run from a clean database is the
backfill assertion and the second-market proof; and D1's classification columns do not exist yet,
so the acceptance cannot be met as written.)* the D1 and D4 migrations run
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
  — the duplicated unions **as they were on 2026-10-02**; both are superseded (canonical union
  `ui/src/api/types/payment.ts:8`)
- `crates/kasirmu-core/migrations/20260813_init.sql:364-371` — `payments`; `:367` the
  unconstrained `method`; `:371` the empty gateway columns
- `crates/kasirmu-core/migrations/20260825_payment_infra.sql:24-37` — `payment_settlements` and
  its CHECK
- `crates/kasirmu-core/migrations/20261017_payments_method_check.sql` — the `method` + first
  `gateway_status` CHECK (D1 vocabulary; registered `migrations.rs:449`)
- `crates/kasirmu-core/migrations/20261018_gateway_status_adr64_vocabulary.sql` — the nine-value
  `gateway_status` repair (D4 vocabulary; registered `migrations.rs:458`)
- `ui/src/api/types/payment.ts:8` — the canonical twelve-member union (D2)
- `crates/kasirmu-payment/src/types.rs:54`, `:69`, `:110`, `:124`, `:142` — `PaymentPhase`,
  `TenderState`, and the two-phase `PaymentResult` with its constructors (D3)
- `platform/sync/src/queue/appliers.rs:784` — the only path that writes `gateway_status` (D4 §2.2)
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

> last audited 11-10-26 by docs-auditor
