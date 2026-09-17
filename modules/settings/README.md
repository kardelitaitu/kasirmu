<!-- Audit stamp: 2026-07-22 · Hermes-Agent · status: ACCURATE (0 findings, 1 low-severity observe) · all owned paths verified: crates/kasirmu-core/src/settings.rs + db/settings.rs, commands/{settings,setup,sync}.rs, features/{settings,setup}, api/settings.ts, ui/src/locales/settings.ftl; modules/settings/src/lib.rs has SettingsModule; manifest deps [] match · observe: Overview says settings owns "currency/exchange rate configuration" while modules/currency owns the ISO table + rates — a doc overlap (settings = default-currency config, currency = table/rates), not a false claim · Kernel API matches · RE-AUDITED 31-08 by docs-auditor: manifest.json re-verified (id settings, v1.0.0, deps [], perms view/edit); on_load/on_start/on_stop are stubs (log + "future phases will register handlers") — Lifecycle corrected (previously implied they validate/prepare/clean up); crate has repository.rs/service.rs (SettingsRepository/SettingsService) NOT wired into runtime and NOT parity-tested (no tests/boundary_contract.rs); · EXTENDED 12-09-26: the "NOT wired" half was imprecise — the MODULE is registered (platform/startup/src/lib.rs:97); what has no production caller is the mirror's setters, and be1d42003 pinned that door as a known hazard (MSL-5), which this page did not mention at all until now; the currency-ownership observe (settings = default-currency config, currency = ISO table/rates) still holds; normalized footer -->

# Settings Module

**Status:** Active (Phase 2.6 — Proof of Concept)

## Overview

The Settings module owns the store configuration vertical. It handles store name/address/tax ID, receipt formatting options, feature flag management, currency/exchange rate configuration, sync settings, and the setup wizard state.

## Module Info

| Field        | Value            |
|--------------|------------------|
| ID           | `settings`       |
| Version      | `1.0.0`          |
| Dependencies | `[]`             |
| Permissions  | `settings:view`, `settings:edit` |

## Currently Owns

- **Backend** — Settings CRUD, feature flags, currencies (`crates/kasirmu-core/src/settings.rs`, `crates/kasirmu-core/src/db/settings.rs`)
- **Commands** — Settings, setup, and sync Tauri commands (`apps/desktop-tauri/src/commands/settings.rs`, `apps/desktop-tauri/src/commands/setup.rs`, `apps/desktop-tauri/src/commands/sync.rs`)
- **Frontend** — Settings and setup wizard screens (`ui/src/features/settings/`, `ui/src/features/setup/`)
- **API** — TypeScript API client (`ui/src/api/settings.ts`)
- **Locale** — Fluent translation strings (`ui/src/locales/settings.ftl`)

In the current phase the runtime settings path still runs through the files above (notably `crates/kasirmu-core/src/settings.rs` and `db/settings.rs`). The crate now also carries a mirror — `repository.rs` (`SettingsRepository`) and `service.rs` (`SettingsService`). Precision, because the two halves are in different states: the **module** is wired (it is registered with the kernel at `platform/startup/src/lib.rs:97`), while the **mirror's setters are called by nobody** — every reference to `SettingsRepository` / `SettingsService` outside this crate is a doc comment, measured untruncated at the time this was written. Unlike tax/inventory there is also no `tests/boundary_contract.rs` pinning them. A subsequent phase will move the implementation fully into `modules/settings/`.

### The mirror's write door is unguarded (MSL-5)

`SettingsRepository::set` and `SettingsService::set` take a key and a value and UPSERT
them, and they ask nothing first: no credential refusal, no `settings:edit` check (the
permission this module's own manifest declares), no `IngestPolicy`, and no
`terminal_id` — so the write never reaches the DB-08 delta ledger. A deny-listed
credential is accepted and reads back byte-identical with `setting_updated` left empty;
the list itself lives in `platform/core/src/settings/keys.rs` and is deliberately not
copied here. That state is pinned by
`known_hazard_set_writes_a_deny_listed_credential_in_cleartext` in
`src/repository_tests.rs`, which asserts today's truth so the day a guard appears, that
test is the thing that notices.

Safe for: a key outside the deny list that holds no credential and need not be
versioned. Not safe for anything the credential guards cover — and those guards key on
the funnel, `platform_core::settings::Settings::set_tracked`, which asks
`cleartext_credential_refusal` before writing and records the delta row. When this
mirror is wired in, writes go through that funnel; `src/repository.rs` records why the
guard was not added here instead. Until then the door is latent, not live — re-run
`git grep -n "SettingsService" -- .` rather than trusting this sentence.

## Lifecycle

The module implements `foundation::contracts::Module`. Its lifecycle hooks are currently **stubs** — each logs a message and returns `Ok(())`; none touch the database or event bus yet:

1. **`on_load`** — logs "validating configuration" (a future phase will register event handlers to react to setting changes)
2. **`on_start`** — logs "ready to manage configuration"
3. **`on_stop`** — logs "cleaning up"

## Registration

Registered with the kernel during application setup:

```rust
use modules_settings::SettingsModule;
use platform_kernel::Kernel;

let mut kernel = Kernel::new();
kernel.register(Box::new(SettingsModule::new()))?;
kernel.load_all()?;
kernel.start_all()?;
```

## Manifest

```json
{
  "id": "settings",
  "name": "Settings",
  "version": "1.0.0",
  "dependencies": [],
  "permissions": ["settings:view", "settings:edit"]
}
```

> Extended 12-09-26 with the MSL-5 hazard note above.

> last audited 31-08-26 by docs-auditor
