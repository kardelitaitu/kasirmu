# Tablet file pickers + backup/export/import — the dialog plugin and the content-URI bridge (b-full)

<!-- Audit stamp: 2026-09-20 · DSH · status: NEW, UNEXECUTED · authoring HEAD `d62b69413` on branch `0.0.39`, working tree carrying other lanes' ` M` on Cargo.lock, apps/desktop-tauri/src/lib.rs, apps/mobile-tauri/src/lib.rs (+1 line: `commands::auth::has_users`), platform/startup/*, ui/src/features/* and ui/src/__tests__/*, plus untracked `.tmp-android-audit/`, `scripts/android-cdp.mjs`, `scripts/android-screen.mjs`, `ui/src/utils/boot-retry.ts` — none of it mine, none of it touched by this pass. Every anchor below was re-read in this checkout at that HEAD; every claim about a crate's behaviour was read out of the vendored source at the version named, not recalled. Claims about the *tablet's runtime behaviour on a device* are NOT measured here — no device was attached and no APK was built in this pass; they are marked `[unrun]` and each is a Phase-1/2/3 acceptance item rather than a fact. · Supersedes nothing; extends `docs/records/2026-09-20-audit-android-shell.md` §D3, whose option (b) this file is the execution plan for. -->

**Document:** `todo-tablet-dialog-content-uri.md`
**Role:** Execution plan — one workstream, four phases, four fences
**Goal:** Make the tablet's file pickers, backup, export and import work, by registering `tauri-plugin-dialog` on the mobile shell and bridging the `content://` ↔ filesystem-path gap that Android's Storage Access Framework opens.
**Acceptance:** per phase, its own named command. AGENTS.md §4 governs the rename: the `todo-` token stays until every phase's acceptance command has been RUN and PASSED.

---

## 0. Why this document exists

The owner's instruction was **"we want b-full — make a documentation first, we don't want it to stuck in the process."** That is a specific fear with a specific cause, and it is well-founded: this work crosses **six** independently-enforced gates, and three of them **fail in the direction of "your change broke something you did not touch."** A worker who starts at `Cargo.toml` and works outward will hit them in the worst order — after the code is written.

The stall map, in the order a naive pass meets it:

| # | Gate | What it does when b-full lands | Found at |
|---|---|---|---|
| 1 | **Capability ACL** | `plugin:dialog\|open` and `plugin:fs\|read_file` are refused at runtime with `"not allowed"` unless named in the capability file. Code compiles, UI silently fails. | `apps/mobile-tauri/capabilities/mobile.json` |
| 2 | **`tauri-build` Gradle regeneration** | Regenerates `tauri.settings.gradle` + `app/tauri.build.gradle.kts` from `DEP_*_ANDROID_LIBRARY_PATH`. A hand-edited `gen/android/` that "fixes" the plugin wiring is overwritten on the next build. | `tauri-build-2.6.3/src/mobile.rs:147-201` |
| 3 | **IPC parity gate** | **FAILS ON A STALE ALLOWLIST ENTRY.** All 11 commands this plan registers are currently in `/tablet` in `scripts/ipc-parity-allowlist.json`. Register them and the gate reports 11 stale entries and returns 1. | `scripts/verify-ipc-parity.py:3689` |
| 4 | **Registration-gate ledger** | `REGISTERED_TOTAL` is asserted **equal** to the sweep's measurement. Registering 11 names makes it 335 against a pinned 324 and fails. | `registration_gate_debt.generated.rs:257` |
| 5 | **Allowlist schema** | The allowlist is schema-validated; it is not free text. | `scripts/allowlist-schema.py` |
| 6 | **`content://` vs path** | The actual technical blocker, and the one the UI cannot see: every Android picker returns `content://…`, and every Rust consumer of a picked path calls `tokio::fs::read`. | `crates/kasirmu-bridge/src/products_images.rs:113` |

Gates 3, 4 and 5 are the "stuck" part. They are all in **Phase 4**, and they are all *mechanical* — but only if the phases before them are done in the order given, because the ledger must be regenerated **in the same pass** that touches its floor (the generated file says so itself, at `:252-257`).

