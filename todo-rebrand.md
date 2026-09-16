# todo-rebrand.md — OZ-POS → kasir.mu

<!-- Rebrand status: PLANNED — no phase started. Every checklist box in this file is `[ ]`; none
     carries `[/]` or `[x]`, so the file describes work-to-do rather than work-in-progress. (The token
     `[/]` does appear once, at `:24` — that is the Legend defining it, not a phase marked in
     progress.)
     Counts measured 2026-09-16 at `442473337`, each with its command because two defensible greps
     disagree and the population matters:
       git grep -l -i -E "oz[-_ ]?pos" | wc -l                                  -> 692 files
       git grep -l -F "OZ-POS" | wc -l                                           -> 462 files
       git grep -l -F "ozpos" | wc -l                                            -> 93 files
     The 692 is the widest population and INCLUDES the Tier-3 names this plan defers (crate names,
     binary names, doc prose), so it is not "files to change in this plan". The 462 (literal brand
     text) is the closest thing to the user-visible set. The previous header claimed "689 old-brand
     files, 98 already rebranded"; 689 sits within noise of the 692 above (same grep, a few commits
     earlier), but "98 already rebranded" has no command and no `[/]`/`[x]` box anywhere in this file
     to back it, so it is dropped rather than carried. -->
<!-- Decisions locked: identifier=mu.kasir.app, db=kasir.db, format=.kasirpkg, env=KASIRMU_* -->
<!-- Commit law: one pathspec commit per phase below; no git add, no -a, no amend — EXCEPT the §3
     one-line new-file chain (`git add -- <new/path> && git commit -m "..." -- <new/path>`), which
     Phase 4 needs for the Android Java directory move. (This line previously said a bare "no git
     add", contradicting Phase 4:104-106.) -->

## Legend
- `[ ]` not started
- `[/]` in progress
- `[x]` done

---

## Phase 1 — FTL localization bundles
**Commit:** `refactor(i18n): rebrand OZ-POS → kasir.mu in all FTL bundles`
**Pathspec:** `ui/src/locales/sales.ftl ui/src/locales/sales.id.ftl ui/src/locales/settings.ftl ui/src/locales/settings.id.ftl ui/src/locales/shared.ftl ui/src/locales/shared.id.ftl ui/src/locales/staff.ftl ui/src/locales/staff.id.ftl`

- [x] `ui/src/locales/sales.ftl`
  - `payment-qris-merchant-name = OZ-POS Store` → `kasir.mu Store`
  - `receipt-preview-store-name = OZ-POS Store` → `kasir.mu Store`
- [x] `ui/src/locales/sales.id.ftl`
  - `payment-qris-merchant-name = OZ-POS Store` → `kasir.mu Store`
  - `receipt-preview-store-name = Toko OZ-POS` → `Toko kasir.mu`
- [x] `ui/src/locales/settings.ftl`
  - `setup-logo = OZ-POS` → `kasir.mu`
  - `setup-launch = Launch OZ-POS` → `Launch kasir.mu`
  - `.placeholder = OZ-POS Store` → `kasir.mu Store`
  - `settings-app-version = OZ-POS Enterprise v{ $version }` → `kasir.mu Enterprise v{ $version }`
  - `settings-copyright-notice-value = OZ-POS © 2025–2026 OZ Systems. All rights reserved.` → `kasir.mu © 2025–2026. All rights reserved.`
  - `appearance-store-name-fallback = OZ-POS` → `kasir.mu`
  - `data-mgmt-import-desc` — `…created by OZ-POS export` → `…created by kasir.mu export` and `.kasirpkg` extension (see Phase 6)
  - `addon-support-desc` — `…from the OZ-POS team` → `…from the kasir.mu team`
- [x] `ui/src/locales/settings.id.ftl`
  - `setup-logo = OZ-POS` → `kasir.mu`
  - `setup-launch = Luncurkan OZ-POS` → `Luncurkan kasir.mu`
  - `.placeholder = Toko OZ-POS` → `Toko kasir.mu`
  - `appearance-store-name-fallback = OZ-POS` → `kasir.mu`
  - `data-mgmt-import-desc` — `…ekspor OZ-POS` → `…ekspor kasir.mu` and `.kasirpkg`
  - `settings-app-version = OZ-POS Enterprise v{ $version }` → `kasir.mu Enterprise v{ $version }`
  - `settings-copyright-notice-value = OZ-POS © 2025–2026 OZ Systems. Seluruh hak cipta dilindungi.` → `kasir.mu © 2025–2026. Seluruh hak cipta dilindungi.`
  - `addon-support-desc` — `…dari tim OZ-POS` → `…dari tim kasir.mu`
- [x] `ui/src/locales/shared.ftl`
  - `auth-copyright = OZ-POS © { $year } All rights reserved.` → `kasir.mu © { $year } All rights reserved.`
- [x] `ui/src/locales/shared.id.ftl`
  - `-app-name = OZ-POS` → `kasir.mu`
  - `auth-copyright = OZ-POS © { $year } Hak Cipta Dilindungi.` → `kasir.mu © { $year } Hak Cipta Dilindungi.`
- [x] `ui/src/locales/staff.ftl` / `ui/src/locales/staff.id.ftl` (wired in Phase 2)
  - `staff-login-copyright = © 2026 kasir.mu. All rights reserved.`
  - `staff-login-copyright = © 2026 kasir.mu. Seluruh hak cipta dilindungi.`

**Pre-commit gate:** steps 2 (bundle parity), 3 (FTL dedupe), 7 (FTL orphan lint) — all must pass.

---

## Phase 2 — UI hardcoded strings + test fixtures
**Commit:** `refactor(ui): remove hardcoded OZ-POS brand strings; use FTL or kasir.mu`
**Pathspec:** `ui/src/locales/staff.ftl ui/src/locales/staff.id.ftl ui/src/features/auth/SessionLockScreen.tsx ui/src/features/auth/StaffLoginScreen.tsx ui/src/features/auth/LicenseActivationScreen.tsx ui/src/features/setup/SetupWizard.tsx ui/src/features/settings/components/SettingsFooter.tsx ui/src/features/settings/components/ImportSection.tsx ui/src/features/settings/sections/AboutSection.tsx ui/src/features/settings/sections/GeneralSection.tsx ui/src/features/settings/AppearanceSettings.tsx ui/src/features/sales/ReceiptPreview.tsx ui/src/features/kiosk/KioskScreen.tsx ui/src/frontend/shell/AppLayout.tsx ui/src/dev-mock/handlers/settings.ts ui/src/features/design/brand-tokens.css ui/src/features/design/TooltipPreview.tsx ui/src/__tests__/LicenseActivationScreen.test.tsx ui/src/__tests__/StaffLoginKeyboard.test.tsx ui/src/__tests__/StaffLoginScreen.test.tsx ui/src/__tests__/AppearanceSettings.test.tsx ui/src/__tests__/QrisQrDisplay.test.tsx ui/src/__tests__/ReceiptPreview.test.tsx ui/src/__tests__/GeneralSection.test.tsx ui/src/features/auth/__tests__/LicenseActivationScreen.test.tsx ui/src/__tests__/a11y/axe-helper.tsx ui/src/__tests__/a11y/WorkspaceHome.a11y.test.tsx ui/src/__tests__/a11y/StaffLoginScreen.a11y.test.tsx ui/src/__tests__/a11y/SettingsPage.a11y.test.tsx ui/src/__tests__/a11y/SalesHistoryScreen.a11y.test.tsx ui/src/__tests__/a11y/ProductLookupScreen.a11y.test.tsx`

> **The list below was rebuilt from `git grep -n "OZ-POS" -- ui/src` at `442473337`.** The previous
> version named 6 items; the tree holds **15 user-visible source files** (19 bullets, since some files
> carry several sites) plus **14 test/fixture files** that pin the old text — 29 paths, which is the
> pathspec above. As written before, the phase would have shipped a half-rebranded UI and a red suite.

### User-visible hardcoded strings (source)
- [x] `ui/src/features/auth/SessionLockScreen.tsx:357`
  `OZ-POS © {new Date().getFullYear()} All rights reserved.` — wire the existing `auth-copyright` FTL key instead of this hardcode
- [x] `ui/src/features/auth/StaffLoginScreen.tsx:597`
  `© OZ-POS. All rights reserved.` — wire `staff-login-copyright` FTL key instead
- [x] `ui/src/features/auth/StaffLoginScreen.tsx:363,369`
  `alt={storeName || 'OZ-POS'}` — a11y-visible alt text; the fallback is the brand
- [x] `ui/src/features/auth/LicenseActivationScreen.tsx:178` — `alt="OZ-POS Logo"`
- [x] `ui/src/features/auth/LicenseActivationScreen.tsx:338`
  `OZ-POS © {new Date().getFullYear()} All rights reserved.` — the same hardcode as SessionLockScreen:357; both should use `auth-copyright`
- [x] `ui/src/features/setup/SetupWizard.tsx:415,460`
  `<div className="setup-logo">OZ-POS</div>` — hardcoded, although the FTL key `setup-logo` exists (Phase 1); wire it
- [x] `ui/src/features/setup/SetupWizard.tsx:441`
  `<Localized id="setup-launch">Launch OZ-POS</Localized>` — JSX fallback text; update with the FTL value
- [x] `ui/src/features/settings/components/SettingsFooter.tsx:149` — `OZ-POS Enterprise v{appVersion}`
- [x] `ui/src/features/settings/sections/AboutSection.tsx:38` — `OZ-POS Enterprise v{appVersion}`
- [x] `ui/src/features/settings/sections/AboutSection.tsx:60` — `&copy; 2024-2026 OZ-POS Contributors. All Rights Reserved.`
- [x] `ui/src/features/settings/sections/GeneralSection.tsx:75` — `placeholder="OZ-POS Store"`
- [x] `ui/src/features/settings/AppearanceSettings.tsx:416` — `<Localized id="appearance-store-name-fallback"><span>OZ-POS</span></Localized>` fallback text
- [x] `ui/src/features/settings/components/ImportSection.tsx:62` — "created by OZ-POS export." (prose, user-visible)
- [x] `ui/src/features/sales/ReceiptPreview.tsx:65` — `l10n.getString('receipt-preview-store-name', null, 'OZ-POS Store')` fallback
- [x] `ui/src/features/kiosk/KioskScreen.tsx:113` — `<h1 className="kiosk-attract-title">OZ-POS</h1>` (attract screen — the most customer-visible string in the app)
- [x] `ui/src/frontend/shell/AppLayout.tsx:129,132,133,151,171` — document title (`${store_name} — OZ-POS` / `'OZ-POS'`) and the sidebar/tooltip store-name fallbacks
- [x] `ui/src/dev-mock/handlers/settings.ts:121,127` — `store_name: 'OZ-POS Demo'` → `'kasir.mu Demo'`
- [x] `ui/src/features/design/brand-tokens.css:2,9` — `--brand-app-name: 'OZ-POS'` (and `:10` `--brand-company: 'OZ POS Inc.'`). ⚠️ `themeTokenCompliance.test.ts` pins the company value, so this file and that test move together
- [x] `ui/src/features/design/TooltipPreview.tsx:440` — `OZ-POS v0.0.39` (dev-preview surface only)

### Test fixtures that pin the old text (must move in the same commit)
- [x] `ui/src/__tests__/LicenseActivationScreen.test.tsx:80` — `'auth-copyright': 'OZ-POS © {year} All rights reserved.'`
- [x] `ui/src/__tests__/StaffLoginKeyboard.test.tsx:47,76` — `staff-login-title = OZ-POS` and `staff-login-copyright = © 2026 OZ-POS. All rights reserved.`
- [x] `ui/src/__tests__/StaffLoginScreen.test.tsx:41,48` — `store_name: 'OZ-POS'` fixture and `staff-login-title = OZ-POS`
- [x] `ui/src/features/auth/__tests__/LicenseActivationScreen.test.tsx:51,634,636,644` — inline `auth-copyright` snapshot, the logo-hero test name, `getByAltText('OZ-POS Logo')`, and the `OZ-POS © ${year}` regex
- [x] `ui/src/__tests__/AppearanceSettings.test.tsx:343,346` — test name + `expect(screen.getByText('OZ-POS'))`
- [x] `ui/src/__tests__/QrisQrDisplay.test.tsx:188` — `expect(screen.getByText('OZ-POS Store'))`
- [x] `ui/src/__tests__/ReceiptPreview.test.tsx:64,199` — `'OZ-POS Store'` and `'Toko OZ-POS'`
- [x] `ui/src/__tests__/GeneralSection.test.tsx:34` — `'settings-store-name-placeholder': 'OZ-POS Store'`
- [x] `ui/src/__tests__/a11y/axe-helper.tsx:51,54,63` — `store_name: 'OZ-POS'` fixtures and `staff-login-title = OZ-POS`
- [x] `ui/src/__tests__/a11y/WorkspaceHome.a11y.test.tsx:42` · `StaffLoginScreen.a11y.test.tsx:32` · `SettingsPage.a11y.test.tsx:47,53` · `SalesHistoryScreen.a11y.test.tsx:39` · `ProductLookupScreen.a11y.test.tsx:51` — `store_name: 'OZ-POS'` fixtures

### Deliberately NOT in this phase
- CSS section headers (`ui/src/**/*.css:2`) and `//!` doc comments (`ui/src/api/client/*.ts`) carry the
  old brand in 30+ files. They are not user-visible; sweep them mechanically in one later commit rather
  than bloating this one. Enumerate with `git grep -ln "OZ-POS" -- 'ui/src/**/*.css' 'ui/src/api/client'`.


---

## Phase 2b — Client storage key migrations
**Commit:** `feat(ui): migrate persisted storage keys from oz-pos-* to kasirmu brand`
**Pathspec:** `ui/src/utils/storage.ts ui/src/i18n/LocaleContext.tsx ui/src/frontend/shell/ThemeProvider.tsx website/src/layouts/Base.astro website/worker.ts ui/src/__tests__/storageKeyPins.test.ts ui/src/__tests__/storage.test.ts ui/src/__tests__/LocaleContext.test.tsx ui/src/__tests__/ThemeProvider.test.tsx ui/src/__tests__/themeRegression.test.tsx website/src/__tests__/apply-theme.test.ts`

> ⚠️ Each key below requires a **read-old/write-new migration**, NOT a find-and-replace. On first load
> after upgrade: if the old key exists and the new key does not, copy the value to the new key (and
> optionally clear the old key). A bare rename orphans every existing user's preferences.

### UI (localStorage — `ui/src/utils/storage.ts`)
- [x] `oz-pos-locale` (`:8`) → `kasirmu-locale`
  - Migration in `ui/src/i18n/LocaleContext.tsx:44` — read `oz-pos-locale`, write `kasirmu-locale`
- [x] `oz-pos-decimal-sep` (`:9`) → `kasirmu-decimal-sep`
  - Migration inline in whichever hook/context reads this key on startup
- [x] `oz-pos-theme-v4` (`ui/src/frontend/shell/ThemeProvider.tsx:41`) → `kasirmu-theme-v4`
  - Migration in `ThemeProvider.tsx` — read old key on mount, write new key, remove old key

### Website
- [x] `oz_theme` (`website/src/layouts/Base.astro` inline pre-paint script) → `kasirmu_theme`
  - Pre-paint script runs before React hydration; old key must be read as fallback until cleared
- [x] `oz_session` cookie (`website/worker.ts`) → `kasirmu_session`
  - Cookie rename with backward-compat: worker accepts both old and new cookies during transition

### Test fixtures (must move in the same commit)
- [x] `ui/src/__tests__/storageKeyPins.test.ts:44,45` — pinned key values
- [x] `ui/src/__tests__/storage.test.ts:10,14` — key constant assertions
- [x] `ui/src/__tests__/LocaleContext.test.tsx:17` — locale key reference
- [x] `ui/src/__tests__/ThemeProvider.test.tsx:11` — theme key reference
- [x] `ui/src/__tests__/themeRegression.test.tsx:10` — regression fixture
- [x] `website/src/__tests__/apply-theme.test.ts` — website theme key

**Pre-commit gate:** `cd ui && npm run test -- --run storageKeyPins storage LocaleContext ThemeProvider themeRegression` after editing.

---

## Phase 3 — Tauri display names (productName / title only)
**Commit:** `refactor(config): rename productName and window title to kasir.mu`
**Pathspec:** `apps/desktop-client/tauri.conf.json apps/tablet-client/tauri.conf.json install/install.sh install/win/install.ps1 install/win/uninstall.ps1 install/uninstall.sh`

- [x] `apps/desktop-client/tauri.conf.json`
  - `"productName": "OZ-POS"` → `"productName": "kasir.mu"`
  - window `"title": "OZ-POS"` → `"title": "kasir.mu"`
  - **identifier stays `com.ozpos.app` in this commit — moved in Phase 4**
- [x] `apps/tablet-client/tauri.conf.json`
  - `"productName": "OZ-POS"` → `"productName": "kasir.mu"`
- [x] `install/**` — **added after review; this phase's original list omitted every file that consumes the artifact name.** `productName` drives the installer output, so these break here (not in the Tier-3 plan, which only takes their repo URLs):
  - `install/install.sh` — `OZ-POS.app` (`:224`), `/opt/oz-pos/OZ-POS.AppImage` (`:275,279,280,281,287,291`), `~/.local/bin/oz-pos.AppImage` (`:297,302,309,315,317`), `/usr/local/bin/oz-pos` (`:281`), `/usr/share/applications/oz-pos.desktop` (`:282,304,314`), and `dpkg -s oz-pos` (`:268,269,271`)
  - `install/win/install.ps1` — `Programs\OZ-POS\OZ-POS.exe`
  - `install/win/uninstall.ps1` — `DisplayName -like 'OZ-POS*'`, `Get-Process -Name 'OZ-POS'`
  - `install/uninstall.sh` — `/Applications/OZ-POS.app`, `~/Library/Caches/…`, `~/.local/bin/oz-pos.AppImage`
  - Decision to record: whether the Linux launcher and `/usr/local/bin/oz-pos` symlink keep the old short name (a user-visible PATH change, same class as the `oz` CLI binary in T3-2)

---

## Phase 4 — Bundle identifier + data-dir migration ⚠️
**Commit:** `feat(app): change bundle identifier to mu.kasir.app/tablet and add data-dir migration`
**Pathspec:** `apps/desktop-client/tauri.conf.json apps/desktop-client/src/state.rs apps/tablet-client/tauri.conf.json apps/tablet-client/src/state.rs apps/tablet-client/gen/android/app/build.gradle.kts apps/tablet-client/gen/android/app/src/main/java/com/ozpos/tablet/MainActivity.kt install/uninstall.sh install/win/uninstall.ps1 install/win/README.md`

> ⚠️ The data-dir migration in state.rs MUST ship in the same commit as the identifier change.
> On first launch after update: if old path (com.ozpos.*/oz-pos.db) exists and new path does not,
> copy the DB to the new location before opening. Copy (not move) — old install stays as backup.

### Identifier changes
- [x] `apps/desktop-client/tauri.conf.json` — `"identifier": "com.ozpos.app"` → `"mu.kasir.app"`
- [x] `apps/tablet-client/tauri.conf.json` — `"identifier": "com.ozpos.tablet"` → `"mu.kasir.tablet"`
- [x] `apps/tablet-client/gen/android/app/build.gradle.kts:31`
  `namespace = "com.ozpos.tablet"` → `"mu.kasir.tablet"`
- [x] `apps/tablet-client/gen/android/app/build.gradle.kts:34`
  `applicationId = "com.ozpos.tablet"` → `"mu.kasir.tablet"`
- [x] `apps/tablet-client/gen/android/app/src/main/java/com/ozpos/tablet/MainActivity.kt:1`
  `package com.ozpos.tablet` → `package mu.kasir.tablet`
  Also rename the Java directory tree: `com/ozpos/tablet/` → `mu/kasir/tablet/`
  (new files — use §3 one-line new-file chain for the directory move)
- [x] `install/uninstall.sh:55,56,59,96` — **added after review; the original list had no `install/` file.** The uninstaller removes the *old* identifiers' data dirs: `~/Library/Application Support/com.ozpos.app`, `~/Library/Caches/com.ozpos.app`, `~/Library/Preferences/com.ozpos.app.plist`, `~/.local/share/com.ozpos.app`, `~/.config/com.ozpos.app`. After the identifier change these are stale, so an uninstall leaves `mu.kasir.app` data behind. Point them at the new identifier, and decide whether to also remove the legacy path (a separate, deliberate choice — deleting the old dir destroys the user's pre-migration data)
- [x] `install/win/uninstall.ps1:97,98` — `%APPDATA%\com.ozpos.app`, `%LOCALAPPDATA%\com.ozpos.app`; same decision as above
- [x] `install/win/README.md:58` — documents both paths

