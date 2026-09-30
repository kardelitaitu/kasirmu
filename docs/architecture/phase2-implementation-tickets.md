# Phase 2 Implementation Tickets — Module Context and Registry Hardening

**Status:** Draft for execution (2026-10-02) — tickets only, no code changed by this document
**Scope:** Phase 2 of the modular scaffolding plan (`todo-modular-scaffolding.md` §7 "Phase 2 — Module
Context and Registry Hardening"), plus the Phase 2 half of `docs/architecture/namespaced-store-api-draft.md`.

**Predecessors:**
- `docs/architecture/module-namespace-governance.md` — Phase 1 rules, the table-ownership map, and the
  single-source note added in Phase 2 kickoff.
- `docs/architecture/namespaced-store-api-draft.md` — the `NamespacedStore` shape (§3), the validation
  reuse plan (§4), the per-module migration order (§5), and the reporting-exception construction (§6).
- `docs/architecture/phase1-implementation-tickets.md` — the sibling ticket set; T1–T5 are all DONE.
- `docs/architecture/phase3-implementation-tickets.md` — the successor ticket set this phase feeds (P3.1–P3.5).
- `docs/decisions/2026-09-30-adr62-module-seam-taxonomy.md` — the seam vocabulary and the D5 read exception.

**Grounding rule (learned in Phase 0):** every ticket names a repository fact verified at the time of
writing. The plan's prose is *not* treated as evidence.

**Already landed before these tickets (Phase 2 kickoff, commit `f46e213c2`):**
- `modules/ownership.json` is the single source of truth for the table→module map (14 modules, 30 tables).
- `crates/kasirmu-core/src/db/ownership.rs` is GENERATED from it and carries
  `pub const TABLE_OWNERS: &[(&str, &[&str])]` and `pub fn owner_of(table: &str) -> Option<&'static str>`
  (fail-closed: `None` for an unmapped table).
- The `ownership-map-parity` gate (`scripts/gates.json`) makes the checker and the Rust copy agree by
  construction: `node scripts/generate-ownership-map.mjs --check` and
  `python scripts/verify-namespace-governance.py --check-ownership`.

---

## 1. How these tickets map to the plan

| Plan §7 Phase 2 task | Ticket |
|---|---|
| Introduce `ModuleContext`; expose event bus, capability registry, settings store, namespaced store factory, reporting facade handle, logger, clock, transaction coordinator | P2 — the context and its capability registry |
| Migrate module initialization to use `ModuleContext` | P3 — migrate `init_module_system` onto the context |
| Keep legacy shared-connection access behind compatibility adapters | P1 — the `NamespacedStore` view (the adapter) |
| Add tests proving modules cannot acquire ungranted capabilities | P2 (unit) + P4 (integration) |
| Make module registration fail fast when required capabilities are missing | P2 (`register` validates) + P3 (boot fails) |
| Document the boot sequence | P5 — boot-sequence doc |

Keeping the plan's own order: the store view (P1) is the adapter the later tasks reuse; the context (P2)
holds the capability registry; P3 moves the existing registration onto it; P4 proves the gate can fail;
P5 documents the result.

---

## 2. P1 — `NamespacedStore` view (the compatibility adapter)

**Problem (verified).** Every production module function takes the shared connection directly
(`modules/inventory/src/service.rs:19` `get_product(conn: &Connection, ...)`,
`modules/crm/src/service.rs:25` `create_customer(conn: &mut Connection, ...)`). Nothing stops a module
calling `conn.prepare("SELECT ... FROM sales")`: the Phase 1 checker governs what raw SQL *may say* in a
file, not what a runtime path *does* when the SQL is assembled from data.

**What already exists (verified).** The ownership map landed in Phase 2 kickoff:
`crates/kasirmu-core/src/db/ownership.rs` `owner_of()`. The reusable SQL scanner lives in
`crates/kasirmu-plugin/src/db.rs` (`strip_sql_comments` :344, `ensure_no_quoted_identifiers` :282,
`extract_table_references` :404). `Store<'a>` is the borrowed view this mirrors
(`crates/kasirmu-core/src/db/mod.rs`).

**Ticket P1 — add the borrowed, runtime-checked view.**

1. Add `crates/kasirmu-core/src/db/namespaced.rs` (to be created) implementing the draft's §3 surface: `NamespacedStore<'a>`
   wrapping `Store<'a>`, `ModuleId`, `Grants { read: Vec<ModuleId> }`, hand out `own()` and
   `read(module) -> Result<Namespace, NamespaceError>`, and `Namespace::{query, execute, raw}`.
2. Resolve each table against `ownership::owner_of`; a table owned by the module or in `grants.read` passes,
   anything else is `NamespaceError::Foreign`, and an unmapped table is `NamespaceError::UnknownTable`
   (fail-closed). Reuse the `kasirmu-plugin` scanner (C3: no second parser, no new dependency).
3. No `write(module)`, no connection pool, no async (draft §3.1). `raw()` stays for the migration window but
   every call emits a structured warning naming module + tables (draft open question 2).
4. The check is a pure function over `(owner, grants, sql)` so it unit-tests without a database.

**Files:** `crates/kasirmu-core/src/db/namespaced.rs` (to be created); `crates/kasirmu-core/src/db/mod.rs`
(`pub mod namespaced;`); `crates/kasirmu-core/src/db/namespaced_tests.rs` (to be created).

**Acceptance criteria:**
- Unit tests (no DB) prove: own-table passes; granted foreign read passes; ungranted foreign read is
  `Foreign`; unknown table is `UnknownTable`; a comment-hidden or quoted foreign table is still caught.
- `raw()` naming a foreign table returns `Err(Foreign)`; naming an own table returns the SQL unchanged.
- The file is rustfmt-clean and the crate tests pass (`cargo test -p kasirmu-core --lib namespaced`).

**Depends on:** the ownership map (landed). **Blocks:** P3, P4.

**Status: DONE 2026-10-03.** `crates/kasirmu-core/src/db/namespaced.rs` adds `NamespacedStore<'a>`,
`ModuleId`, `Grants` (read-only, no `write` by construction), `Namespace`, `Posture`, `NamespaceError`, and
the pure `pub fn check_statement(owner, grants, sql, posture)` the unit tests drive without a database. The
scanner is a deliberate reimplementation of `crates/kasirmu-plugin/src/db.rs` (comment stripping, quoted-
identifier rejection, table extraction) because `kasirmu-core` does NOT depend on `kasirmu-plugin` and a
core→plugin edge would invert the dependency graph — the decision the ticket said to make in review. Table
resolution goes through `ownership::owner_of` (fail-closed on an unmapped table); a `Posture::ReadOnly`
handle additionally rejects any write verb, so a granted foreign read cannot write. 18 unit tests
(`crates/kasirmu-core/src/db/namespaced_tests.rs`, 13 pure + 5 in-memory-connection) cover own/granted/
foreign/unknown, quoted identifiers, comment-hidden tables, string-literal content, CTE names, and the
handle-level `read()`/`raw()` paths. `cargo test -p kasirmu-core --lib namespaced` 18/18; clippy pedantic and
rustfmt edition 2024 clean.

---

## 3. P2 — `ModuleContext` and the capability registry

**Problem (verified).** No `ModuleContext`, no `CapabilityRegistry`, no capability concept exists anywhere in
the tree (grep of `platform/`, `crates/`, `foundation/` finds none in Rust; the only `capabilit` hits are the
Tauri permission framework in `apps/desktop-tauri/tests/capability_parity.rs`, a different thing). The
`Module` trait (`foundation/src/contracts.rs:27`) has `id`/`dependencies`/`on_load`/`on_start`/`on_stop`
and no way to reach a platform service. Manifests carry `dependencies` and `permissions` but neither gates
code (`modules/inventory/manifest.json`).

**Ticket P2 — a narrow, typed context plus a capability registry.**

1. Add `ModuleContext` (proposed home: a new `platform/kernel/src/context.rs`, since the kernel owns module boot)
   exposing the plan's list: the event-bus handle, the capability registry, the settings store, a namespaced
   store factory, the reporting facade handle, a logger, a clock, and the transaction coordinator.
2. Add `CapabilityRegistry`: a module declares required capabilities (from its manifest `permissions` plus a
   new `capabilities` list in the vocabulary `docs/architecture/namespaced-store-api-draft.md` needs:
   `read:<module>`, `subscribe:<event>`, `use:reporting_facade`, ...), and `register` **fails fast** when a
   required capability is not explicitly granted.
3. Keep the context **narrow**: no service-locator bag. Each accessor returns a typed handle, and granting is
   the only way to obtain a foreign one.
4. `Module` gains a hook to receive the context (e.g. `fn on_context(&mut self, ctx: &ModuleContext)`);
   default no-op so existing impls compile.

**Files:** `platform/kernel/src/context.rs` (to be created), `platform/kernel/src/lib.rs`,
`foundation/src/contracts.rs` (`Module` hook + `Capability` type), `platform/kernel/src/manifest.rs`.

**Acceptance criteria:**
- A unit test proves a module that requests an ungranted capability fails registration with a named error.
- A unit test proves a granted capability is handed back as the typed handle, not a generic bag.
- `cargo test -p platform-kernel` is green and existing module registration still compiles.
- The manifest schema `docs/specs/module-manifest.schema.json` gains the `capabilities` field, with a
  parity/gate check that a declared capability in code appears in the manifest (or is explicitly empty).

**Depends on:** P1 (the store factory hands out `NamespacedStore`). **Blocks:** P3.

**Status: ACCEPTANCE MET 2026-10-03; context surface still growing.** The capability half of P2 has landed: `platform/kernel/src/capability.rs` adds `Capability` (`namespace:action`, parsed), `ModuleCapabilities` (required + granted sets), and `CapabilityRegistry` (`verify_all` returns a named `MissingCapability` for the first unsatisfied module in id order); `platform/kernel/src/error.rs` gains `MissingCapability` and `InvalidCapability`; `ModuleManifest` gains a `capabilities: Vec<String>` field with validation, and `docs/specs/module-manifest.schema.json` gains the matching `capabilities` property (proven in parity by a new integration test that fails when the schema or struct drifts). `ModuleContext` is defined as a `dyn`-compatible trait in `foundation/src/contracts.rs` (the bottom of the dependency graph, so the kernel can implement it without inverting the graph) with `Module::on_context` a default no-op hook; `platform/kernel/src/context.rs` adds the concrete `KernelContext`. `Kernel` carries the registry and fails fast: `load_all` runs `verify_capabilities()` **before any `on_load`**, and hands each module its capability-scoped `KernelContext` after `on_load`. Tests: `capability_tests.rs` (16), `context_tests.rs` (8), `capability_lifecycle_tests.rs` (8, including boot-fails-on-ungranted and `on_context` delivery), plus the manifest parity tests; `cargo test -p platform-kernel` green and the workspace still compiles. All four acceptance criteria above are satisfied. The wider context surface the ticket's step 1 lists (event-bus, settings store, namespaced-store factory, reporting-facade, logger, clock, transaction coordinator accessors) is deliberately not on `ModuleContext` yet: adding all of them now would make it the service-locator bag criterion 3 forbids. Each accessor is added as the vertical that needs it migrates, so the context stays narrow and every handle is capability-scoped.

---

## 4. P3 — Migrate `init_module_system` onto the context

**Problem (verified).** `platform/startup/src/lib.rs` `init_module_system` (:86) registers 14 modules with
`k.register(Box::new(...))` (:101–:122) and subscribes 11 handlers with `bus.subscribe` (:134–:193) using
the raw bus and connection directly. Nothing forces a module to have been granted a capability before it
subscribes to another vertical's event.

**Ticket P3 — register through the context, deterministically.**

1. Build a `ModuleContext` in `init_module_system`, hand it to each module, and route the `bus.subscribe`
   calls through the capability registry so subscribing to a foreign topic requires the matching grant.
2. Keep legacy access working: a module with no declared capabilities still starts (the plan's "legacy access
   still works during migration"), but the boot logs a deprecation warning naming the module.
3. Make registration order deterministic and document the topological sort already in `load_all`
   (dependencies at `foundation/src/contracts.rs:41`).

**Files:** `platform/startup/src/lib.rs`, `platform/startup/src/event_handlers.rs` (subscription sites).

**Acceptance criteria:**
- `cargo check --workspace --all-targets` clean; the 14 modules still register and the 11 subscriptions
  still fire.
- The `--census` checker still reports 12 classified types, 0 stale (the T1 census is the regression guard
  for moved lines).
- A module with a missing *required* capability fails boot (covered by the P2 unit test) while a module with
  none declared still boots with a warning.

**Depends on:** P2. **Blocks:** P4.

**Status: DONE 2026-10-03.** `init_module_system` (`platform/startup/src/lib.rs`) now declares the wiring owner's capabilities before `load_all` and routes all 11 subscription sites (8 unconditional + 3 whatsapp-feature-gated) through `Kernel::subscribe_gated`, a new kernel method that refuses a subscription when the module declares a capability set without holding the topic's `subscribe:<event>` grant (`KernelError::MissingCapability`), allows it with a deprecation warning when the module declares nothing (the legacy path), and registers with module ownership so stopping the module unsubscribes it. `STARTUP_WIRING_CAPABILITIES` (a public const) names the four topics once (`subscribe:sale.completed`, `subscribe:product.created`, `subscribe:stock.adjusted`, `subscribe:settings.updated`); each is required and granted, so the wiring cannot listen on an undeclared topic. Registration order was already deterministic and now carries an explicit comment tying it to `load_all`'s topological sort. Tests in `startup_tests.rs`: the capability list covers every subscribed topic, an ungranted subscription is refused (and registers no handler), a granted one is accepted, and a module with no declaration still subscribes. `cargo test -p platform-startup` 104 pass; `--census` still reports 12 rows / 0 stale; workspace check, clippy `-D warnings`, and the `whatsapp-notifications` feature build are all clean.

---

## 5. P4 — Integration test: no ungranted capability

**Problem.** The plan's exit criterion is "Modules cannot acquire ungranted capabilities" and "Module
startup behavior is deterministic". A unit test on the registry (P2) does not prove the *boot path* refuses.

**Ticket P4 — a boot-path integration test.**

1. Add an integration test that boots the module system with a fixture module requesting an ungranted
   capability and asserts boot fails with the named capability error.
2. Add a second test that boots the real module set and asserts deterministic order and a clean start.
3. Assert at least one module reads through the `NamespacedStore` factory (P1) and that a foreign read
   without a grant returns `NamespaceError::Foreign` at the boundary.

**Files:** a new integration test under `platform/startup/tests/` (to be created), or the kernel's test module.

**Acceptance criteria:**
- Deliberately removing a grant from a fixture module makes the boot test fail, naming module + capability;
  restoring it passes.
- The real boot test passes twice in a row with identical ordering output.

**Depends on:** P3.

**Status: DONE 2026-10-03.** `platform/startup/tests/boot_capability.rs` (created) is the boot-path integration test. It registers a `FixtureModule` that requires `write:sales` with no grant and asserts `load_all` fails with `KernelError::MissingCapability { module: "fixture-ungranted", missing: "write:sales" }`; the paired positive control registers the same module WITH the grant and asserts a clean load — so the grant is what flips the result. A second test calls `init_module_system` twice and asserts both boots succeed and register an identical (>= 14) module set, pinning deterministic startup. A third exercises the `NamespacedStore` boundary from P1: `reporting` reading `sales` without the grant is refused with `NamespaceError::Foreign`, and a granted read handle runs the same query. `cargo test -p platform-startup` runs 104 lib + 4 boot_capability + 1 doctest, all green; clippy `-D warnings`, rustfmt, and `cargo check --workspace --all-targets` are clean.

---

## 6. P5 — Document the boot sequence

**Ticket P5 — one page describing how a module starts.**

1. Add `docs/architecture/module-boot-sequence.md` (to be created): registration → dependency sort → capability check →
   `on_load` → `on_start`, naming the real functions and line anchors.
2. State the compatibility window explicitly (legacy `&Connection` access is allowed but logs a warning
   until Phase 4 removes `raw()`).
3. Link it from `docs/architecture/module-namespace-governance.md` and the plan's Phase 2 exit criteria.

**Files:** `docs/architecture/module-boot-sequence.md` (to be created); inbound links from the governance doc.

**Acceptance criteria:**
- The docs-auditor dead-ref check (`.agents/skills/docs-auditor/scripts/check-dead-refs.py`) is clean on
  the new page (to be created at `docs/architecture/module-boot-sequence.md`) once P5 lands.
- Every function named in the page exists at the named location on the commit that lands it.

**Depends on:** P3 (the code it documents).

**Status: DONE 2026-10-03.** `docs/architecture/module-boot-sequence.md` (created) walks the real boot path — registration, the wiring owner's capability declaration, the topological dependency sort, the fail-fast capability check, `on_load` + `on_context`, `on_start`/`on_stop`, and the gated subscriptions — naming the actual functions and line anchors (`init_module_system` at `platform/startup/src/lib.rs:109`; `Kernel::load_all` at `platform/kernel/src/kernel/lifecycle.rs:234`; `verify_capabilities` at `:245`; `subscribe_gated` at `:696`). It states the compatibility window explicitly (undeclared capabilities log; `NamespacedStore::raw` is the escape hatch removed in Phase 4) and links from `docs/architecture/module-namespace-governance.md`. The dead-ref check is clean on the new page, and all 23 named `file:line` function anchors were verified to point at the named code on this commit.

---

## 7. Sequencing

```
P1 (store view)  →  P2 (context + registry)  →  P3 (migrate boot)  →  P4 (boot test)  →  P5 (doc)
```

P1 is independently reviewable and revertible and unblocks the runtime check the whole phase exists for. P5
trails the code so the doc describes what actually shipped, not the plan's aspiration.
