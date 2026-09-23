---
num: 30
area: module-system
title: ADR #30: Domain Module Extraction & oz-core Decomposition
status: Accepted — Phase 4 (Currency) Complete (2026-07-25)
---
<!-- Audit stamp: 2026-07-24 · Hermes-Agent · status: ACTIVE · ADR #30: Domain Module Extraction & oz-core Decomposition -->

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

> last audited 09-08-26 by buffy
> audit: Phase 1 Core Architecture & API Docs Audit

> status: ACCURATE (0 findings) · verified accurate: cargo check passed, no structural orphans, no stale version headers

