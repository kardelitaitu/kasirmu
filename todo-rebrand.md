# todo-rebrand.md — OZ-POS → kasir.mu

<!-- Rebrand status: IN PROGRESS — 689 old-brand files, 98 already rebranded -->
<!-- Decisions locked: identifier=mu.kasir.app, db=kasir.db, format=.kasirpkg, env=KASIRMU_* -->
<!-- Commit law: one pathspec commit per phase below; no git add; no -a; no amend -->

## Legend
- `[ ]` not started
- `[/]` in progress
- `[x]` done

---

## Phase 1 — FTL localization bundles
**Commit:** `refactor(i18n): rebrand OZ-POS → kasir.mu in all FTL bundles`
**Pathspec:** `ui/src/locales/sales.ftl ui/src/locales/sales.id.ftl ui/src/locales/settings.ftl ui/src/locales/settings.id.ftl ui/src/locales/shared.ftl ui/src/locales/shared.id.ftl ui/src/locales/staff.ftl ui/src/locales/staff.id.ftl`

- [ ] `ui/src/locales/sales.ftl`
  - `payment-qris-merchant-name = OZ-POS Store` → `kasir.mu Store`
  - `receipt-preview-store-name = OZ-POS Store` → `kasir.mu Store`
- [ ] `ui/src/locales/sales.id.ftl`
  - `payment-qris-merchant-name = OZ-POS Store` → `kasir.mu Store`
  - `receipt-preview-store-name = Toko OZ-POS` → `Toko kasir.mu`
- [ ] `ui/src/locales/settings.ftl`
  - `setup-logo = OZ-POS` → `kasir.mu`
  - `setup-launch = Launch OZ-POS` → `Launch kasir.mu`
  - `.placeholder = OZ-POS Store` → `kasir.mu Store`
  - `settings-app-version = OZ-POS Enterprise v{ $version }` → `kasir.mu Enterprise v{ $version }`
  - `settings-copyright-notice-value = OZ-POS © 2025–2026 OZ Systems. All rights reserved.` → `kasir.mu © 2025–2026. All rights reserved.`
  - `appearance-store-name-fallback = OZ-POS` → `kasir.mu`
  - `data-mgmt-import-desc` — `…created by OZ-POS export` → `…created by kasir.mu export` and `.kasirpkg` extension (see Phase 6)
  - `addon-support-desc` — `…from the OZ-POS team` → `…from the kasir.mu team`
- [ ] `ui/src/locales/settings.id.ftl`
  - `setup-logo = OZ-POS` → `kasir.mu`
  - `setup-launch = Luncurkan OZ-POS` → `Luncurkan kasir.mu`
  - `.placeholder = Toko OZ-POS` → `Toko kasir.mu`
  - `appearance-store-name-fallback = OZ-POS` → `kasir.mu`
  - `data-mgmt-import-desc` — `…ekspor OZ-POS` → `…ekspor kasir.mu` and `.kasirpkg`
  - `settings-app-version = OZ-POS Enterprise v{ $version }` → `kasir.mu Enterprise v{ $version }`
  - `settings-copyright-notice-value = OZ-POS © 2025–2026 OZ Systems. Seluruh hak cipta dilindungi.` → `kasir.mu © 2025–2026. Seluruh hak cipta dilindungi.`
  - `addon-support-desc` — `…dari tim OZ-POS` → `…dari tim kasir.mu`
- [ ] `ui/src/locales/shared.ftl`
  - `auth-copyright = OZ-POS © { $year } All rights reserved.` → `kasir.mu © { $year } All rights reserved.`
- [ ] `ui/src/locales/shared.id.ftl`
  - `-app-name = OZ-POS` → `kasir.mu`
  - `auth-copyright = OZ-POS © { $year } Hak Cipta Dilindungi.` → `kasir.mu © { $year } Hak Cipta Dilindungi.`
- [ ] `ui/src/locales/staff.ftl`
  - `staff-login-copyright = © 2026 OZ-POS. All rights reserved.` → `© 2026 kasir.mu. All rights reserved.`
- [ ] `ui/src/locales/staff.id.ftl`
  - `staff-login-copyright = © 2026 OZ-POS. Seluruh hak cipta dilindungi.` → `© 2026 kasir.mu. Seluruh hak cipta dilindungi.`

**Pre-commit gate:** steps 2 (bundle parity), 3 (FTL dedupe), 7 (FTL orphan lint) — all must pass.

---

