# Gift Cards Module

<!-- Audit stamp: 2026-08-31 · docs-auditor · status: ACCURATE (0 findings) · verified against HEAD: GiftCard* types live in modules/loyalty/src/models.rs; manifest.json declares giftcards:view/issue/redeem/manage; GiftCardsModule is a lifecycle-only stub (on_load/on_start log 'stub — no handlers registered yet'); Feature::GiftCards flag exists -->

**Status:** Stub (lifecycle only — domain types currently live in `modules/loyalty`)

## Overview

The Gift Cards module will own stored-value instruments: card issuance, balance
tracking in `Money` minor units, partial redemption against a sale, and
per-card transaction history.

## Module Info

| Field        | Value |
|--------------|-------|
| ID           | `giftcards` |
| Crate        | `modules-giftcards` |
| Version      | `0.1.0` |
| Dependencies | `["sales"]` — redemption debits a card as part of a sale's tender |
| Permissions  | `giftcards:view`, `giftcards:issue`, `giftcards:redeem`, `giftcards:manage` |
| Feature flag | `gift-cards` (`crates/kasirmu-core/src/features.rs`) |

## Why this stub exists

This module corrects a misplaced ownership. `modules/loyalty/src/models.rs`
currently defines and re-exports `GiftCard`, `GiftCardTransaction`,
`GiftCardWithTransactions`, `IssueGiftCardInput`, `GiftCardFilter`, and
`RedeemGiftCardResult`. Gift cards are stored value; loyalty is points and
tiers. They are different verticals with different permissions and different
audit requirements, and they were only ever colocated by convenience.

## Currently Owns

Nothing yet — `GiftCardsModule` registers with the kernel, declares its
dependency on `sales`, and logs its lifecycle transitions.

## Promotion Checklist

- [ ] Move the six `GiftCard*` types from `modules/loyalty/src/models.rs` into
      this crate's `models.rs`; re-export from loyalty for one release so
      downstream `use` paths keep compiling
- [ ] `repository.rs` — card and transaction tables (namespace: `giftcards_*`)
- [ ] `service.rs` — issuance and redemption. Every redeem must debit the card
      and record the sale line **in the same transaction**; a partial redeem
      that debits a card without a matching tender line is a money bug
- [ ] Balances are `Money` (`i64` minor units) and must never go negative —
      enforce with a CHECK constraint, not just application code
- [ ] Remove the loyalty re-exports and update this README

See `modules/README.md` for the full promotion path.

> last audited 31-08-26 by docs-auditor
