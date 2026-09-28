---
num: 61
area: architecture
title: ADR-61: Architecture Boundary Rule Tiers — a named rule for re-export-only edges and a governed expiry
status: Implemented (2026-09-28) — the core-type-shim rule, the quarter-renewal invariant and the baseline re-tier, the currency edge closure and six type-shim edges (crm, tax, terminal, inventory, loyalty, sales) landed; the model-type move that retires the seven shims is sequenced, not done
---

# ADR-61: Architecture Boundary Rule Tiers

**Status:** Implemented (2026-09-28); the currency edge is CLOSED. The named rule, the classification, the governed expiry
and the re-tiered baseline are in the tree and gated. The currency edge and SIX type-shim edges (`crm`, `tax`, `terminal`, `inventory`, `loyalty`, `sales`)
are closed by moving those types — with their impls and their unit tests — down to `foundation`; ONE
entry remains (`staff`), and it is the one that cannot close the same way: its `Role` calls
`platform_core::rbac`, and `platform-core` depends on `foundation`, so moving it down would be a
cycle. `foundation` now depends on `tracing` and `chrono`, each for a moved member whose behaviour
could not be left behind (a documented diagnostic; a load-bearing clock read). `foundation`
now depends on `tracing`, because `ProductType::parse_stored_or_default`'s documented warning had to
move with its type and every consumer of that parser sits above the module.
**Date:** 2026-09-28
**Recorded against:** branch `0.0.40`
**Tags:** architecture, boundaries, gates, cargo, dependency-debt, expiry

## Context

**1. The checker could not tell two different debts apart.** Every rule was derived from the
Cargo graph alone, so all eight `kasirmu-core` upward edges were reported as
`core-upward-dependency` whatever the source actually did with the module.

**2. Measured, they are not one debt.** Over the 305 `.rs` files under
`crates/kasirmu-core/src`, with comments and string contents masked:

| edge | `modules_<m>::` mentions | on a `use` line | verdict |
|---|---|---|---|
| `crm`, `inventory`, `loyalty`, `sales`, `staff`, `tax`, `terminal` | 1-3 each | all of them | re-export only |
| `currency` | 34 | 1 | real code |

The one comment that looks like a seventh use (`migrations_tests.rs` naming
`modules_tax::models::RoundingMode`) is prose; masking it is what keeps the count honest.

**3. Every entry expired on the same day, and nothing governed the date.** Eight entries,
`introduced: 2026-08-06`, `expires: 2026-11-06` — so a day nobody touches the boundary reddens
every push. Worse, extending one was indistinguishable from editing a date: no input this
checker receives can tell that a bump happened.

**4. The real edge cannot be closed by deletion.** `crates/kasirmu-core/src/error.rs:188-196` is
`impl From<modules_currency::CurrencyError> for CoreError`, so core's public error type names a
module type and cannot stop depending on the module. The fifteen deprecated `Store` shims in
`crates/kasirmu-core/src/db/settings.rs` are deliberately retained: `src/db/settings_tests.rs:1`
and `tests/settings_integration.rs:9` carry `#![allow(deprecated)]` with the reason written beside
it — "Deprecated currency methods tested here for DB back-compat verification".

## Decision

**D1 — A re-export-only edge gets its own name.** `core-type-shim` joins `RULES` (severity P2,
its own hint). It is reported, not allowed: the edge is still debt, it is now debt with the right
name and the right fix.

**D2 — The classification is earned from the source, positive evidence only.** `core_edge_kinds`
walks `crates/kasirmu-core/src` once, masks comments and strings, and calls an edge a shim only
when it mentions `modules_<target>::` at least once AND every mention sits on a `use`/`pub use`
line. Zero mentions returns "real", never "shim": a tree with no crate source examines nothing,
and reading that absence as proof of a re-export would downgrade the rule for every tree this
checker cannot see. The failure direction is deliberate — a mis-set baseline key makes the
finding NEW and blocking, never silent.

**D3 — An exemption runs one calendar quarter.** `MAX_TERM_MONTHS = 3`, applied with calendar
arithmetic (`add_months`) rather than a 90-day delta, so `2026-08-06 + 3 months = 2026-11-06`
exactly. That is the term this baseline already used, which is why the constant is re-derivable
rather than invented.

**D4 — A longer exemption is a recorded decision.** An entry may carry
`renewals: [{ on, reason }]`. Each renewal is validated (real date, not in the future, not after
the expiry it extends, non-empty reason) and moves the anchor forward one quarter. A bump with no
renewal is refused as malformed input (exit 2), so extending a deadline now requires writing down
why.

**D5 — The term rule governs live exemptions only.** It is gated on `expires >= today`: a past
expiry is already an expired finding (exit 1), and refusing it as malformed input would report
governed history as a broken file.

**D6 — The currency edge is closed by moving the shared error type DOWN, not by deleting it.**
`CurrencyError` moves to `platform-core`, NOT to `foundation` — the payload forbids that: the enum
carries `rusqlite::Error` in its `Db` variant and foundation deliberately has no database
dependency. `platform-core` already depends on rusqlite and is already a dependency of both
`kasirmu-core` and `modules-currency`, so the move costs no new edge. `modules-currency` re-exports
the type so every existing path keeps resolving, and the fifteen deprecated `Store` shims retire
once the repository is the only caller. **Implemented 2026-09-28** (`596ab8f66`, `a6b32370c`): the
edge is closed, the baseline entry is DELETED rather than renewed, and `kasirmu-core` keeps
`modules-currency` as a dev-dependency only — which this checker ignores by design, because a
dev-dependency is not a shipped layering edge.

## Consequences

- **Good:** the seven edges are named for what they are, and the deadline can no longer be
  extended by editing a date.
- **Cost, accepted:** the checker does one extra walk of core's source, and a mis-set baseline
  key turns a tracked entry into a blocking finding rather than a silent pass.
- **Seven edges are gone (currency, crm, tax, terminal, inventory, loyalty, sales); ONE entry remains
  red on 2026-11-07 — and it needs a different move from the seven that worked.** That is the point: the expiry is now a governed promise instead of an unread date. The
  dates were NOT bumped (C26, D3).
- **Verified this pass, and what that excludes:** `cargo check -p kasirmu-core --all-targets` is
  clean and warning-free, `cargo check --workspace --exclude kasirmu-mobile` exits 0, and
  `cargo test -p kasirmu-core --test currency_integration --test settings_integration` is
  38 + 86 passed / 0 failed. `kasirmu-mobile` is excluded because it does not compile for an
  unrelated reason (an uncommitted C28 `pos.rs` split by another lane), so mobile is covered by a
  source read instead: its nine currency calls are `repo.`-receiver calls on `CurrencyRepository`.
- **Verification:** `python scripts/verify-architecture-boundaries.py` → 8 tracked / 0 blocking /
  0 stale, exit 0, with 7 `core-type-shim` + 1 `core-upward-dependency`;
  `node --test scripts/__tests__/verify-architecture-boundaries.test.mjs` → 32 pass / 0 fail,
  including a refusal case, an accepted-renewal case and a no-source non-vacuity case.

## References

- `scripts/verify-architecture-boundaries.py` — `RULES`, `core_edge_kinds`, `add_months`, `MAX_TERM_MONTHS`
- `scripts/architecture-boundaries-baseline.json` — the eight entries
- `scripts/__tests__/verify-architecture-boundaries.test.mjs`
- `manager-codebase-review-checklist.md` — item C26 and the D3 correction
