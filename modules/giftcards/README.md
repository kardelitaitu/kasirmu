# Gift Cards Module

<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (1 major) · Re-audit of the gift-cards stub page; the 2026-08-31 stamp is merged at the bottom as plain text (delimiters stripped so it cannot nest). · MAJOR: the page's central claim about WHERE the six stored-value types live was stale in the same way this campaign has now recorded in several module READMEs. It said they "currently" sit in `modules/loyalty/src/models.rs`, which "defines and re-exports" them. They do not: that file is a 13-line shim (`pub use foundation::loyalty::*;`) because the types MOVED into `foundation/src/loyalty.rs` on 2026-09-28 under ADR-61/C26, precisely so `kasirmu-core` can re-export them without depending on a module. All six definitions are in foundation/src/loyalty.rs (GiftCard :97, GiftCardTransaction :142, GiftCardWithTransactions :163, IssueGiftCardInput :172, GiftCardFilter :189, RedeemGiftCardResult :202), and `modules/loyalty/src/lib.rs` re-exports the six by name, which is why downstream `use modules_loyalty::GiftCard` still resolves. The promotion checklist inherited the same mistake — step 1 told a promoter to move the types "from modules/loyalty/src/models.rs", when the move is now out of `foundation`. · WHY IT MATTERED: this is a promotion checklist, i.e. instructions a future author follows literally. Sending them to a file that no longer holds the types is the failure mode the skill exists to catch, and the sibling `modules/loyalty/README.md` had ALREADY been corrected to say `foundation::loyalty` (2026-10-08) while this page was not — a one-sided repair across a pair, the same class recorded in the website docs. · VERIFIED AND LEFT ALONE: manifest.json declares exactly giftcards:view/issue/redeem/manage and dependencies ["sales"], matching the Module Info table; `dependencies()` returns &["sales"] with the same rationale comment; GiftCardsModule is genuinely lifecycle-only — on_load logs "stub — no handlers registered yet" and no subscribe/handler call exists in the crate; Feature::GiftCards maps to "gift-cards" (features.rs:489); the GiftCard* Debug redaction the old stamp mentioned is in foundation now. · The live implementation paths added to the body (kasirmu-core/src/db/gift_cards.rs, both Tauri command files, ui/src/features/gift-cards/, ui/src/api/giftCards.ts) were each confirmed present. · NOT re-measured: the redemption transaction behaviour the checklist's money-bug warning describes — that is a test-run question. · Superseded 2026-08-31 body follows as plain text:

Superseded audit stamp: 2026-08-31 · docs-auditor · status: ACCURATE (0 findings) · verified against HEAD: GiftCard* types live in modules/loyalty/src/models.rs; manifest.json declares giftcards:view/issue/redeem/manage; GiftCardsModule is a lifecycle-only stub; Feature::GiftCards flag exists. -->

<!-- Audit stamp: 2026-08-31 · docs-auditor · status: ACCURATE (0 findings) · verified against HEAD: GiftCard* types live in modules/loyalty/src/models.rs; manifest.json declares giftcards:view/issue/redeem/manage; GiftCardsModule is a lifecycle-only stub (on_load/on_start log 'stub — no handlers registered yet'); Feature::GiftCards flag exists -->

**Status:** Stub (lifecycle only — the domain types now live in `foundation::loyalty`, re-exported through `modules/loyalty`)

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

This module corrects a misplaced ownership. The six stored-value types —
`GiftCard`, `GiftCardTransaction`, `GiftCardWithTransactions`,
`IssueGiftCardInput`, `GiftCardFilter` and `RedeemGiftCardResult` — are defined in
`foundation/src/loyalty.rs` (they MOVED there on 2026-09-28 under ADR-61/C26, so
that `kasirmu-core` can re-export them without depending on a module), and
`modules/loyalty/src/models.rs` re-exports them through `pub use foundation::loyalty::*`.
Loyalty itself re-exports the six by name from its `lib.rs`, which is why downstream
`use modules_loyalty::GiftCard` paths still compile.

Gift cards are stored value; loyalty is points and tiers. They are different
verticals with different permissions and different audit requirements, and they
were only ever colocated by convenience — the relocation to `foundation` moved
them out of `loyalty`'s *source* but not out of its *public surface*.

The live implementation is `crates/kasirmu-core/src/db/gift_cards.rs`, the Tauri
commands are in `apps/{desktop,mobile}-tauri/src/commands/gift_cards.rs`, and the UI
is `ui/src/features/gift-cards/` with `ui/src/api/giftCards.ts`.

## Currently Owns

Nothing yet — `GiftCardsModule` registers with the kernel, declares its
dependency on `sales`, and logs its lifecycle transitions.

## Promotion Checklist

- [ ] Move the six `GiftCard*` types from `foundation/src/loyalty.rs` into
      this crate's `models.rs`; re-export from `modules/loyalty` for one release so
      downstream `use` paths keep compiling (the types already sit outside
      `loyalty`, so this is now a move from `foundation`, not out of the module)
- [ ] `repository.rs` — card and transaction tables (namespace: `giftcards_*`)
- [ ] `service.rs` — issuance and redemption. Every redeem must debit the card
      and record the sale line **in the same transaction**; a partial redeem
      that debits a card without a matching tender line is a money bug
- [ ] Balances are `Money` (`i64` minor units) and must never go negative —
      enforce with a CHECK constraint, not just application code
- [ ] Remove the loyalty re-exports and update this README

See `modules/README.md` for the full promotion path.

> last audited 11-10-26 by docs-auditor
