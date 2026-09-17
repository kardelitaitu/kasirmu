# OZ-POS Modules

<!-- Audit stamp: 2026-08-31 · docs-auditor · status: ACCURATE (0 findings) · verified against HEAD: all 4 stubs (purchasing/promotions/giftcards/kitchen) confirmed lifecycle-only (the PROMO-3 engine lives in kasirmu-core, not modules/promotions); loyalty Active (models/repository/service); dependency table matches manifest.json (sales->inventory, reporting->inventory+sales, loyalty->crm, kitchen->sales+terminal); referenced files exist (scripts/new-module.{ps1,sh}, docs/specs/module-manifest.schema.json, platform/startup/src/startup_tests.rs) -->

Each directory here is one **business vertical**: a Cargo crate that owns a
slice of the domain and plugs into the kernel through a single trait. This file
is the contract for adding one.

## Anatomy of a module

```
modules/<id>/
  Cargo.toml        # package `modules-<id>`, [lints] workspace = true
  manifest.json     # id, version, dependencies, permissions
  README.md         # what it owns; promotion checklist if it is a stub
  src/
    lib.rs          # `<Pascal>Module` implementing foundation::contracts::Module
    error.rs        # `<Pascal>Error` (thiserror: Db / NotFound / Validation)
    models.rs       # domain types            (owning modules)
    repository.rs   # SQL, one namespace      (owning modules)
    service.rs      # orchestration, in a transaction (owning modules)
    lib_tests.rs    # sibling test file, imported via #[path]
```

`manifest.json` is validated against `docs/specs/module-manifest.schema.json`:
kebab-case `id`, semver `version`, a `dependencies` array of other module ids,
and a `permissions` array.

## The two sources of truth, and why they cannot drift

A module declares its dependencies **twice** — in `manifest.json` and in
`Module::dependencies()` — because they serve different consumers. The manifest
is data (tooling, docs, future dynamic loading); the trait method is what the
kernel actually reads when it topologically sorts modules before calling
`on_load` and `on_start`.

Every module has a test asserting the two are equal:

```rust
#[test]
fn manifest_json_matches_module_declaration() {
    let parsed: serde_json::Value =
        serde_json::from_str(include_str!("../manifest.json")).unwrap();
    let declared: Vec<&str> = parsed["dependencies"].as_array().unwrap()
        .iter().map(|v| v.as_str().unwrap()).collect();
    assert_eq!(declared, MyModule::new().dependencies().to_vec());
}
```

Two further guards live in `platform/startup/src/startup_tests.rs`:

- **`every_module_manifest_is_registered`** — the set of `modules/*/manifest.json`
  ids must equal the set `init_module_system` registers. A module directory that
  nothing registers is dead code: its `on_load` never runs, so any event handler
  it was supposed to register silently does not exist. `modules/loyalty` shipped
  in exactly that state for several releases while a `LoyaltyEarnHandler` was
  wired on `sale.completed` from the startup crate instead.
- **`every_declared_dependency_is_registered`** — a dependency on an unregistered
  id would fail `load_all` at runtime, inside the client's Tauri setup closure,
  on a real machine. It fails here instead.

## Adding a module

Use the generator; it writes a crate that compiles and passes its own tests on
the first run.

```powershell
pwsh -File scripts/new-module.ps1 -Id purchasing -Name "Purchasing" `
     -Description "Supplier records and purchase orders." `
     -Dependencies inventory
```

```bash
scripts/new-module.sh --id purchasing --name "Purchasing" \
    --description "Supplier records and purchase orders." \
    --dependencies inventory
```

Pass `-DryRun` / `--dry-run` to see the file list without writing anything.

The root `Cargo.toml` globs `modules/*`, so the new directory becomes a
workspace member with no edit there. Two wiring edits remain, and the generator
prints both:

1. `Cargo.toml` → `[workspace.dependencies]`:
   `modules-<id> = { path = "modules/<id>" }`
2. `platform/startup/Cargo.toml` → `[dependencies]`:
   `modules-<id> = { workspace = true }`, and in
   `platform/startup/src/lib.rs::init_module_system`:
   `k.register(Box::new(modules_<id>::<Pascal>Module::new()))?;`

Then:

```bash
cargo test -p modules-<id> --lib
cargo test -p platform-startup --lib every_module_manifest_is_registered
```

## Stubs and the promotion path

Four modules — `purchasing`, `promotions`, `giftcards`, `kitchen` — are
**stubs**: they own their id, manifest, dependency edges, and error type, but no
domain logic. Their hooks only log.

This is deliberate. A stub costs one `register` line and buys the dependency
graph, load order, and shutdown order being exercised from the first commit.
Filling one in later is an additive change inside one crate, not a
cross-cutting one that touches the workspace manifest, the startup crate, and
the kernel at the same time as the business logic.

Promoting a stub, in order:

1. **Models first.** Move or write the domain types in `models.rs`. If the types
   already exist in the wrong crate (as the `GiftCard*` types do in
   `modules/loyalty`), move them and re-export from the old location for one
   release so downstream `use` paths keep compiling.
2. **Repository.** Own the tables. Use the module's `database_namespace` prefix
   so ownership is legible in the schema. All writes go through a `rusqlite`
   transaction — never write outside one.
3. **Service.** Orchestration goes here, and any operation that touches two
   tables commits once. This is the layer where money bugs are prevented: a
   gift-card redeem that debits the card without recording the tender line is a
   bug no test at the repository layer will catch.
4. **Events, not reaching across.** If another vertical's state must change,
   emit an event in `on_load`'s subscriptions rather than writing that
   vertical's tables. `purchasing` receiving a PO should emit
   `stock.adjusted`, not write `inventory_*` rows.
5. **Timers are lifecycle-bound.** Spawn in `on_start`, cancel in `on_stop`. A
   stopped module must leave nothing running.
6. **Commands and UI last.** Tauri commands live in the owning app's
   `commands/` directory and are registered in its `lib.rs`; front-end calls go
   through `ui/src/api/`. Gate the UI on the module's feature flag.

## Conventions that apply to every module

- **Money is `i64` minor units** via the `Money` struct. Never `f32`/`f64` for
  currency, at any layer, including intermediate calculations.
- **Errors** use `thiserror` with `Db` / `NotFound` / `Validation` variants and a
  `validation(field, message)` constructor. Application-level propagation uses
  `anyhow`.
- **Docs** — every public item gets a `///`; every production file opens with a
  5–15 line `//!` module doc. `missing_docs = "warn"` is inherited from
  `[workspace.lints]` via `[lints] workspace = true`.
- **Tests** live in a sibling `*_tests.rs`, imported with
  `#[cfg(test)] #[path = "x_tests.rs"] mod tests;`. Never inline tests in a
  production file.
- **File size** — keep production files under 1,000 lines, preferably under 600.

## Current modules

| Module | Status | Dependencies |
|--------|--------|--------------|
| `inventory` | Active | — |
| `crm` | Active | — |
| `tax` | Active | — |
| `settings` | Active | — |
| `staff` | Active | — |
| `terminal` | Active | — |
| `currency` | Active | — |
| `sales` | Active | `inventory` |
| `reporting` | Active | `inventory`, `sales` |
| `loyalty` | Active | `crm` |
| `purchasing` | Stub | `inventory` |
| `promotions` | Stub | `sales` |
| `giftcards` | Stub | `sales` |
| `kitchen` | Stub | `sales`, `terminal` |

> last audited 31-08-26 by docs-auditor
