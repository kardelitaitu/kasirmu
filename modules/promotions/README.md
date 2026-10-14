# Promotions Module

<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (0 major, 1 minor) · First audit stamp this page has carried. · MINOR: one sentence conflated two files. It said "the engine in `crates/kasirmu-core/src/promotion_engine.rs` computes Fixed / buy-X-get-Y discounts, and `compute_checkout_promotions` applies them at checkout" — but `compute_checkout_promotions` lives in `crates/kasirmu-core/src/db/promotions.rs:403`, not in `promotion_engine.rs`. Both halves are individually true and the distinction is the useful one: `promotion_engine.rs` is the PURE maths (compute_discount / compute_discount_unscoped, checked_* arithmetic, discount clamped to 0..=total), while `db/promotions.rs` is the store-backed CRUD plus the checkout application that reads rules and records applications. Naming both, and saying which is pure, is what makes the page's own "rule evaluation should be pure" design note actionable. · VERIFIED AND LEFT ALONE: the engine is genuinely live (PROMO-3) and is called from both IPC shells through the bridge — crates/kasirmu-bridge/src/pos/checkout.rs calls compute_checkout_promotions, so the page's "the working logic lives in kasirmu-core, not here" framing is correct; manifest.json declares promotions:view/apply/manage with dependencies ["sales"]; dependencies() returns &["sales"]; PromotionsModule is lifecycle-only (on_load logs "stub — no handlers registered yet"); Feature::Promotions maps to "promotions-engine"; the crates/kasirmu-core/README.md `promotion_engine` row the page points at exists and describes compute_discount. · NOT re-measured: the "total never negative" and stacking-order properties the checklist asks a promoter to test — those are test-run questions, and the checklist correctly frames them as work to do. · No prior stamp existed; this is the first. -->

**Status:** Module crate is a lifecycle stub — the promotion engine itself shipped in `crates/kasirmu-core` (PROMO-3)

## Overview

Discount evaluation is **live**: the engine in `crates/kasirmu-core/src/promotion_engine.rs`
computes Fixed / buy-X-get-Y discounts, and `compute_checkout_promotions` applies
them at checkout (PROMO-3). This module crate is the *eventual* home for that
logic — percentage and fixed-amount discounts, buy-X-get-Y, bundle pricing,
time-windowed campaigns, and coupon codes — but the working engine currently
lives in `kasirmu-core`, not here. It answers one question for the cart: given these
lines, which discounts apply and what do they subtract?

## Module Info

| Field        | Value |
|--------------|-------|
| ID           | `promotions` |
| Crate        | `modules-promotions` |
| Version      | `0.1.0` |
| Dependencies | `["sales"]` — discounts are evaluated against a cart |
| Permissions  | `promotions:view`, `promotions:apply`, `promotions:manage` |
| Feature flag | `promotions-engine` (`crates/kasirmu-core/src/features.rs`) |

## Currently Owns

Nothing yet. `PromotionsModule` registers with the kernel, declares its dependency
on `sales`, and logs its lifecycle transitions. The working promotion logic lives
in `crates/kasirmu-core` — see the `promotion_engine` row in `crates/kasirmu-core/README.md`,
plus `db/promotions.rs` and the checkout application in `db/sales_checkout.rs`.

## Design notes for the promotion

- Discount amounts are `Money` (`i64` minor units). Percentage rules must
  round once, at the line level, and the rounding direction must be explicit —
  never accumulate fractional minor units.
- Rule evaluation should be pure: `(cart, active_rules) -> Vec<DiscountLine>`.
  Keeping it free of database access makes it cheap to property-test against
  the "total never goes negative" invariant.
- Stacking order matters and must be deterministic. Decide it once, encode it
  in the rule type, and test it.

## Promotion Checklist

> The engine already exists in `kasirmu-core` (PROMO-3); these are **migration**
> tasks to lift it into this module, not greenfield work.

- [ ] `models.rs` — `PromotionRule`, `RuleKind`, `DiscountLine`, `Coupon`
- [ ] `repository.rs` — rule storage (namespace: `promotions_*`)
- [ ] `service.rs` — pure evaluation + coupon redemption in a transaction
- [ ] Property tests: total never negative, stacking is order-stable
- [ ] Gate the UI on the `promotions-engine` feature flag

See `modules/README.md` for the full promotion path.

> last audited 11-10-26 by docs-auditor
