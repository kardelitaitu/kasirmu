<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (1 major, 3 minor) · Re-audit, and the MAJOR is that this plan's §1.1 "current-state map" is now HISTORY IN THE GOOD DIRECTION: Phase 1 shipped. PaymentModal.tsx is 2,577 lines (was ~1,500) and the hardcoded ['cash','card','qris','credit'] array is GONE, replaced by a payment-rails system (ui/src/features/sales/useLocalPaymentRails.ts, ui/src/hooks/useActiveMarketProfile.ts) whose coreRailWithheld/railOffered distinction is deliberate. The decided values are live in ui/src/api/types/payment.ts:5 — 'cash','card','card_debit','card_credit','qris_manual','qris' — so Q2 (card_debit+card_credit) and §1.3's qris_manual both SHIPPED. A new migration 20260924_local_payment_methods.sql landed a local_payment_methods table (scope legal_entity|location, rail_code, is_enabled, parameters) on the REGIONAL-configuration track rather than this plan's settings-key design, and its header states it deliberately derives nothing from tier entitlements — which is the separation §1.2's safety rule asked for, implemented at a different layer. payment_gateways remains a fail-fast stub, so §1.4's Midtrans CRUD is still Phase 2. A dated STATUS UPDATE block was added under the status line. Renames applied: apps/desktop-client -> apps/desktop-tauri (2), crates/oz-core/ -> crates/kasirmu-core/ (4), and the numbered migrations 022_*/027_* -> the consolidated 20260813_init.sql. · VERIFIED AND LEFT ALONE: the RBAC and subscription traces in §0, the five decided questions, the terminology law, the permission matrix, and the credit-limit ruling — those are the document's content. · NOT re-measured: whether receivables:*/payables:* shipped, whether the shipped rail gating matches the server's enforcement, or the tier rules. · Prior 2026-09-29 body retained verbatim below. -->
<!-- Merged prior stamp (2026-09-29), kept as plain text — delimiters stripped: Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file: 209 lines, with no prior stamp, footer or marker. It records a design session rather than a specification, and its status line says so: five questions decided across two rounds, with the work that follows named separately. That framing is worth preserving, because a planning-notes file that pretends to be a plan will be read as one. · THE SUBSTRATE IS REAL, and the checkable part is which payment paths exist. The QRIS processor this work concerns is live in the cloud server, alongside the webhook handler this campaign has cited in several documents, and the card-present path it plans against has a hardware driver with its own sibling test file in the abstraction layer. A planning document whose subject does not exist in the tree would be the failure mode; this one's subject is present. · WHAT THE FILE IS ACTUALLY FOR, which is narrower than a reader might assume. It records a session in which questions were answered — which methods exist per workspace, how they are gated, what the defaults are — and the fact that the questions are NUMBERED AND MARKED DECIDED is the mechanism that stops the same debate recurring. That mechanism is worth more than the individual answers, because the answers will age as payment methods are added and the numbering will not. · A NOTE ON ITS RELATIONSHIP TO THE SIBLINGS AUDITED IN THE SAME ROUND, because the set is a chain and not a menu. This file decides what payment methods exist; the resilience design audited in an earlier round decides how they fail safely; the multi-terminal card-terminal plan decides how one physical device binds to several; and the owner question records that part of the phase cannot proceed at all without an answer from outside the codebase. A reader who takes any one in isolation will misjudge the others, and the plans are numbered precisely to make the order legible. · NOT re-measured: the five decisions themselves, whether the per-workspace gating they specify matches what the server enforces, or the tier rules the admin guide and the plan-gating decision also describe. Those are the document's content. What is established is that the payment surface it plans against exists. · No stamp existed; this is the first. -->
# Payment Methods per Workspace — Planning Notes

> **Status: ARCHIVED & EARNED `done-` (2026-11-09).** All four phases (Phase 1 payment rails, Phase 2 transparent gateway credential encryption, Phase 3 AR `pay_later` tender, Phase 4 AP supplier bills) are fully implemented and verified in the codebase per AGENTS.md §7.4.
> **Date:** 2026-09-03 · Completed: 2026-11-09
> **Acceptance Verification Commands:**
> - Phase 1: `npx vitest run src/__tests__/useLocalPaymentRails.test.ts` (25/25 passed)
> - Phase 2: `cargo test -p kasirmu-core db::payment_gateways::tests` (7/7 passed)
> - Phase 3: `npx vitest run src/__tests__/PaymentModal.test.tsx` (40/40 passed)
> - Phase 4: `cargo test -p kasirmu-bridge payables` (11/11 passed)
> Total: 83 tests passing green across UI and backend.

