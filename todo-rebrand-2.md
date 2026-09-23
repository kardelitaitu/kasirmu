# todo-rebrand-2.md — Structural renames (Tier 3)

<!-- Follows todo-rebrand.md (Phases 1-9, user-visible changes). -->
<!-- This file covers the structural renames `todo-rebrand.md` defers: crate names, binary names, -->
<!-- Rust symbols, CLI subcommands, and the GitHub repo move. -->
<!-- NOT "zero user-visible", which is what this line used to claim while T3-5 said the opposite in its
     own body. Three items here are visible breaking changes: the CLI binary `oz` → `kasir` (T3-2),
     the subcommands `export-ozpkg`/`import-ozpkg` → `export`/`import` (T3-5), and the persisted
     client keys (Notes), which log every existing user out unless migrated. -->
<!-- Execute only AFTER todo-rebrand.md is fully merged. -->
<!-- Commit law: one pathspec commit per phase; no git add, no -a, no amend — EXCEPT the §3 one-line
     new-file chain (`git add -- <new/path> && git commit -m "..." -- <new/path>`), which T3-1
     (16 crate-directory renames — `crates/` holds 16 `oz-*` dirs plus `qris-core`, which stays) and
     T3-4 (two module-file renames) both require. This line previously said a bare "no git add" while
     T3-4:176 instructed the opposite. -->
<!-- Every count in this file was re-measured 2026-09-16 at `442473337`; the command sits beside the
     number, because two of them had drifted enough to change the work: see T3-3. -->

## Legend
- `[ ]` not started
- `[/]` in progress
- `[x]` done

---

## Overview

| Phase | What | Files affected |
|---|---|---|
| T3-1 | Crate library renames — `Cargo.toml` + directory renames | 17 crates × 2–4 files |
| T3-2 | Binary / lib-crate target names | 6 targets in 4 Cargo.toml files, + the root profile section (30 paths once the scripts/packaging surface is included — see the phase) |
| T3-3 | `use oz_*` imports across all Rust source | 413 `.rs` files (`git grep -l "use oz_" -- "*.rs" \| wc -l`) |
| T3-4 | `oz_core::ozpkg` module + `OzpkgPayload` struct + `export_ozpkg`/`import_ozpkg` fn names | 8 `.rs` files carry the symbols (`git grep -l -E "OzpkgPayload\|export_ozpkg\|import_ozpkg\|oz_core::ozpkg\|run_export_ozpkg\|run_import_ozpkg" -- "*.rs"`), + the test/fuzz files that rename with the module |
| T3-5 | CLI subcommand names `export-ozpkg` / `import-ozpkg` → `export` / `import` (with deprecation) | `oz-cli` crate |
| T3-6 | `deny.toml` + workspace `Cargo.toml` metadata | 2 files |
| T3-7 | GitHub repo move + badge URLs + updater endpoints | admin action + ~20 files |

> **Do T3-1 first.** Every downstream phase depends on the crate names being settled.
> Run `cargo check --workspace --all-targets --all-features` after every phase before committing.

---

## T3-1 — Crate library renames

Each crate rename is a three-step operation:
1. Change `name = "oz-…"` in `crates/<name>/Cargo.toml` (and optionally rename the directory).
2. Update the workspace `[dependencies]` entry in the root `Cargo.toml`.
3. Update all `[dependencies]` sections in consumer crates that reference the old name.

Rename map (all `oz-*` → `kasirmu-*`; `qris-core` keeps its name — not an oz-brand):

| Old crate name | New crate name | Directory |
|---|---|---|
| `oz-core` | `kasirmu-core` | `crates/oz-core/` → `crates/kasirmu-core/` |
| `oz-bridge` | `kasirmu-bridge` | `crates/oz-bridge/` → `crates/kasirmu-bridge/` |
| `oz-api` | `kasirmu-api` | `crates/oz-api/` → `crates/kasirmu-api/` |
| `oz-hal` | `kasirmu-hal` | `crates/oz-hal/` → `crates/kasirmu-hal/` |
| `oz-cli` | `kasirmu-cli` | `crates/oz-cli/` → `crates/kasirmu-cli/` |
| `oz-lan` | `kasirmu-lan` | `crates/oz-lan/` → `crates/kasirmu-lan/` |
| `oz-local-api` | `kasirmu-local-api` | `crates/oz-local-api/` → `crates/kasirmu-local-api/` |
| `oz-crypto` | `kasirmu-crypto` | `crates/oz-crypto/` → `crates/kasirmu-crypto/` |
| `oz-lua` | `kasirmu-lua` | `crates/oz-lua/` → `crates/kasirmu-lua/` |
| `oz-media` | `kasirmu-media` | `crates/oz-media/` → `crates/kasirmu-media/` |
| `oz-payment` | `kasirmu-payment` | `crates/oz-payment/` → `crates/kasirmu-payment/` |
| `oz-plugin` | `kasirmu-plugin` | `crates/oz-plugin/` → `crates/kasirmu-plugin/` |
| `oz-reporting` | `kasirmu-reporting` | `crates/oz-reporting/` → `crates/kasirmu-reporting/` |
| `oz-security` | `kasirmu-security` | `crates/oz-security/` → `crates/kasirmu-security/` |
| `oz-logging` | `kasirmu-logging` | `crates/oz-logging/` → `crates/kasirmu-logging/` |
| `oz-notification` | `kasirmu-notification` | `crates/oz-notification/` → `crates/kasirmu-notification/` |
| `oz-cloud-server` | `kasirmu-cloud-server` | `apps/cloud-server/` (no dir rename — keep path) |

