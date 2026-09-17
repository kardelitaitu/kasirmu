<!-- Audit stamp: 2026-08-29 · docs-auditor · status: ACCURATE (0 findings) · platform/kernel/src/manifest.rs exists with ModuleManifest::from_json (line 56) + validate (line 92); crate is platform-kernel (matches use platform_kernel::ModuleManifest); modules/<name>/manifest.json files exist for 14 modules (crm, currency, giftcards, inventory, kitchen, loyalty, promotions, purchasing, reporting, sales, settings, staff, tax, terminal) — consistent with Status: Draft + ADR #1 'not parsed at runtime in Phase 2' · schema fields verified: id/name/version required, description/author/dependencies/permissions/database_namespace defaulted · related links valid -->

# Module Manifest Format Specification

**Version:** 1.0
**Status:** Draft
**Applies to:** kasir.mu Phase 2+

---

## Overview

Every module in kasir.mu must have a `manifest.json` file at its root. The manifest defines the module's identity, version, dependencies, and metadata. It is used by tooling for scaffolding, dependency analysis, documentation generation, and (in future phases) runtime consistency checks.

---

## File Location

`modules/<name>/manifest.json`

---

## Schema

### Top-Level Fields

| Field          | Type            | Required | Description |
|----------------|-----------------|----------|-------------|
| `id`           | String          | Yes      | Stable unique identifier (kebab-case, e.g. `"sales"`). |
| `name`         | String          | Yes      | Human-readable display name (e.g. `"Sales"`). |
| `version`      | String (SemVer) | Yes      | Semantic version string (`X.Y.Z`). |
| `dependencies` | Array[String]   | No       | Module IDs that this module depends on. Empty by default. |
| `permissions`  | Array[String]   | No       | Permission strings required by this module. Empty by default. |
| `description`  | String          | No       | Human-readable description of the module's purpose. Empty by default. |

### Dependencies

The `dependencies` array lists module IDs (matching other modules' `id` fields) that must be loaded before this module. The kernel uses this to compute the correct load/start/stop order via topological sort.

Example: `["inventory", "crm"]` — this module requires inventory and CRM to be loaded first.

### Permissions

The `permissions` array lists permission strings following the `<domain>:<action>` convention:

- `"sales:void"` — void a completed sale
- `"products:edit"` — create/update/delete products
- `"settings:edit"` — modify store settings
- `"staff:manage"` — create/update/delete staff users
- `"reports:view"` — view sales reports
- `"audit:view"` — view audit log

---

## Examples

### Minimal Module (No Dependencies)

```json
{
  "id": "crm",
  "name": "CRM",
  "version": "1.0.0"
}
```

### Full Module with Dependencies and Permissions

```json
{
  "id": "sales",
  "name": "Sales",
  "version": "2.3.1",
  "description": "Core point-of-sale pipeline: cart, checkout, refunds, history, reports",
  "dependencies": ["inventory", "crm"],
  "permissions": [
    "sales:void",
    "sales:refund",
    "reports:view"
  ]
}
```

---

## Validation Rules

1. `id` must be non-empty and unique within the workspace.
2. `name` must be non-empty.
3. `version` must follow SemVer format (`X.Y.Z`) where `X`, `Y`, `Z` are non-negative integers.
4. `dependencies` entries must match the `id` of another registered module (enforced at runtime).
5. Circular dependencies are not allowed and are detected at load time.
6. Unknown fields are silently ignored (forward compatibility).

---

## Parsing

The `platform-kernel` crate provides `ModuleManifest::from_json()` for parsing and `validate()` for validation.

```rust
use platform_kernel::ModuleManifest;

let manifest = ModuleManifest::from_json(json_str)?;
manifest.validate()?;
```

---

## Related

- `platform/kernel/src/manifest.rs` — Rust implementation
- ADR #1: Module System Design (`docs/decisions/2026-01-15-module-system-design.md`)

> last audited 29-08-26 by docs-auditor
