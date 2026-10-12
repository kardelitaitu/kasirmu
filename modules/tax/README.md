<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (1 major, 1 minor) · Full re-audit; the 2026-07-22-31-08 marker is retained as original evidence below. · MAJOR: the §Currently Owns paragraph claimed the crate "owns the canonical domain types (`TaxRate`, `RoundingMode`), which `kasirmu_core` re-exports". That ownership ended on 2026-09-28 — ADR-61 / C26 moved both types down into `foundation/src/tax.rs`, so `foundation` is the owner and both `modules/tax/src/models.rs` and `crates/kasirmu-core/src/tax_rate.rs` are one-line `pub use foundation::tax::{RoundingMode, TaxRate};` re-exports. Corrected in place (the sentence now says "re-exports", with the move recorded) rather than deleted, because the paths consumers use are unchanged and `modules/tax/tests/boundary_contract.rs` still pins type identity. The module's own `lib.rs:18` doc comment carries the same now-stale "owns" phrasing and is left for its author (code-side). · MINOR: §Lifecycle described the hooks as performing work ("Validates configuration" / "Prepares for tax operations" / "Cleans up resources"); they are stubs — each logs and returns `Ok(())` (`modules/tax/src/lib.rs`). Corrected to match, the same defect the 31-08 pass fixed in the sibling modules but missed here. · VERIFIED AND LEFT ALONE: all owned paths resolve; manifest matches; `TaxRepository`/`TaxService` are parity-tested by `boundary_contract.rs` and not the runtime path; live CRUD is still `crates/kasirmu-core/src/db/tax.rs`. · NOT re-measured: the tax-calc integer-rounding behaviour. -->

<!-- STAMP MERGED INTO THIS ONE (2026-10-11) — superseded bodies kept verbatim:

  [Audit stamp: 2026-07-22 · Hermes-Agent · status: ACCURATE (0 findings) · all owned paths verified: crates/kasirmu-core/src/db/tax.rs, commands/tax.rs, features/tax, api/tax.ts, shared-ui/locales/tax.ftl; modules/tax/src/lib.rs has TaxModule; manifest deps [] + permissions [tax:view,tax:edit] match · Kernel API matches · RE-AUDITED 31-08 by docs-auditor: manifest.json re-verified (id tax, v1.0.0, deps [], perms tax:view/tax:edit); types ownership confirmed (crates/kasirmu-core/src/tax_rate.rs:3 re-exports modules_tax::models; commands/tax.rs uses the re-exported type); boundary_contract.rs (TAX-10) present; module now also has parity-tested TaxRepository (repository.rs, rusqlite, TAX-03 soft-delete) + TaxService (service.rs) that are NOT the runtime path (on_load/on_start are stubs; live CRUD still in crates/kasirmu-core/src/db/tax.rs) — body updated to note this layer; tax is not gated by a feature flag (TaxEngine exists in features.rs but isn't wired to module registration); normalized footer]
-->

# Tax Module

**Status:** Active (Phase 2.5 — Proof of Concept)

## Overview

The Tax module owns the tax configuration vertical. It handles tax rate CRUD, product and category tax assignments, and tax calculation helpers.

## Module Info

| Field        | Value            |
|--------------|------------------|
| ID           | `tax`            |
| Version      | `1.0.0`          |
| Dependencies | `[]`             |
| Permissions  | `tax:view`, `tax:edit` |

## Currently Owns

- **Backend** — Tax rate CRUD and assignments (`crates/kasirmu-core/src/db/tax.rs`)
- **Commands** — Tax Tauri commands (`apps/desktop-tauri/src/commands/tax.rs`)
- **Frontend** — Tax configuration screen (`ui/src/features/tax/`)
- **API** — TypeScript API client (`ui/src/api/tax.ts`)
- **Locale** — Fluent translation strings (`shared-ui/locales/*/tax.ftl`)

This crate is the **contractual layer** for the tax vertical: it re-exports the canonical domain types (`TaxRate`, `RoundingMode`), which `kasirmu_core` also re-exports. **Correction (11-10-26):** the types are no longer *owned* here — ADR-61 / C26 (2026-09-28) moved `TaxRate` and `RoundingMode` down into `foundation/src/tax.rs`, so `foundation` is now the owner, and both `modules/tax/src/models.rs` and `crates/kasirmu-core/src/tax_rate.rs` are one-line `pub use foundation::tax::{RoundingMode, TaxRate};` re-exports. The `modules_tax::*` and `kasirmu_core::tax_rate::*` paths consumers use are unchanged, which is why the identity assertions in `modules/tax/tests/boundary_contract.rs` still hold. The implementation layers above remain in their original locations, and the boundary between this crate and those layers is pinned by the cross-layer contract tests in `modules/tax/tests/boundary_contract.rs` (manifest registration ↔ type identity ↔ DB behaviour parity ↔ serde wire shape). The crate now also carries a parity-tested `TaxRepository` (`repository.rs`, rusqlite-backed, honouring the TAX-03 `is_active` soft-delete) and a thin `TaxService` (`service.rs`) that mirror the `kasirmu_core` CRUD; these are pinned by the boundary contract but are **not yet the runtime path** — the live tax CRUD still runs through `crates/kasirmu-core/src/db/tax.rs`, and the module's `on_load`/`on_start` are lifecycle stubs. A future phase may complete the move into this crate as the module system matures.

## Lifecycle

The module implements `foundation::contracts::Module`. Its lifecycle hooks are currently **stubs** — each logs a message and returns `Ok(())`; none touches the database or event bus yet (`modules/tax/src/lib.rs`):

1. **`on_load`** — logs "validating configuration" (a future phase will register event handlers and validate tables)
2. **`on_start`** — logs "ready to manage tax rates"
3. **`on_stop`** — logs "cleaning up"

## Registration

Registered with the kernel during application setup:

```rust
use modules_tax::TaxModule;
use platform_kernel::Kernel;

let mut kernel = Kernel::new();
kernel.register(Box::new(TaxModule::new()))?;
kernel.load_all()?;
kernel.start_all()?;
```

## Manifest

```json
{
  "id": "tax",
  "name": "Tax",
  "version": "1.0.0",
  "dependencies": [],
  "permissions": ["tax:view", "tax:edit"]
}
```

> last audited 11-10-26 by docs-auditor
