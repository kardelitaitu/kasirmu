---
num: 61
area: architecture
title: ADR-61: Architecture Boundary Rule Tiers — a named rule for re-export-only edges and a governed expiry
status: Implemented (2026-09-28) — the core-type-shim rule, the quarter-renewal invariant and the baseline re-tier landed; the foundation type move that retires the seven shims is sequenced, not done
---

# ADR-61: Architecture Boundary Rule Tiers

**Status:** Implemented (2026-09-28). The named rule, the classification, the governed expiry
and the re-tiered baseline are in the tree and gated. The foundation type move that retires the
seven re-export edges is sequenced behind a compatibility ruling and is NOT part of this change.
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

**D6 — The currency edge retires with the others, not before them.** All eight entries are one
piece of work: `CurrencyError` and the currency row types move to foundation, the shims then
retire on a compatibility ruling, and the Cargo edges follow.

## Consequences

- **Good:** the seven edges are named for what they are, and the deadline can no longer be
  extended by editing a date.
- **Cost, accepted:** the checker does one extra walk of core's source, and a mis-set baseline
  key turns a tracked entry into a blocking finding rather than a silent pass.
- **Still red on 2026-11-07 unless the type move lands.** That is the point: the expiry is now a
  governed promise instead of an unread date. The dates were NOT bumped (C26, D3).
- **Verification:** `python scripts/verify-architecture-boundaries.py` → 8 tracked / 0 blocking /
  0 stale, exit 0, with 7 `core-type-shim` + 1 `core-upward-dependency`;
  `node --test scripts/__tests__/verify-architecture-boundaries.test.mjs` → 32 pass / 0 fail,
  including a refusal case, an accepted-renewal case and a no-source non-vacuity case.

## References

- `scripts/verify-architecture-boundaries.py` — `RULES`, `core_edge_kinds`, `add_months`, `MAX_TERM_MONTHS`
- `scripts/architecture-boundaries-baseline.json` — the eight entries
- `scripts/__tests__/verify-architecture-boundaries.test.mjs`
- `manager-codebase-review-checklist.md` — item C26 and the D3 correction
