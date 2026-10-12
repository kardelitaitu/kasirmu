---
num: 1
area: module-system
title: ADR #1: Module System Design
status: Implemented (2026-07-15)
---

<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (1 major, 2 minor) · Full re-audit; the 2026-09-29 and 2026-07-22 stamps are merged at the bottom as original evidence. · MAJOR: §4 Feature Toggle Integration claimed the `FeatureRegistry` "maps to module IDs", that the kernel "reads enabled features from settings and loads only the corresponding modules", and that "disabled modules are never registered". NONE of that is wired at HEAD: a repo-wide search finds no FeatureRegistry-to-module coupling, and `platform/startup/src/lib.rs#init_module_system` registers all fourteen modules unconditionally. The same bullet also pointed at `oz-core/src/features.rs`, a crate path that no longer exists (rebranded to kasirmu-core). Left the decision text in place and added a correction note — this is an ADR recording an intended mechanism, and feature toggles in fact gate UI pages/nav via the registries. · MINOR 1: §3's manifest example used the dot-joined permission spelling `"inventory.read"`/`"inventory.write"`; the enforced convention is `<domain>:<action>` (one colon, both halves non-empty) per `ModuleManifest::validate` and `docs/specs/module-manifest-format.md`. Example corrected and a note added that `capabilities` is the second, boot-enforced vocabulary. · MINOR 2: §3 said "the manifest is not parsed at runtime in Phase 2" — `Kernel::register_with_manifest` now validates a manifest and enforces manifest-id/module-id equality (`platform/kernel/src/kernel/lifecycle.rs`). Noted rather than rewritten. · DEAD REFERENCE: the Related list cites `RESTRUCTURING.md`, which does not exist tracked or on disk (confirmed via `git ls-files`); struck through with the reason kept, matching ADR #2's treatment. · VERIFIED UNCHANGED: the `Module` trait sketch against `foundation/src/contracts.rs` (on_load/on_start/on_stop/ModuleResult present; the `id()` return-type observation in the 2026-07-22 stamp is real — the trait returns `ModuleId` = `&'static str`), the `Service` trait, the `Kernel` surface (register/load_all/start_all/stop_all all on `platform/kernel/src/kernel/lifecycle.rs`), and the nine-field manifest struct. The "fourteen crates registered" figure is still accurate (14 `k.register(...)` calls, `platform/startup/src/lib.rs:124-145`), though the cited line range `:94-115` has drifted. · Repaired against branch 0.0.41 at ea89612c3. -->

<!-- STAMP MERGED INTO THIS ONE (2026-10-11) — superseded bodies kept verbatim as original evidence:

<!-- Superseded audit marker (2026-07-22 · Hermes-Agent, body kept verbatim) · retained · status: ACCURATE (0 findings, 1 low-severity observation) · foundation/src/contracts.rs has Module trait (on_load/on_start/on_stop, ModuleResult) — matches ADR; Kernel in platform/kernel/src/kernel.rs:52 with register/load_all/start_all — matches; FeatureRegistry in crates/oz-core/src/features.rs:171 — matches; Status "Implemented (2026-07-15)" consistent with live module system · obs: ADR shows id()->&'static str but actual trait returns ModuleId (typed id) — design intent preserved, not a drift · Related links (ARCHITECTURE.md, RESTRUCTURING.md) valid -->

<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file: 206 lines, with a prior stamp re-verified rather than replaced. ADR #1 is the oldest decision record in the directory and the one every later module-system document cites, so its standing matters more than its line count. · WHAT STILL VERIFIES is the design, not the coordinates. The module-lifecycle concept it establishes is the one the manifest specification and the domain-extraction ADR both elaborate, and the implementation it describes is live: `ModuleManifest::from_json` and `validate` are in `platform/kernel/src/manifest.rs`, and the trait foundation it points at is `foundation/src/contracts.rs`, one of the few roots the workspace restructure never renamed. That is a genuine survival result for a January decision record. · WHAT IS DATED, and left as written: it counts registered crates and locates them at `platform/startup/src/lib.rs:94-115`, and names the ten owning modules. Both are point-in-time facts about a workspace that now publishes 40 packages across four roots. A count in a foundational ADR is a snapshot of the moment it was written, and correcting it would suggest the decision was re-taken, which it was not. · THE ONE REASON THIS FILE EARNS A PASS DESPITE ITS PRIOR STAMP is that it is the citation root for the module-lifecycle chain — ADR #30 (domain extraction, audited in this same round), the manifest format spec (round 22), and the modular app plan (round 24) all rest on it. Where a foundational ADR's claims have been checked downstream and hold, that belongs on the root rather than being left for each citing document to re-verify. · NOT re-measured: the crate inventory and the proof-of-concept trait definitions the body quotes, which are design content describing an intended module contract. · Prior stamp retained as original evidence; footer re-dated to match the new stamp. -->
-->