## Phase 2 — UI hardcoded strings + test fixtures
**Commit:** `refactor(ui): remove hardcoded OZ-POS brand strings; use FTL or kasir.mu`
**Pathspec:** `ui/src/features/auth/SessionLockScreen.tsx ui/src/features/auth/StaffLoginScreen.tsx ui/src/dev-mock/handlers/settings.ts ui/src/__tests__/LicenseActivationScreen.test.tsx ui/src/__tests__/StaffLoginKeyboard.test.tsx ui/src/features/auth/__tests__/LicenseActivationScreen.test.tsx`

- [ ] `ui/src/features/auth/SessionLockScreen.tsx:357`
  `OZ-POS © {new Date().getFullYear()} All rights reserved.` — wire the existing `auth-copyright` FTL key instead of this hardcode
- [ ] `ui/src/features/auth/StaffLoginScreen.tsx:597`
  `© OZ-POS. All rights reserved.` — wire `staff-login-copyright` FTL key instead
- [ ] `ui/src/dev-mock/handlers/settings.ts:121,127`
  `store_name: 'OZ-POS Demo'` → `store_name: 'kasir.mu Demo'`
- [ ] `ui/src/__tests__/LicenseActivationScreen.test.tsx:80`
  Update snapshot: `'auth-copyright': 'OZ-POS © {year} All rights reserved.'` → new FTL value
- [ ] `ui/src/__tests__/StaffLoginKeyboard.test.tsx:76`
  `staff-login-copyright = © 2026 OZ-POS. All rights reserved.` → updated value
- [ ] `ui/src/features/auth/__tests__/LicenseActivationScreen.test.tsx:51`
  Update inline snapshot to match new `auth-copyright` FTL value

---

## Phase 3 — Tauri display names (productName / title only)
**Commit:** `refactor(config): rename productName and window title to kasir.mu`
**Pathspec:** `apps/desktop-client/tauri.conf.json apps/tablet-client/tauri.conf.json`

- [ ] `apps/desktop-client/tauri.conf.json`
  - `"productName": "OZ-POS"` → `"productName": "kasir.mu"`
  - window `"title": "OZ-POS"` → `"title": "kasir.mu"`
  - **identifier stays `com.ozpos.app` in this commit — moved in Phase 4**
- [ ] `apps/tablet-client/tauri.conf.json`
  - `"productName": "OZ-POS"` → `"productName": "kasir.mu"`

---

## Phase 4 — Bundle identifier + data-dir migration ⚠️
**Commit:** `feat(app): change bundle identifier to mu.kasir.app/tablet and add data-dir migration`
**Pathspec:** `apps/desktop-client/tauri.conf.json apps/desktop-client/src/state.rs apps/tablet-client/tauri.conf.json apps/tablet-client/src/state.rs apps/tablet-client/gen/android/app/build.gradle.kts apps/tablet-client/gen/android/app/src/main/java/com/ozpos/tablet/MainActivity.kt`

> ⚠️ The data-dir migration in state.rs MUST ship in the same commit as the identifier change.
> On first launch after update: if old path (com.ozpos.*/oz-pos.db) exists and new path does not,
> copy the DB to the new location before opening. Copy (not move) — old install stays as backup.

### Identifier changes
- [ ] `apps/desktop-client/tauri.conf.json` — `"identifier": "com.ozpos.app"` → `"mu.kasir.app"`
- [ ] `apps/tablet-client/tauri.conf.json` — `"identifier": "com.ozpos.tablet"` → `"mu.kasir.tablet"`
- [ ] `apps/tablet-client/gen/android/app/build.gradle.kts:31`
  `namespace = "com.ozpos.tablet"` → `"mu.kasir.tablet"`
- [ ] `apps/tablet-client/gen/android/app/build.gradle.kts:34`
  `applicationId = "com.ozpos.tablet"` → `"mu.kasir.tablet"`
- [ ] `apps/tablet-client/gen/android/app/src/main/java/com/ozpos/tablet/MainActivity.kt:1`
  `package com.ozpos.tablet` → `package mu.kasir.tablet`
  Also rename the Java directory tree: `com/ozpos/tablet/` → `mu/kasir/tablet/`
  (new files — use §3 one-line new-file chain for the directory move)

### Data-dir migration in state.rs
- [ ] `apps/desktop-client/src/state.rs:757–762` — `resolve_db_path()`
  - Change `dir.join("oz-pos.db")` → `dir.join("kasir.db")`
  - Before returning the new path, add migration: if old `%APPDATA%/com.ozpos.app/oz-pos.db` exists
    and new `%APPDATA%/mu.kasir.app/kasir.db` does not → `std::fs::copy(old, new)?`
  - Update doc comment at `:214`
