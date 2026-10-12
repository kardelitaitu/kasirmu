<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (1 major, 3 minor) · First full audit of this format spec since 2026-09-29; the 2026-08-29 and 2026-09-29 stamps are merged at the bottom as original evidence. · MAJOR: the top-level field table omitted two real fields. `ModuleManifest` (`platform/kernel/src/manifest.rs:26-72`) carries NINE fields: id, name, version, description, author, dependencies, permissions, capabilities, database_namespace. The table listed six — `author`, `capabilities` and `database_namespace` were absent — and `capabilities` is not cosmetic: it is the Phase-2 vocabulary the kernel fails boot on (`KernelError::MissingCapability`, `Kernel::verify_capabilities`), every one of the 14 real manifests carries it (`modules/sales/manifest.json`), and the formal schema already documents it. A format spec that omits an enforced field is the one omission a reader cannot detect. · MINOR 1: Validation rule 6 claimed "Unknown fields are silently ignored (forward compatibility)". The runtime serde struct does ignore extras, but the formal schema this repo ships sets `additionalProperties: false` (`docs/specs/module-manifest.schema.json`), so the rule as written contradicted the authoritative artifact. Rule replaced with the six rules the code actually enforces (kebab-case charset, unique deps/permissions/capabilities, two-non-empty-halves shape, topological MissingDependency at load) and split the unknown-fields case explicitly. · MINOR 2: rule 4 said dependency ids are "enforced at runtime"; they are enforced at LOAD by the topological sort in `Kernel::load_all` returning `KernelError::MissingDependency` (`platform/kernel/src/kernel/lifecycle.rs:533`), which is what the rule now says. · MINOR 3: the Overview said runtime consistency checks were a future phase; `Kernel::register_with_manifest` validates the manifest and enforces module-id/manifest-id equality today, and the section now says so and points at the code. · ALSO REPAIRED (not separately counted): the "Full Module" example now carries the real `modules/sales/manifest.json` shape (version 1.0.0, deps ["inventory"], the three capability strings) instead of an invented 2.3.1/crm-dependency sample; the `capabilities` vocabulary gained its own subsection because `permissions` and `capabilities` are different vocabularies and presenting only the first taught the wrong model; the Related list gained the schema and capability files. · LEFT AS WRITTEN: the `Status: Draft` line (governance status, not format maturity — the format is enforced and all 14 manifests conform) and the permission examples. · Verified: all 14 `modules/*/manifest.json` exist; `ModuleManifest::from_json`/`validate`/`load_from_file` present at `manifest.rs:79/121/96`. -->
<!-- Superseded audit marker (2026-08-29 · docs-auditor, body kept verbatim) · retained · status: ACCURATE (0 findings) · platform/kernel/src/manifest.rs exists with ModuleManifest::from_json (line 56) + validate (line 92); crate is platform-kernel (matches use platform_kernel::ModuleManifest); modules/<name>/manifest.json files exist for 14 modules (crm, currency, giftcards, inventory, kitchen, loyalty, promotions, purchasing, reporting, sales, settings, staff, tax, terminal) — consistent with Status: Draft + ADR #1 'not parsed at runtime in Phase 2' · schema fields verified: id/name/version required, description/author/dependencies/permissions/database_namespace defaulted · related links valid -->

<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · ACCURATE, and the 2026-08-29 docs-auditor stamp on this file is confirmed rather than inherited. The parser it specifies is real and still carries the two entry points the stamp named: `ModuleManifest::from_json(json: &str) -> Result<Self, KernelError>` at `platform/kernel/src/manifest.rs:62` and `validate(&self)` at `:98` (the stamp cites lines 56 and 92 — ordinary drift in a file that has grown, the same pattern this campaign has recorded in dozens of coordinates). · THE SPECIFICATION IS ALSO STILL IN USE, which is the claim that matters for a format document: a format spec is only correct if something conforms to it, and real module manifests exist — `modules/sales/manifest.json` and `modules/crm/manifest.json` are both present. The examples in the body are concrete enough to check against them: the `id`/`name`/`version`/`dependencies`/`permissions` top-level fields it tables are the fields those files carry, and the permission strings it illustrates (`sales:void`, `reports:view`) are in the `<domain>:<action>` shape the document prescribes AND in the registry vocabulary that ADR #35 and the 0046 spec series (audited in round 3) established — `sales:void` is registered as a SENSITIVE key there, which is a real cross-check that this document's permission convention and the enforcement registry agree rather than merely coexisting. · The Status line reads Draft, and that is worth reading carefully rather than treating as drift: the format is enforced at load time and the examples conform, so Draft describes the document's governance status, not the format's maturity. Left as written. · The prior stamp is retained as original evidence; footer bumped to match the new stamp. -->