Files to touch per crate:
- [ ] `crates/<name>/Cargo.toml` — `name = "oz-…"` → `"kasirmu-…"`
- [ ] `crates/<name>/Cargo.toml` — `description` prose if it says "OZ-POS …" (covered by todo-rebrand.md Phase 9 but verify)
- [ ] Root `Cargo.toml:49–64` — update each `oz-* = { path = … }` key and value
- [ ] Every consumer `Cargo.toml` `[dependencies]` entry that names the old crate

**Commit:** `refactor(workspace): rename all oz-* crates to kasirmu-*`
**Pathspec:** root `Cargo.toml` + all `crates/*/Cargo.toml` + `apps/*/Cargo.toml` that reference them

> After this commit, `cargo check` will fail on every `use oz_*::` — that is expected; T3-3 fixes it.

---

## T3-2 — Binary and lib-crate target names

**Commit:** `refactor(cargo): rename oz-pos-app / oz-pos-tablet / oz-cloud-server binary targets`
**Pathspec:** `apps/desktop-client/Cargo.toml apps/tablet-client/Cargo.toml apps/cloud-server/Cargo.toml crates/kasirmu-cli/Cargo.toml Cargo.toml apps/desktop-client/src/main.rs apps/tablet-client/src/main.rs apps/cloud-server/build.rs apps/cloud-server/src/main.rs apps/cloud-server/tests/startup.rs crates/kasirmu-cli/src/cli.rs scripts/check.sh scripts/check.ps1 scripts/release.sh scripts/coverage.sh scripts/coverage.ps1 scripts/setup-cache.sh scripts/setup-cache.ps1 scripts/setup-dev.ps1 scripts/build-exe-release.ps1 scripts/dev-code-sign.ps1 scripts/profile.sh scripts/profile.ps1 scripts/gates.json scripts/architecture-cargo-metadata.json .agents/verify-lane.sh packaging/linux/oz-pos.desktop packaging/mobile/README.md .github/workflows/release.yml .github/workflows/dev-ci.yml`

> **Pathspec rebuilt.** The original listed 9 files but its own body edits at least 4 more it never named — `apps/desktop-client/src/main.rs`, `apps/tablet-client/src/main.rs`, `apps/cloud-server/build.rs` and `apps/cloud-server/tests/startup.rs`. A pathspec commit takes only the paths named, so those edits would have been left in the working tree and the commit would not have compiled (`oz_…_lib::run()` renamed in the lib, old name still called in the bin).

### `apps/desktop-client/Cargo.toml`
- [ ] `name = "oz-pos-app"` (package) → `"kasirmu-app"`
- [ ] `name = "oz_pos_app_lib"` (`[lib]`) → `"kasirmu_app_lib"`
- [ ] `name = "oz-pos-app"` (`[[bin]]`) → `"kasirmu-app"`
- [ ] `default-run = "oz-pos-app"` → `"kasirmu-app"`
- [ ] `[profile.release.package.oz-pos-app]` in root `Cargo.toml:212` → `kasirmu-app`

### `apps/tablet-client/Cargo.toml`
- [ ] `name = "oz-pos-tablet"` (package) → `"kasirmu-tablet"`
- [ ] `name = "oz_pos_tablet_lib"` (`[lib]`) → `"kasirmu_tablet_lib"`
- [ ] `name = "oz-pos-tablet"` (`[[bin]]`) → `"kasirmu-tablet"`

### `apps/cloud-server/Cargo.toml`
- [ ] `name = "oz-cloud-server"` (package + `[[bin]]`) → `"kasirmu-cloud"`

### `crates/kasirmu-cli/Cargo.toml` (renamed in T3-1)
- [ ] `[[bin]] name = "oz"` — decide: keep `oz` as the CLI command name (user-facing), or rename to `kasir`
  - **Recommendation:** rename to `kasir` — this IS user-visible (breaking change)
  - Add a deprecation shim or note in release notes
