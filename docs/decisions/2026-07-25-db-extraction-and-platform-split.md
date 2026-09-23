---
num: 32
area: database
title: ADR #32: DB Layer Extraction (R2) & Platform File Split (R5)
status: Proposed
---
# ADR #32: DB Layer Extraction (R2) & Platform File Split (R5)

**Status:** Proposed
**Date:** 2026-07-25  
**Author:** Architecture Team  
**Tags:** architecture, refactoring, oz-core, platform, monolith-split  

---

## Context

Two structural debts remain from the P1/P10 stabilisation sprint:

### R2 — `oz-core/src/db/` Monolith

ADR #30 (2026-07-24) defined a 5-phase plan to extract domain logic from `crates/oz-core` into `modules/<domain>/`. Phase 0 (model extraction) completed: every module (`sales`, `inventory`, `crm`, `loyalty`, `staff`, `terminal`, `settings`, `tax`, `reporting`) has `models.rs`, `repository.rs`, `service.rs`, and `lib.rs` with the standard 3-tier structure. However, **the DB query layer was never migrated**. All 32 files in `crates/oz-core/src/db/` still contain the real SQLite CRUD as `impl Store<'_>` methods on a monolithic `Store` struct (defined in `crates/oz-core/src/db/mod.rs:107`).

Current state:

| File | Lines | Module |
|------|-------|--------|
| `crates/oz-core/src/db/sales.rs` | 3,521 | `modules/sales` |
| `crates/oz-core/src/db/cart.rs` | — | `modules/sales` |
| `crates/oz-core/src/db/refunds.rs` | — | `modules/sales` |
| `crates/oz-core/src/db/cash_payouts.rs` | — | `modules/sales` |
| `crates/oz-core/src/db/products.rs` | — | `modules/inventory` |
| `crates/oz-core/src/db/inventory.rs` | — | `modules/inventory` |
| `crates/oz-core/src/db/stock_counts.rs` | — | `modules/inventory` |
| `crates/oz-core/src/db/stock_transfers.rs` | — | `modules/inventory` |
| `crates/oz-core/src/db/product_bundles.rs` | — | `modules/inventory` |
| `crates/oz-core/src/db/recipes.rs` | — | `modules/inventory` |
| `crates/oz-core/src/db/customers.rs` | — | `modules/crm` |
| `crates/oz-core/src/db/gift_cards.rs` | — | `modules/crm` |
| `crates/oz-core/src/db/loyalty.rs` | — | `modules/loyalty` |
| `crates/oz-core/src/db/staff.rs` | — | `modules/staff` |
| `crates/oz-core/src/db/terminals.rs` | — | `modules/terminal` |
| `crates/oz-core/src/db/terminal_profiles.rs` | — | `modules/terminal` |
| `crates/oz-core/src/db/terminal_overrides.rs` | — | `modules/terminal` |
| `crates/oz-core/src/db/settings.rs` | — | `modules/settings` |
| `crates/oz-core/src/db/tax.rs` | — | `modules/tax` |
| `crates/oz-core/src/db/reports.rs` | — | `modules/reporting` |
| `crates/oz-core/src/db/shifts.rs` | — | `modules/staff` |
| `crates/oz-core/src/db/offline.rs` | — | `modules/sales` (sync) |
| `crates/oz-core/src/db/kds.rs` | — | `modules/sales` |
| `crates/oz-core/src/db/audit.rs` | — | stay in `oz-core` |
| `crates/oz-core/src/db/store_profiles.rs` | — | stay in `oz-core` |
| `crates/oz-core/src/db/suppliers.rs` | — | `modules/inventory` |
| `crates/oz-core/src/db/purchase_orders.rs` | — | `modules/inventory` |
| `crates/oz-core/src/db/payments.rs` | — | `modules/sales` |
| `crates/oz-core/src/db/promotions.rs` | — | `modules/sales` |
| `crates/oz-core/src/db/tables.rs` | — | `modules/sales` |
| `crates/oz-core/src/db/workspaces.rs` | — | stay in `oz-core` |

Every change to any of these files forces a recompile of `oz-core` and all 29 downstream crates. The `modules/sales/src/repository.rs` exists at 180 lines but is a **duplicate** of a subset of `oz-core/src/db/sales.rs` — not a replacement.

### R5 — Platform Oversized Files

Two files in the platform layer exceed healthy module size:

| File | Total Lines | Production | Tests | Test % |
|------|------------|------------|-------|--------|
| `platform/core/src/settings.rs` | 2,131 | ~908 | ~1,223 | 57% |
| `platform/kernel/src/kernel.rs` | 1,558 | ~686 | ~872 | 56% |