### 0.1 This reverses a recorded ruling — deliberately, and by the owner

This is not a gap being filled. It is a **decision being changed**, and the change must be recorded as one.

`apps/mobile-tauri/src/commands/avatars.rs:27-39` records a 2026-09-19 owner ruling that the avatar write pair is **desktop-only by product choice**, registered as such in the parity allowlist. `scripts/ipc-parity-allowlist.json` `_comment` states the exit condition in as many words:

> *"They come off this list **if the tablet ever gets a dialog plugin and an upload ruling**."*

The owner's "we want b-full" on 2026-09-20 **is the upload ruling**, and Phase 1 is the dialog plugin. Both preconditions in that sentence are therefore met, and the allowlist entries are expected to come off — not be re-justified. Phase 4 removes them, and the `_comment` must be rewritten to say *why* they left rather than deleted, because the next reader's first question is "was this an oversight?"

Two consequences to hold onto:

1. **`restaurant-avatar-desktop-only` becomes a lie.** `shared-ui/locales/products.ftl:8` reads *"Changing your photo needs the desktop app"*. Once b-full lands on tablet, that string is wrong on the tablet. Phase 2 must replace it (and its `.id.ftl` twin at `:7`).
2. **The product-image write is a different animal from the avatar write.** `products_set_image_scoped` is allowlisted with the reason *"Full ingest pipeline on the authoring (desktop) device… Tablet registers no ingest surface at all."* b-full registers that surface. That is a genuine scope increase — the tablet gains an image-authoring capability it has never had — and Phase 3's acceptance must say so out loud rather than let it arrive as a side effect of "make the picker work."

---

## 1. Measured starting state

Everything in this table was read in this checkout. `[unrun]` marks the two rows that are behavioural claims about a device.

| Fact | Evidence |
|---|---|
| Tablet registers exactly two plugins | `apps/mobile-tauri/src/lib.rs:73-74` — `tauri_plugin_clipboard_manager::init()`, `tauri_plugin_opener::init()` |
| Tablet capability grants four permissions | `apps/mobile-tauri/capabilities/mobile.json:5-10` — `core:default`, `core:event:default`, `clipboard-manager:allow-write-text`, `opener:allow-open-url` |
| Neither plugin is a tablet dependency | `apps/mobile-tauri/Cargo.toml` — no `tauri-plugin-dialog`, no `tauri-plugin-fs` (verified by reading the whole file) |
| `tauri-plugin-dialog` **is** a workspace dependency | root `Cargo.toml:112` — `tauri-plugin-dialog = "2"`; desktop declares it at `apps/desktop-tauri/Cargo.toml:63` |
| `tauri-plugin-fs` is **not** a workspace dependency, but **is** in the lock graph | `Cargo.lock` — `tauri-plugin-fs 2.5.1`, and the only dependent is `tauri-plugin-dialog`. So it is currently **transitive**; using `tauri_plugin_fs::init()` needs a direct declaration in both `apps/mobile-tauri/Cargo.toml` and root `[workspace.dependencies]` |
| The JS dialog plugin is already an npm dependency | `ui/package.json:44` — `"@tauri-apps/plugin-dialog": "^2.2.0"`, installed at `ui/node_modules/@tauri-apps/plugin-dialog/` |
| The JS fs plugin is **not** installed | `ui/node_modules/@tauri-apps/` contains `api`, `plugin-clipboard-manager`, `plugin-dialog`, `plugin-opener`, `plugin-updater` — no `plugin-fs`; and `ui/package.json` does not name it |
| The tablet already resolves a media root | `apps/mobile-tauri/src/state.rs:449-457` — `BridgeCtx::media_cache_dir` from `app.path().app_cache_dir()`; no new plumbing needed for the image ingest |
| The shim pattern that stays ledger-neutral | `apps/mobile-tauri/src/commands/avatars.rs:70-79` — `state.bridge_ctx()` → `kasirmu_bridge::…` → `.map_err(Into::into)` |
| `content://` is what the picker returns | `tauri-plugin-dialog-2.7.1/android/…/DialogPlugin.kt:117` and `:121` — `uri.toString()`; `:232` for save |
| The Rust consumers take a **path** | `crates/kasirmu-bridge/src/products_images.rs:113` — `tokio::fs::read(source_path)` |
| Android cancel is `None`, not an error | `tauri-plugin-dialog-2.7.1/src/mobile.rs:66-70` — `if let Ok(response) = res { f(Some(..)) } else { f(None) }`; `:100-104` same for save. The Kotlin `invoke.reject("File picker cancelled")` is absorbed here |
| `open()` on cancel serialises to `null` | `tauri-plugin-dialog-2.7.1/src/commands.rs:12-24` — `OpenResponse` is `#[serde(untagged)]`, so `File(None)` → `null` |
| The asset protocol does **not** handle `content://` | `tauri-2.11.3/src/protocol/asset.rs` names no `content://` and no `ContentResolver` path (grep, whole file) |
| Android's picker filters **drop unknown extensions** | `DialogPlugin.kt:128-142` — `MimeTypeMap.getMimeTypeFromExtension(ext)`; `kasirpkg`/`ozpkg` have no MIME type, so `parsedTypes` is empty and `:76-78` falls through to `type = "*/*"` |
| Dialog plugin adds **no** Android manifest entries | `tauri-plugin-dialog-2.7.1/android/src/main/AndroidManifest.xml` is an empty `<manifest>` element |
| The tablet is the reachable shell for all of this | `ui/src/app/tablet/TabletAppShell.tsx:87` maps `admin` → `settings`; `crates/kasirmu-core/migrations/20260813_init.sql:1443,1487` — `('admin', 'data-management', 8)`; `ui/src/features/settings/register.tsx:31` registers the route |
| The parity gate runs at pre-push **and** in CI | `.githooks/pre-push:132`; `.github/workflows/dev-ci.yml:675` |

