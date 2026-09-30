# Module Boot Sequence (Phase 2)

This page describes what actually happens between `init_module_system` being
called and the first domain event being delivered, naming the real functions and
line anchors on the commit that landed Phase 2. It is the narrative companion to
the machine-checked rules in `docs/architecture/module-namespace-governance.md`
and to the tickets in `docs/architecture/phase2-implementation-tickets.md`.

## 1. The sequence at a glance

```
init_module_system(kernel, db_path)          platform/startup/src/lib.rs:109
  │
  ├─ register 14 modules                     platform/startup/src/lib.rs:124-145
  │    Kernel::register                      platform/kernel/src/kernel/lifecycle.rs:69
  │
  ├─ declare the wiring owner's capabilities platform/startup/src/lib.rs:162
  │    Kernel::declare_capabilities          platform/kernel/src/kernel/lifecycle.rs:127
  │
  ├─ load_all                               platform/startup/src/lib.rs:165
  │    │  Kernel::load_all                   platform/kernel/src/kernel/lifecycle.rs:234
  │    ├─ resolve_dependencies (topo sort)   platform/kernel/src/kernel/lifecycle.rs:487
  │    ├─ verify_capabilities (FAIL FAST)    platform/kernel/src/kernel/lifecycle.rs:245
  │    ├─ per module, in order:
  │    │    on_load                          platform/kernel/src/kernel/lifecycle.rs:270
  │    │    on_context(KernelContext)        platform/kernel/src/kernel/lifecycle.rs:281
  │    └─ finish
  │
  ├─ start_all                              platform/startup/src/lib.rs:166
  │    Kernel::start_all                    platform/kernel/src/kernel/lifecycle.rs:299
  │    per module, in order: on_start
  │
  ├─ subscribe_gated (11 sites)             platform/kernel/src/kernel/lifecycle.rs:696
  │    KernelError::MissingCapability on an ungranted topic
  │
  └─ init_pending_sale_reaper               platform/startup/src/lib.rs:554
```

## 2. Registration

`init_module_system` (`platform/startup/src/lib.rs:109`) registers the 14 vertical
modules with `Kernel::register` (`platform/kernel/src/kernel/lifecycle.rs:69`) in a
fixed order (`platform/startup/src/lib.rs:124-145`). Registration is deterministic
by construction: the calls are literal, in source order, and the kernel rejects a
duplicate id with `KernelError::DuplicateModule`. Which modules exist is pinned
against `modules/*/manifest.json` by `every_module_manifest_is_registered`
(`platform/startup/src/startup_tests.rs`).

## 3. Capability declaration

Before loading, `init_module_system` declares the *wiring owner's* capabilities
(`platform/startup/src/lib.rs:162`): the event-handler subscriptions in this crate
are owned by the `startup` identity (`STARTUP_WIRING_OWNER`,
`platform/startup/src/lib.rs:83`) rather than by a vertical module. The four topics
it may listen on are named once in `STARTUP_WIRING_CAPABILITIES`
(`platform/startup/src/lib.rs:90`): `subscribe:sale.completed`,
`subscribe:product.created`, `subscribe:stock.adjusted`, `subscribe:settings.updated`.
Each is declared as both required and granted via `Kernel::declare_capabilities`
(`platform/kernel/src/kernel/lifecycle.rs:127`). A module that wants to subscribe
must make the same declaration in its manifest `capabilities` list.

## 4. Dependency sort and the capability check

`Kernel::load_all` (`platform/kernel/src/kernel/lifecycle.rs:234`) first resolves
the dependency graph with `resolve_dependencies`
(`platform/kernel/src/kernel/lifecycle.rs:487`) — a Kahn topological sort over the
`dependencies` each module returns (`foundation/src/contracts.rs:64`). A missing
dependency is `KernelError::MissingDependency`; a cycle is
`KernelError::CircularDependency`. A dependency's `on_load`/`on_start` always runs
before its dependents'.

Immediately after the sort, and **before any `on_load` runs**, `load_all` calls
`verify_capabilities` (`platform/kernel/src/kernel/lifecycle.rs:245`). This is the
fail-fast point: a module that declared a required capability it was not granted
stops the boot with `KernelError::MissingCapability { module, missing }` naming
both. Because the check runs before the loop
(`platform/kernel/src/kernel/lifecycle.rs:247`), a half-loaded system never exists.
An empty registry is not an error; a module that declares nothing is simply
unconstrained (the legacy path, §7).

## 5. Load, context, and start