### Data-dir migration in state.rs
- [x] `apps/desktop-client/src/state.rs:757–762` — `resolve_db_path()`
  - Change `dir.join("oz-pos.db")` → `dir.join("kasir.db")`
  - Before returning the new path, add migration: if old `%APPDATA%/com.ozpos.app/oz-pos.db` exists
    and new `%APPDATA%/mu.kasir.app/kasir.db` does not → `std::fs::copy(old, new)?`
  - Update doc comment at `:214`
- [x] `apps/tablet-client/src/state.rs:373–378` — same pattern
  - `dir.join("oz-pos.db")` → `dir.join("kasir.db")`
  - Migration: old `com.ozpos.tablet/oz-pos.db` → new `mu.kasir.tablet/kasir.db`
  - Update doc comment at `:153`

---

## Phase 5 — DB filename defaults (cloud / CLI / Docker)
**Commit:** `refactor(config): rename default db filename oz-pos.db → kasir.db`
**Pathspec:** `apps/cloud-server/src/config.rs apps/cloud-server/src/db.rs apps/cloud-server/src/main.rs apps/cloud-server/src/bin/migrate_sqlite_to_pg/main.rs apps/cloud-server/src/bin/migrate_sqlite_to_pg/migrate_sqlite_to_pg_tests.rs apps/cloud-server/src/db_tests.rs crates/oz-api/src/lib.rs crates/oz-api/README.md crates/oz-cli/src/cli.rs crates/oz-cli/README.md crates/oz-cli/src/commands/mod.rs crates/oz-cli/src/commands/credential_deltas.rs crates/oz-cli/src/commands/backup.rs crates/oz-cli/src/seed_demo.rs crates/oz-cli/src/seed_demo_tests.rs crates/oz-bridge/src/sync_tests.rs scripts/backup-db.sh scripts/restore-db.sh scripts/check.sh scripts/check.ps1 scripts/setup-dev.ps1 apps/unified/supervisord.conf apps/unified/docker-entrypoint.sh apps/tablet-client/src/commands/offline.rs apps/tablet-client/src/commands/pos_tests.rs .agents/skills/database/SKILL.md .env.example Dockerfile.server Dockerfile.unified docker-compose.yml platform/core/src/database/manager.rs`