- [ ] `crates/kasirmu-cli/src/cli.rs:25` — `#[command(name = "oz", about = "OZ-POS maintenance and migration CLI")]`. **Two names on one line, and neither follows the Cargo rename on its own:** clap's `name` is what `--help` and usage errors print, so renaming only the `[[bin]]` target leaves the CLI still calling itself `oz`. The `about` prose is a user-visible brand string too, and it is not in `todo-rebrand.md` either (whose `cli.rs` citations are `:28` for the DB default and `:70,82,84` for the subcommand help).

### `apps/desktop-client/src/main.rs:6,11`
- [ ] `oz_pos_app_lib::run()` → `kasirmu_app_lib::run()`
- [ ] doc comment reference

### `apps/tablet-client/src/main.rs:6,12`
- [ ] `oz_pos_tablet_lib::run()` → `kasirmu_tablet_lib::run()`

### Scripts / CI
> **Rebuilt from the tree.** The original list named 4 files; `git grep -c -E "oz-pos-app|oz-pos-tablet|oz_pos_app_lib|oz_pos_tablet_lib" -- scripts/ packaging/ install/` at `442473337` returns **16 files**, and every one of them would reference a binary that no longer exists.

- [ ] `scripts/check.sh:115` — `--exclude oz-pos-app --exclude oz-pos-tablet` → `--exclude kasirmu-app --exclude kasirmu-tablet`
- [ ] `scripts/check.ps1:116,117` — the same `--exclude` pair on the PowerShell twin (the original list had only the `.sh`)
- [ ] `scripts/release.sh:62,65` — same `--exclude` flags
- [ ] `scripts/coverage.sh:70,71`, `scripts/coverage.ps1:60,61` — same `--exclude` flags in the coverage runners
- [ ] `.github/workflows/release.yml:149` — same `--exclude` flags
- [ ] `.github/workflows/release.yml:243`
  `--exe apps/desktop-client/target/release/oz-pos-app.exe` → `kasirmu-app.exe`
- [ ] `scripts/setup-cache.sh`, `scripts/setup-cache.ps1` (2 each) — cache-key/warm paths naming the app target
- [ ] `scripts/setup-dev.ps1:1` — dev bootstrap
- [ ] `scripts/build-exe-release.ps1:193,211` — `target\release\oz-pos-app.exe` / `target\$config\oz-pos-app.exe`: the release-exe builder
- [ ] `scripts/dev-code-sign.ps1:61` — `-Exe "..., apps\desktop-client\target\release\oz-pos-app.exe"`
- [ ] `scripts/profile.sh:17,27`, `scripts/profile.ps1:14` — `--bin oz-pos-app` help text + examples
- [ ] `scripts/gates.json` (2) — `_note` prose naming `oz-pos-app`
- [ ] `scripts/architecture-cargo-metadata.json:1` — **generated**: regenerate rather than hand-edit; confirm the generator is one of the scripts above
- [ ] `.agents/verify-lane.sh:225–231` — `-p oz-pos-tablet`, `-p oz-pos-app` → new names
- [ ] `packaging/linux/oz-pos.desktop:3,4,5,10` — `Name=OZ-POS`, **`Exec=oz-pos-app`** (a hard dependency on the binary name), `Icon=oz-pos`, `MimeType=application/x-ozpkg`. Also decide the file's own name (`oz-pos.desktop`) — `install/uninstall.sh` references that exact filename
- [ ] `packaging/mobile/README.md:11,105,154,155,175,182` — `oz-pos-tablet.xcodeproj` / `.apk` / `.aab` / `.ipa` artifact names
- [ ] `.github/workflows/dev-ci.yml` — **verified to contain none of these names** (`git grep -n -E "oz-pos-app|oz-pos-tablet|oz-cloud-server" -- .github/workflows/dev-ci.yml` → no output at this tip). It is in this phase's pathspec; do not go looking for a change that isn't there. Its nextest step also carries **no `--exclude` flags**, unlike `check.sh`.

### `apps/cloud-server/`
- [ ] `apps/cloud-server/build.rs:7` — comment `oz-cloud-server.exe` → `kasirmu-cloud.exe`
- [ ] `apps/cloud-server/src/main.rs:9,23` — `oz-cloud-server` in doc + log filter hint
- [ ] `apps/cloud-server/tests/startup.rs:17,18`
  `CARGO_BIN_EXE_oz-cloud-server` → `CARGO_BIN_EXE_kasirmu-cloud`

---

## T3-3 — `use oz_*` imports across all Rust source (413 files)