### 1.1 The content-URI bridge, verified end to end

This is the load-bearing technical claim of the whole plan, so it is spelled out with the chain that proves it. **The picker's `content://` string can be read and written directly by `@tauri-apps/plugin-fs` on Android, with no Rust-side JNI and no copying through a cache dir.**

| Step | Source |
|---|---|
| A string whose URL scheme is longer than one char parses as `FilePath::Url`, not `FilePath::Path` | `tauri-plugin-fs-2.5.1/src/file_path.rs:190-200` — `if url.scheme().len() != 1 { return Ok(Self::Url(url)) }`. `content` is four chars |
| `read_file` / `write_file` route through `resolve_file` | `…/src/commands.rs:556-591` (`read_file_inner`), `:1090-1170` (`write_file_inner`) |
| **On mobile, the `Url` arm bypasses the scope check entirely** | `…/src/commands.rs:1448-1477` — the `#[cfg(mobile)]` `resolve_file` matches `SafeFilePath::Url(url)` and calls `webview.fs().open(…)` **without** consulting `global_scope` / `command_scope`. Only the `Path` arm falls through to `resolve_file_in_fs` |
| `Fs::open` sends the URI to Kotlin | `…/src/android.rs:31-85` — `FilePath::Url` → `resolve_content_uri` → `run_mobile_plugin("getFileDescriptor", {uri, mode})` |
| Kotlin opens it through the content resolver | `…/android/src/main/java/FsPlugin.kt:62-68` — `activity.contentResolver.openAssetFileDescriptor(Uri.parse(args.uri), args.mode)` |
| The mode string is derived from the open options | `…/src/lib.rs:304-320` — `android_mode()` builds `r` / `w` / `t` / `a`; read → `"r"`, write+truncate → `"wt"` |

Two caveats that follow from the same reading, both of which shape Phase 2:

- **The scope bypass means reading a URI needs no `fs:scope` entry — but it also means there is no scope guard on that read.** `plugin-fs` will happily read any URI the webview hands it on Android. The ACL permission (`fs:allow-read-file`) is the only control. This is a real, if narrow, widening: the tablet's JS can read any `content://` URI it can construct. It cannot construct one without a picker result, since it has no other source of URIs — but that is an argument about reachability, not about enforcement.

