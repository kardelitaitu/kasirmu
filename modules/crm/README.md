<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE — 0 findings · Fresh full audit; the footer read 31-08-26 while the only stamp was 2026-07-22, so the file was carrying a freshness claim no stamp backed (the footer was bumped on 31-08 without adding evidence). That split is closed here: one stamp, footer matched to it. · EVERY "Currently Owns" PATH VERIFIED PRESENT at HEAD: `crates/kasirmu-core/src/db/customers.rs`, `apps/desktop-tauri/src/commands/customers.rs`, `ui/src/features/customers/`, `ui/src/api/customers.ts`, `shared-ui/locales/customers.ftl` (plus the `customers.id.ftl` Indonesian bundle the row does not enumerate, which is correct — the row does not claim to be exhaustive). · The mirror-implementation note is still true and still the point: `modules/crm/tests/boundary_contract.rs` does NOT exist, `repository.rs`/`service.rs` export `CrmRepository`/`CrmService` from `modules/crm/src/lib.rs`, and runtime customer CRUD still runs through kasirmu-core — so "thin wrapper / not-yet-wired mirror" remains the measured description, not a euphemism. · Manifest block re-checked against `modules/crm/manifest.json`: id/name/version/dependencies/permissions all match. The manifest file also carries `description` and `capabilities` ("read:crm","write:crm") that this README's JSON snippet omits — left as written deliberately: the snippet is labelled by its section as the module's identity metadata, and the authoritative field list is `docs/specs/module-manifest-format.md` (repaired this round to name all nine fields), so duplicating the full manifest here would create a second copy to drift. · Lifespan hooks re-read at `modules/crm/src/lib.rs`: `id()` returns "crm", the three hooks log and return `Ok(())`, and `on_load`'s "Validates configuration" phrasing matches the log text it emits; the "generic phrasing matches their log messages" note from 31-08 still holds. · `Kernel::register(Box<dyn Module>) -> Result<(), KernelError>` confirmed at `platform/kernel/src/kernel/lifecycle.rs:69`, so the README's `? ` usage in its registration snippet compiles as written. `CrmModule::new()` is registered at `platform/startup/src/lib.rs:125`. · NOT re-measured: the customer-CRUD behavior of the kasirmu-core implementation, which is outside a module README's claim surface. -->

<!-- STAMP MERGED INTO THIS ONE (2026-10-11) — superseded body kept verbatim:
<!-- Audit stamp: 2026-07-22 · Hermes-Agent · status: ACCURATE (0 findings) · all owned paths verified: crates/kasirmu-core/src/db/customers.rs, apps/desktop-tauri/src/commands/customers.rs, ui/src/features/customers/, ui/src/api/customers.ts, shared-ui/locales/{customers,customers.id}.ftl; modules/crm/manifest.json present and matches spec schema; registration code (Kernel::register/load_all/start_all) matches platform/kernel API · Status "Phase 2.4 POC" consistent with files still in original locations · RE-AUDITED 2026-08-31 by docs-auditor: manifest deps [] + perms [crm:view,crm:edit] and all "Currently Owns" paths re-confirmed against current HEAD (module changed 9 commits since the 08-09 footer, none moved the files — still a POC thin wrapper); CORRECTED stale stamp — the old note listed customers.th.ftl, but the Thai locale was removed repo-wide (6088a975 "remove Thai locale — not a target market"; zero .th.ftl files remain). The body Locale row was always correct (lists only customers.ftl) · 31-08 (cont): noted the crate's CrmRepository/CrmService are a not-yet-wired mirror (no boundary_contract, not the runtime path) — L28 updated to say so (previously only claimed files 'remain in their original locations'); lifecycle hooks are stubs but the README's generic phrasing matches their log messages, so left as-is -->
-->


# CRM Module

**Status:** Active (Phase 2.4 — Proof of Concept)

## Overview

The CRM module owns the customer relationship management vertical. It handles customer CRUD (create, read, update, delete), loyalty points tracking, and purchase history.

## Module Info

| Field        | Value        |
|--------------|--------------|
| ID           | `crm`        |
| Version      | `1.0.0`      |
| Dependencies | `[]`         |
| Permissions  | `crm:view`, `crm:edit` |

## Currently Owns

- **Backend** — Customer CRUD (`crates/kasirmu-core/src/db/customers.rs`)
- **Commands** — Customer Tauri commands (`apps/desktop-tauri/src/commands/customers.rs`)
- **Frontend** — Customer management screen (`ui/src/features/customers/`)
- **API** — TypeScript API client (`ui/src/api/customers.ts`)
- **Locale** — Fluent translation strings (`shared-ui/locales/customers.ftl`)

In the current phase the runtime customer CRUD still runs through the files above (notably `crates/kasirmu-core/src/db/customers.rs`). The crate also contains `repository.rs` (`CrmRepository`) and `service.rs` (`CrmService`) as a not-yet-wired mirror (no `tests/boundary_contract.rs`), so the module remains a thin wrapper over the `kasirmu-core` implementation. A subsequent phase will move the implementation fully into `modules/crm/`.

## Lifecycle

The module implements `foundation::contracts::Module` and follows the standard lifecycle:

1. **`on_load`** — Validates configuration
2. **`on_start`** — Prepares for customer operations
3. **`on_stop`** — Cleans up resources

## Registration

Registered with the kernel during application setup:

```rust
use modules_crm::CrmModule;
use platform_kernel::Kernel;

let mut kernel = Kernel::new();
kernel.register(Box::new(CrmModule::new()))?;
kernel.load_all()?;
kernel.start_all()?;
```

## Manifest

```json
{
  "id": "crm",
  "name": "CRM",
  "version": "1.0.0",
  "dependencies": [],
  "permissions": ["crm:view", "crm:edit"]
}
```

> last audited 11-10-26 by docs-auditor