**Commit strategy:** split by import root, one commit per crate being imported.

> **Rebuilt from the tree at `442473337`; the previous list was wrong in both directions.** It named
> four roots that have no `use oz_x::` site, and omitted one that does. Two commands, because a crate
> can be reached by a `use` import or by an inline path, and only the first is what the old list counted:
>
> ```
> git grep -o -h -E "use oz_[a-z_]+" -- "*.rs" | sort -u          # roots in `use` form
> git grep -o "oz_x::" -- "*.rs" | wc -l                          # inline `crate::`-qualified sites
> ```

| Root | `use` sites (files) | Inline `oz_x::` occurrences | In the old list? |
|---|---|---|---|
| `oz_core` | **344** | 2681 | yes — but it said "~200 files" |
| `oz_bridge` | 92 | — | yes |
| `oz_hal` | 27 | — | yes |
| `oz_security` | 15 | — | yes |
| `oz_payment` | 13 | — | yes |
| `oz_plugin` | 7 | — | yes |
| `oz_notification` | 4 | — | yes |
| `oz_api` | 3 | — | yes |
| `oz_lan` | 3 | — | yes |
| `oz_lua` | 2 | — | yes |
| `oz_local_api` | **1** | 3 | **NO — omitted, and it is a real root** |
| `oz_crypto` | 1 | — | yes |
| `oz_reporting` | none | 13 | yes |
| `oz_cli` | none | 7 | yes |
| `oz_logging` | none | 7 | yes |
| `oz_media` | **none** | **0** | listed, but has no `.rs` site at all — its rename is a `Cargo.toml`/workspace-dep concern (T3-1), not a T3-3 sub-commit |

- [ ] `use oz_core::` → `use kasirmu_core::` — the largest sub-commit by far (**344 files**, not ~200)
- [ ] `use oz_bridge::` → `use kasirmu_bridge::`
- [ ] `use oz_api::` → `use kasirmu_api::`
- [ ] `use oz_hal::` → `use kasirmu_hal::`
- [ ] `use oz_local_api::` → `use kasirmu_local_api::` **(was missing from the list)**
- [ ] `use oz_lan::` → `use kasirmu_lan::`
- [ ] `use oz_crypto::` → `use kasirmu_crypto::`
- [ ] `use oz_lua::` → `use kasirmu_lua::`
- [ ] `use oz_payment::` → `use kasirmu_payment::`
- [ ] `use oz_plugin::` → `use kasirmu_plugin::`
- [ ] `use oz_security::` → `use kasirmu_security::`
- [ ] `use oz_notification::` → `use kasirmu_notification::`
- [ ] Inline-path sub-commits (no `use` line to catch — a `use`-only sweep leaves these broken): `oz_cli::` (7), `oz_reporting::` (13), `oz_logging::` (7), `oz_local_api::` (3)

Affected source areas (directories containing `use oz_*`):
```
apps/cloud-server/src/           apps/desktop-client/src/
apps/desktop-client/src/commands/ apps/desktop-client/tests/
apps/tablet-client/src/          apps/tablet-client/src/commands/
crates/kasirmu-api/src/          crates/kasirmu-api/src/routes/
crates/kasirmu-bridge/src/       crates/kasirmu-bridge/src/topology/
crates/kasirmu-cli/src/commands/ crates/kasirmu-core/benches/
crates/kasirmu-core/src/         crates/kasirmu-core/src/sync/
crates/kasirmu-core/tests/       crates/kasirmu-hal/examples/
crates/kasirmu-hal/src/drivers/  crates/kasirmu-hal/src/traits/
crates/kasirmu-hal/tests/        crates/kasirmu-lan/src/
crates/kasirmu-lua/src/          crates/kasirmu-notification/src/
crates/kasirmu-payment/src/      crates/kasirmu-payment/tests/
crates/kasirmu-plugin/src/       crates/kasirmu-reporting/src/
crates/kasirmu-security/src/     fuzz/fuzz_targets/
modules/inventory/src/           modules/inventory/tests/
modules/sales/tests/             modules/tax/tests/
platform/startup/src/            platform/sync/src/
platform/sync/src/crdt/          platform/sync/tests/
```

> Use `cargo fix` or a targeted sed to batch these — do NOT hand-edit 412 files.
> Verify with `cargo check --workspace` after each sub-commit.

---

## T3-4 — `oz_core::ozpkg` module + internal symbols