For each module in dependency order, `load_all` calls `on_load`
(`platform/kernel/src/kernel/lifecycle.rs:270`), then builds a `KernelContext`
scoped to that module (`platform/kernel/src/kernel/lifecycle.rs:280`) and hands it
over through `Module::on_context` (`platform/kernel/src/kernel/lifecycle.rs:281`).
`on_context` is a default no-op on the `Module` trait
(`foundation/src/contracts.rs:88`), so existing modules compile unchanged; a module
that needs a platform service overrides it. The context is the `dyn`-compatible
`ModuleContext` trait (`foundation/src/contracts.rs:35`); `load_all` skips a module
already in `Loaded` status, which keeps a retry idempotent.

`Kernel::start_all` (`platform/kernel/src/kernel/lifecycle.rs:299`) then calls
`on_start` in the same order, auto-loading first if needed. `stop_all`
(`platform/kernel/src/kernel/lifecycle.rs:374`) runs `on_stop` in reverse.

## 6. Gated subscriptions

Handler wiring does not use the raw bus. Each of the 11 subscription sites calls
`Kernel::subscribe_gated`
(`platform/kernel/src/kernel/lifecycle.rs:696`) with the module id, topic, and the
`subscribe:<event>` capability it needs:

```rust
k.subscribe_gated::<SaleCompleted>(
    STARTUP_WIRING_OWNER,
    "sale.completed",
    "subscribe:sale.completed",
    Box::new(SaleSyncEnqueuer::new(handler_conn.clone())),
)?;
```

The gate has three outcomes:

1. the module declares capabilities and holds the grant — the handler is
   registered under module ownership, so stopping the module unsubscribes it;
2. the module declares capabilities and does **not** hold the grant — the
   subscription is refused with `KernelError::MissingCapability`;
3. the module declares nothing — the subscription is allowed, and a deprecation
   warning names the module (the legacy path, §7).

The capability vocabulary (`namespace:action`) is the plan's: `read:<module>`,
`write:<module>`, `subscribe:<event>`, `use:reporting_facade`,
`use:lua_hook:<name>`. `Capability::parse`
(`platform/kernel/src/capability.rs:29`) rejects anything that is not
`<namespace>:<action>` with non-empty parts;
`CapabilityRegistry::verify_all`
(`platform/kernel/src/capability.rs:164`) reports the first unsatisfied module in
id order.

## 7. The compatibility window

Two compatibility doors are open on purpose, and both log rather than silently
pass:

- **Undeclared capabilities.** A module whose manifest declares none still
  boots; its gated subscriptions take outcome 3 above and each logs a
  deprecation warning naming the module. Populating the vertical manifests is
  the remaining migration; the mechanism is live and tested now.
- **Raw connection access.** `NamespacedStore::raw`
  (`crates/kasirmu-core/src/db/namespaced.rs`) runs the namespace check and
  returns the SQL unchanged — the escape hatch that lets the Phase 1 code keep
  compiling while it migrates. `Grants` has no `write` field, so there is no
  sanctioned cross-namespace write to open.

Phase 4 closes both: `raw()` was **removed 2026-10-03** (P4.3) and strict namespace enforcement
(reject unauthorised cross-namespace access) replaces the soft posture. The
frozen record of what is tolerated until then is
`scripts/namespace-governance-baseline.json`, checked by
`scripts/verify-namespace-governance.py`.

## 8. Where each piece is tested

| Behaviour | Test |
|-----------|------|
| A required-but-ungranted capability fails the boot path, naming module + capability | `platform/startup/tests/boot_capability.rs` (`boot_fails_when_a_required_capability_is_ungranted`) |
| The same module loads once granted | `platform/startup/tests/boot_capability.rs` (`boot_succeeds_once_the_requirement_is_granted`) |
| Boot is deterministic across two runs | `platform/startup/tests/boot_capability.rs` (`real_boot_is_deterministic_across_two_runs`) |
| A foreign read without a grant is refused at the store boundary | `platform/startup/tests/boot_capability.rs` (`namespaced_store_refuses_a_foreign_read_without_a_grant`) |
| An ungranted subscription is refused; a granted one is accepted; undeclared is allowed | `platform/startup/src/startup_tests.rs` (P3 tests) |
| The registry fails fast and names the first unsatisfied module | `platform/kernel/src/capability_tests.rs`, `platform/kernel/src/kernel/capability_lifecycle_tests.rs` |
| Manifest ids match the registered set | `platform/startup/src/startup_tests.rs` (`every_module_manifest_is_registered`) |

## References

- `docs/architecture/phase2-implementation-tickets.md` — the P1–P5 tickets
- `docs/architecture/module-namespace-governance.md` — the soft-governance rules
- `docs/architecture/namespaced-store-api-draft.md` — the store design
- `platform/kernel/src/kernel/lifecycle.rs` — register / declare / verify / load / start
- `platform/kernel/src/capability.rs` — the capability vocabulary and registry
- `foundation/src/contracts.rs` — `Module`, `ModuleContext`, `EventHandler`
- `platform/startup/src/lib.rs` — the real boot path
- `scripts/verify-namespace-governance.py` — the checker