> **Correction, 2026-09-20 (found while implementing Phase 2).** This section originally read *"no `fs:scope` entry is needed"* without qualification, and Phase 1 was committed with a capability description saying so. That is **half wrong**, and the half that is wrong is the half Phase 2 depends on. The bypass is a property of the `SafeFilePath::Url` arm only. The bridged copy has to be **written** to a real cache path, and a path is `SafeFilePath::Path`, which takes the scope-checked arm (`commands.rs:1474-1479` → `resolve_path` → `is_allowed` at `:1573`). So the write leg **does** need `fs:scope`, and the correct grant is `$APPCACHE/image-pick-*` — narrow on purpose, since `require_literal_separator` confines a single-segment pattern to direct children and keeps it clear of `$APPCACHE/images/`, the media store root. Both the capability and the helper now carry the corrected reading. **The lesson generalises to Phase 3**: ask which *arm* a path takes, not whether "the scope applies to plugin-fs". The inbound (read a URI) and outbound (write a real file) legs of the export/import bridge are on opposite sides of that line.
- **The grant is transient.** `DialogPlugin.kt:63` uses `ACTION_GET_CONTENT`, not `ACTION_OPEN_DOCUMENT`, so no persistable URI permission is taken. Reading immediately after the pick is fine; holding the URI across a restart is not. Phase 2 must therefore never store a `content://` string — it must ingest to the media cache and store the resulting hash, which is what the existing `set_avatar_scoped` / `products_set_image_scoped` contracts already return. **This is a constraint the existing API shape satisfies for free, and it must stay that way.**

---

## 2. Phase 1 — register the dialog and fs plugins on the tablet

**Fence:** `apps/mobile-tauri/Cargo.toml`, `apps/mobile-tauri/src/lib.rs`, `apps/mobile-tauri/capabilities/mobile.json`, root `Cargo.toml` (the one added workspace line).
**Commit prefix:** `feat(mobile)`
**Acceptance:** `cd ui && npm run typecheck` green, **and** `cargo check -p kasirmu-mobile` green, **and** `[unrun]` on a device the app boots and `plugin:dialog|open` is *not* refused with `"not allowed"`.

### 1.1 Dependency declarations

1. Root `Cargo.toml`, in `[workspace.dependencies]` beside line 112: add `tauri-plugin-fs = "2"`. It is already resolved at 2.5.1 in the lock; this only promotes a transitive edge to a direct one.
2. `apps/mobile-tauri/Cargo.toml`, beside lines 60-61: add
   ```toml
   tauri-plugin-dialog = { workspace = true }
   tauri-plugin-fs = { workspace = true }
   ```

### 1.2 Plugin registration

`apps/mobile-tauri/src/lib.rs:73-74` becomes:

```rust
.plugin(tauri_plugin_clipboard_manager::init())
.plugin(tauri_plugin_opener::init())
.plugin(tauri_plugin_dialog::init())
.plugin(tauri_plugin_fs::init())
```

`fs` is required even though this plan only *directly* calls it from JS: without `tauri_plugin_fs::init()` the `plugin:fs|*` commands are unregistered and the Phase-2 bridge has nothing to call.

### 1.3 Capability grants

`apps/mobile-tauri/capabilities/mobile.json:5-10` gains:

```json
"dialog:allow-open",
"dialog:allow-save",
"fs:allow-read-file",
"fs:allow-write-file"
```

**Grant these four, not `dialog:default` / `fs:default`.** The desktop capability carries `dialog:default`, and copying it here is the wrong move twice over: it is broader than the four call sites need, and this file's own description at `:3` records that it was *"narrowed from wildcard"* — an M-1 decision this would partly undo. The four commands named above are exactly the four this plan introduces, and `mobile.json` already follows the narrow style (`clipboard-manager:allow-write-text`, not `clipboard-manager:default`).

**Grant one `fs:scope` entry, `$APPCACHE/image-pick-*`, and nothing wider.** The reasoning in the original draft of this section — "the mobile `Url` arm does not consult the scope, so a scope entry would be decoration" — is true only of the **read** leg. The **write** leg takes the scope-checked arm and needs the entry (see the correction under §1.1). The pattern is deliberately one segment wide so it cannot reach `$APPCACHE/images/`, which is the media store root the image ingest writes into.