**Commit:** `refactor(core): rename ozpkg module and its public symbols`
**Pathspec:** `crates/kasirmu-core/src/ozpkg.rs crates/kasirmu-core/src/ozpkg_tests.rs crates/kasirmu-core/src/ozpkg_password_tests.rs crates/kasirmu-core/src/lib.rs crates/kasirmu-bridge/src/data.rs crates/kasirmu-bridge/src/data_tests.rs crates/kasirmu-cli/src/commands/ozpkg.rs crates/kasirmu-cli/src/commands/ozpkg_tests.rs crates/kasirmu-cli/src/commands/mod.rs crates/kasirmu-cli/src/cli_tests.rs fuzz/fuzz_targets/ozpkg_parse.rs fuzz/Cargo.toml`

### Module rename
- [ ] `crates/kasirmu-core/src/ozpkg.rs` → rename file to `kasirpkg.rs`
  (§3 new-file chain; add `pub mod kasirpkg;` in `lib.rs`, remove `pub mod ozpkg;`)
- [ ] All `use kasirmu_core::ozpkg::` → `use kasirmu_core::kasirpkg::`

### Struct and function renames
| Old name | New name | Files |
|---|---|---|
| `OzpkgPayload` | `KasirpkgPayload` | `crates/kasirmu-core/src/kasirpkg.rs`, `crates/kasirmu-bridge/src/data.rs:375,474`, `crates/kasirmu-cli/src/commands/ozpkg.rs:100,221` |
| `export_ozpkg` | `export_kasirpkg` | `crates/kasirmu-core/src/kasirpkg.rs`, `crates/kasirmu-bridge/src/data.rs:24,493`, `crates/kasirmu-cli/src/commands/ozpkg.rs:100,235` |
| `import_ozpkg` | `import_kasirpkg` | `crates/kasirmu-core/src/kasirpkg.rs`, `crates/kasirmu-bridge/src/data.rs:24,532,561`, `crates/kasirmu-cli/src/commands/ozpkg.rs:272,278` |
| `run_export_ozpkg` | `run_export_kasirpkg` | `crates/kasirmu-cli/src/commands/ozpkg.rs:94`, `crates/kasirmu-cli/src/commands/mod.rs:121` |
| `run_import_ozpkg` | `run_import_kasirpkg` | `crates/kasirmu-cli/src/commands/ozpkg.rs:266`, `crates/kasirmu-cli/src/commands/mod.rs:126` |

### Module file rename
- [ ] `crates/kasirmu-cli/src/commands/ozpkg.rs` → `kasirpkg.rs`
  (update `mod.rs:10,27,40`: `pub(crate) mod ozpkg` → `pub(crate) mod kasirpkg`)

### Test fixtures
- [ ] `crates/kasirmu-bridge/src/data_tests.rs` — update function/struct names, keep `.kasirpkg` extension tests from Phase 6
- [ ] `crates/kasirmu-cli/src/cli_tests.rs` — `cli_parse_export_ozpkg()` → `cli_parse_export_kasirpkg()`, `cli_parse_import_ozpkg()` → `cli_parse_import_kasirpkg()`
- [ ] `crates/kasirmu-core/src/ozpkg_tests.rs` — **was missing from the pathspec.** Renames with `ozpkg.rs` (§3 new-file chain) and imports the renamed symbols, so leaving it out reds the crate's own tests
- [ ] `crates/kasirmu-core/src/ozpkg_password_tests.rs` — same; the module's password-path suite
- [ ] `crates/kasirmu-cli/src/commands/ozpkg_tests.rs` — same; calls `run_export_ozpkg` at `:150`

### Fuzz target (unlisted in the original)
- [ ] `fuzz/Cargo.toml:86,87` — `[[bin]] name = "ozpkg_parse"` / `path = "fuzz_targets/ozpkg_parse.rs"`, and the comment at `:34` that names it. Renaming the file without this entry breaks `cargo fuzz`
- [ ] `fuzz/fuzz_targets/ozpkg_parse.rs:1,18,32` — header/binary name in the doc comment and its `--features oz-plugin-fuzz ozpkg_parse` invocation
- [ ] **Decide separately:** this target exercises `oz_plugin::package::OzpkArchive` (5 sites in `crates/oz-plugin/src/package.rs`, 32 in `package_tests.rs`, 2 here), a *different* symbol family — `Ozpk`-prefixed, no `g`. It is not in the rename table above and `.ozpkg` → `.kasirpkg` does not require touching it. Record the decision (rename or leave) rather than letting it be discovered mid-phase.

---

## T3-5 — CLI subcommand names `export-ozpkg` / `import-ozpkg`

**Commit:** `refactor(cli): rename export-ozpkg/import-ozpkg subcommands (breaking change)`
**Pathspec:** `crates/kasirmu-cli/src/cli.rs crates/kasirmu-cli/src/cli_tests.rs crates/kasirmu-cli/src/commands/mod.rs`