Both are flat single files with no sub-module structure, despite the project having a well-established directory-based sub-module convention (see `platform/core/src/database/`).

---

## Decision

We will execute R2 and R5 as two independent but parallel tracks. R2 is the more complex effort; R5 is a mechanical file-split that can be done in a single focused work session.

---

### R2 — DB Query Migration Strategy

#### Guiding Principle: Dual-Path, Not Big Bang

The `Store` struct is referenced from hundreds of call sites across `apps/`, `crates/`, and `modules/`. A blocking migration that requires all callers to switch simultaneously would take weeks. Instead we use a **dual-path** strategy:

1. **Copy** the `impl Store<'_>` methods from each `crates/oz-core/src/db/<domain>.rs` into the corresponding `modules/<domain>/src/repository.rs` as `impl Repository<'_>` methods.
2. **Don't remove** the originals yet — `Store` continues to work.
3. Migrate callers one at a time, module by module.
4. After all callers are migrated, delete the originals and remove the `Store` facade.

#### Phase Order

Migrate in this order (fewest callers → most callers to build confidence):

| Phase | Module | DB Files | Estimated Call Sites |
|-------|--------|----------|---------------------|
| 1 | `modules/currency` | `exchange_rate.rs` (in `oz-core` not `db/`) | ~5 |
| 2 | `modules/tax` | `db/tax.rs` | ~10 |
| 3 | `modules/settings` | `db/settings.rs` | ~15 |
| 4 | `modules/loyalty` | `db/loyalty.rs` | ~10 |
| 5 | `modules/crm` | `db/customers.rs`, `db/gift_cards.rs` | ~20 |
| 6 | `modules/staff` | `db/staff.rs`, `db/shifts.rs` | ~25 |
| 7 | `modules/terminal` | `db/terminals.rs`, `db/terminal_profiles.rs`, `db/terminal_overrides.rs` | ~15 |
| 8 | `modules/inventory` | `db/products.rs`, `db/inventory.rs`, `db/stock_counts.rs`, `db/stock_transfers.rs`, `db/product_bundles.rs`, `db/recipes.rs`, `db/suppliers.rs`, `db/purchase_orders.rs` | ~60 |
| 9 | `modules/sales` | `db/sales.rs` (3,521 lines!), `db/cart.rs`, `db/refunds.rs`, `db/cash_payouts.rs`, `db/payments.rs`, `db/promotions.rs`, `db/tables.rs`, `db/kds.rs`, `db/offline.rs` | ~120 |
| 10 | Cleanup | Remove migrated files from `oz-core/src/db/`, slim `mod.rs` | — |

#### Migration Pattern

For each `db/<domain>.rs` file:

1. Add methods to the existing `Repository` struct in `modules/<domain>/src/repository.rs`.
2. Repository structs borrow `&'a Connection` (no `Cache`, no `terminal_id` — those stay in `Store`).
3. Where a method references `self.cache` or `self.terminal_id`, extract the cache/terminal logic into a helper and pass the cache handle as a parameter.
4. Re-export domain-specific types from `modules/<domain>/src/models.rs` (most are already there).
5. Leave the original `oz-core/src/db/<domain>.rs` in place as a delegating wrapper until all callers are migrated.

Example migration of a `Store` method:

```rust
// OLD — in oz-core/src/db/sales.rs
impl Store<'_> {
    pub fn get_sale(&self, id: &str) -> Result<Option<Sale>, CoreError> {
        // ... SQL query on self.conn ...
    }
}

// NEW — in modules/sales/src/repository.rs
impl<'a> SalesRepository<'a> {
    pub fn get_sale(&self, id: &str) -> Result<Option<Sale>, anyhow::Error> {
        // ... same SQL query on self.conn ...
    }
}

// DELEGATING WRAPPER — in oz-core/src/db/sales.rs (transitional)
impl Store<'_> {
    pub fn get_sale(&self, id: &str) -> Result<Option<Sale>, CoreError> {
        let repo = SalesRepository::new(self.conn);
        repo.get_sale(id).map_err(|e| CoreError::Internal(e.to_string()))
    }
}
```

#### Things That Stay in `oz-core`

These DB files are infrastructure, not domain — they stay:

| File | Reason |
|------|--------|
| `db/mod.rs` | `Store` struct definition + backup/export |
| `db/audit.rs` | Cross-cutting audit log, touches all domains |
| `db/store_profiles.rs` | Store-level config, not a module |
| `db/workspaces.rs` | Workspace routing, not a domain |

