# Payment Methods per Workspace — Planning Notes

> **Status:** ALL FIVE QUESTIONS DECIDED (rounds 1–2, 2026-09-03) — see §2a/§2b/§2c. Phase 1 is spec-ready; Phase 3/4 designs are complete on paper. Next: draft `docs/specs/_active/` package (spec.yaml + plan.md + validation.md).
> **Date:** 2026-09-03 · Session with DSH (DeepSeek Harness agent)

---

## 0. Context — how we got here

Three topics were reviewed today, in order:

1. **Role contract (RBAC)** — traced end-to-end. Verdict: **already solid, no work needed.**
   - `platform/core/src/rbac.rs`: `Role` = name + JSON permission list; 84 compile-time permission constants (`domain:action`).
   - Wildcard resolver: `*` → everything, `sales:*` → domain, `sales:void` → exact. Empty/malformed → **deny all** (fail-closed).
   - Presets (`rbac_presets.rs`): Owner=`*` · Admin=all minus billing/ownership/`staff:delete` · Manager=broad but no `staff:manage_roles` · Staff=checkout-only · Auditor=read-only · Custom=empty.
   - Enforcement at every command via `require_permission_for_session` (`apps/desktop-client/src/commands/authz.rs`) + scope check (store/workspace assignment, ADR #35).
   - Bidirectional inventory tests anchor registry ↔ presets ↔ `ALL_ENFORCED`.

2. **Subscription contract** — traced end-to-end. Verdict: **already solid, no work needed.**
   - `crates/oz-core/src/subscription.rs`: tiers Free/Plus/Pro/Premium/Enterprise (+ deprecated `OneTime` for DB back-compat).
   - Quotas: `max_stores` (1/1/2/5/∞), `max_pos_instances` (1/2/5/∞/∞), `max_warehouses` (1/2/3/∞/∞), `max_staff_users` (1/5/20/50/∞), `sales_history_days` (90/365/5y/∞/∞).
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
| 2 | `payments.method` is a **free string** column | `crates/oz-core/src/payment.rs`; migration `022_payments_table.sql` | New method values need **no schema change** |
| 3 | `credit` already exists but means **customer tab** (name + later settlement), NOT credit card. Settlement SQL filters `method = 'credit'` | PaymentModal:1497; `apps/desktop-client/src/commands/settings.rs:359,396` | ⚠️ Naming collision: "credit card" needs a different value (proposal: keep `card` for EDC, or `card_credit`/`card_debit` split — open question #2) |
| 4 | Subscription caps already gate method visibility: `useSubscription().caps` → QRIS locked teaser when `!caps.supportsQris` | PaymentModal:1592, SetupWizard:695 | Config must **intersect** with signed entitlements — pattern already exists |
| 5 | `payment_gateways` table EXISTS (migration `20260825_payment_infra.sql`) with stub CRUD: `name` (stripe/square/midtrans/paddle), `is_active`, `config_json` | `crates/oz-core/src/db/payment_gateways.rs` | "Midtrans ID" has a designated home; stubs must be implemented; audit note: **encrypt keys at rest** (CRY-1 tie-in) |
| 6 | Gateway plumbing pre-built on `Payment`: `gateway_reference/status/response`, `idempotency_key` (PAY-2 drop point lives in oz-payment drivers) | `payment.rs`; migration `027_payment_gateway_fields.sql` | Midtrans integration slots in without schema changes |
| 7 | `MIDTRANS_SERVER_KEY` env validation exists (`Mid-server-`/`SB-Mid-server-` prefixes) | `crates/oz-core/src/config_validator.rs:162` | Env-var path works today; per-store config is the next step |
| 8 | `type_key` (`store-pos`/`restaurant-pos`) flows through session + WorkspaceContext; Settings page already has separate `store-pos` and `restaurant-pos` sections | `SettingsPage.tsx:806-813`, `SettingsNavTree.tsx:114-125` | Config UI has a natural home; retail-only gating trivial |
| 9 | Settings storage = `settings` table (key, JSON value) per store DB | `db/popularity.rs:574,630` | Phase 1 rides this — **no migration needed** |
| 10 | **No piutang/receivable concept exists** anywhere in the codebase | (grep: only an unrelated comment) | "Pay later" is greenfield — needs real design (§1.5) |

### 1.2 The configuration shape (Phase 1)

One settings key per workspace type, JSON value (TOML-able later — same shape):

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
2. UI hides disabled methods, but the **backend checkout command re-validates** against the effective config — never trust the UI.
3. Malformed/unparseable config JSON → **fail closed to current defaults** (cash/card always available as floor).
4. Dynamic methods additionally require their signed entitlement (`caps.supportsQris` etc.).

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

- Implement the stubbed `payment_gateways` CRUD: upsert/list/get; `config_json` **encrypted at rest**; per-tenant row with `is_active`.
- Midtrans SNAP client in Rust (desktop client is the backend): create transaction → show QR → poll status → write `gateway_reference`/`gateway_status` on the payment.
- `idempotency_key` prevents double-charge on retry (field already in schema, waiting).

### 1.5 Pay later / piutang (Phase 3 — retail only)

- New method value `pay_later` + new `receivables` table:
  `sale_id, customer_id, amount, due_date, status(open|partial|paid), settled_at` — real migration (SQLite registry + PG drift-guard rules apply).
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

1. **Phase 1 is unblocked by today's decisions** — draft the spec package `docs/specs/_active/<next-id>-workspace-payment-methods/` (spec.yaml + plan.md + validation.md per house format; see `0043-architecture-boundary-checker` as the example).
2. Phase 1 implementation order: settings key + load/validate module → backend checkout validation → PaymentModal reads config (delete hardcoded array; add `qris_manual`, `bank_transfer`, split card buttons) → Settings UI section → tests (unit + `PaymentModal*.test.tsx` + contract tests).
3. Continue the Q5 discussion (pay-later permission) together with the Phase 3/4 deferred-payment design (AR + AP, shared settlement pattern).
4. Update the tier-gating table (`subscription.rs` capabilities) if per-instance payment config becomes a marketed Premium feature — check whether a `supports_*` method or just UI gating is wanted.

---

*Raw discussion trace: sessions with DSH on 2026-09-03. Code references verified at branch `0.0.35` (HEAD at time of writing: `8beda436`).*