> ⚠️ This is user-facing. Any script calling `oz export-ozpkg` will break.
> The CLI binary itself is renamed `kasir` in T3-2, so users will already need to update their scripts.
> Document both changes in the release notes under "Breaking Changes".

- [ ] `crates/kasirmu-cli/src/cli.rs` — `ExportOzpkg` variant → `Export`; `ImportOzpkg` variant → `Import`
  - Old: `oz export-ozpkg -o backup.kasirpkg -p secret`
  - New: `kasir export -o backup.kasirpkg -p secret`
- [ ] `crates/kasirmu-cli/src/commands/mod.rs:121,126` — match arm names
- [ ] `crates/kasirmu-cli/src/cli_tests.rs` — update test inputs `"export-ozpkg"` → `"export"` etc.

---

## T3-6 — `deny.toml` + workspace `Cargo.toml` metadata

**Commit:** `chore(workspace): update deny.toml crate entries and Cargo.toml metadata for new names`
**Pathspec:** `deny.toml Cargo.toml`

### `deny.toml` — crate skip entries (lines 88–178)
**19 entries**, not 18: `git grep -n 'name = "oz-' -- deny.toml`. Each `name = "oz-…"` entry under `[bans.skip]`: the original list stopped at `oz-reporting` and **omitted `oz-security` (deny.toml:178)**, which would have left one skip entry naming a crate that no longer exists.
- [ ] `oz-api` → `kasirmu-api`
- [ ] `oz-bridge` → `kasirmu-bridge`
- [ ] `oz-cli` → `kasirmu-cli`
- [ ] `oz-cloud-server` → `kasirmu-cloud-server` (or `kasirmu-cloud` — match T3-2)
- [ ] `oz-core` → `kasirmu-core`
- [ ] `oz-crypto` → `kasirmu-crypto`
- [ ] `oz-hal` → `kasirmu-hal`
- [ ] `oz-lan` → `kasirmu-lan`
- [ ] `oz-local-api` → `kasirmu-local-api`
- [ ] `oz-logging` → `kasirmu-logging`
- [ ] `oz-lua` → `kasirmu-lua`
- [ ] `oz-media` → `kasirmu-media`
- [ ] `oz-notification` → `kasirmu-notification`
- [ ] `oz-payment` → `kasirmu-payment`
- [ ] `oz-plugin` → `kasirmu-plugin`
- [ ] `oz-pos-app` → `kasirmu-app`
- [ ] `oz-pos-tablet` → `kasirmu-tablet`
- [ ] `oz-reporting` → `kasirmu-reporting`
- [ ] `oz-security` → `kasirmu-security` **(was missing)**

### Root `Cargo.toml` — profile section
- [ ] `[profile.release.package.oz-pos-app]` → `[profile.release.package.kasirmu-app]`
- [ ] Comment at `:207` and `:212`

### `Cargo.lock`
- [ ] Auto-regenerated by `cargo check` after T3-1/T3-2 — do not edit by hand. Commit the updated lockfile in the same commit as the last crate rename phase.

---

## T3-7 — GitHub repo move + URL updates

> ⚠️ This is an admin action. Complete all code changes first, then do the repo move.

### Step 1: Admin action (not a code commit)
- [ ] Transfer `kardelitaitu/oz-pos` → `kasirmu/kasir.mu` on GitHub
- [ ] Enable "redirect old URLs" (GitHub preserves the redirect for 12 months)
- [ ] Update Northflank / CI secrets that reference the old repo name

### Step 2: Update hard-coded URLs (code commits after the move)

**Commit:** `chore(config): update GitHub repo URLs to kasirmu/kasir.mu`
**Pathspec:** `Cargo.toml README.md CHANGELOG.md apps/desktop-client/tauri.conf.json install/README.md install/install.sh install/uninstall.sh install/win/README.md install/win/install.ps1 install/win/uninstall.ps1 website/src/pages/[locale]/download.astro website/src/content/docs/en/installation.md website/src/content/docs/id/installation.md docs/guides/developer/QUICKSTART.md docs/guides/platform/android-install-test.md docs/guides/platform/ios-build-guide.md docs/guides/platform/ios-install-test.md docs/guides/platform/linux-launch-test.md docs/decisions/2026-07-16-desktop-app-updater.md docs/decisions/2026-07-16-release-automation.md`

> **The original pathspec said "(list all files below explicitly)" and then listed only `Cargo.toml`,
> `README.md`, `CHANGELOG.md`, `tauri.conf.json` and the `docs/` guides — omitting the two surfaces
> that actually *use* the URL at runtime.** Both were found with
> `git grep -n "kardelitaitu/oz-pos" -- install/ packaging/ website/`.

