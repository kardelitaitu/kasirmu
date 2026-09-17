<!-- Audit stamp: 2026-07-22 · Hermes-Agent · status: ACCURATE (0 findings) · all owned paths verified: crates/kasirmu-core/src/db/sales.rs, apps/desktop-client/src/commands/pos.rs, ui/src/features/sales, ui/src/api/sales.ts, ui/src/locales/sales.ftl; modules/sales/manifest.json deps [inventory] match; Module trait + Kernel::register/load_all/start_all match platform/kernel API · Status "Phase 2.2 POC" consistent with files still in original locations · RE-AUDITED 31-08 (cont) by docs-auditor: manifest deps [inventory] + perms re-verified; boundary_contract.rs present; the crate has a parity-tested SalesRepository/SalesService mirror NOT wired into runtime (live pipeline still in crates/kasirmu-core/src/db/sales.rs). FIXED: Lifecycle claimed on_load 'checks dependencies' and on_start 'Initializes state' — both are "future phases" comments (lib.rs:85-108 are stubs); corrected to describe the stubs. Overview PROMO-3/COR-7/LOY-03 checkout behaviours re-confirmed; normalized footer -->

# Sales Module

**Status:** Active (Phase 2.2 — Proof of Concept)

## Overview

The Sales module is the core point-of-sale vertical. It owns the entire sale pipeline: cart management, checkout (promotions applied via the `kasirmu-core` promotion engine — PROMO-3; submissions replay-guarded by a client `attemptId` → per-split `idempotency_key` — COR-7, desktop), payment processing, sales history, void/refund (loyalty points reversed inside the refund transaction — LOY-03), held orders, and end-of-day reports.

## Module Info

| Field        | Value        |
|--------------|--------------|
| ID           | `sales`      |
| Version      | `1.0.0`      |
| Dependencies | `[inventory]` |
| Permissions  | `sales:void`, `sales:refund`, `reports:view` |

## Currently Owns

- **Backend** — Sales CRUD and business logic (`crates/kasirmu-core/src/db/sales.rs`)
- **Commands** — POS pipeline Tauri commands (`apps/desktop-client/src/commands/pos.rs`)
- **Frontend** — Sale screens (`ui/src/features/sales/`)
- **API** — TypeScript API client (`ui/src/api/sales.ts`)
- **Locale** — Fluent translation strings (`ui/src/locales/sales.ftl`)

In the current phase the runtime sale pipeline still runs through the files above (notably `crates/kasirmu-core/src/db/sales.rs`). The crate now also carries a parity-tested mirror — `repository.rs` (`SalesRepository`) and `service.rs` (`SalesService`) — pinned by `tests/boundary_contract.rs`, but these are **not yet wired into the runtime** (the lifecycle hooks below are stubs). A subsequent phase will move the implementation fully into `modules/sales/`.

## Lifecycle

The module implements `foundation::contracts::Module`. Its lifecycle hooks are currently **stubs** — each logs a message and returns `Ok(())`; none touch the database or event bus yet:

1. **`on_load`** — logs "validating configuration" (a future phase will register event handlers, validate tables, and check the `inventory` dependency)
2. **`on_start`** — logs "ready to process sales" (a future phase will spawn the sync watcher and initialize in-memory state)
3. **`on_stop`** — logs "cleaning up" (a future phase will flush pending writes and cancel background tasks)

## Registration

Registered with the kernel during `AppState::new()`:

```rust
use modules_sales::SalesModule;
use platform_kernel::Kernel;

let mut kernel = Kernel::new();
kernel.register(Box::new(SalesModule::new()))?;
kernel.load_all()?;
kernel.start_all()?;
```

## Manifest

```json
{
  "id": "sales",
  "name": "Sales",
  "version": "1.0.0",
  "dependencies": ["inventory"],
  "permissions": ["sales:void", "sales:refund", "reports:view"]
}
```

> last audited 31-08-26 by docs-auditor
