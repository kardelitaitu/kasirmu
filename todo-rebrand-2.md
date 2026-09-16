# todo-rebrand-2.md — Structural renames (Tier 3)

<!-- Follows todo-rebrand.md (Phases 1-9, user-visible changes). -->
<!-- This file covers zero-user-visible structural renames: crate names, binary names, -->
<!-- Rust symbols, CLI subcommands, and the GitHub repo move. -->
<!-- Execute only AFTER todo-rebrand.md is fully merged. -->
<!-- Commit law: one pathspec commit per phase; no git add; no -a; no amend. -->

## Legend
- `[ ]` not started
- `[/]` in progress
- `[x]` done

---

## Overview

| Phase | What | Files affected |
|---|---|---|
| T3-1 | Crate library renames — `Cargo.toml` + directory renames | 17 crates × 2–4 files |
| T3-2 | Binary / lib-crate target names | 5 targets in 4 Cargo.toml files |
| T3-3 | `use oz_*` imports across all Rust source | 412 `.rs` files |
| T3-4 | `oz_core::ozpkg` module + `OzpkgPayload` struct + `export_ozpkg`/`import_ozpkg` fn names | ~15 `.rs` files |
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
**Pathspec:** `apps/desktop-client/Cargo.toml apps/tablet-client/Cargo.toml apps/cloud-server/Cargo.toml crates/kasirmu-cli/Cargo.toml Cargo.toml scripts/check.sh scripts/release.sh .github/workflows/release.yml .github/workflows/dev-ci.yml`

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

### `apps/desktop-client/src/main.rs:6,11`
- [ ] `oz_pos_app_lib::run()` → `kasirmu_app_lib::run()`
- [ ] doc comment reference

### `apps/tablet-client/src/main.rs:6,12`
- [ ] `oz_pos_tablet_lib::run()` → `kasirmu_tablet_lib::run()`

### Scripts / CI
- [ ] `scripts/check.sh:115` — `--exclude oz-pos-app --exclude oz-pos-tablet` → `--exclude kasirmu-app --exclude kasirmu-tablet`
- [ ] `scripts/release.sh:62,65` — same `--exclude` flags
- [ ] `.github/workflows/release.yml:149` — same `--exclude` flags
- [ ] `.github/workflows/release.yml:243`
  `--exe apps/desktop-client/target/release/oz-pos-app.exe` → `kasirmu-app.exe`
- [ ] `.agents/verify-lane.sh:225–231` — `-p oz-pos-tablet`, `-p oz-pos-app` → new names

### `apps/cloud-server/`
- [ ] `apps/cloud-server/build.rs:7` — comment `oz-cloud-server.exe` → `kasirmu-cloud.exe`
- [ ] `apps/cloud-server/src/main.rs:9,23` — `oz-cloud-server` in doc + log filter hint
- [ ] `apps/cloud-server/tests/startup.rs:17,18`
  `CARGO_BIN_EXE_oz-cloud-server` → `CARGO_BIN_EXE_kasirmu-cloud`

---

## T3-3 — `use oz_*` imports across all Rust source (412 files)

**Commit strategy:** split by import root, one commit per crate being imported:
- `use oz_core::` → `use kasirmu_core::` — largest, ~200 files
- `use oz_bridge::` → `use kasirmu_bridge::`
- `use oz_api::` → `use kasirmu_api::`
- `use oz_hal::` → `use kasirmu_hal::`
- `use oz_cli::` → `use kasirmu_cli::` (internal use only, likely few)
- `use oz_lan::` → `use kasirmu_lan::`
- `use oz_crypto::` → `use kasirmu_crypto::`
- `use oz_lua::` → `use kasirmu_lua::`
- `use oz_media::` → `use kasirmu_media::`
- `use oz_payment::` → `use kasirmu_payment::`
- `use oz_plugin::` → `use kasirmu_plugin::`
- `use oz_reporting::` → `use kasirmu_reporting::`
- `use oz_security::` → `use kasirmu_security::`
- `use oz_logging::` → `use kasirmu_logging::`
- `use oz_notification::` → `use kasirmu_notification::`

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
**Pathspec:** `crates/kasirmu-core/src/ozpkg.rs crates/kasirmu-core/src/lib.rs crates/kasirmu-bridge/src/data.rs crates/kasirmu-bridge/src/data_tests.rs crates/kasirmu-cli/src/commands/ozpkg.rs crates/kasirmu-cli/src/commands/mod.rs crates/kasirmu-cli/src/cli_tests.rs`

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

### `deny.toml` — crate skip entries (lines 88–173 and beyond)
Each `name = "oz-…"` entry under `[bans.skip]` must be updated:
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
**Pathspec:** (list all files below explicitly)

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

#### `docs/guides/QUICKSTART.md:54`
- [ ] `git clone https://github.com/kardelitaitu/oz-pos.git` → new URL

#### `docs/guides/android-install-test.md:5,634,635`
- [ ] All GitHub tree/blob links

#### `docs/guides/ios-build-guide.md:20`
- [ ] GitHub blob link

#### `docs/guides/ios-install-test.md:19,713`
- [ ] All GitHub tree/blob links

#### `docs/guides/linux-launch-test.md:6,487`
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

# 2. No old binary names in scripts/CI
git grep -rn "oz-pos-app\|oz-pos-tablet\|oz_pos_app_lib\|oz_pos_tablet_lib" \
  -- scripts/ .github/ .agents/ "*.rs"

# 3. No old use imports
git grep -rn "use oz_core::\|use oz_bridge::\|use oz_api::\|use oz_hal::" -- "*.rs"

# 4. No old ozpkg symbols
git grep -rn "OzpkgPayload\|export_ozpkg\|import_ozpkg\|oz_core::ozpkg\|run_export_ozpkg\|run_import_ozpkg" -- "*.rs"

# 5. No old GitHub URLs (excluding CHANGELOG historical compare links if not yet updated)
git grep -rn "kardelitaitu/oz-pos" -- Cargo.toml README.md docs/ apps/ .agents/

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

- **`qris-core`** is not an oz-brand crate (payment protocol, not brand-named). Leave as-is.
- **The `oz` CLI binary name** (defined in `crates/oz-cli/Cargo.toml [[bin]] name = "oz"`) is user-facing. Renaming it to `kasir` is a breaking change for any user with `oz` in their PATH or scripts. Coordinate with a release note.
- **`Cargo.lock`** regenerates automatically — do not edit by hand. Commit the updated lockfile alongside the final crate-rename commit.
- **Directory renames** (`crates/oz-core/` → `crates/kasirmu-core/`) break any tool hardcoding the old path. Update `.agents/verify-lane.sh` and any other scripts that reference crate directories by path.