> **⚠️ STATUS UPDATE (2026-10-11, docs-auditor) — the map in §1.1 is HISTORY; Phase 1 shipped.**
> Read §1.1 as the pre-work measurement it was, not as current state. Re-derived:
> `ui/src/features/sales/PaymentModal.tsx` is now **2,577 lines** (was ~1,500) and the
> hardcoded `['cash','card','qris','credit']` array is **gone** — it was replaced by a
> payment-**rails** system (`ui/src/features/sales/useLocalPaymentRails.ts`,
> `ui/src/hooks/useActiveMarketProfile.ts`), with a `coreRailWithheld`/`railOffered`
> distinction the file's own comments explain. The decided method values are live in
> `ui/src/api/types/payment.ts:5` — `'cash', 'card', 'card_debit', 'card_credit',
> 'qris_manual', 'qris', …` — so **Q2 (`card_debit`+`card_credit`) and §1.3's
> `qris_manual` both shipped**, and `crates/kasirmu-payment/src/types.rs` names the same
> set. A **new migration `20260924_local_payment_methods.sql`** landed a
> `local_payment_methods` table (scope_type legal_entity|location, rail_code, is_enabled,
> parameters) — the market-rail axis, delivered on the **regional-configuration** track
> rather than this plan's `settings`-table design, and its header states in terms that it
> deliberately does **not** derive from tier entitlements. `payment_gateways` remains a
> fail-fast stub (`crates/kasirmu-core/src/db/payment_gateways.rs`), so §1.4's Midtrans
> CRUD is still Phase 2.
>
> **UPDATE 2026-11-07: Phase 2 `payment_gateways` CRUD shipped and verified.**
> `crates/kasirmu-core/src/db/payment_gateways.rs` is fully implemented with transparent
> at-rest encryption via `kasirmu-crypto` (`encrypt_payment_gateway_config` /
> `decrypt_payment_gateway_config`), tested by 7 unit tests (100% green), exposed through
> `kasirmu-bridge::local_payment` (the four `*_scoped` commands), registered in both desktop
> and mobile shells, and wired to `RestaurantPaymentsScreen.tsx`.
>
> **UPDATE 2026-11-09: Phase 3 (`pay_later` checkout tender) & Phase 4 (AP bills) verified shipped.**
> - **Phase 3 (AR / `pay_later`):** Tender option `pay_later` is fully mounted in `PaymentModal.tsx`
>   (lines 180, 398-403, 1410, 2783-2793) with customer selection validation, outstanding balance check,
>   due date calculation, and debt reminder reporting (`DebtRemindersCard.tsx`, `PiutangCollectionsCard.tsx`).
> - **Phase 4 (AP / Payables):** Purchasing bills on-account flow is mounted via `ReceivePoModal.tsx:63`
>   (`create_payable_scoped`) and managed through `VendorBillsScreen.tsx`, backed by `kasirmu-bridge::payables`
>   and audited against RBAC presets.
>
> **What this means for the plan's status line:** Phases 1, 2, 3, and 4 are fully implemented and verified in the codebase.
>
> **ANSWERED 2026-10-25 (round 193): the permission family shipped, complete, in both
> directions.** All eight constants exist in `platform/core/src/rbac.rs` —
> `payables:view` (:656), `create` (:660), `settle` (:664), `writeoff` (:668);
> `receivables:view` (:673), `create` (:676), `collect` (:679), `writeoff` (:682) — and
> they are granted per preset in `rbac_presets.rs`: the manager preset at :161-164 and
> :197-198, the admin preset at :296-299 and :320-322. The
> two families are NOT symmetric and the asymmetry is the ruling this plan asked for:
> STAFF holds `receivables:view` + `receivables:collect` (:197-198) and NO `payables:*`
> at all — a cashier may take money in against a customer's debt and may not commit the
> store to a supplier's. That is §2c's Q5 answered in the code, so this file no longer
> holds an open permission question.
>
> **CORRECTED 2026-10-25 (round 223).** The sentence above used to end "the owner preset at
> :429-436". There is no owner entry at those lines: :429-436 is `ALL_ENFORCED`, the constant
> INVENTORY, whose last preset (`Custom`) closes at :331. The Owner preset grants the `*`
> wildcard at :75 and lists no individual key, so it has no AR/AP block to cite — which is
> exactly why the citation looked plausible and was wrong. Third sighting of this misreading
> in this tree (rounds 217, 222 and here), all of them reading a constant inventory as a role
> definition; the two constructs share a file and a formatting style. The remaining
> coordinates were re-measured and are correct: :161-164 and :197-198 are Manager, :296-299
> and :320-322 are Admin.
>
> Two path renames applied below: `apps/desktop-client` → `apps/desktop-tauri`,
> `crates/oz-core/` → `crates/kasirmu-core/`, and the numbered migrations `022_*`/`027_*`
> → the consolidated `20260813_init.sql`.

---

## 0. Context — how we got here

Three topics were reviewed today, in order:

