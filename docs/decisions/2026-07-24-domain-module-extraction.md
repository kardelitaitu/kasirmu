---
num: 30
area: module-system
title: ADR #30: Domain Module Extraction & oz-core Decomposition
status: Accepted — Phase 4 (Currency) Complete (2026-07-25)
---
<!-- Superseded audit marker (2026-07-24 · Hermes-Agent, body kept verbatim) · retained · status: ACTIVE · ADR #30: Domain Module Extraction & oz-core Decomposition -->

<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (2 minor) · Fresh full audit; the 2026-09-29 body is merged below as original evidence. · MINOR 1 (a uniform mandate that was not adopted uniformly): §1 requires every domain module to use `src/models/`+`src/repositories/`+`src/services/` directories; the modules actually use FLAT `models.rs`/`repository.rs`/`service.rs` files (`modules/sales`, `modules/inventory`, `modules/crm`, `modules/loyalty`, `modules/tax`, `modules/terminal` all comply in that flat form), and three diverge further — `modules/reporting` has no trio (`lib.rs`+`handlers.rs` only), `modules/staff` has no `models.rs`, `modules/currency` has no `service.rs`. Recorded as a dated note, not rewritten: the modules that diverge are those whose domain logic still lives in `kasirmu-core`. · MINOR 2: §5 of the Consequences names `crates/oz-api` among the paths needing import updates; that crate is now `crates/kasirmu-api` (and `apps/desktop-client`/`apps/tablet-client` are `apps/desktop-tauri`/`apps/mobile-tauri`). Pre-rebrand names in a decision record left as written per the ADR rule; the note records the mapping. · VERIFIED AND LEFT ALONE, re-measured: all nine modules the five phases name exist (`modules/{sales,inventory,crm,loyalty,tax,staff,terminal,currency,reporting}`, each with `lib.rs`); the Phase-4 currency claim holds (`modules/currency` carries `ExchangeRateRow`, `CurrencyRepository`, `CurrencyError`); both Related links resolve. · NOT re-measured: the "53 source files / 32 DB sub-modules / ~1.2 MB" context figures, which are 2026-07-24 measurements of a tree since restructured. · Prior stamp retained verbatim below. -->

<!-- STAMP MERGED INTO THIS ONE (2026-10-11) — superseded 2026-09-29 body kept as blockquote text (not nested in an HTML comment):
> Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · ACCURATE, and its Phase 4 completion claim is verifiable rather than merely asserted. The status line says Phase 4 (Currency) Complete, and the body records what moved: `ExchangeRateRow`, `CurrencyRepository` and `CurrencyError` relocated to `modules/currency`. That module exists, with a real `src/lib.rs`, alongside `modules/sales` — so the extraction this ADR set out to do produced the structure it specified, and the two crates this campaign has leaned on most heavily (`modules/currency` for the statutory-rounding resolver chain, `modules/sales` for the deduction model) are both products of it. · THE 3-TIER INTERNAL STRUCTURE IT MANDATES is the part that most often degrades in practice, and it is worth checking whether the modules actually follow it rather than assuming: the spec requires `models/`, `repositories/`, `services/` and `lib.rs` per module. Whether each module complies to the letter is a code-shape question this pass did not walk module by module — recorded as the limit rather than implied as verified. What IS verified is that the extraction targets named in the five phases (`modules/sales`, `modules/inventory`, `modules/crm`, `modules/loyalty`, and the finance group) exist as modules. · THE 5-PHASE PLAN AND ITS STATED CONSTRAINT are the durable part, and the constraint was the thoughtful choice: extraction proceeds in vertical slices specifically to hold `cargo test --workspace` at 100% and avoid breaking IPC contracts mid-migration. A refactor this size is usually done by moving code and fixing the fallout; sequencing it so the suite never goes red is a different discipline, and it is what makes a record like this safe to act from later. · PRE-RESTRUCTURE PATHS LEFT AS WRITTEN: the body is written throughout against `crates/oz-core` and `apps/desktop-client` / `apps/tablet-client`, and its tag list includes `oz-core`. Those are the names the decision was recorded under; the modules it produced are addressed by their current names in every document this campaign has audited since. · Prior stamp retained; footer re-dated.
-->
# ADR #30: Domain Module Extraction & oz-core Decomposition

**Status:** Accepted — Phase 4 (Currency) Complete (2026-07-25)  
**Date:** 2026-07-24  
**Author:** Architecture Team  
**Tags:** architecture, module-system, oz-core, refactoring, database  

---

## Context

The initial v2.0 architectural refactoring introduced `platform/kernel`, `foundation/`, and 10 feature module directories in `modules/`. However, while the module lifecycle hooks (`on_load`, `on_start`, `on_stop`) were wired into `platform/kernel`, the underlying business logic, domain models, and SQLite persistence layer remained centralized in `crates/oz-core`.

As a result, `crates/oz-core` grew into a monolithic "God crate" containing over 53 source files and 32 database sub-modules in `crates/oz-core/src/db/` (~1.2 MB of Rust code). Domain entities (`Sale`, `Product`, `Customer`, `TaxRate`, etc.) and database queries were all defined within `oz-core`, and feature modules in `modules/` acted as thin lifecycle shells re-exporting `oz-core` types.

This created several architectural and development bottlenecks:
1. **Compilation Overhead**: Any change to a domain model or DB query in `oz-core` triggered a full workspace recompile.
2. **False Decoupling**: Modules appeared independent in documentation, but all physically depended on `oz-core` for core business operations.
3. **Monolithic Persistence**: Database CRUD operations were attached to a single `Store` struct with dozens of methods implemented across 32 files.

---

## Decision