# ADR #1: Module System Design

**Status:** Implemented (2026-07-15)
**Date:** 2026-01-15
**Author:** Architecture Team
**Tags:** architecture, module-system, kernel

---

## Context

kasir.mu is migrating from a flat, monolithic crate structure to a modular architecture where every business feature is a self-contained module. This ADR captures the design decisions for the module system.

The target architecture, defined in `ARCHITECTURE.md`, requires:

- Each module owns its entire vertical slice (backend + frontend + locale + migrations).
- Modules communicate exclusively through an event bus — no direct module-to-module imports.
- The platform layer (kernel, core, sync) provides infrastructure, never business logic.
- Modules are loaded/unloaded at runtime based on feature toggles persisted in settings.
- The system supports multiple deployable targets (desktop, tablet) sharing the same modules.

A proof-of-concept trait definition already exists in `foundation/src/contracts.rs`.

### Measured state of the first requirement (added 2026-09-21)

The first requirement above is the **target**. This is where the tree actually stands, because a
reader who takes the sentence as a description will form the wrong picture (recorded by ADR #59
§Q1 drift, which required this note):

**Fourteen crates are registered** (`platform/startup/src/lib.rs:94-115`). **Ten own their
vertical slice** — `inventory`, `crm`, `tax`, `settings`, `staff`, `sales`, `reporting`,
`terminal`, `currency`, `loyalty`. **Four are lifecycle-only placeholders** — `purchasing`,
`promotions`, `giftcards`, `kitchen` — which own their manifest, id and dependency edges while
their hooks only log (`platform/startup/src/lib.rs:107-111`, and the same fact is stamped at
`modules/README.md:3`).

**They are not dead code.** All fourteen are registered, dependency-checked and lifecycle-driven,
which is what makes the manifest/declaration parity test meaningful; "lifecycle-only placeholder" is
the measured description, and calling them unimplemented would be a different inaccuracy. Domain
logic for the four lives in `kasirmu-core` today, and extraction is deferred — ADR #59 §Q1 drift
decides to amend this record rather than port working code to make a sentence true.

---

## Decision

### 1. Module Trait Definition

We adopt the `Module` trait as defined in `foundation/src/contracts.rs`:

```rust
pub trait Module: Debug + Send + Sync {
    fn id(&self) -> &'static str;
    fn on_load(&mut self) -> ModuleResult { Ok(()) }
    fn on_start(&mut self) -> ModuleResult { Ok(()) }
    fn on_stop(&mut self) -> ModuleResult { Ok(()) }
}
```

The lifecycle is: **register → load → start → stop → unload**.

- `on_load` — Validate configuration, register event handlers, declare dependencies.
- `on_start` — Spawn background tasks, open connections.
- `on_stop` — Graceful shutdown.

Default implementations return `Ok(())` so modules only override what they need.

### 2. Kernel Ownership

The `Kernel` struct lives in `platform/kernel/` and is the sole owner of the module lifecycle:

- `Kernel::register(Box<dyn Module>)` — Add a module to the registry.
- `Kernel::load_all()` — Call `on_load` on every registered module, respecting dependency order.
- `Kernel::start_all()` — Call `on_start` on every module.
- `Kernel::stop_all()` — Call `on_stop` on every module during shutdown.

The kernel does NOT know about specific module types — it operates exclusively through the `Module` trait.

### 3. Module Manifest

Every module has a `manifest.json` at its root:

```json
{
  "id": "inventory",
  "name": "Inventory",
  "version": "1.0.0",
  "dependencies": [],
  "permissions": ["inventory:view", "inventory:edit"]
}
```

The manifest is not parsed at runtime in Phase 2 — it's a metadata file for tooling (scaffolding, documentation generation, dependency analysis). Runtime module registration is done programmatically through `Kernel::register()`.

