---
num: 1
area: module-system
title: ADR #1: Module System Design
status: Implemented (2026-07-15)
---
<!-- Audit stamp: 2026-07-22 · Hermes-Agent · status: ACCURATE (0 findings, 1 low-severity observation) · foundation/src/contracts.rs has Module trait (on_load/on_start/on_stop, ModuleResult) — matches ADR; Kernel in platform/kernel/src/kernel.rs:52 with register/load_all/start_all — matches; FeatureRegistry in crates/oz-core/src/features.rs:171 — matches; Status "Implemented (2026-07-15)" consistent with live module system · obs: ADR shows id()->&'static str but actual trait returns ModuleId (typed id) — design intent preserved, not a drift · Related links (ARCHITECTURE.md, RESTRUCTURING.md) valid -->

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
  "permissions": ["inventory.read", "inventory.write"]
}
```

The manifest is not parsed at runtime in Phase 2 — it's a metadata file for tooling (scaffolding, documentation generation, dependency analysis). Runtime module registration is done programmatically through `Kernel::register()`.

### 4. Feature Toggle Integration

Feature toggles control which modules are loaded:

- The `FeatureRegistry` (in `oz-core/src/features.rs`) maps to module IDs.
- On startup, the kernel reads enabled features from settings and loads only the corresponding modules.
- Disabled modules are never registered.

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
- `RESTRUCTURING.md` — Phased migration plan

> last audited 09-08-26 by buffy
> audit: Phase 1 Core Architecture & API Docs Audit; Phase 4 ADR Deep Audit
> status: ACCURATE (0 findings) · verified accurate: cargo check passed, no structural orphans, no stale version headers
> status: ACCURATE (verified against actual codebase)