- [ ] `apps/tablet-client/src/state.rs:373–378` — same pattern
  - `dir.join("oz-pos.db")` → `dir.join("kasir.db")`
  - Migration: old `com.ozpos.tablet/oz-pos.db` → new `mu.kasir.tablet/kasir.db`
  - Update doc comment at `:153`

---

## Phase 5 — DB filename defaults (cloud / CLI / Docker)
**Commit:** `refactor(config): rename default db filename oz-pos.db → kasir.db`
**Pathspec:** (list all affected files explicitly)

- [ ] `apps/cloud-server/src/config.rs:201` — `"oz-pos.db"` → `"kasir.db"`
- [ ] `apps/cloud-server/src/db.rs:12,128` — comments
- [ ] `apps/cloud-server/src/main.rs:9,16` — doc comment + table
- [ ] `apps/cloud-server/src/bin/migrate_sqlite_to_pg/main.rs:5,38,113,126`
- [ ] `crates/oz-api/src/lib.rs:101,442,450` — default + doc
- [ ] `crates/oz-cli/src/cli.rs:28` — `default_value = "oz-pos.db"` → `"kasir.db"`
- [ ] `crates/oz-cli/src/commands/credential_deltas.rs:106,114,771,797` — user-facing --db text
- [ ] `crates/oz-cli/src/commands/mod.rs:67,86` — footgun doc + error text
- [ ] `crates/oz-cli/src/seed_demo.rs:71` — `unwrap_or("oz-pos.db")` → `"kasir.db"`
- [ ] `.env.example:22,24` — `OZ_DB_PATH=oz-pos.db` → `kasir.db` + comment
- [ ] `Dockerfile.server:12,197` — comment + `ENV OZ_DB_PATH=/data/oz-pos.db` → `/data/kasir.db`
- [ ] `Dockerfile.unified:18,187,208,211` — all occurrences
- [ ] `docker-compose.yml:49` — `OZ_DB_PATH: /data/oz-pos.db` → `/data/kasir.db`

**Test fixtures (same commit):**
- [ ] `apps/cloud-server/src/bin/migrate_sqlite_to_pg/migrate_sqlite_to_pg_tests.rs:107,218,367`
- [ ] `apps/cloud-server/src/db_tests.rs:48,49` — update assert strings (verify logic still correct)
- [ ] `crates/oz-bridge/src/sync_tests.rs:551,569,586,606,628,682,740,773`
- [ ] `crates/oz-cli/src/cli_tests.rs:132` — `assert_eq!(cli.db, "oz-pos.db")` → `"kasir.db"`
- [ ] `crates/oz-cli/src/seed_demo_tests.rs:97` — verify semantics
- [ ] `platform/core/src/database/manager.rs:32` — comment

---

## Phase 6 — `.ozpkg` → `.kasirpkg` (user-visible + import alias)
**Commit:** `refactor(data): rename .ozpkg → .kasirpkg with backward-compat import alias`
**Pathspec:** `apps/desktop-client/src/commands/data.rs apps/tablet-client/src/commands/features.rs crates/oz-bridge/src/data.rs crates/oz-bridge/src/data_tests.rs crates/oz-cli/src/cli.rs crates/oz-cli/src/cli_tests.rs`

> Internal Rust module/struct names (OzpkgPayload, export_ozpkg, import_ozpkg, oz_core::ozpkg,
> CLI subcommands export-ozpkg/import-ozpkg) are Tier 3 — deferred. Only user-visible extension
> strings and file dialog filters change here.

- [ ] `apps/desktop-client/src/commands/data.rs:1` — doc comment `.ozpkg` → `.kasirpkg`
- [ ] `apps/tablet-client/src/commands/features.rs:535`
  `"Data export/import in .ozpkg format"` → `"Data export/import in .kasirpkg format"`
- [ ] `crates/oz-bridge/src/data.rs:1,2` — doc comments
- [ ] File dialog filter in export command — add `.kasirpkg` as primary, `.ozpkg` as legacy alias:
  ```rust
  .add_filter("kasir.mu Package", &["kasirpkg"])
  .add_filter("Legacy OZ-POS Package", &["ozpkg"])
  ```
- [ ] `crates/oz-cli/src/cli.rs:70,82,84`
  `--help` text: `.ozpkg file` → `.kasirpkg file (also accepts legacy .ozpkg files)`
- [ ] FTL strings: already covered in Phase 1 (`data-mgmt-import-desc`)

**Test fixtures:**
- [ ] `crates/oz-bridge/src/data_tests.rs:313,339,350,363,365,423,425`
  Primary cases → `.kasirpkg`; keep at least one `.ozpkg` case to cover the legacy alias