<!-- STAMP MERGED INTO THIS ONE (2026-10-11) — superseded bodies kept verbatim as original evidence:
Superseded audit marker (2026-08-29 · docs-auditor, body kept verbatim) · retained · status: ACCURATE (0 findings) · platform/kernel/src/manifest.rs exists with ModuleManifest::from_json (line 56) + validate (line 92); crate is platform-kernel (matches use platform_kernel::ModuleManifest); modules/<name>/manifest.json files exist for 14 modules (crm, currency, giftcards, inventory, kitchen, loyalty, promotions, purchasing, reporting, sales, settings, staff, tax, terminal) — consistent with Status: Draft + ADR #1 'not parsed at runtime in Phase 2' · schema fields verified: id/name/version required, description/author/dependencies/permissions/database_namespace defaulted · related links valid

Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · ACCURATE, and the 2026-08-29 docs-auditor stamp on this file is confirmed rather than inherited. The parser it specifies is real and still carries the two entry points the stamp named: `ModuleManifest::from_json(json: &str) -> Result<Self, KernelError>` at `platform/kernel/src/manifest.rs:62` and `validate(&self)` at `:98` (the stamp cites lines 56 and 92 — ordinary drift in a file that has grown, the same pattern this campaign has recorded in dozens of coordinates). · THE SPECIFICATION IS ALSO STILL IN USE, which is the claim that matters for a format document: a format spec is only correct if something conforms to it, and real module manifests exist — `modules/sales/manifest.json` and `modules/crm/manifest.json` are both present. The examples in the body are concrete enough to check against them: the `id`/`name`/`version`/`dependencies`/`permissions` top-level fields it tables are the fields those files carry, and the permission strings it illustrates (`sales:void`, `reports:view`) are in the `<domain>:<action>` shape the document prescribes AND in the registry vocabulary that ADR #35 and the 0046 spec series (audited in round 3) established — `sales:void` is registered as a SENSITIVE key there, which is a real cross-check that this document's permission convention and the enforcement registry agree rather than merely coexisting. · The Status line reads Draft, and that is worth reading carefully rather than treating as drift: the format is enforced at load time and the examples conform, so Draft describes the document's governance status, not the format's maturity. Left as written. · The prior stamp is retained as original evidence; footer bumped to match the new stamp.
-->

# Module Manifest Format Specification

**Version:** 1.0
**Status:** Draft
**Applies to:** kasir.mu Phase 2+

---

## Overview

Every module in kasir.mu must have a `manifest.json` file at its root. The manifest defines the module's identity, version, dependencies, capabilities and metadata. It is used by tooling for scaffolding, dependency analysis, and documentation generation, and it is enforced **at runtime**: `Kernel::register_with_manifest` validates it before registering, and the manifest's `id` must match the module's own `Module::id()` (`platform/kernel/src/kernel/lifecycle.rs`).

---

## File Location

`modules/<name>/manifest.json`

---

## Schema

### Top-Level Fields

