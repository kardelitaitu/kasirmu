# Workspace payment methods, enforced end to end

## 1. Decision requested

Accept as the spec of record for the payment-methods programme the shape that
actually shipped, and keep the four safety rules from
[`../../plans/_active/payment-methods-plan.md`](../../plans/_active/payment-methods-plan.md)
§1.2 as its contract.

The programme ran in three phases and each one changed what the previous phase
had assumed. That is why this spec is written AFTER the code rather than before:
the plan's original sketch (one settings key per workspace type, a boolean per
method) is not what shipped, and a spec that restated the sketch would be a
description of a design nobody built. §2 records what is measurably true now;
the plan keeps the reasoning and the superseded sketches, annotated in place.

## 2. Evidence baseline

Measured 2026-10-25 on branch `0.0.41`.

**The rail surface is rows, not a settings blob.**
`crates/kasirmu-core/migrations/20260924_local_payment_methods.sql` creates
`local_payment_methods`, keyed `(scope_type, scope_id, rail_code)`. The legal-entity
row is the market default and a location row overrides it per rail — including
`is_enabled = false`, because "not offered at this site" is a FACT rather than the
absence of one. `location_disable_survives_entity_reenable` pins that.

**Rule 2 — the backend re-validates, never trust the UI.**
`Store::refuse_unoffered_tender` (`crates/kasirmu-core/src/db/payment_methods.rs`)
answers `NotOffered` / `Withheld`; `complete_sale_deduction_core` calls it for the
header `payment_method` AND every split row before a row is written. Before this
landed the effective-rail read had **no writer-side caller at all** — the UI read it,
nothing enforced it, so a client posting `payment_method: "qris"` against a site that
never enabled QRIS was stored verbatim.

**Rule 4 — dynamic methods need their entitlement.**
`Store::tier_withholds_tender` answers `TierWithheld` for `qris` when the tier's
`supports_qris()` is false. `qris_manual` is NOT gated: it is the static printed code a
cashier eyeballs, it costs the tier nothing, and refusing it on Free would strip the
counter workflow the plan calls Phase 1 value. `effective_tier: None` skips the check
rather than denying, because an unreadable subscription is not a Free one.

**Q1 — money appears on the day it arrives.**
`20261021_receivables.sql` carries `receivables` and `receivable_payments`, the latter
with a `method` column recording the ACTUAL tender. `Store::piutang_collections`
(`crates/kasirmu-core/src/db/reports/sales_summary.rs`) reports repayments by tender
and currency for a date range. It is deliberately a SEPARATE query from
`payment_method_breakdown`, not a UNION: one answers "what was sold today" and the
other "what was collected today", and a union destroys the ability to read either.

**Gateway credentials are a different axis.**
`crates/kasirmu-core/src/db/payment_gateways.rs` holds encrypted-at-rest provider
credentials, while the rail `parameters` bag is per-rail MARKET metadata and rejects
credential-shaped keys outright. A rail can be market-enabled with no gateway
configured.

**Test evidence, measured rather than recalled.**
`cargo test -p kasirmu-core --lib` → **3697 passed**. By area:
`payment_method` 25, `piutang` 5, and the four checkout boundaries
(`checkout_refuses_a_tender_the_site_does_not_offer`,
`an_unconfigured_site_still_completes_a_cash_sale`,
`checkout_refuses_dynamic_qris_on_a_free_tier`,
`a_free_tier_store_with_no_rail_surface_still_sells_cash`) 4.

## 3. What the safety rules cost, and why each narrowing is load-bearing

Two conditions had to hold or the enforcement would do more harm than the gap:

1. **`None` skips rather than denies.** The tier-aware door takes
   `Option<&SubscriptionTier>`; the old tier-less door forwards `None`, which is why
   all pre-existing callers kept their behaviour byte for byte.
2. **Rules 2 and 4 must not compose into a store that cannot trade.** Each is narrow
   alone. `a_free_tier_store_with_no_rail_surface_still_sells_cash` is that guard:
   Free tier, no rails configured, cash sale completes.

## 4. Open work this spec does not close

- The **acquirer's** response is unproven. `crates/kasirmu-payment/tests/` grades our
  side of the wire only; the four behaviours in
  `docs/plans/_active/owner-question-2026-09-28-r4-r6-r7.md` need a live sandbox.
- The `credit` settlement hole the plan notes in Q1 (a `settled_at` stamp records no
  cash movement) is untouched by this spec.
- `pay_later` reminder surfaces: the due-soon card exists
  (`DebtRemindersCard.tsx`); the opt-in POS-open toast does not.

> last audited 11-10-26 by docs-auditor