- [ ] `crates/oz-cli/src/cli_tests.rs:142–174,292–308`
  Primary cases → `.kasirpkg`; keep one `.ozpkg` legacy case

---

## Phase 7 — `OZPOS_*` env vars → `KASIRMU_*`
**Commit:** `refactor(env): rename OZPOS_* environment variables to KASIRMU_*`
**Pathspec:** `.githooks/post-commit scripts/generate-records-index.mjs scripts/test-records-index-escaping.sh scripts/test-typecheck-gate.sh scripts/gates.json AGENTS.md`

> Any developer who has set OZPOS_SKIP_TYPECHECK=1 in their shell profile must rename it.
> Add a note in the commit message body.

### Hook / script vars
| Old | New | Files |
|---|---|---|
| `OZPOS_SKIP_TYPECHECK` | `KASIRMU_SKIP_TYPECHECK` | `.githooks/post-commit:8,106` · `scripts/test-typecheck-gate.sh:86,115,121,128,129` · `scripts/gates.json:483 (_note)` |
| `OZPOS_SKIP_TRIPWIRE` | `KASIRMU_SKIP_TRIPWIRE` | `.githooks/post-commit:76,80` |
| `OZPOS_RECORDS_ROOT` | `KASIRMU_RECORDS_ROOT` | `scripts/generate-records-index.mjs:30,33,34` · `scripts/test-records-index-escaping.sh:7,83,85,94` |

### API key env vars (AGENTS.md only — not in live code/CI)
| Old | New |
|---|---|
| `OZPOS_CLOUDFLARE_API_TOKEN` | `KASIRMU_CLOUDFLARE_API_TOKEN` |
| `OZPOS_CLOUDFLARE_ACCOUNT_ID` | `KASIRMU_CLOUDFLARE_ACCOUNT_ID` |
| `OZPOS_CLOUDFLARE_ACCESS_KEY` | `KASIRMU_CLOUDFLARE_ACCESS_KEY` |
| `OZPOS_CLOUDFLARE_SECRET_ACCESS_KEY` | `KASIRMU_CLOUDFLARE_SECRET_ACCESS_KEY` |
| `OZPOS_CLOUDFLARE_S3_ENDPOINT` | `KASIRMU_CLOUDFLARE_S3_ENDPOINT` |
| `OZPOS_NORTHFLANK_API_TOKEN` | `KASIRMU_NORTHFLANK_API_TOKEN` |
| `OZPOS_OZ_ADMIN_KEY` | `KASIRMU_ADMIN_KEY` |
| `OZPOS_OZ_API_SECRET` | `KASIRMU_API_SECRET` |
| `OZPOS_OZ_ENFORCE_PLANS` | `KASIRMU_ENFORCE_PLANS` |
| `OZPOS_OZ_LICENSE_PRIVATE_KEY` | `KASIRMU_LICENSE_PRIVATE_KEY` |

- [ ] `.githooks/post-commit` — 4 occurrences (`OZPOS_SKIP_TYPECHECK` x2, `OZPOS_SKIP_TRIPWIRE` x2)
- [ ] `scripts/generate-records-index.mjs` — `OZPOS_RECORDS_ROOT` (3 occurrences)
- [ ] `scripts/test-records-index-escaping.sh` — `OZPOS_RECORDS_ROOT` (4 occurrences)
- [ ] `scripts/test-typecheck-gate.sh` — `OZPOS_SKIP_TYPECHECK` (5 occurrences)
- [ ] `scripts/gates.json` — `_note` text at typecheck-gate row
- [ ] `AGENTS.md:76–96` — section heading + all `$env:OZPOS_*` listings

> Confirm before committing: `git grep -n OZPOS_ .githooks/pre-commit` should return 0 lines.

---

## Phase 8 — Docs / guides / decisions prose
**Commit:** `docs: rebrand OZ-POS → kasir.mu in all user-facing documentation`

Key files with functional (not just prose) brand references:
- [ ] `docs/guides/EXTENDING.md:321`
  `sqlite3 "$APPDATA/com.ozpos.app/oz-pos.db"` → `"$APPDATA/mu.kasir.app/kasir.db"`
- [ ] `docs/guides/android-install-test.md`
  All `com.ozpos.tablet` → `mu.kasir.tablet`; `oz-pos.db` → `kasir.db`
- [ ] `docs/guides/ios-install-test.md`
  `APPLE_BUNDLE_ID` example: `com.ozpos.tablet` → `mu.kasir.tablet`