### 1.4 What is deliberately **not** done here

- **No `tauri android init`.** The scaffold at `apps/mobile-tauri/gen/android/` is committed and already wired.
- **No hand-edit of `gen/android/`.** `tauri-build-2.6.3/src/mobile.rs:147-201` regenerates `tauri.settings.gradle` and `app/tauri.build.gradle.kts` from the build script's `DEP_*_ANDROID_LIBRARY_PATH` environment, so a hand-written plugin entry is a change that vanishes on the next build. Any `gen/android/` diff appearing after Phase 1 is evidence of a mistake, not of progress. Note that `gen/android/app/.gitignore:1` ignores `/src/main/**/generated` — a `git status` that looks clean there proves nothing.
- **No `ui/package.json` change in this phase.** `@tauri-apps/plugin-dialog` is already present. `@tauri-apps/plugin-fs` is added in Phase 2, where it is used.

---

## 3. Phase 2 — the two image pickers

**Fence:** `ui/src/api/` (a new `image-pick.ts` or an addition to `products.ts`/`staff.ts`), `ui/src/features/sales/PosScreen.tsx`, `ui/src/features/retail/EditProductModal.tsx`, `shared-ui/locales/products.ftl`, `shared-ui/locales/products.id.ftl`, `ui/package.json` + lockfile.
**Commit prefix:** `feat(ui)`
**Acceptance:** `cd ui && npm run check:all` green, **and** `[unrun]` on a device both pickers select an image and the new image renders.

### 2.1 The bridge

Add `@tauri-apps/plugin-fs` to `ui/package.json` and one shared helper — call it `pickImageAsIngestiblePath()` — that does:

1. `open({ multiple: false, filters: [{ name: 'Images', extensions: ['webp','png','jpg','jpeg'] }] })`
2. if the result is `null`, return `null` (the user cancelled — see §1, this is the documented cancel path, **not** an error)
3. read the bytes: `readFile(picked)` — works on `content://` per §1.1
4. write them to a real path in the app cache: `writeFile(cachePath, bytes, { baseDir: BaseDirectory.AppCache })` with a per-call unique name
5. return that **real path** for the existing IPC call

Step 4 is what makes the existing Rust contract work unchanged: `crates/kasirmu-bridge/src/products_images.rs:113` and its `avatars.rs` twin keep taking a filesystem path and keep calling `tokio::fs::read`. The alternative — teaching the Rust ingest to accept a `content://` URI — needs JNI content-resolver plumbing inside `kasirmu-bridge`, a crate whose stated invariant is that **no tauri type enters it** (`apps/mobile-tauri/src/state.rs:66-68`). Bridging on the JS side keeps that invariant and costs one file read/write per image.

The temp file must be deleted after the ingest call resolves (success or failure), and its name must be unique per call — two concurrent pickers writing the same cache name would race.

### 2.2 The two call sites

| Site | Current state | Change |
|---|---|---|
| `ui/src/features/sales/PosScreen.tsx:226` | Already guarded by `isTauriWebview()` at `:216`, with a `restaurant-avatar-desktop-only` toast for the browser preview | Swap `open(...)` for the helper; replace the now-false `restaurant-avatar-desktop-only` message with a generic picker-failure string |
| `ui/src/features/retail/EditProductModal.tsx:88` | **Unguarded.** Calls `open(...)` unconditionally, so in the browser dev preview it falls into the `catch` at `:100` and shows `retail-edit-image-error` | Swap in the helper **and add the same `isTauriWebview()` guard the avatar path already has** — this is a pre-existing wart that b-full makes visible, and it is one line |

### 2.3 The i18n obligation

`shared-ui/locales/products.ftl:8` and `products.id.ftl:7` both assert the feature is desktop-only. Once Phase 2 lands that is false on tablet. Both must be replaced in this phase, and the FTL orphan lint is a pre-commit step — removing a string that JSX still references, or leaving one that nothing references, both fail.