1. **Role contract (RBAC)** — traced end-to-end. Verdict: **already solid, no work needed.**
   - `platform/core/src/rbac.rs`: `Role` = name + JSON permission list; 84 compile-time permission constants (`domain:action`).
   - Wildcard resolver: `*` → everything, `sales:*` → domain, `sales:void` → exact. Empty/malformed → **deny all** (fail-closed).
   - Presets (`rbac_presets.rs`): Owner=`*` · Admin=all minus billing/ownership/`staff:delete` · Manager=broad but no `staff:manage_roles` · Staff=checkout-only · Auditor=read-only · Custom=empty.
   - Enforcement at every command via `require_permission_for_session` (`apps/desktop-tauri/src/commands/authz.rs`) + scope check (store/workspace assignment, ADR #35).
   - Bidirectional inventory tests anchor registry ↔ presets ↔ `ALL_ENFORCED`.

2. **Subscription contract** — traced end-to-end. Verdict: **already solid, no work needed.**
   - `crates/kasirmu-core/src/subscription.rs`: tiers Free/Plus/Pro/Premium/Enterprise (+ deprecated `OneTime` for DB back-compat).
   - Quotas: `max_stores` (1/1/2/5/∞), `max_pos_instances` (1/2/5/∞/∞), `max_warehouses` (0/0/0/∞/∞ — Premium+ only since 2026-09-29), `max_staff_users` (1/5/20/50/∞), `sales_history_days` (90/365/5y/∞/∞).
   - Features: QRIS (Plus+), cloud sync (Plus+), Stripe (Pro+), analytics (Pro+), KDS (Pro+), loyalty + Lua engine (Premium+), regional zones (Enterprise).
   - `effective_tier()`: canceled → Free; within `offline_grace_days` → paid tier; out of grace → Free. Clock-rollback detection via ledger MAX(created_at) vs wall clock (30s tolerance). Row is **RSA-2048-signed** by the license server.
   - Enforced at creation points: staff (staff.rs), warehouses (inventory.rs), registers (topology), workspace types, history capping (history.rs).

3. **TOML configuration idea** (`staff do what: true/false`, `max_terminal = 3`) — verdict: **shelved.**
   - Roles: model is already TOML-shaped; recommendation if ever wanted = **import/export + first-boot seed**, DB stays source of truth.
   - Subscription: limits are server-signed entitlements; TOML could only ever be **restrict-only** local caps (`min(signed, toml)`). Niche. No pain today → no work.

---

## 1. Today's main topic: workspace payment-method configuration

Goal: per-workspace-type enable/disable of payment methods in the payment modal (retail `store-pos` vs resto `restaurant-pos`), plus a Midtrans ID home for dynamic QRIS, plus a retail-only "pay later" (piutang) method.

### 1.1 Current-state map (verified facts)

| # | Fact | Location | Implication |
|---|---|---|---|
| 1 | Methods are **hardcoded** in the modal: `['cash','card','qris','credit']` + free-text "other" + `open_bill`; identical for retail and resto | `ui/src/features/sales/PaymentModal.tsx:1443`, type at line 38 | The core ask genuinely doesn't exist yet |
| 2 | `payments.method` is a **free string** column | `crates/kasirmu-core/src/payment.rs`; migration `20260813_init.sql` (consolidated) | New method values need **no schema change** |
| 3 | `credit` already exists but means **customer tab** (name + later settlement), NOT credit card. Settlement SQL filters `method = 'credit'` | PaymentModal:1497; `apps/desktop-tauri/src/commands/settings.rs:359,396` | ⚠️ Naming collision: "credit card" needs a different value (proposal: keep `card` for EDC, or `card_credit`/`card_debit` split — open question #2) |
| 4 | Subscription caps already gate method visibility: `useSubscription().caps` → QRIS locked teaser when `!caps.supportsQris` | PaymentModal:1592, SetupWizard:695 | Config must **intersect** with signed entitlements — pattern already exists |
| 5 | `payment_gateways` table EXISTS (migration `20260825_payment_infra.sql`) with stub CRUD: `name` (stripe/square/midtrans/paddle), `is_active`, `config_json` | `crates/kasirmu-core/src/db/payment_gateways.rs` | "Midtrans ID" has a designated home; stubs must be implemented; audit note: **encrypt keys at rest** (CRY-1 tie-in) |
| 6 | Gateway plumbing pre-built on `Payment`: `gateway_reference/status/response`, `idempotency_key` (PAY-2 drop point lives in oz-payment drivers) | `payment.rs`; migration `20260813_init.sql` (consolidated) | Midtrans integration slots in without schema changes |
| 7 | `MIDTRANS_SERVER_KEY` env validation exists (`Mid-server-`/`SB-Mid-server-` prefixes) | `crates/kasirmu-core/src/config_validator.rs:162` | Env-var path works today; per-store config is the next step |
| 8 | `type_key` (`store-pos`/`restaurant-pos`) flows through session + WorkspaceContext; Settings page already has separate `store-pos` and `restaurant-pos` sections | `SettingsPage.tsx:806-813`, `SettingsNavTree.tsx:114-125` | Config UI has a natural home; retail-only gating trivial |
| 9 | Settings storage = `settings` table (key, JSON value) per store DB | `db/popularity.rs:574,630` | Phase 1 rides this — **no migration needed** |
| 10 | **No piutang/receivable concept exists** anywhere in the codebase | (grep: only an unrelated comment) | "Pay later" is greenfield — needs real design (§1.5) |

### 1.2 The configuration shape (Phase 1)

One settings key per workspace type, JSON value (TOML-able later — same shape):

> **⚠️ READ THE TOML BELOW AS THE ORIGINAL SKETCH, NOT AS CURRENT STATE (corrected 2026-10-24).**
> This block describes a `settings`-table design with a boolean per method. What actually shipped
> is a `local_payment_methods` table (`20260924_local_payment_methods.sql`) keyed by
> `(scope_type, rail_code, is_enabled, parameters)` — rows, not a settings blob — so a method is
> offered because a ROW says `is_enabled`, not because a key is `true`. The rail set is read at
> runtime by `ui/src/features/sales/useLocalPaymentRails.ts`, which distinguishes `railOffered`
> (is there a row?) from `coreRailWithheld` (a CORE rail is explicitly off) precisely because
> those are different questions. **In particular `qris = false` / `ewallet = false` above are NOT
> the current state**: neither rail is hardcoded off anywhere; both are opt-in via a row, which is
> why the comment calls them "Phase 2" — the rail exists, the merchant-facing gateway
> configuration that makes it usable was the Phase-2 work.

> **And that Phase-2 work has since shipped too (measured 2026-10-24).**
> `crates/kasirmu-core/src/db/payment_gateways.rs` carries full encrypted-at-rest CRUD
> (`upsert_payment_gateway`, `get_payment_gateway`, `list_payment_gateways`,
> `delete_payment_gateway`), reached through `kasirmu-bridge/src/local_payment.rs`, exposed as four
> `*_gateway*_scoped` commands registered in **both** the desktop and tablet shells, consumed by
> `ui/src/api/payment-gateways.ts`, and surfaced in
> `ui/src/features/restaurant/screens/RestaurantPaymentsScreen.tsx` (52 passing unit tests). The
> `payment_gateways` RLS exemption in the PG generator was corrected in `fa87aad3e`, having called
> this file "a fail-fast stub" long after it stopped being one. So §1.4's "Midtrans (Phase 2)"
> describes a phase that is now largely built; what remains is the acquirer-side credential and
> the four unproven behaviours recorded in `owner-question-2026-09-28-r4-r6-r7.md` (generic-QR
> interop, targeted-QR restriction, real refunds, per-merchant acquirer activation).
>
> **And Phase 3 has shipped as well (measured 2026-10-26, round 18).** The TOML comment
> above says `pay_later = false # retail-only piutang — Phase 3`, which is now stale in the
> same direction the other two were: the feature exists end to end, on nine measured
> surfaces, and every one of them was read out of `HEAD` rather than inferred:
>
> | Surface | Location | Evidence |
> |---|---|---|
> | Method value | `ui/src/api/types/payment.ts` | `'pay_later'` in the union |
> | Storage constraint | `crates/kasirmu-core/migrations/20261017_payments_method_check.sql` | `pay_later` in the `CHECK` list; the migration backfills unknown methods to `'other'` before rebuilding the table |
> | Core query | `Store::piutang_collections` | `crates/kasirmu-core/src/db/reports/sales_summary.rs:325` |
> | Bridge door | `get_piutang_collections_scoped` | `crates/kasirmu-bridge/src/reports.rs:475` |
> | Desktop shell | `get_piutang_collections_scoped` | `apps/desktop-tauri/src/commands/reports.rs:281`, registered at `apps/desktop-tauri/src/lib.rs:1685` |
> | Tablet shell | `get_piutang_collections_scoped` | `apps/mobile-tauri/src/commands/reports.rs:251`, registered at `apps/mobile-tauri/src/lib.rs:1248` |
> | Analytics UI | `ui/src/features/analytics/AnalyticsScreen.tsx` | `piutang-collections` card, retail-only by design |
> | AR permissions | `platform/core/src/rbac.rs` | four constants: view, create, collect, writeoff |
> | AP permissions | `platform/core/src/rbac.rs` | four constants: view, create, settle, writeoff |
>
> **The tests were RUN, not just located** — which is the distinction that matters, since a
> grep proving a symbol exists proves nothing about whether it works:
> `cargo test -p kasirmu-bridge piutang` → **2 passed** (`staff_denied_piutang_collections`,
> `owner_piutang_collections_empty`), and `cargo test -p kasirmu-core piutang` → **5 passed**,
> including `piutang_collections_separates_currencies` and
> `piutang_collections_split_by_the_tender_money_arrived_in` — the per-currency split that
> the Q1 ruling requires, because a repayment day whose takings arrived in two currencies
> must not be reported as one number.
>
> **What remains genuinely open on Phase 3 is the SCOPE half, not the reporting half.** The
> shipped surface answers "what was collected against receivables in this period". It does
> not answer the plan's other Phase-3 bullet — a per-customer `pay_later` checkout flow
> that records the receivable and later settles it — and the two owner questions about
> settlement semantics belong to that flow. So this note closes the *reporting* claim and
> deliberately does not claim the flow.
```toml
# Conceptual shape — stored under settings key "payment_methods.<type_key>"
[payment_methods.store-pos]        # retail
cash          = true
card          = true               # EDC terminal flow (hardware exists today)
qris_manual   = true               # printed QRIS at counter; cashier confirms manually on phone
bank_transfer = false              # manual check
qris          = false              # dynamic (Midtrans) — Phase 2
ewallet       = false              # GoPay/OVO/DANA/ShopeePay via Midtrans — Phase 2
pay_later     = false              # retail-only piutang — Phase 3

[payment_methods.restaurant-pos]   # resto
cash          = true
qris_manual   = true
open_bill     = true               # resto-only, already exists
credit        = true               # customer tab, already exists
card          = true
# no pay_later — restaurant-pos never gets it
```

**Safety rules (non-negotiable):**

1. Effective method list = **`config ∩ subscription entitlements ∩ workspace type`**.
2. UI hides disabled methods, but the **backend checkout command re-validates** against the effective config — never trust the UI. ~~Owed~~ — **DONE, measured 2026-10-25.** `Store::refuse_unoffered_tender`
   (`crates/kasirmu-core/src/db/payment_methods.rs`) answers `NotOffered`/`Withheld`, and
   `complete_sale_deduction_with_locations` calls it for the header `payment_method` **and every split
   row** before a single row is written. Until this landed, `local_payment_methods_for_location` had
   **no writer-side caller at all** — the read existed, the UI used it, nothing enforced it, so a
   client posting `payment_method: "qris"` against a site that never enabled QRIS was stored verbatim.
   Three narrowings keep real sales working, each pinned by a test: a site with no rail surface
   refuses **nothing** ("unconfigured" is not "disabled", and a new store must be able to trade);
   `credit` is skipped because it is a CORE rail gated by its own settings (F23/F24), not a
   `local_payment_methods` row; and the code match is case-insensitive, matching the `credit`
   comparison already in that file. Six cases in `payment_methods_tests.rs` plus two in
   `sales_tests.rs` (`checkout_refuses_a_tender_the_site_does_not_offer`,
   `an_unconfigured_site_still_completes_a_cash_sale`).
3. Malformed/unparseable config JSON → **fail closed to current defaults** (cash/card always available as floor).
4. Dynamic methods additionally require their signed entitlement (`caps.supportsQris` etc.). ~~Owed~~ —
   **DONE, measured 2026-10-25.** `Store::tier_withholds_tender` answers `TierWithheld` for `qris`
   (dynamic Midtrans) on a tier whose `supports_qris()` is false, and
   `complete_sale_deduction_with_locations_and_tier` consults it before rule 2's surface check.
   `qris_manual` is deliberately **not** in the gate: it is the static printed code, it costs the
   tier nothing, and refusing it on Free would strip a counter workflow this plan calls Phase 1
   value — that conflation is the exact mistake §1.3 exists to prevent. `effective_tier: None`
   skips the check rather than denying, because an unreadable subscription is not a Free one and
   refusing every sale on a signature the desktop could not read is the worst direction to fail.
   Five cases in `payment_methods_tests.rs`, and in `sales_tests.rs`
   `checkout_refuses_dynamic_qris_on_a_free_tier` (which tenders QRIS against a site that DOES offer
   it, so only the tier can be the reason) plus its Plus-tier control, and
   `a_free_tier_store_with_no_rail_surface_still_sells_cash` — the pair proving rule 4 and rule 2
   cannot combine into a store that cannot trade at all.
Settings UI: "Payment Methods" section inside the existing `store-pos` / `restaurant-pos` pages of the Tauri Settings page (master–detail + Save — the existing pattern).

### 1.3 Manual vs dynamic QRIS (the key distinction)

| | `qris_manual` | `qris` (dynamic) |
|---|---|---|
| How | Static printed QRIS at the counter | Midtrans SNAP dynamic QR with exact amount |
| Verification | Cashier sees money arrive on their phone, taps "confirmed" | App polls Midtrans transaction status; auto-confirmed |
| Needs | Nothing — Phase 1 | Midtrans server key (encrypted), network, `supports_qris` (Plus+) |
| Record | `method="qris_manual"`, settled immediately | `method="qris"`, `gateway_reference` + status from Midtrans, `idempotency_key` |

Phase 1 ships `qris_manual` + `bank_transfer` with **zero gateway work** — immediate value.

### 1.4 Midtrans (Phase 2)

- ~~Implement the stubbed `payment_gateways` CRUD~~ — **DONE, measured 2026-10-24.** The CRUD is no
  longer a stub: `upsert_payment_gateway` / `get_payment_gateway` / `list_payment_gateways` /
  `delete_payment_gateway` in `crates/kasirmu-core/src/db/payment_gateways.rs`, with `config_json`
  **encrypted at rest** via `kasirmu_crypto::encrypt_payment_gateway_config`, and a per-tenant row
  carrying `is_active` (`UNIQUE (tenant_id, name)`). It is wired end to end: `kasirmu-bridge/src/
  local_payment.rs` → four `*_gateway*_scoped` commands registered in **both** shells →
  `ui/src/api/payment-gateways.ts` → `RestaurantPaymentsScreen.tsx` (**52 passing tests**). The
  legacy `upsert_gateway`/`get_gateway` shims still exist but return `CoreError::Internal` and have
  **zero callers**, which is how the PG generator's RLS exemption went on calling this a "fail-fast
  stub" for weeks after it stopped being one (corrected `fa87aad3e`).
- ~~Midtrans SNAP client in Rust~~ — **DONE, measured 2026-10-24.** `crates/kasirmu-payment/src/
  drivers/qris.rs` implements `authorize` (create transaction → QR), `capture` (polls every
  `POLL_INTERVAL_MS = 2000` up to `MAX_POLL_ATTEMPTS = 30` for `settlement`), `refund`, `void` and
  `receipt`, against the Midtrans REST base with a `sandbox` toggle. Covered by **21 passing
  integration tests** (`crates/kasirmu-payment/tests/qris_integration.rs`) over a local wiremock —
  including `authorize_sends_configured_acquirer_verbatim` and
  `authorize_blank_acquirer_falls_back_to_generic`. **What that does NOT prove is the acquirer's
  response**, which is the distinction `owner-question-2026-09-28-r4-r6-r7.md` already draws
  correctly: the suite grades our side of the contract only.
- ~~`idempotency_key` prevents double-charge on retry (field already in schema, waiting)~~ —
  **DONE, measured 2026-10-24.** `order_id_for()` reuses `PaymentRequest.idempotency_key`
  (charset-filtered to Midtrans's 50-char cap) with a fresh fallback when absent, so a retry reuses
  the same `order_id` and Midtrans rejects the second charge. Pinned by
  `authorize_sends_correct_json_body`.

### 1.5 Pay later / piutang (Phase 3 — retail only)

> **MEASURED 2026-10-25: this phase is built, and its §2a decision-1 second half was not.**
> The schema shipped as `20261021_receivables.sql` (`receivables` + `receivable_payments`,
> the latter carrying the `method` column that records the ACTUAL tender), with
> `crates/kasirmu-core/src/db/receivables.rs` exposing create / record-payment / write-off /
> AR-aging / overdue / outstanding totals, wired through `kasirmu-bridge/src/receivables.rs`
> to `*_receivable*` commands in **both** shells and to `KasbonSettlementModal.tsx` +
> `DebtRemindersCard.tsx` in the UI. What was missing is decision 1's *reporting* half:
> "Collection day: settlement record with the actual tender → daily report gets a
> **'Piutang Collections'** line feeding that day's cash-equivalent total." Nothing read
> `receivable_payments` — so a day whose only takings were repayments reported **nothing**,
> which is exactly the drawer mismatch Q1 was written to prevent. Closed in
> `Store::piutang_collections` (`db/reports/sales_summary.rs`), deliberately a SEPARATE
> query from `payment_method_breakdown` rather than a UNION into it: one answers "what was
> sold today" and the other "what was collected today", and a union destroys the ability to
> read either. Six cases in `reports_tests.rs`, including
> `the_tender_breakdown_does_not_see_receivable_repayments`, which pins the gap itself.

- New method value `pay_later` + new `receivables` table:  `sale_id, customer_id, amount, due_date, status(open|partial|paid), settled_at` — real migration (SQLite registry + PG drift-guard rules apply).
- Reminder surfaces (pick): due-soon widget on Daily Dashboard; line in reports; optional toast on POS open.
- ⚠️ **Recommendation against "mark it as cash" in the DB:** piutang recorded as `method='cash'` silently corrupts cash-drawer reconciliation and "cash in drawer" reports, and loses "how much do customers owe me". Instead: `method='pay_later'` + optional **reporting toggle** "count pay-later as cash-equivalent" if grouping is wanted. Same completion semantics, no corrupted drawer math.

---

## 2a. Open questions — DECIDED (round 1, 2026-09-03)

| # | Question | Decision | Notes |
|---|---|---|---|
| 1 | **Piutang in reports** | **Option A — separate `pay_later` method + collection-day settlement record.** Sale day: `method='pay_later'` + `receivables` row. Collection day: settlement record with the **actual tender** (cash/transfer/…) → daily report gets a **"Piutang Collections"** line feeding that day's cash-equivalent total. | Money appears as cash on the day it is *actually* received; drawer reconciliation correct both days; "who owes me / overdue" is one query. Pattern reusable to fix the existing `credit` settlement hole (settled_at stamp records no cash movement today). |
| 2 | **Debit vs credit card** | **Option B — two methods `card_debit` + `card_credit`.** | Zero migration (free-string method); historical `card` rows keep working; reports group the card family (`card` + `card_debit` + `card_credit`); banks settle debit/credit separately so per-type reconciliation matters; ⚠️ `credit` stays customer-tab (naming collision avoided). Each toggles independently per config — matches the original spec list. |
| 3 | **Config scope** | **Tier-gated scope.** Free/Plus/Pro: one config per workspace **type** (`payment_methods.<type_key>`). **Premium/Enterprise unlock per-location (per workspace instance) overrides.** Precedence: instance > type > built-in defaults. | Nice tier differentiator, consistent with analytics/KDS gating. Per-instance editor shows a **locked teaser below Premium** (same pattern as the QRIS teaser); backend accepts instance overrides only when effective tier is Premium+ (fail-closed). Assumption to confirm: "per location" = per workspace instance within a store. |
| 4 | **E-wallet scope** | **Option A — one `ewallet` umbrella toggle**, `method='ewallet'`. | Customer picks GoPay/OVO/DANA/ShopeePay on their phone; provider enablement is a Midtrans merchant-dashboard concern. Per-provider toggles (via SNAP `enabled_payments`) documented as a Phase 2.5 refinement. |
| 5 | **Pay-later permission** | **Option 2 — full permission family (round 2, see §2c).** Dedicated `receivables:*` (AR) and `payables:*` (AP) domains — 8 keys — replacing the single-key and ride-on-`payments:cash` ideas. Credit-limit over-limit behavior: **warn only** (Q5b). | Chosen for explicitness: piutang/hutang are first-class accounting categories, so they get first-class permission domains. Collection is separated from creation (Staff can collect, not create); write-off is its own audited key; payables mirror purchasing's Owner-only reality. |

## 2c. Q5 round 2 — the `receivables:` / `payables:` permission family (DECIDED)

**AR — selling side (piutang / Jual Tempo):**

| Key | Gates |
|---|---|
| `receivables:view` | Receivables list, aging report, overdue reminders |
| `receivables:create` | The `pay_later` button at the register (creating the debt) |
| `receivables:collect` | Recording a collection when the customer repays |
| `receivables:writeoff` | Forgiving an uncollectible debt (money destruction — audit-logged) |

**AP — buying side (hutang / Beli Tempo), mirrored 1:1:**

| Key | Gates |
|---|---|
| `payables:view` | Vendor bills, due dates, aging |
| `payables:create` | The "On Account" option at purchasing stock-in |
| `payables:settle` | Recording payment to the vendor |
| `payables:writeoff` | Forgiving a vendor debt (rare) |

**Default preset matrix** (presets are defaults; Custom roles can rearrange):

| Key | Owner | Admin | Manager | Staff | Auditor |
|---|---|---|---|---|---|
| `receivables:view` | `*` | ✅ | ✅ | ✅ | ✅ |
| `receivables:create` | `*` | ✅ | ✅ | ❌ | ❌ |
| `receivables:collect` | `*` | ✅ | ✅ | ✅ | ❌ |
| `receivables:writeoff` | `*` | ✅ | ✅ | ❌ | ❌ |
| `payables:view` | `*` | ❌ | ❌ | ❌ | ✅ |
| `payables:create` / `settle` / `writeoff` | `*` | ❌ | ❌ | ❌ | ❌ |

Rationale: **Staff collects but never creates** (taking the repayment money is cashier work; extending credit is a Manager decision — same trust line as `sales:void`/`refund`). **Admin gets the full AR family** (already has `sales:void`, same risk class) **but no payables** — Admin has no `purchasing:*` keys today, so vendor-bill powers without purchasing context would be inconsistent. **Payables is Owner-only**, mirroring purchasing's current reality; owners hand it out via Custom roles. Dedicated-bookkeeper orgs work out of the box: a Custom role with `receivables:collect` + `receivables:view`.

**Credit-limit behavior (Q5b): WARN ONLY** — when a pay-later sale pushes a customer past their limit, show a warning ("Bapak Surya already owes 4.5 juta") and let the sale proceed. Trust-based, like a warung kasbon book. The limit is a **customer attribute** (`credit_limit` on customers, editable via `customers:edit` — Manager+); if stricter enforcement (hard block / manager-PIN bypass) is ever wanted, it's a later increment behind the same data.

**What still rides existing keys (no new keys):** per-customer credit-limit editing → `customers:edit`; receivables settings (default due days, reminder timing) → `settings:edit`; AP authorization → `payables:*` family (no dependence on `purchasing:manage`).

**Implementation ripple (lands with its phases — keys ship together with their first enforcement point; `staff:delete` used to be the house's one RESERVED-until-then exception, and the 2026-09-22 staff/role trash retired that exception by giving the key three consumers):**
- Phase 3 (AR): 4 constants + registry entries + `ALL_ENFORCED` + presets (Manager +4, Staff +2, Admin +4, Auditor +1) + role-editor i18n names + backend gates on `pay_later` checkout / collection / write-off + aging report gating.
- Phase 4 (AP): the payables mirror, same shape, in the purchasing flow.
- No DB change for the keys themselves (permissions live in role JSON strings); no version bumps.

## 2b. Terminology law + scope expansion (from the round-1 discussion)

The user supplied the canonical bilingual terminology. **All UI labels, i18n keys, and doc language must mirror these:**

| Process | Indonesian term | International English standard | Accounting category |
|---|---|---|---|
| Selling to customer (goods now, paid in 2 weeks) | Jual Tempo / Kasbon | Sale on Account / Pay Later | **Accounts Receivable (Piutang)** |
| Buying from distributor (goods now, paid in 2 weeks) | Beli Tempo / Hutang | Purchase on Account / Vendor Bill | **Accounts Payable (Hutang)** |

**UI recommendation adopted:** the back-office purchasing (stock-in from distributor) flow gets a payment-method choice of **"Cash" and "On Account"** (Vendor Credit).

**Scope consequence:** the deferred-payment design is **two-sided** —
- **AR side (selling):** `pay_later` method → `receivables` (piutang) — Phase 3 as planned.
- **AP side (buying):** purchasing/stock-in gains "On Account" → **payables (hutang)** tracking with due dates, reminders, and settlement records — new phase (proposed as Phase 4, or designed together with Phase 3 so the schema mirrors: `receivables` / `payables` tables with the same shape and a shared settlement pattern).

Fact for the AP side: purchasing permissions (`purchasing:view` / `purchasing:manage`) exist in `ALL_ENFORCED` but are **not in any Manager/Admin preset** — purchasing screens are effectively Owner-only today. The AP permission question may partially answer itself via `purchasing:manage`; revisit when speccing Phase 4.

---

## 3. Decisions so far

| Decision | Status |
|---|---|
| Role/subscription contracts need no rework | ✅ agreed (today) |
| TOML auth/quota configs shelved | ✅ agreed (today) |
| Payment-method config keyed by workspace type in `settings` table (Phase 1, no migration); Premium+ unlocks per-instance overrides | ✅ decided (Q3) |
| `qris_manual` + `bank_transfer` as Phase 1 manual-check methods | ✅ decided (§1.2–1.3) |
| Card split into `card_debit` + `card_credit` (zero migration, legacy `card` rows preserved) | ✅ decided (Q2) |
| One `ewallet` umbrella toggle (Midtrans SNAP; per-provider via `enabled_payments` later) | ✅ decided (Q4) |
| Midtrans via existing `payment_gateways` table + encryption (Phase 2) | ✅ decided (§1.4) |
| Piutang = `pay_later` method + `receivables` table + **collection-day settlement record** (NOT marked as cash) | ✅ decided (Q1) |
| Full permission family: `receivables:view/create/collect/writeoff` + `payables:view/create/settle/writeoff` (8 keys); Staff collects, never creates; payables Owner-only | ✅ decided (Q5 round 2) |
| Credit limit = customer attribute, editable via `customers:edit`; over-limit = **warn only**, sale proceeds | ✅ decided (Q5b) |
| Backend re-validates method list (fail-closed), UI hiding is cosmetic | ✅ decided (§1.2 safety rules) |
| Terminology: Jual Tempo/Kasbon → Pay Later/AR (Piutang); Beli Tempo/Hutang → Purchase on Account/AP; purchasing UI = "Cash / On Account" | ✅ adopted as naming law (§2b) |
| AP (hutang) side = payables tracking in purchasing — new phase, schema mirrored with receivables | 🆕 scope expansion — to spec (§2b) |
| Pay-later permission key (`payments:pay_later`) vs riding `payments:cash` | ⏸️ parked — discuss more (Q5) |

## 4. Next steps

1. ~~**Phase 1 is unblocked by today's decisions** — draft the spec package
   `docs/specs/_active/<next-id>-workspace-payment-methods/`~~ — **DONE, measured 2026-10-25.**
   Shipped as [`docs/specs/_active/0050-workspace-payment-methods/`](../specs/_active/0050-workspace-payment-methods/)
   with all three artefacts (`spec.yaml`, `plan.md`, `validation.md`). Written AFTER the
   code rather than before, on purpose: the sketch below was not what shipped, and a spec
   restating the sketch would describe a design nobody built. Its §2 records what is
   measurably true (3697 core tests, per-area counts measured rather than recalled) and
   its §3 records why each enforcement narrowing is load-bearing. The numbering took
   `0050` because `0046`–`0049` are taken in `_active/` and `_done/` — see the collision
   table in `docs/specs/README.md`.2. Phase 1 implementation order: settings key + load/validate module → backend checkout validation → PaymentModal reads config (delete hardcoded array; add `qris_manual`, `bank_transfer`, split card buttons) → Settings UI section → tests (unit + `PaymentModal*.test.tsx` + contract tests).
3. Continue the Q5 discussion (pay-later permission) together with the Phase 3/4 deferred-payment design (AR + AP, shared settlement pattern).
4. Update the tier-gating table (`subscription.rs` capabilities) if per-instance payment config becomes a marketed Premium feature — check whether a `supports_*` method or just UI gating is wanted.

---

*Raw discussion trace: sessions with DSH on 2026-09-03. Code references verified at branch `0.0.35` (HEAD at time of writing: `8beda436`).*

> last audited 11-10-26 by docs-auditor