- [x] `apps/cloud-server/src/config.rs:201` — `"oz-pos.db"` → `"kasir.db"`
- [x] `apps/cloud-server/src/db.rs:12,128` — comments
- [x] `apps/cloud-server/src/main.rs:9,16` — doc comment + table
- [x] `apps/cloud-server/src/bin/migrate_sqlite_to_pg/main.rs:5,38,113,126`
- [x] `crates/oz-api/src/lib.rs:101,442,450` — default + doc
- [x] `crates/oz-cli/src/cli.rs:27-28` — doc comment + `default_value = "kasir.db"`
- [x] `crates/oz-cli/src/commands/credential_deltas.rs:106,114,771,797` — user-facing --db text
- [x] `crates/oz-cli/src/commands/mod.rs:67,86` — footgun doc + error text
- [x] `crates/oz-cli/src/seed_demo.rs:71` — `unwrap_or("kasir.db")`
- [x] `.env.example:22,24` — `OZ_DB_PATH=kasir.db` + comment
- [x] `Dockerfile.server:12,197` — comment + `ENV OZ_DB_PATH=/data/kasir.db`
- [x] `Dockerfile.unified:18,187,208,211` — all occurrences
- [x] `docker-compose.yml:49` — `OZ_DB_PATH: /data/kasir.db`