#### `Cargo.toml:44`
- [ ] `repository = "https://github.com/kardelitaitu/oz-pos"` → `"https://github.com/kasirmu/kasir.mu"`

#### `README.md`
- [ ] Shields.io badge URLs: `kardelitaitu/oz-pos` → `kasirmu/kasir.mu` (2 badges)
- [ ] Dev CI badge action URL
- [ ] `git clone https://github.com/kardelitaitu/oz-pos.git` → new URL
- [ ] Remove all `<!-- TODO: update after repo rename -->` markers added in Phase 9

#### `apps/desktop-client/tauri.conf.json:69–70`
- [ ] Updater `pubkey` endpoint URLs:
  `https://github.com/kardelitaitu/oz-pos/releases/latest/download/beta.json` → new URL
  `https://github.com/kardelitaitu/oz-pos/releases/latest/download/latest.json` → new URL

#### `website/` — **missing from the original plan, and this is the live download path**
- [ ] `website/src/pages/[locale]/download.astro:11` — `const releaseUrl = 'https://github.com/kardelitaitu/oz-pos/releases'` feeds the **download button on the live site**. The 12-month redirect would keep it working, which is exactly why a stale URL here can go unnoticed for a year
- [ ] `website/src/content/docs/en/installation.md:31` and `website/src/content/docs/id/installation.md:31` — the `[releases page]` link in the install docs (deliberately left as a live link when the website was rebranded; this phase is where it belongs)

#### `install/` — **missing from the original plan**
- [ ] `install/install.sh:19,46` — the one-line `curl … | bash` URL and the `REPO="kardelitaitu/oz-pos"` default that fetches the release manifest
- [ ] `install/win/install.ps1:26,58` — the `irm … | iex` example and `[string]$Repo = 'kardelitaitu/oz-pos'`
- [ ] `install/uninstall.sh:15`, `install/win/uninstall.ps1:14` — uninstall one-liners
- [ ] `install/README.md:3,20,25` and `install/win/README.md:3,14,49` — documented install commands (the `:3` audit stamps additionally assert that the URL "matches git remote", so they need re-stating, not just re-writing)

#### `docs/guides/developer/QUICKSTART.md:54`
- [ ] `git clone https://github.com/kardelitaitu/oz-pos.git` → new URL

#### `docs/guides/platform/android-install-test.md:5,634,635`
- [ ] All GitHub tree/blob links

#### `docs/guides/platform/ios-build-guide.md:20`
- [ ] GitHub blob link

#### `docs/guides/platform/ios-install-test.md:19,713`
- [ ] All GitHub tree/blob links

#### `docs/guides/platform/linux-launch-test.md:6,487`
- [ ] GitHub blob/config links

#### `docs/decisions/2026-07-16-desktop-app-updater.md:48,142,150,160`
- [ ] All `kardelitaitu/oz-pos/releases/` links (these are example URLs in a decision doc)

#### `docs/decisions/2026-07-16-release-automation.md:38,130`
- [ ] Same — example release download URLs