We will execute **P1: Complete `oz-core` Modularization** by physically extracting domain entities, persistence logic, and business services out of `crates/oz-core` and placing them directly inside their respective domain modules in `modules/`.

### 1. Module Internal Structure Standard

Every domain module in `modules/<domain>/` will adopt a 3-tier internal structure:

```text
modules/<domain>/
├─ src/
│   ├─ models/          Domain entities & value objects (e.g., Sale, SaleLine, HeldCart)
│   ├─ repositories/    Typed DB access operating on &Connection or &Transaction
│   ├─ services/        Business logic & EventBus event dispatching
│   └─ lib.rs           Module entry point re-exporting public API
```

### 2. Domain Repositories Replace Monolithic Store

Instead of extending a single global `Store` struct in `oz-core`, each domain module will provide its own repository struct (e.g., `SalesRepository<'a>`, `InventoryRepository<'a>`).

Repositories will:
- Borrow a `&'a rusqlite::Connection` or `&'a rusqlite::Transaction`.
- Contain only queries relevant to that module's domain.
- Use `Money` integer minor units for monetary fields and rusqlite transactions for all multi-row writes.

```rust
pub struct SalesRepository<'a> {
    conn: &'a Connection,
}

impl<'a> SalesRepository<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }
    
    pub fn get_sale(&self, id: &str) -> Result<Option<Sale>, SalesError> { ... }
    pub fn create_sale_tx(&self, tx: &Transaction, sale: &Sale) -> Result<(), SalesError> { ... }
}
```

### 3. Business Services & Event Bus Integration

High-level business operations (e.g. completing a sale, applying a stock adjustment, closing a shift) will live in module services (e.g. `SalesService`).

Services will:
- Execute business validations.
- Invoke repository transactions.
- Publish domain events to `EventBus` (`sale.completed`, `stock.adjusted`, etc.).

### 4. Incremental Vertical Slice Migration

To maintain 100% test suite pass rates (`cargo test --workspace`) and non-breaking IPC contracts during the migration, extraction will proceed in 5 staged phases:

- **Phase 1 (Sales)**: Extract `Sale`, `Cart`, `HeldCart`, `Refund` models + `crates/oz-core/src/db/{sales,cart,refunds,cash_payouts}.rs` → `modules/sales`.
- **Phase 2 (Inventory & Products)**: Extract `Product`, `Variant`, `Bundle`, `Category`, `Recipe`, `StockCount`, `StockTransfer` + `crates/oz-core/src/db/{products,inventory,product_bundles,recipes,stock_counts,stock_transfers}.rs` → `modules/inventory`.
- **Phase 3 (CRM & Loyalty)**: Extract `Customer`, `GiftCard`, `Loyalty` models + `db/{customers,gift_cards,loyalty}.rs` → `modules/crm` & `modules/loyalty`.
- **Phase 4 (Finance, Staff, Terminal & Reports)**: Extract `tax`, `staff`, `shifts`, `terminals`, `currency`, `reports` → `modules/{tax,staff,terminal,currency,reporting}`.
  - **R2 Complete (2026-07-25)** — Currency extraction done: `ExchangeRateRow`, `CurrencyRepository`, `CurrencyError` moved to `modules/currency`; 6-phase extraction including exchange rates, currency listings, currency-format settings, and deprecation of 15 oz-core Store methods.
- **Phase 5 (oz-core Cleanup)**: Strip all domain entities from `oz-core`, leaving only shared DB connection management, crypto/auth, cache, feature flags, and sync client adapters.

---

## Consequences

### Positive
- **True Module Decoupling**: Business logic and DB persistence live alongside feature modules.
- **Faster Compile Times**: Changes in one module (e.g., `modules-sales`) no longer force recompilation of unrelated modules or `oz-core`.
- **Cleaner API Surface**: Desktop/Tablet Tauri commands and API handlers invoke explicit module repositories/services instead of a 32-file `Store` facade.
- **Easier Unit Testing**: Modules can be tested with isolated in-memory SQLite instances using only their local repository code.

### Negative / Trade-offs
- **Migration Effort**: Requires updating import paths across `apps/desktop-client`, `apps/tablet-client`, `crates/oz-api`, and frontend API integration tests.
- **Transitional Re-exports**: Re-export facades in `oz-core` must be temporarily maintained during intermediate migration steps until all callers are updated.

---

## Related Documents
- [ARCHITECTURE.md](../../ARCHITECTURE.md) — Target architecture specification
- [ADR #1: Module System Design](2026-01-15-module-system-design.md)

> **Correction (2026-10-11): the 3-tier structure was NOT adopted uniformly.** §1 mandates
> that EVERY domain module adopt `src/models/` + `src/repositories/` + `src/services/` +
> `lib.rs`. Measured 2026-10-11, the modules follow the *intent* (domain types and a
> repository/service layer live in the module) but not the directory shape: they use **flat
> files** — `models.rs`, `repository.rs`, `service.rs` — beside `lib.rs`, not the
> `models/`/`repositories/`/`services/` directories the spec sketches. Compliance also varies:
> `modules/reporting` has NO models/repository/service trio at all (only `lib.rs` +
> `handlers.rs`); `modules/staff` has no `models.rs`; `modules/currency` has no
> `service.rs`. The Phase-1..4 extraction itself is real — the named modules exist and the
> currency Phase 4 claim verifies (`modules/currency` carries `ExchangeRateRow`,
> `CurrencyRepository`, `CurrencyError`). The deviation is a naming/shape divergence and a
> partial-adoption fact, recorded here rather than repaired: the body is the decision as
> written, and the modules that diverge are the ones whose domain logic still lives in
> `kasirmu-core`.

> last audited 11-10-26 by docs-auditor