**Test fixtures (same commit):**
- [x] `apps/cloud-server/src/bin/migrate_sqlite_to_pg/migrate_sqlite_to_pg_tests.rs:107,218,367`
- [x] `apps/cloud-server/src/db_tests.rs:48,49` — assert strings updated
- [x] `crates/oz-bridge/src/sync_tests.rs:551,569,586,606,628,682,740,773`
- [x] `crates/oz-cli/src/cli_tests.rs:132` — `assert_eq!(cli.db, "kasir.db")`
- [x] `crates/oz-cli/src/seed_demo_tests.rs:97` — `is_store_db_filename("kasir.db")`
- [x] `platform/core/src/database/manager.rs:32` — comment
- [x] `crates/oz-cli/src/commands/backup.rs:69` — `unwrap_or_else(|| "kasir.db".into())`
- [x] `scripts/backup-db.sh:10,15,21` — default `./kasir.db`
- [x] `scripts/restore-db.sh:9,19,24` — default `kasir.db`
- [x] `scripts/check.sh:148`, `scripts/check.ps1:132`, `scripts/setup-dev.ps1:115` — `rm -f kasir.db kasir.db-wal kasir.db-shm`
- [x] `apps/unified/supervisord.conf:32`, `apps/unified/docker-entrypoint.sh:8` — comments naming `/data/kasir.db`
- [x] `crates/oz-cli/README.md:28`, `crates/oz-api/README.md:19` — documented CLI/API defaults
- [x] `.agents/skills/database/SKILL.md:58,65` — skill doc updated
- [x] `apps/tablet-client/src/commands/offline.rs:38,280`, `apps/tablet-client/src/commands/pos_tests.rs:866` — comments