| Field                | Type            | Required | Description |
|----------------------|-----------------|----------|-------------|
| `id`                 | String          | Yes      | Stable unique identifier (kebab-case, e.g. `"sales"`). |
| `name`               | String          | Yes      | Human-readable display name (e.g. `"Sales"`). |
| `version`            | String (SemVer) | Yes      | Semantic version string (`X.Y.Z`). |
| `description`        | String          | No       | Human-readable description of the module's purpose. Empty by default. |
| `author`             | String          | No       | Module author name or organization. Empty by default. |
| `dependencies`       | Array[String]   | No       | Module IDs that this module depends on. Empty by default. |
| `permissions`        | Array[String]   | No       | Permission strings required by this module. Empty by default. |
| `capabilities`       | Array[String]   | No       | Capabilities this module requires, in `namespace:action` shape (e.g. `"read:inventory"`). Empty by default. |
| `database_namespace` | String          | No       | Optional database namespace prefix (e.g. `"plugin_<id>_"`). Empty by default. |

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

### Capabilities

The `capabilities` array lists what a module requires to do its job, in the
`namespace:action` shape — a different vocabulary from `permissions`. A permission
(`sales:void`) names a *user* action RBAC gates; a capability (`read:inventory`) names
*something a module needs from the kernel*. The vocabulary is deliberately open
(`platform/kernel/src/capability.rs`: a plain string newtype, not a closed enum), so new
verbs can be added as verticals land.

A module that lists a capability in its manifest is asserting it may use it; the kernel
declares each manifest entry as **both required and granted**
(`Kernel::declare_from_manifest`, `platform/kernel/src/kernel/lifecycle.rs`). Boot fails
with `KernelError::MissingCapability` when a required capability was not granted
(`Kernel::verify_capabilities`). A module that declares nothing is unaffected.

Example: `["read:inventory", "read:sales", "write:sales"]` (from `modules/sales/manifest.json`).

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
  "version": "1.0.0",
  "description": "Core point-of-sale module: cart management, checkout, payment processing, sales history, void/refund, held orders, end-of-day reports.",
  "dependencies": ["inventory"],
  "permissions": [
    "sales:void",
    "sales:refund",
    "reports:view"
  ],
  "capabilities": [
    "read:inventory",
    "read:sales",
    "write:sales"
  ]
}
```

---

## Validation Rules

1. `id` must be non-empty and kebab-case (lowercase letters, digits and hyphens, starting with a lowercase letter; max 64 chars). `ModuleManifest::validate` enforces the character set at load time; "unique within the workspace" is enforced by `Kernel::register` (duplicate ids are rejected).
2. `name` must be non-empty.
3. `version` must follow SemVer format (`X.Y.Z`) where `X`, `Y`, `Z` are non-negative integers.
4. `dependencies` entries must be unique, and each must match the `id` of a registered module. `Kernel::load_all` resolves the edges by topological sort and returns `KernelError::MissingDependency` when one is absent (`platform/kernel/src/kernel/lifecycle.rs`).
5. Circular dependencies are rejected by the topological sort at load time.
6. `permissions` and `capabilities` entries must each be unique, and both follow the `<domain>:<action>` / `<namespace>:<action>` shape with two non-empty halves (`ModuleManifest::validate`; `Capability::parse`).
7. Unknown fields are **not** accepted by the formal schema: `docs/specs/module-manifest.schema.json` sets `additionalProperties: false`. Note the split — the runtime `ModuleManifest` struct (serde, no `deny_unknown_fields`) ignores extras, so schema validation and load-time parsing disagree on this point. Treat the schema as authoritative for authoring.

---

## Parsing

The `platform-kernel` crate provides `ModuleManifest::from_json()` for parsing and `validate()` for validation. `load_from_file()` reads and validates a `manifest.json` in one step.

```rust
use platform_kernel::ModuleManifest;

let manifest = ModuleManifest::from_json(json_str)?;
manifest.validate()?;

// or, from disk (parses + validates):
let manifest = ModuleManifest::load_from_file(std::path::Path::new("modules/sales/manifest.json"))?;
```

---

## Related

- `platform/kernel/src/manifest.rs` — Rust implementation
- `docs/specs/module-manifest.schema.json` — formal JSON Schema (same fields; `additionalProperties: false`)
- `platform/kernel/src/capability.rs` — capability registry
- ADR #1: Module System Design (`docs/decisions/2026-01-15-module-system-design.md`)

> last audited 11-10-26 by docs-auditor