#### Caller Migration Order

For each module phase, migrate callers in this order:
1. `modules/<domain>/` — the module's own `service.rs` and `lib.rs`
2. `apps/desktop-client/src/commands/` — Tauri command handlers
3. `apps/tablet-client/src/commands/` — Tauri command handlers
4. `crates/oz-api/src/routes/` — HTTP API handlers
5. `crates/oz-core/src/` — any remaining references (should be few)

#### Verification Gate

After each phase, run:
```bash
cargo test --workspace --no-fail-fast
cargo clippy --workspace -- -D warnings
```

After phase 10 (cleanup), confirm:
```bash
# No domain .rs files remain in oz-core/src/db/ (except audit, store_profiles, workspaces)
rg "mod (sales|products|customers|...)" crates/oz-core/src/db/mod.rs
```

---

### R5 — Platform File Splits

#### `platform/core/src/settings.rs` (2,131 lines)

Split into a `settings/` directory with 4 files:

```
platform/core/src/
├── settings/
│   ├── mod.rs          # re-exports, the `Settings` struct stub
│   ├── raw.rs          # "Raw key-value helpers" impl block (~200 lines)
│   ├── keys.rs         # `pub mod keys` — setting key constants (~135 lines)
│   ├── typed.rs        # "Typed store configuration helpers" impl block (~550 lines)
│   └── tests.rs        # extracted #[cfg(test)] (~1,223 lines)
├── settings.rs         # deleted after split
```

**Migration steps:**
1. Create `settings/` directory.
2. Move each section to its file, keeping visibility identical.
3. `mod.rs` re-exports `pub use raw::{...}` etc. so existing `use platform_core::settings::*` imports continue working.
4. Delete `settings.rs`.
5. `cargo test -p platform-core` passes without changes to any caller.

#### `platform/kernel/src/kernel.rs` (1,558 lines)

Split into a `kernel/` directory with 5 files:

```
platform/kernel/src/
├── kernel/
│   ├── mod.rs          # re-exports, `Kernel` struct definition, `impl Default`
│   ├── types.rs        # `ModuleStatus` enum, dependency types (~30 lines)
│   ├── lifecycle.rs    # registration, load_all, start_all, stop_all, start_module, stop_module (~570 lines)
│   ├── dependency.rs   # `HasDependencies`, `resolve_dependencies`, `collect_dependencies` (~60 lines)
│   └── tests.rs        # extracted #[cfg(test)] (~872 lines)
├── kernel.rs           # deleted after split
```

**Migration steps:**
1. Create `kernel/` directory.
2. Move each section to its file.
3. Carefully preserve `pub(crate)` visibility on `resolve_dependencies`.
4. `mod.rs` re-exports `pub use types::ModuleStatus; pub use lifecycle::Kernel;` etc.
5. Delete `kernel.rs`.
6. `cargo test -p platform-kernel` passes without changes to any caller.

---

## Consequences

### Positive
- **Compile-time isolation:** Changes to a domain's DB queries no longer force recompilation of unrelated modules.
- **Platform clarity:** `platform-core` and `platform-kernel` become maintainable sub-module directories like every other sizable module in the project.
- **Incremental safety:** The dual-path R2 migration means no risky big-bang cutover — each phase is independently testable.
- **Cleaner public API:** Callers eventually use `SalesRepository::new(&conn).get_sale(id)` instead of `Store { conn: &conn }.get_sale(id)`.

### Negative / Trade-offs
- **R2 phases 1–9 require updating imports.** Each phase touches 10–120 call sites. The migration wrapper pattern means callers can be updated one file at a time, but the total volume across all 9 phases is ~280 call sites.
- **`oz-core` still depends on all modules** during the migration (already true — see `oz-core/Cargo.toml`). After phase 10, `oz-core` should NOT depend on `modules-sales`, `modules-inventory`, etc.
- **R5 is purely mechanical** but the test extraction (~1,200 and ~870 lines) must preserve all assertions.

---

## Related Documents

- [ADR #30: Domain Module Extraction](2026-07-24-domain-module-extraction.md) — Original P1 modularization plan
- [ARCHITECTURE.md](../../ARCHITECTURE.md) — Target architecture specification
- `modules/sales/src/repository.rs` — Existing partial repository template
- `platform/core/src/database/` — Existing sub-module directory pattern

> last audited 09-08-26 by buffy
> audit: Phase 1 Core Architecture & API Docs Audit

> status: ACCURATE (0 findings) · verified accurate: cargo check passed, no structural orphans, no stale version headers