---

## Phase 6 — `.ozpkg` → `.kasirpkg` (user-visible + import alias)
**Commit:** `refactor(data): rename .ozpkg → .kasirpkg with backward-compat import alias`
**Pathspec:** `ui/src/api/data.ts apps/desktop-client/src/commands/data.rs apps/tablet-client/src/commands/features.rs crates/oz-bridge/src/data.rs crates/oz-bridge/src/data_tests.rs crates/oz-cli/src/cli.rs crates/oz-cli/src/cli_tests.rs`

> Internal Rust module/struct names (OzpkgPayload, export_ozpkg, import_ozpkg, oz_core::ozpkg,
> CLI subcommands export-ozpkg/import-ozpkg) are Tier 3 — deferred. Only user-visible extension
> strings and file dialog filters change here.

- [x] `apps/desktop-client/src/commands/data.rs:1` — doc comment `.ozpkg` → `.kasirpkg`
- [x] `apps/tablet-client/src/commands/features.rs:535`
  `"Data export/import in .kasirpkg format"`
- [x] `crates/oz-bridge/src/data.rs:1,2` — doc comments
- [x] File dialog filter in export command — `.kasirpkg` as primary, `.ozpkg` as legacy alias:
  `ui/src/api/data.ts:pickExportPath/pickImportFile` now use `kasir.mu Package` with extensions `['kasirpkg', 'ozpkg']`
