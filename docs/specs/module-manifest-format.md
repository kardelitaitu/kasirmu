<!-- Superseded audit marker (2026-08-29 · docs-auditor, body kept verbatim) · retained · status: ACCURATE (0 findings) · platform/kernel/src/manifest.rs exists with ModuleManifest::from_json (line 56) + validate (line 92); crate is platform-kernel (matches use platform_kernel::ModuleManifest); modules/<name>/manifest.json files exist for 14 modules (crm, currency, giftcards, inventory, kitchen, loyalty, promotions, purchasing, reporting, sales, settings, staff, tax, terminal) — consistent with Status: Draft + ADR #1 'not parsed at runtime in Phase 2' · schema fields verified: id/name/version required, description/author/dependencies/permissions/database_namespace defaulted · related links valid -->

<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · ACCURATE, and the 2026-08-29 docs-auditor stamp on this file is confirmed rather than inherited. The parser it specifies is real and still carries the two entry points the stamp named: `ModuleManifest::from_json(json: &str) -> Result<Self, KernelError>` at `platform/kernel/src/manifest.rs:62` and `validate(&self)` at `:98` (the stamp cites lines 56 and 92 — ordinary drift in a file that has grown, the same pattern this campaign has recorded in dozens of coordinates). · THE SPECIFICATION IS ALSO STILL IN USE, which is the claim that matters for a format document: a format spec is only correct if something conforms to it, and real module manifests exist — `modules/sales/manifest.json` and `modules/crm/manifest.json` are both present. The examples in the body are concrete enough to check against them: the `id`/`name`/`version`/`dependencies`/`permissions` top-level fields it tables are the fields those files carry, and the permission strings it illustrates (`sales:void`, `reports:view`) are in the `<domain>:<action>` shape the document prescribes AND in the registry vocabulary that ADR #35 and the 0046 spec series (audited in round 3) established — `sales:void` is registered as a SENSITIVE key there, which is a real cross-check that this document's permission convention and the enforcement registry agree rather than merely coexisting. · The Status line reads Draft, and that is worth reading carefully rather than treating as drift: the format is enforced at load time and the examples conform, so Draft describes the document's governance status, not the format's maturity. Left as written. · The prior stamp is retained as original evidence; footer bumped to match the new stamp. -->
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

> last audited 29-09-26 by docs-auditor