---

## 4. Phase 3 — backup, export and import

**Fence:** `apps/mobile-tauri/src/commands/` (a new `data.rs`), `apps/mobile-tauri/src/lib.rs` (the `generate_handler!` list only), `ui/src/api/data.ts`.
**Commit prefix:** `feat(mobile)`
**Acceptance:** `cargo check -p kasirmu-mobile` green, **and** `cd ui && npm run test` green, **and** `[unrun]` on a device: a backup is written to a location the user chooses, and an exported `.kasirpkg` is re-imported.

This phase is **bigger than Phase 2 and should be sequenced after it**, because it is the one that turns a picker fix into a new product capability (§0.1).

### 3.1 The eleven commands

All eleven are currently `/tablet` allowlist entries (measured: `python3 -c` over `scripts/ipc-parity-allowlist.json`, 140 entries in `/tablet`, of which these are the b-full set):

| Group | Commands |
|---|---|
| Image writes | `products_set_image_scoped`, `products_clear_image_scoped` |
| Avatar writes | `set_avatar_scoped`, `clear_avatar_scoped` |
| Export | `export_data` |
| Import | `import_data`, `import_preview` |
| Backup | `create_backup`, `create_backup_scoped`, `get_backup_status`, `get_backup_status_scoped` |

### 3.2 Register them as bridge shims, never as local bodies

