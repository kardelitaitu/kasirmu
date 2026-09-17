<!-- Audit stamp: 2026-07-22 · Hermes-Agent · status: ACCURATE (0 findings) · all owned paths verified: crates/kasirmu-core/src/user.rs + db/staff.rs, commands/{staff,auth}.rs, features/staff, api/staff.ts, ui/src/locales/staff.ftl; modules/staff/src/lib.rs has StaffModule; manifest deps [] + permissions [staff:view,staff:edit,staff:auth] match · Kernel API matches -->
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
- **Commands** — Staff Tauri commands (`apps/desktop-client/src/commands/staff.rs`, `apps/desktop-client/src/commands/auth.rs`)
- **Frontend** — Staff management screen (`ui/src/features/staff/`)
- **API** — TypeScript API client (`ui/src/api/staff.ts`)
- **Locale** — Fluent translation strings (`ui/src/locales/staff.ftl`)

These files remain in their original locations while the module boundary is transitional. The production security boundary is already session-scoped: legacy staff CRUD IPC commands are disabled and unregistered. Physical migration into `modules/staff/` remains a separate architectural phase.

## Lifecycle

The module implements `foundation::contracts::Module` and follows the standard lifecycle:

1. **`on_load`** — Validates configuration
2. **`on_start`** — Prepares for staff operations
3. **`on_stop`** — Cleans up resources

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

> last audited 09-08-26 by buffy
> audit: Phase 3 Module-Level Documentation Audit
> status: ACCURATE (verified against actual codebase)