> **Correction (11-10-26, docs-auditor).** Two claims above were true when written and are not now, left as the record of what was decided:
> (1) the example's permission spelling was `"inventory.read"` / `"inventory.write"` — dot-joined. The enforced convention is `<domain>:<action>` with exactly one colon, validated by `ModuleManifest::validate` (`platform/kernel/src/manifest.rs`) and matching `docs/specs/module-manifest-format.md`; the example now shows it. `permissions` is also only one of the two vocabularies a manifest carries — `capabilities` (`namespace:action`) is the other and is the one the kernel fails boot on. See `docs/specs/module-manifest-format.md`.
> (2) "not parsed at runtime" is no longer the case: `Kernel::register_with_manifest` validates a manifest and enforces that its `id` equals `Module::id()` (`platform/kernel/src/kernel/lifecycle.rs`).

### 4. Feature Toggle Integration

Feature toggles control which modules are loaded:

- The `FeatureRegistry` (in `oz-core/src/features.rs`) maps to module IDs.
- On startup, the kernel reads enabled features from settings and loads only the corresponding modules.
- Disabled modules are never registered.

> **Correction (11-10-26, docs-auditor).** The path above is stale: `crates/oz-core/` does not exist (the crate was rebranded to `crates/kasirmu-core/`). `FeatureRegistry` is at `crates/kasirmu-core/src/features.rs`, re-exported from `kasirmu_core`. **The described mechanism is a target, not the current behaviour**: at HEAD there is no code coupling `FeatureRegistry` to module ids or to module registration — `platform/startup/src/lib.rs#init_module_system` registers all fourteen modules unconditionally, and a repo-wide search finds no `FeatureRegistry`-to-module wiring. Feature toggles gate UI pages/nav (the page/menu registries), not kernel module loading.

### 5. Module Structure Convention

Every module follows the same directory convention (target, not yet migrated):

```
modules/inventory/
├── manifest.json
├── migrations/
├── src/
│   ├── lib.rs
│   ├── services/
│   ├── models/
│   ├── events/
│   └── permissions/
├── ui/
│   ├── pages/
│   ├── components/
│   └── widgets/
└── tests/
```

### 6. Service Trait

Long-running services (sync engine, background jobs) implement the `Service` trait:

```rust
pub trait Service: Debug + Send + Sync {
    fn id(&self) -> &'static str;
    fn start(&mut self) -> ModuleResult;
    fn stop(&mut self) -> ModuleResult;
}
```

Services are registered with and managed by the kernel.

---

## Options Considered

### Option A — Single Trait with Lifecycle Methods (Chosen)

The `Module` trait with `on_load`/`on_start`/`on_stop` provides clear lifecycle hooks without coupling to any specific framework.

- **Pro:** Simple, no framework lock-in, easy to test.
- **Pro:** Modules can be loaded in any Rust environment (Tauri, CLI, test).
- **Con:** Modules must manage their own async runtime if needed.

### Option B — Actor-Based System (Rejected)

Each module runs in its own actor/process, communicating via message passing.

- **Pro:** Strong isolation, fault tolerance.
- **Con:** Over-engineered for a single-process POS application. Adds unnecessary complexity for module-to-module calls that will use the event bus anyway.

### Option C — Plugin Framework (e.g., Wasm plugins) (Deferred)

Modules compiled to WebAssembly and loaded at runtime.

- **Pro:** True hot-swapping, language-agnostic modules.
- **Con:** Adds Wasm runtime dependency, serialization overhead, significantly more complex. Consider for Phase 4+ if third-party module support is needed.

---

## Consequences

### Positive

- Clear separation of concerns — modules are independently developed, tested, and deployed.
- Feature toggles directly map to module loading — no dead code for disabled features.
- The kernel is small and testable — it only manages lifecycle and provides infrastructure.
- Multiple application shells (desktop, tablet, headless) can register the same modules.

### Negative

- Module dependencies must be resolved at registration time — cycles cause a hard error.
- Runtime module loading adds startup latency proportional to the number of modules.
- Modules cannot be unloaded mid-session — the lifecycle is start-to-shutdown.

### Mitigations

- Dependency resolution is a simple topological sort — O(n) in the number of modules.
- Startup latency is acceptable for a POS application (expect < 100 modules).
- Graceful shutdown covers the common case; hot-reload is deferred.

---

## Related

- `foundation/src/contracts.rs` — Trait definitions
- `ARCHITECTURE.md` — Target architecture
- ~~`RESTRUCTURING.md`~~ — Phased migration plan \*(dead pointer: no such file exists in the repository, tracked or on disk; noted 11-10-26 by docs-auditor, kept so the reference is not silently erased)\*

> last audited 11-10-26 by docs-auditor