- [x] `crates/oz-cli/src/cli.rs:70,82,84`
  `--help` text: `.ozpkg file` → `.kasirpkg file (also accepts legacy .ozpkg files)`
- [x] FTL strings: already covered in Phase 1 (`data-mgmt-import-desc`)
- [x] `ui/src/api/data.ts:66,67,75` — the dialog the user actually sees:
  - `:66` `defaultPath: \`kasir_export_${date}.kasirpkg\``
  - `:67`, `:75` `filters: [{ name: 'kasir.mu Package', extensions: ['kasirpkg', 'ozpkg'] }]`
  - Also updated the doc comments at `:1,21,37,72,112,122,133` which say `.ozpkg`, and `ui/src/features/settings/components/ImportSection.tsx:2,61` and `ui/src/features/settings/DataManagementScreen.tsx:5` (the import wizard's own copy)

**Test fixtures:**
- [x] `crates/oz-bridge/src/data_tests.rs:313,339,350,363,365,423,425`
  Primary cases → `.kasirpkg`; keep at least one `.ozpkg` case to cover the legacy alias
- [x] `crates/oz-cli/src/cli_tests.rs:142–174,292–308`
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

- [x] `.githooks/post-commit` — 4 occurrences (`KASIRMU_SKIP_TYPECHECK` x2, `KASIRMU_SKIP_TRIPWIRE` x2)
- [x] `scripts/generate-records-index.mjs` — `KASIRMU_RECORDS_ROOT` (3 occurrences)
- [x] `scripts/test-records-index-escaping.sh` — `KASIRMU_RECORDS_ROOT` (4 occurrences)
- [x] `scripts/test-typecheck-gate.sh` — `KASIRMU_SKIP_TYPECHECK` (5 occurrences)
- [x] `scripts/gates.json` — `_note` text at typecheck-gate row
- [x] `AGENTS.md:76–96` — section heading + all `$env:KASIRMU_*` listings

> Confirm before committing: `git grep -n OZPOS_ .githooks/pre-commit` should return 0 lines.

---

## Phase 8 — Docs / guides / decisions prose
**Commit:** `docs: rebrand OZ-POS → kasir.mu in all user-facing documentation`

Key files with functional (not just prose) brand references:
- [ ] `docs/guides/EXTENDING.md:321`
  `sqlite3 "$APPDATA/com.ozpos.app/oz-pos.db"` → `"$APPDATA/mu.kasir.app/kasir.db"`
- [ ] `docs/guides/EXTENDING.md:78` — same file, second functional reference: `env knobs: OZ_API_PORT (default 3099), OZ_DB_PATH (default oz-pos.db)`
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
  > ⚠️ **These fallbacks must match the LIVE Northflank names, not the desired ones.** They resolve only
  > when the repo variable is unset, and the deployed project/service are still `oz-pos` / `oz-pos-cloud`
  > (`website/worker.ts:54-55` uses `NF_PROJECT='oz-pos'` / `NF_SERVICE='cloud'` against the same API).
  > Renaming the fallback alone breaks the deploy on any run where the variable is unset. Either rename
  > the Northflank project first and land both together, or leave the fallback and mark it Tier 3.
- [ ] `scripts/check.sh:529,531`
  Docker image tag `oz-pos-cloud:local` → `kasir-cloud:local`
- [ ] `.github/workflows/release.yml:149,243` — leave `oz-pos-app` / `oz-pos-tablet` references (binary names, Tier 3). *(Path corrected: the original cited bare `release.yml`, which is also the filename of the retired `.github/workflows/release.yml.bak` sibling — ambiguous in a directory that holds both.)*
- [ ] `scripts/release.sh` — prose/comments only; `--exclude oz-pos-app` stays (Tier 3)

---

## Tier 3 — Deferred (separate PR after brand launch)

**Zero user-visible effect. Do not mix into this rebrand diff.**

The work is specified in full in [`todo-rebrand-2.md`](./todo-rebrand-2.md) (phases T3-1…T3-7). That
file is authoritative; this section previously carried a **second copy** of the list, and the two had
already drifted:

- the copy here named **`oz-pos-cli`** as a binary to rename — no such target exists.
  `crates/oz-cli/Cargo.toml` declares exactly one: `[[bin]] name = "oz"` (`:10-11`)
- it listed **7 crates** (`oz-core`, `oz-bridge`, `oz-hal`, `oz-api`, `oz-cli`, `oz-lan`,
  `oz-local-api`); the rename set is **16** (`crates/` holds 16 `oz-*` dirs plus `qris-core`, which stays)
- it knew nothing of the `ozpkg_parse` fuzz target, the `oz-security` deny.toml entry, the
  **website** and **install/** URL surfaces, or the **persisted client keys** — all found in review
  and recorded in `todo-rebrand-2.md`

Keeping one list is the fix: two enumerations of the same work cannot be edited in step, and this
repo has paid for that lesson repeatedly.

---

## Verification checklist (run after all phases)

```bash
# 1. No old-brand strings in user-facing surfaces.
#    NOTE: this grep is NON-ZERO even when every phase is complete, by design. The survivors are
#    exactly two classes, both recorded above so a future reader does not chase them as debt:
#      (a) CSS section headers and `//!` doc comments under ui/src/features (Phase 2, "Deliberately
#          NOT in this phase"); and
#      (b) Tier-3 persisted keys, which are underscores not hyphens so only `oz-pos-*` here
#          (todo-rebrand-2.md, Notes: "Persisted client keys").
#    Enumerate first, then confirm every remaining hit belongs to (a) or (b); anything else is a miss.
git grep -rn "OZ-POS\|OZ_POS\|OZPOS\|ozpos\|oz-pos" -- \
  ui/src/locales/ ui/src/features/ ui/src/dev-mock/ \
  apps/desktop-client/tauri.conf.json apps/tablet-client/tauri.conf.json

# 1b. Agent-facing surfaces (absent from the original checklist, although Phase 5 now edits one of
#     them and the database skill is what an agent reads before touching the DB layer).
git grep -rn "OZ-POS\|oz-pos\.db" -- .agents/skills/

# 2. No old identifier
git grep -rn "com\.ozpos" -- apps/ docs/ crates/ scripts/

# 3. No old DB default in code OR in the scripts that default to it.
#    NOTE the pattern is deliberately bare `oz-pos\.db` with no surrounding quotes: the scripts this
#    phase now covers write it unquoted, in `${OZ_DB_PATH:-oz-pos.db}` (backup-db.sh / restore-db.sh)
#    and `rm -f oz-pos.db …` (check.sh / check.ps1 / setup-dev.ps1). The previous pattern —
#    `'"oz-pos\.db"\|/oz-pos\.db'` — required a quote or a leading slash and therefore reported ZERO
#    while every one of those script defaults was still stale.
git grep -rn "oz-pos\.db" -- apps/ crates/ scripts/ platform/ Dockerfile* docker-compose* .env.example .agents/skills/

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