- [ ] `docs/guides/windows-launch-test.md:283`
  `%APPDATA%\com.ozpos.app\logs\` → `%APPDATA%\mu.kasir.app\logs\`
- [ ] `docs/decisions/2026-07-15-whitelabel-branding-system.md`
  All `com.ozpos.*` identifier examples → `mu.kasir.*`; update default-brand table
- [ ] All remaining `docs/` files — sweep `OZ-POS` prose → `kasir.mu`

---

## Phase 9 — Root config + scripts + CI
**Commit:** `chore: rebrand root config, scripts, and CI defaults to kasir.mu`
**Pathspec:** `Cargo.toml README.md CHANGELOG.md .github/workflows/dev-ci.yml scripts/check.sh`

- [ ] `Cargo.toml:43` — `authors = ["OZ-POS contributors"]` → `["kasir.mu contributors"]`
- [ ] `Cargo.toml:44` — add `<!-- TODO: update after repo rename -->` alongside the repo URL
- [ ] `README.md` — all prose `OZ-POS` → `kasir.mu`; directory tree `oz-pos/` → `kasir.mu/`
  Badge URLs and clone URL stay (live links) — add TODO markers
- [ ] `CHANGELOG.md:5` — `All notable changes to OZ-POS` → `kasir.mu`
  CHANGELOG compare/tag URLs stay unchanged (live git history links)
- [ ] `.github/workflows/dev-ci.yml:763–764`
  `NF_PROJECT_ID` fallback `'oz-pos'` → `'kasir-mu'`
  `NF_SERVICE_ID` fallback `'oz-pos-cloud'` → `'kasir-cloud'`
- [ ] `scripts/check.sh:529,531`
  Docker image tag `oz-pos-cloud:local` → `kasir-cloud:local`
- [ ] `release.yml:149,243` — leave `oz-pos-app` / `oz-pos-tablet` references (binary names, Tier 3)
- [ ] `scripts/release.sh` — prose/comments only; `--exclude oz-pos-app` stays (Tier 3)

---

## Tier 3 — Deferred (separate PR after brand launch)

Zero user-visible effect. Do not mix into this rebrand diff.

- [ ] Crate names: `oz-core`, `oz-bridge`, `oz-hal`, `oz-api`, `oz-cli`, `oz-lan`, `oz-local-api` → `kasirmu-*`
- [ ] Binary names: `oz-pos-app`, `oz-pos-tablet`, `oz-pos-cli` in `Cargo.toml [[bin]]`
- [ ] All `use oz_core::`, `use oz_api::` etc. imports across all apps/modules
- [ ] Internal Rust symbols: `OzpkgPayload`, `export_ozpkg`, `import_ozpkg`, `oz_core::ozpkg` module path
- [ ] CLI subcommand names: `export-ozpkg`, `import-ozpkg` (breaking — needs deprecation notice)
- [ ] `deny.toml` crate-level metadata
- [ ] GitHub repo move: `kardelitaitu/oz-pos` → `kasirmu/kasir.mu` (admin action)
- [ ] CI badge URLs and CHANGELOG compare links (after repo move)

---

## Verification checklist (run after all phases)

```bash
# 1. No old-brand strings in user-facing surfaces
git grep -rn "OZ-POS\|OZ_POS\|OZPOS\|ozpos\|oz-pos" -- \
  ui/src/locales/ ui/src/features/ ui/src/dev-mock/ \
  apps/desktop-client/tauri.conf.json apps/tablet-client/tauri.conf.json

# 2. No old identifier
git grep -rn "com\.ozpos" -- apps/ docs/ crates/ scripts/

# 3. No old DB default in code
git grep -rn '"oz-pos\.db"\|/oz-pos\.db' -- apps/ crates/ Dockerfile* docker-compose* .env.example

# 4. No old env var in live code
git grep -rn "OZPOS_" -- .githooks/ scripts/ AGENTS.md

# 5. FTL bundle parity
python scripts/verify-bundle-parity.py \
  --include-getstring --include-nav-keys --include-key-fields \
  --include-dynamic-literals --include-id-maps --check-domain-pairs

# 6. FTL orphan lint
python scripts/verify-ftl-orphans.py --census

# 7. Mirror/drift checks
python scripts/verify-agents-mirrors.py
python scripts/verify-ci-docs-drift.py

# 8. Rust build + tests
cargo check --workspace --all-targets --all-features
cargo nextest run --workspace --all-features --exclude oz-pos-app --exclude oz-pos-tablet

# 9. UI typecheck + tests
cd ui && npm run typecheck && npm run test
```
