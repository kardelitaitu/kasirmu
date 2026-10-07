<!-- Audit stamp: 2026-10-08 · docs-auditor · status: ACCURATE AFTER REPAIR (1 finding) · Supersedes the 2026-07-22 marker below, kept verbatim. Repaired: the §Lifecycle section described the three hooks as performing work ("Validates configuration", "Prepares for staff operations", "Cleans up resources"). Verified against modules/staff/src/lib.rs: each hook is a STUB — it logs a message and returns Ok(()) — with "In future phases, this will:" comments naming what is planned (event-bus handler registration, cache warm-up). The section now says so, matching the correction modules/sales/README.md already carries. Note the sibling paragraph on the transitional boundary — that staff CRUD IPC is disabled/unregistered and physical migration into modules/staff/ is a separate phase — was re-verified and still reads correctly. · Repaired against branch 0.0.41. -->
<!-- Audit stamp: 2026-07-22 · Hermes-Agent · status: ACCURATE (0 findings) · all owned paths verified: crates/kasirmu-core/src/user.rs + db/staff.rs, commands/{staff,auth}.rs, features/staff, api/staff.ts, shared-ui/locales/staff.ftl; modules/staff/src/lib.rs has StaffModule; manifest deps [] + permissions [staff:view,staff:edit,staff:auth] match · Kernel API matches -->
<!-- 2026-07-31 · audit/06 remediation: commands are session-scoped (*_scoped, STAFF-01), role-hierarchy enforced (STAFF-02), PIN rotation invalidates sessions (STAFF-03), profile+workspace save has compensating rollback (STAFF-05), uniform pre-auth response (STAFF-06), device/global login rate limiter (STAFF-07); legacy staff IPC commands disabled/unregistered; see the Staff section in docs/records/audit-open-findings.md -->

# Staff Module

**Status:** Active (Phase 2.7)

## Overview

The Staff module owns the staff management vertical. It handles user CRUD, role management, authentication, and session handling.

## Module Info

| Field        | Value        |
|--------------|--------------|
| ID           | `staff`      |
| Version      | `1.0.0`      |
| Dependencies | `[]`         |
| Permissions  | `staff:view`, `staff:edit`, `staff:auth` |

## Currently Owns

- **Types** — User and Role domain types (`crates/kasirmu-core/src/user.rs`)
- **Backend** — User/Role CRUD (`crates/kasirmu-core/src/db/staff.rs`)
- **Commands** — Staff Tauri commands (`apps/desktop-tauri/src/commands/staff.rs`, `apps/desktop-tauri/src/commands/auth.rs`)
- **Frontend** — Staff management screen (`ui/src/features/staff/`)
- **API** — TypeScript API client (`ui/src/api/staff.ts`)
- **Locale** — Fluent translation strings (`shared-ui/locales/staff.ftl`)

These files remain in their original locations while the module boundary is transitional. The production security boundary is already session-scoped: legacy staff CRUD IPC commands are disabled and unregistered. Physical migration into `modules/staff/` remains a separate architectural phase.

## Lifecycle

The module implements `foundation::contracts::Module`. **Its lifecycle hooks are currently stubs** — each logs a message and returns `Ok(())`; none touches the database or event bus yet (`modules/staff/src/lib.rs`):

1. **`on_load`** — logs "validating configuration" (a future phase will register event handlers with the event bus, e.g. `staff.created`)
2. **`on_start`** — logs "ready to manage staff" (a future phase will warm any in-memory caches for staff lookup)
3. **`on_stop`** — logs "cleaning up"

## Registration

Registered with the kernel during application setup:

```rust
use modules_staff::StaffModule;
use platform_kernel::Kernel;

let mut kernel = Kernel::new();
kernel.register(Box::new(StaffModule::new()))?;
kernel.load_all()?;
kernel.start_all()?;
```

## Manifest

```json
{
  "id": "staff",
  "name": "Staff",
  "version": "1.0.0",
  "dependencies": [],
  "permissions": ["staff:view", "staff:edit", "staff:auth"]
}
```

> last audited 08-10-26 by docs-auditor
> audit: Phase 3 Module-Level Documentation Audit
> status: ACCURATE (verified against actual codebase)
