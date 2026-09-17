<!-- Audit stamp: 2026-07-22 · Hermes-Agent · status: ACCURATE (0 findings) · all owned paths verified: crates/kasirmu-core/src/db/products.rs, apps/desktop-tauri/src/commands/{products,product_variants,categories}.rs, ui/src/features/{products,inventory}, ui/src/api/products.ts, shared-ui/locales/{products,inventory}.ftl; modules/inventory/manifest.json deps [] match; Module trait + Kernel::register/load_all/start_all match platform/kernel API · Status "Phase 2.3 POC" consistent with files still in original locations · RE-AUDITED 31-08 by docs-auditor: manifest.json re-verified (id inventory, v1.0.0, deps [], perms view/edit/adjust); boundary_contract.rs present; the crate now has a parity-tested mirror (repository.rs InventoryRepository, service.rs InventoryService, handlers.rs SaleCompleted stock-decrement) that is NOT the runtime path — on_load/on_start/on_stop are stubs (log + "future phases will…" comments), live CRUD still in crates/kasirmu-core/src/db/products.rs. FIXED: the Lifecycle section had copied those future-phase comments and presented them as current behaviour ("warms caches and verifies stock integrity", "flushes state") — corrected to describe the stubs; body notes the mirror layer; normalized footer -->

# Inventory Module

**Status:** Active (Phase 2.3 — Proof of Concept)

## Overview

The Inventory module owns the entire product and stock management vertical. It handles product CRUD, barcode lookup, product variants (size/colour/flavour), categories, stock adjustments, and inventory tracking.

## Module Info

| Field        | Value            |
|--------------|------------------|
| ID           | `inventory`      |
| Version      | `1.0.0`          |
| Dependencies | `[]`             |
| Permissions  | `inventory:view`, `inventory:edit`, `inventory:adjust` |

## Currently Owns

- **Backend** — Product CRUD, stock, variants, categories (`crates/kasirmu-core/src/db/products.rs`)
- **Commands** — Product and variant Tauri commands (`apps/desktop-tauri/src/commands/products.rs`, `apps/desktop-tauri/src/commands/product_variants.rs`, `apps/desktop-tauri/src/commands/categories.rs`)
- **Frontend** — Product screens (`ui/src/features/products/`), inventory adjustment (`ui/src/features/inventory/`)
- **API** — TypeScript API client (`ui/src/api/products.ts`)
- **Locale** — Fluent translation strings (`shared-ui/locales/products.ftl`, `shared-ui/locales/inventory.ftl`)

In the current phase the runtime product/stock path still runs through the files above (notably `crates/kasirmu-core/src/db/products.rs`). The crate now also carries a parity-tested mirror — `repository.rs` (`InventoryRepository`), `service.rs` (`InventoryService`), and `handlers.rs` (a `SaleCompleted` stock-decrement handler) — pinned by `tests/boundary_contract.rs`, but these are **not yet wired into the runtime** (the lifecycle hooks below are stubs). A subsequent phase will move the implementation fully into `modules/inventory/`.

## Lifecycle

The module implements `foundation::contracts::Module`. Its lifecycle hooks are currently **stubs** — each logs a message and returns `Ok(())` without touching the database or event bus:

1. **`on_load`** — logs "validating configuration"; a future phase will register the `sale.completed` stock-decrement handler, validate tables, and pre-load caches
2. **`on_start`** — logs "ready to manage products"; a future phase will warm caches and verify stock integrity
3. **`on_stop`** — logs "cleaning up"; a future phase will flush pending writes and persist state

## Registration

Registered with the kernel during application setup:

```rust
use modules_inventory::InventoryModule;
use platform_kernel::Kernel;

let mut kernel = Kernel::new();
kernel.register(Box::new(InventoryModule::new()))?;
kernel.load_all()?;
kernel.start_all()?;
```

## Manifest

```json
{
  "id": "inventory",
  "name": "Inventory",
  "version": "1.0.0",
  "dependencies": [],
  "permissions": ["inventory:view", "inventory:edit", "inventory:adjust"]
}
```

> last audited 31-08-26 by docs-auditor