Every one must be a **shim** in the `avatars.rs:70-79` shape — `state.bridge_ctx()` → `kasirmu_bridge::…` → `.map_err(Into::into)` — with no SQL, no gate and no lock of its own (ADR #49).

This is not style. It is what keeps Phase 4 cheap, and the mechanism is worth stating because it is not obvious: the registration gate's `gated_bridge_stems()` (`registration_gate_tests.rs:396-417`) collects the file stems of every `crates/kasirmu-bridge/src/*.rs` that **names a permission**, then classifies a wrapper as *Gated* when it forwards to one of those stems. Measured in this checkout:

- `crates/kasirmu-bridge/src/data.rs` names `permissions::DATA_EXPORT` (`:797`, `:812`) and `kasirmu_core::permissions::SETTINGS_EDIT` (`:375`, `:530`, `:559`)
- `crates/kasirmu-bridge/src/products_images.rs` names `permissions::PRODUCTS_UPDATE` (`:196`, `:249`) and `permissions::PRODUCTS_READ` (`:280`)
- `crates/kasirmu-bridge/src/avatars.rs` names permissions (per its own header at `:48-51`)

So all eleven shims read **Gated**, add **zero** rows to the debt ledger, and move **no** ceiling. A local body that resolves a session without naming a permission would instead add rows to `DEBT_CEILING` (pinned at 88) and require the ceiling be raised — a recorded, owner-facing decision this plan does not want to make for a mechanical port.

The bridge function line numbers, so the shims can be written against the real signatures: `get_backup_status` `data.rs:294`, `create_backup` `:337`, `export_data` `:369`, `import_preview` `:524`, `import_data` `:553`, `get_backup_status_scoped` `:790`, `create_backup_scoped` `:805`.

### 3.3 The Rust-side content-URI problem — and why this phase is not a copy of Phase 2

Phase 2's bridge runs **toward** the picker (read bytes, write a real path). Phase 3 needs both directions, and the outbound one cannot be done in JS:

- **Import (inbound) — same shape as Phase 2.** `import_preview` / `import_data` take `file_path` and the Rust side opens it. `ui/src/api/data.ts:123-142` already threads a plain path. Bridge it the Phase-2 way: read the picked `content://` via `plugin-fs`, write to the cache, pass the real path.
- **Export / backup (outbound) — the other direction.** `export_data` takes `outputPath` (`ui/src/api/data.ts:22-28`) and the Rust side writes a file there. A `content://` URI is not a path `tokio::fs` can open, so the Rust side cannot write to it. Bridge it as: let Rust write to a **cache path**, then JS `readFile(cachePath)` → `writeFile(contentUri, bytes)` via `plugin-fs` (§1.1 — the write mode is `"wt"`). The user still gets the system save dialog and still chooses the destination; only the final byte movement crosses back through JS.
- **`create_backup` / `get_backup_status` take no destination at all** — measured at `data.rs:294` and `:337`, `create_backup(db_path)` and `get_backup_status(db_path)`. They write where the shell tells them to. Check whether the tablet's existing callers expect a path back before wiring a picker to them; a backup that lands in the app cache with no user-visible destination is a different feature from one the user chooses a home for, and **this plan does not settle which one the tablet should get.**

> **Open item, needs the owner.** The three groups are not equally ready. Import and export are mechanical once Phase 2's helper exists. **Backup is not** — it has no destination parameter, and giving it one is a contract change to a command the desktop also calls. Phase 3 can land import + export and leave backup allowlisted; that is the honest partial, and it should be chosen deliberately rather than discovered.

### 3.4 `ui/src/api/data.ts`

`pickExportPath` (`:64-70`) and `pickImportFile` (`:73-79`) return `path` straight from the dialog plugin. They are the two functions the content-URI bridge must wrap, and they are the right place for it: every caller (`useExportWizard`, `useImportWizard`, `useBackupStatus`) goes through them, so no screen needs to learn about `content://`.

Note `ui/src/api/data.ts:123-142`: `importPreview` and `importData` already take a `filePath` string, and the args are sent as `{ file_path: filePath, password }`. The bridge changes what that string *is*, not its type.

---

## 5. Phase 4 — reconcile the six gates

**Fence:** `scripts/ipc-parity-allowlist.json`, `apps/mobile-tauri/src/commands/registration_gate_debt.generated.rs`, `apps/mobile-tauri/src/commands/registration_gate_tests.rs` (the floor only).
**Commit prefix:** `chore(mobile)`
**Acceptance:** `python3 scripts/verify-ipc-parity.py` → 0, **and** `python3 scripts/allowlist-schema.py` → 0, **and** `cargo test -p kasirmu-mobile registration_gate` green.

Do this **in the same pass** as the phases that cause it, or the pre-push hook fails on work that is otherwise complete. Order:

1. **Remove the registered names from `/tablet`** in `scripts/ipc-parity-allowlist.json`. The gate fails on a stale entry by design (`verify-ipc-parity.py:3689` — `stale = sorted(allowed & set(handlers[shell]))`), so leaving them is a guaranteed red. Remove only the ones actually registered — if §3.3's open item is decided as "backup stays out", the four backup names **stay** on the list.
2. **Rewrite the `_comment`.** It currently ends *"They come off this list if the tablet ever gets a dialog plugin and an upload ruling."* That condition has now fired. Say so, with the date, or the next reader sees 11 silent removals and no reason.
3. **Regenerate the ledger**, do not hand-edit it: `KASIRMU_REGENERATE_GATE_LEDGER=1` (`registration_gate_tests.rs:65`), then run the test normally. The generated file's own header (`:1-11`) says a hand-edited line is the drift it exists to prevent.
4. **Move `REGISTERED_TOTAL`** in `registration_gate_debt.generated.rs:257` from 324 to 324 + the number of names registered. The file says at `:252-257` that the generator writing the number does **not** move the floor, "so the two are only ever equal in a pass that touches both files" — this is the single most likely place to stall, because the failure message points at the floor and the fix is in the same file two lines away.
5. **`DEBT_CEILING` should not move.** If it does, §3.2's shim rule was not followed — stop and find which wrapper has a local body instead of raising the ceiling.
6. **`scripts/verify-scoped-reads.py` does not need touching — and that is measured, not assumed.** It reads the same file (`:144`) but only its `dev_mock` and `scoped_orphans` sections (`:33`, `:159`); it never reads `/tablet`. Measured in this checkout: none of the eleven names are in `/scoped_orphans`, so both readers of that section are unaffected either way.
7. **Leave the two `/dev_mock` entries alone.** `products_set_image_scoped` and `products_clear_image_scoped` are in `/dev_mock` for a reason that shell registration does not touch — that section means *"no handler anywhere under `ui/src/dev-mock` can answer this, so `invoke()` resolves to null in the browser preview."* They clear when a dev-mock handler appears, not when the tablet registers a command. Adding the handlers is optional cleanup; removing the entries without the handlers would make the gate lie in the other direction.

---

## 6. Traps, collected

Each of these has cost time on this codebase before, or is a trap this specific work creates.

| Trap | Why it bites here |
|---|---|
| **A `git status` that looks clean in `gen/android/` proves nothing** | `gen/android/app/.gitignore:1` ignores `/src/main/**/generated`. Three separate false-zero readings in the D1–D3 audit came from searching that tree and reading emptiness as absence. If a Phase-1 build *should* have rewritten a Gradle file and `git status` is silent, compare `git hash-object` against the HEAD blob — under `text=auto` a file can also show as ` M` with identical bytes |
| **`--no-ignore` is a ripgrep flag, not a GNU grep flag** | It makes `grep` exit non-zero with a usage error on stderr. With `2>/dev/null` the stdout is empty and reads exactly like "no such code exists." Never read a suppressed stderr as evidence |
| **A stale allowlist entry is a *failure*, not a warning** | The gate is built so the list cannot rot into a lie. Every command registered without the corresponding removal turns pre-push red |
| **`REGISTERED_TOTAL` is an equality, not a floor** | Despite the name in the surrounding prose. It must equal the sweep's measurement exactly |
| **The ledger is generated** | Hand-editing one line is the exact drift the file exists to prevent, and it will be silently overwritten by the next regeneration |
| **`content://` is not a path** | `tokio::fs::read` (`products_images.rs:113`) and the `data.rs` writers all take paths. Every picked value must be bridged before it reaches Rust |
| **The `content://` grant is transient** | `ACTION_GET_CONTENT`, not `ACTION_OPEN_DOCUMENT` — no persistable permission. Never persist a URI; persist the ingest hash |
| **Cancel is `null`, not a rejection** | `mobile.rs:66-70`. Writing a `catch` that shows an error toast on cancel would fire on every dismissed picker |
| **`kasirpkg` / `ozpkg` have no MIME type** | `DialogPlugin.kt:128-142` drops them, so the Android import picker degrades to showing **all** files. Not a bug to fix in this plan, but it should not be mistaken for one during acceptance |
| **`plugin-fs` on mobile skips the scope check for URLs** | `commands.rs:1448-1477`. The ACL permission is the only control — grant the two narrow permissions, not `fs:default` |
| **A `:!` pathspec built by inline concatenation silently matches nothing** | If any Phase-4 verification uses `git grep` with exclusions, build the exclusion as its own variable and sanity-check a zero result with one unfiltered run |

---

## 7. Commit sequence

One commit per phase, pathspec form, per AGENTS.md §3. New files (`ui/src/api/image-pick.ts`, `apps/mobile-tauri/src/commands/data.rs`) use the §3 one-line `add … && commit` chain; everything else is a bare pathspec commit.

| Phase | Subject |
|---|---|
| 1 | `feat(mobile): register dialog and fs plugins on the tablet shell` |
| 2 | `feat(ui): bridge Android content URIs for the two image pickers` |
| 3 | `feat(mobile): register the data-management commands on the tablet shell` |
| 4 | `chore(mobile): retire the b-full tablet allowlist entries and regenerate the ledger` |

Do not run `git push` without an explicit order.

---

## 8. What this document does not claim

- **No device was attached and no APK was built in this pass.** Every `[unrun]` marker is an acceptance item, not a fact. The Android runtime behaviour of the four new permissions is inferred from the capability/ACL system and the vendored plugin sources, not observed.
- **The `plugin-fs` scope-bypass finding is read from source, not tested.** It is stated as a code path (`commands.rs:1448-1477`), which is what it is.
- **Phase 3's backup half is unresolved by design** (§3.3). Import and export are ready; backup needs a destination decision that belongs to the owner.
- **No measurement of the debug-APK size effect** of adding two plugins. `tauri-plugin-fs` is already in the lock graph as a transitive dependency of `tauri-plugin-dialog`, so the marginal native code is small — but that is reasoning, not a measurement, and this document does not put a number on it.