#### `CHANGELOG.md` compare links
- [ ] `[Unreleased]:`, `[0.0.14]:`, …, `[0.0.2]:` at bottom of file
  Old: `https://github.com/kardelitaitu/oz-pos/compare/…`
  New: `https://github.com/kasirmu/kasir.mu/compare/…`
  (GitHub's redirect handles existing tag links, but update these so they work without the redirect)

---

## Post-T3 verification

```bash
# 1. No old crate names anywhere in live code
git grep -rn "oz-core\|oz-bridge\|oz-api\|oz-hal\|oz-cli\|oz-lan\|oz-crypto\|oz-lua\|oz-media\|oz-payment\|oz-plugin\|oz-reporting\|oz-security\|oz-logging\|oz-notification\|oz-cloud-server" \
  -- Cargo.toml deny.toml crates/ apps/ modules/ platform/

# 2. No old binary names in scripts/CI/packaging. (`packaging/` was absent from the original, and
#    it is where the Linux launcher lives: `Exec=oz-pos-app` would survive every other check.)
git grep -rn "oz-pos-app\|oz-pos-tablet\|oz_pos_app_lib\|oz_pos_tablet_lib" \
  -- scripts/ .github/ .agents/ packaging/ "*.rs"

# 3. No old use imports. A pattern over all roots, not the original's four: `oz_local_api` (added to
#    this plan after review) and the others would each have passed a four-root check while unchanged.
git grep -rn "use oz_[a-z_]*::" -- "*.rs"

# 4. No old ozpkg symbols
git grep -rn "OzpkgPayload\|export_ozpkg\|import_ozpkg\|oz_core::ozpkg\|run_export_ozpkg\|run_import_ozpkg" -- "*.rs"

# 5. No old GitHub URLs (excluding CHANGELOG historical compare links if not yet updated).
#    `install/`, `website/` and `packaging/` were missing from the original path list — and they are
#    exactly where the URLs are executable (install one-liners, the site's download button), so the
#    original check reported zero while the live download path was still stale.
git grep -rn "kardelitaitu/oz-pos" -- Cargo.toml README.md CHANGELOG.md docs/ apps/ .agents/ install/ website/ packaging/ .github/

# 6. Full build
cargo check --workspace --all-targets --all-features

# 7. Full test suite
cargo nextest run --workspace --all-features

# 8. deny.toml audit
cargo deny check

# 9. cargo fmt (T3 touches many files — run before pushing)
cargo fmt --all -- --check
```

---

## Notes

- **Persisted client keys — the one item here that can lose user state; now assigned to Phase 2b in `todo-rebrand.md`.**
  Renaming any of these logs every existing user out or resets their preferences, so each needs a
  read-old/write-new migration like `todo-rebrand.md` Phase 4's DB copy, not a find-and-replace:
  - ui: `oz-pos-locale` (`ui/src/utils/storage.ts:8`, `ui/src/i18n/LocaleContext.tsx:44`),
    `oz-pos-decimal-sep` (`ui/src/utils/storage.ts:9`),
    `oz-pos-theme-v4` (`ui/src/frontend/shell/ThemeProvider.tsx:41`)
  - website: `oz_theme` (`website/src/layouts/Base.astro` inline pre-paint script) and the
    `oz_session` cookie (`website/worker.ts`)
  - Pinned by `ui/src/__tests__/storageKeyPins.test.ts:44,45`, `storage.test.ts:10,14`,
    `LocaleContext.test.tsx:17`, `ThemeProvider.test.tsx:11`, `themeRegression.test.tsx:10`, and the
    website's `apply-theme.test.ts` — those tests move with any rename.
  - Without this entry the verification greps in *both* files can never return zero, and a reader
    would chase the survivors as outstanding debt. (Moved here from `todo-rebrand.md`'s Tier 3
    section, which is now a pointer to this file; it was the only item in that duplicate list that
    this file did not already carry.)
- **`install/**` and `packaging/**`:** T3-7 above picks up their *repo URLs* only. Two other families
  live in the same files and belong to `todo-rebrand.md`, not here — both are now covered there:
  - **identifier paths → Phase 4.** `install/uninstall.sh:55,56,59,96` removes `~/Library/Application Support/com.ozpos.app`, `~/Library/Caches/com.ozpos.app`, `~/Library/Preferences/com.ozpos.app.plist`, `~/.local/share/com.ozpos.app`, `~/.config/com.ozpos.app`; `install/win/uninstall.ps1:97,98` removes `%APPDATA%\com.ozpos.app` and `%LOCALAPPDATA%\com.ozpos.app`; `install/win/README.md:58` documents both. After the identifier change these paths are stale and an uninstall leaves the new data dirs behind. `todo-rebrand.md` Phase 4 lists all three files in its pathspec (`install/uninstall.sh install/win/uninstall.ps1 install/win/README.md`) with the specific lines enumerated.
  - **artifact names → Phase 3.** `install/install.sh` (18 sites) uses `OZ-POS.app`, `/opt/oz-pos/OZ-POS.AppImage`, `~/.local/bin/oz-pos.AppImage`, `/usr/local/bin/oz-pos`, `/usr/share/applications/oz-pos.desktop` and `dpkg -s oz-pos`; `install/win/install.ps1`/`uninstall.ps1` use `Programs\OZ-POS\OZ-POS.exe` and `DisplayName -like 'OZ-POS*'`. These follow `productName` and break in Phase 3 — all four install files are in Phase 3's pathspec with the specific lines enumerated.
  - Verified with `git grep -n "com\.ozpos" -- install/` and `git grep -n -E "OZ-POS\.(exe|app|AppImage)|oz-pos\.(AppImage|desktop)|dpkg -s oz-pos" -- install/`.
- **`qris-core`** is not an oz-brand crate (payment protocol, not brand-named). Leave as-is.
- **The `oz` CLI binary name** (defined in `crates/oz-cli/Cargo.toml [[bin]] name = "oz"`) is user-facing. Renaming it to `kasir` is a breaking change for any user with `oz` in their PATH or scripts. Coordinate with a release note.
- **`Cargo.lock`** regenerates automatically — do not edit by hand. Commit the updated lockfile alongside the final crate-rename commit.
- **Directory renames** (`crates/oz-core/` → `crates/kasirmu-core/`) break any tool hardcoding the old path. Update `.agents/verify-lane.sh` and any other scripts that reference crate directories by path.
