# Android shell audit — 2026-09-20

Scope: `apps/mobile-tauri` (Tauri 2 Android target), the manifest, the generated Gradle
project, and the shared renderer paths the tablet actually reaches.
Method: read the sources, then confirm each claim against a built artifact or against the
dependency source (`wry-0.55.1`), not against assumption.

Repo state at audit time: HEAD `c45497c12`, 34 dirty files (all peers'), `cargo check -p
kasirmu-mobile` clean, IPC parity 25 scoped orphans (unchanged).

**Revision 2 — 2026-09-20, re-audit of the hardening notes and the N-claims.** The five hardening
notes and every N-claim were re-derived against the sources and artifacts rather than re-read. The
revision-1 readings are preserved verbatim in git at `c45497c12`. Repo state at revision 2: HEAD
`c45497c12`, 42 dirty files (all peers').

| Item | Revision 1 said | Revision 2 finds |
|---|---|---|
| H1 `file_paths.xml` | over-broad; narrow it if used | **withdrawn** — the root path is load-bearing |
| H2 `backup_rules.xml` | duplicate line | duplicate removed; the note's stated cause was wrong |
| H3 permissions | nothing requests them | scope was the wrong layer; CAMERA is wired; three permissions, not four |
| H4 orientation | no lock | confirmed; cite corrected |
| H5 debug APK | 583 MB, no `abiFilters` | size right, cause wrong in two places |
| N1 updater | degrades cleanly | confirmed |
| N1 dialog | "the tablet never mounts them" | **wrong — a real defect; promoted to D3** |
| N1 window-state | desktop-only | confirmed |
| N2 `UpdateBanner` | desktop-only | confirmed |
| N3 versions | correct | confirmed, and re-confirmed in the built APK |
| N4 asset scope | correct | confirmed |
| N5 CSP | correct | confirmed |
| N6 R8 | correct | confirmed, including in the release dex |
| N7 backup exclusion | correct | confirmed, with the load-bearing file named in H2 |
| D1 / D2 | open, then fixed | fix verified at all four sites; D2's dead permission is now exercised |

**A trap this revision hit three times, recorded because it produced two false zeros.** The Android
Kotlin and the wry ProGuard rules live under
`gen/android/app/src/main/java/mu/kasir/mobile/generated/`, which `gen/android/app/.gitignore:1`
excludes. A default `git grep` / ripgrep therefore cannot see the FileProvider call (H1), the
permission launcher (H3) or `proguard-wry.pro` (N6), and each absence was briefly read as evidence.
Worse, the first check of H1 ran `grep -rn --no-ignore …` — a ripgrep flag GNU grep rejects — with
the error sent to `2>/dev/null`, so an empty stdout looked like a finding. **Search that tree with
ripgrep, or with `grep` and no flag at all, and never read a suppressed stderr as evidence.**

---

## D1 — `window.open()` is a silent no-op on the Android WebView (confirmed, HIGH — FIXED)

**Status: fixed.** All four call sites now route through `openExternalUrl()`
(`ui/src/api/browser.ts`), which prefers `openUrl` from `@tauri-apps/plugin-opener` inside a
real webview and falls back to `window.open` outside one. Verified: `npm run typecheck` clean,
`eslint` clean, 21 tests across the three affected suites pass, mobile build bundles.

Every external-URL call-to-action in the shared renderer opened its URL with
`window.open(url, '_blank', ...)`. On desktop that worked. **On the tablet it did nothing.**

### Proof

`window.open` on Android needs *either* `WebSettings.setSupportMultipleWindows(true)` *or* a
`WebChromeClient.onCreateWindow` override that creates the new window. In `wry-0.55.1`
(`~/.cargo/registry/src/.../wry-0.55.1`):

- `grep -rn "SupportMultipleWindows" wry-0.55.1/src` → **no match** (never enabled)
- `grep -rn "onCreateWindow" wry-0.55.1/src` → **no match** (never overridden)

`RustWebChromeClient.kt` overrides exactly: `onShowCustomView`, `onHideCustomView`,
`onPermissionRequest`, `onJsAlert`, `onJsConfirm`, `onJsPrompt`,
`onGeolocationPermissionsShowPrompt`, `onShowFileChooser`. Window creation is not among them.

With multi-window support off, the WebView discards the request. The button press produces no
navigation, no error, no log line.

### Affected call sites

| File | URL | Tablet-reachable via |
|---|---|---|
| `ui/src/utils/upgrade.ts:16` | `https://ozpos.my.id/{locale}/pricing/#{tier}` | `QrisTenderPanel.tsx:62` ('plus'), `SalesHistoryScreen.tsx:264`, `TopologyScreen.tsx:795`, `MultiStoreDashboardScreen.tsx:191`, `TierLockedFeature.tsx:42` |
| `ui/src/api/browser.ts:28` | Google Images search | `RetailPosScreen.tsx` — the `open_product_images_scoped` fallback |
| `ui/src/features/marketplace/AddonsMarketplace.tsx:97` | addon page | marketplace screen |
| `ui/src/app/UpdateBanner.tsx:181` | release notes | **desktop only** (`AppLayout`, see N2) |

The QRIS one matters most: it is on the tablet's payment panel, so a cashier hitting the
upgrade CTA on a locked tier gets a dead button.

### The fix already has its dependency wired

`tauri_plugin_opener` is registered in **both** shells
(`apps/mobile-tauri/src/lib.rs:74`, `apps/desktop-tauri/src/lib.rs:109`) and
`opener:allow-open-url` is granted in **both** capability files
(`capabilities/default.json`, `capabilities/mobile.json`). Its `openUrl()` is the supported
cross-shell route and works on Android.

**D2 — the granted permission was dead code.** `grep -rn "openUrl\|plugin-opener" ui/src`
returned nothing: the permission existed for precisely this purpose and no code exercised it.
**Retired by the fix above** — `ui/src/api/browser.ts:42-43` is now its one caller, which is the
only place it should be.

### What was applied

`@tauri-apps/plugin-opener@^2.5.5` added to `ui/package.json` (it was absent from
`node_modules` despite the Rust plugin being registered in both shells). One helper added to
`ui/src/api/browser.ts`:

```ts
export async function openExternalUrl(url: string): Promise<void> {
  if (isTauriWebview()) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
      return;
    } catch (err) {
      console.warn('openUrl unavailable, falling back to window.open', err);
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
```

`isTauriWebview()` (the existing predicate that tests `__TAURI_INTERNALS__.invoke` is a
*function*, not merely a present key) keeps the dev preview, dev-mock and plain browser on
the `window.open` path, where it is still correct. The dynamic import keeps the package out
of the initial bundle.

Sites converted: `upgrade.ts:16`, `browser.ts` (the `open_product_images_scoped` fallback),
`AddonsMarketplace.tsx:97`, `UpdateBanner.tsx:181`.

**One behaviour change beyond the swap.** `AddonsMarketplace` opened the relative path
`/pricing/#addon-${id}`. Relative to the app's own `https://tauri.localhost` origin that is a
404 on *both* shells, not just the tablet. It is now absolute
(`${WEBSITE_ORIGIN}/pricing/#addon-${id}`), with `WEBSITE_ORIGIN = 'https://ozpos.my.id'`
exported from `api/browser.ts` and reused by `upgradePricingUrl`.

### Ruled 2026-09-20: keep plugin-direct

`crates/kasirmu-bridge/src/browser.rs` is a stub for the ADR #38 opener surface
(`lib.rs:130`: "External-browser command bodies (ADR #38 opener surface) (Wave F)").

**Decision: the renderer keeps calling `tauri-plugin-opener` directly.**
`openExternalUrl()` is the single seam, so if the bridge lane later becomes the home for
external-browser opens, only that one function body changes — no call site moves. The
alternative (building the session-scoped Rust command now) was rejected as speculative and as
work that lane may already own. Revisit only when `browser.rs` stops being a stub.

---

## D3 — `plugin-dialog` is absent on mobile, but three tablet-reachable paths call it (confirmed, MEDIUM — open)

Found while re-measuring N1, which reasoned about which *screens* the tablet mounts and so missed
which *call sites* it reaches. Same class as D1: a shell divergence the shared renderer does not
account for.

### The plugin is unavailable on the tablet, twice over

- `apps/mobile-tauri/src/lib.rs:73-74` registers exactly two plugins
  (`tauri_plugin_clipboard_manager`, `tauri_plugin_opener`), and
  `apps/mobile-tauri/Cargo.toml:60-61` carries no `tauri-plugin-dialog`. Desktop registers it at
  `apps/desktop-tauri/src/lib.rs:106`.
- `apps/mobile-tauri/capabilities/mobile.json` grants no `dialog:*` permission — only
  `core:default`, `core:event:default`, `clipboard-manager:allow-write-text` and
  `opener:allow-open-url`. So registering the plugin would not be sufficient on its own.

An unregistered plugin command rejects, so every call below fails at the invoke.

### Three tablet-reachable consumers

| Call site | Reached by | Guard |
|---|---|---|
| `ui/src/api/data.ts:65` (`save`), `:74` (`open`) | `useExportWizard`, `useImportWizard`, `useBackupStatus` → the Data management screen | none |
| `ui/src/features/sales/PosScreen.tsx:226` (avatar picker) | `PosScreen.tsx:752` → `RestaurantMenu.tsx:485` → `RestaurantSidebar.tsx:314` | `isTauriWebview()` (`:216`) |
| `ui/src/features/retail/EditProductModal.tsx:88` (product image) | `RetailPosScreen.tsx:1643` → `RetailModals.tsx:755` | none |

Each link is load-bearing and was checked:

- **The Data management screen is reachable on a tablet.** N1 said it is "not in the page
  registry"; it is — `ui/src/features/settings/register.tsx:31` registers route `data-management`
  with a nav item (`:32-39`, `requiredRole: 'owner'`). What actually gates it is the workspace
  screen allowlist: `TabletAppLayout.tsx:68-84` filters nav items by `workspaceScreens`, and
  `('admin', 'data-management', 8)` is in the seed
  (`crates/kasirmu-core/migrations/20260813_init.sql:1487`) with a default admin instance
  (`:1509`) that the free tier allows (`:1514`).
- **`PosScreen` and `RetailPosScreen` are tablet-mounted** —
  `ui/src/app/tablet/TabletAppShell.tsx:23-24` lazy-loads both.
- **`isTauriWebview()` is the wrong test for that guard.** It separates browser from Tauri, not
  desktop from tablet, so on the tablet it passes and the honest message that already exists —
  `restaurant-avatar-desktop-only`, "Changing your photo needs the desktop app"
  (`shared-ui/locales/products.ftl:8`) — is never shown. The user gets the generic
  `retail-edit-image-error` instead.

### Failure mode

Not a crash: each call sits inside a `try`, so the rejection surfaces as an error toast (or an
inline `setImageError`). The cost is a dead feature that reports the wrong reason, on the screen
where a merchant would go to back up their data.

### Owner decision — two options

- **(a) Desktop-gate the three sites.** Smallest change, and it matches what the avatar picker
  already intends: branch on a shell predicate instead of `isTauriWebview()` and show
  `restaurant-avatar-desktop-only` (or a sibling key) rather than an error.
- **(b) Register `tauri-plugin-dialog` on mobile and grant `dialog:allow-open` /
  `dialog:allow-save`.** Necessary, but **not sufficient — measured 2026-09-20, and this is the
  correction that matters.** On Android the plugin returns a `content://` URI, not a filesystem
  path: `DialogPlugin.kt:108-126` (`createPickFilesResult`) resolves `uri.toString()` and never
  calls the `getPathFromUri` helper sitting unused beside it (`FilePickerUtils.kt:29`), and
  `saveFileDialogResult` (`:223-245`) does the same for `save`. Nothing in this repo handles a
  `content://` URI, and every consumer reads the value as a path —
  `crates/kasirmu-bridge/src/products_images.rs:113` is a bare `tokio::fs::read(source_path)`, and
  `set_avatar_scoped` reaches it through the shared `ingest_to_store` (`avatars.rs:94`), whose own
  comment at `:68` says it "hands it the value the dialog plugin returned". That assumption holds
  on desktop and breaks on Android. Registering the plugin alone therefore moves the failure one
  step later: the picker opens, the user chooses a file, and the command then fails. Two bridges
  close the gap, with very different costs:
  - **JS-side, fits the two image pickers.** `@tauri-apps/plugin-fs` is content-URI-aware on
    Android — `FsPlugin.kt:40-71` opens any URI through
    `contentResolver.openAssetFileDescriptor`. Pick, read the bytes, write them into the app cache,
    hand the Rust command a real path. Costs the `fs` plugin on mobile, a scope-limited ACL grant,
    and one shared helper in `ui/src/api/`.
  - **Rust-side, needed for backup/export/import.** Those flows are produced and consumed in Rust
    (`exportData`, `importData`), so writing to a picked destination or reading a picked package
    means either a JNI `ContentResolver` path or shipping the bytes through IPC to a JS writer.
    This is the part that is genuinely desktop-shaped today, and it is a project rather than an
    edit.

Recommendation: **(b) for the two image pickers via the JS-side bridge, (a) for
backup/export/import.** Image capture on the tablet pairs with the camera path the scaffold already
wires (H3) and needs no Rust change; the backup/export flows need the Rust-side bridge to work on
Android. Not applied: it is a product call, and the plugin registration has no user-visible benefit
until its bridge lands with it.

### Ruled 2026-09-20: **(b) full — b-full**, not the mixed recommendation above

The owner was asked to choose between desktop-gating everything (a), the mixed split above, and
(b) full. The answer recorded was **"we want b-full"** — the tablet gets real file pickers *and*
working backup/export/import, so the Rust-side bridge for gate 6 is in scope, not deferred. The
mixed recommendation is **withdrawn**; backup/export/import are **not** desktop-gated.

Execution plan: **`todo-tablet-dialog-content-uri.md`** (repo root), which extends this section.
It sequences the six gates — ACL, `tauri-build` Gradle regeneration, IPC parity allowlist,
registration-gate ledger, allowlist schema, and the `content://` bridge — precisely because three
of them fail in the direction of "your change broke something you did not touch."

**A second answer contradicted this one and was resolved.** A later question, asked without
knowledge of the b-full ruling, returned "mixed: images yes, backup no". Presented back to the
owner with both costs, the ruling was **b-full stands**; mixed was withdrawn. Two decision
records now exist for one question — this paragraph is the one that governs.

---

## Confirmed NOT defects

Each of these looked wrong and was checked rather than reported.

### N1 — `plugin-updater`, `plugin-dialog`, `plugin-window-state` are absent on mobile

Desktop registers five plugins; mobile registers two (`clipboard_manager`, `opener`).
Missing-plugin invokes usually throw. They do not here:

- **updater** — `ui/src/hooks/useVersionStatus.ts:73` uses `await import(...)` inside a
  `try`, and the `catch` is explicit: *"Updater plugin not available (browser / dev) — not an
  update."* It degrades to `{ state: 'latest' }`. Its consumers are `UpdateBanner`
  (desktop-only), `StatusBar.tsx` and `RestaurantSidebar.tsx` — all survive that.
- **dialog** — **this one is a defect, not a non-defect: see D3.** `plugin-dialog.open()/save()`
  appear in `ui/src/api/data.ts:65,74`, `EditProductModal.tsx:88` and `PosScreen.tsx:226`, and all
  three are tablet-reachable. The reasoning that retired them — "the file-picking screens are not
  in the page registry, so the tablet never mounts them" — is wrong twice: `data-management` *is*
  registered (`settings/register.tsx:31`), and what gates it is the `workspaceScreens` allowlist,
  which includes it for the `admin` type.
- **window-state** — desktop-only; nothing on the tablet reads it.

### N2 — `UpdateBanner` is desktop-only

It is mounted at `ui/src/app/AppLayout.tsx:315`. `AppLayout` is rendered only by
`ui/src/app/AppShell.tsx:727`. The tablet entry (`ui/src/main.mobile.tsx`) renders
`TabletAppShell` → `TabletAppLayout`. No overlap.

### N3 — versionCode / versionName are correct

`tauri.properties` is at `gen/android/app/tauri.properties`, **not** `gen/android/`. That is
why `app/build.gradle.kts`'s `file("tauri.properties")` (relative to `app/`) resolves. The
built APK proves the wiring: `versionCode='39' versionName='0.0.39'`, matching
`tauri.conf.json`. The fallback values `"1"` / `"1.0"` are never used.

### N4 — the asset protocol scope matches the real cache layout

`assetProtocol.scope` is `["$APPCACHE/images/**"]`. Images are written to
`cache_dir.join("images")` in all three writers:
`crates/kasirmu-bridge/src/products_images.rs:136`, `platform/sync/src/image_push.rs:158`,
`apps/mobile-tauri/src/image_download.rs:232`. `convertFileSrc` (used in
`ProductThumb.tsx:101`) yields `https://asset.localhost/...` under `useHttpsScheme: true`, and
`img-src` lists both `asset:` and `https://asset.localhost`. Correct.

### N5 — the CSP covers every WebView-side destination

The only real origins the UI reaches are `https://license.kasir.mu` and
`https://license.ozpos.my.id`; both are in `connect-src`. Sync traffic leaves through Rust
(reqwest), which the WebView CSP does not gate, so a user-configured sync server is not
blocked. There is **no** `WebSocket` usage anywhere in `ui/src` — the sync socket is
Rust-side. Everything else the grep surfaced (`example.com`, `sync.test`, `test-server`, …)
is test-fixture text.

### N6 — cleartext and R8 are configured correctly

`usesCleartextTraffic` is `true` for debug (needed: the LAN dev server is plain HTTP) and
`false` for release — confirmed in the merged release manifest. R8 keeps what it must:
`proguard-tauri.pro` keeps `mu.kasir.mobile.TauriActivity.getPluginManager()` and
`proguard-wry.pro` keeps `RustWebChromeClient` / `RustWebViewClient`.

### N7 — backup exclusion is right

`allowBackup="false"`, and `backup_rules.xml` / `data_extraction_rules.xml` exclude
`database`, `sharedpref` and `external`. The SQLite DB (PIN hashes, sync secrets) stays off
cloud backup and device transfer.

---

## Hardening notes

- ~~**`file_paths.xml` is over-broad.**~~ **Withdrawn — do not narrow it.** The root
  `<external-path name="my_images" path="." />` is required. wry's generated
  `RustWebChromeClient.kt:469-485` writes camera-capture files to
  `activity.getExternalFilesDir(Environment.DIRECTORY_PICTURES)` (`:483`) and serves them through
  `FileProvider.getUriForFile(..., ".fileprovider")` (`:471`). Narrowing the root path breaks
  `<input type="file">` image capture on Android. It is Tauri's scaffold shape for a reason. This
  also retires revision 1's claim that "nothing uses FileProvider today" — it does, in the one
  place a default grep cannot see, which is the same trap the permission note below records.
- **`backup_rules.xml` duplicated a line** — `<exclude domain="database" path="." />` appeared
  twice. **Removed** in this pass; behaviour is identical.
- **The duplicate was not a scaffold artifact.** `backup_rules.xml` is not a Tauri template file —
  `tauri-cli-2.11.4/templates` holds no `backup_rules.xml` and no `full-backup-content` at all —
  so revision 1's "reads as an unedited merge" is wrong: the file is repo-authored (`7e649395c`)
  and the duplicate is this repo's own slip, which a scaffold regeneration will not restore.
  While here: `allowBackup="false"` (`AndroidManifest.xml:120`) already disables cloud backup
  through API 30, which makes `backup_rules.xml` belt-and-braces, whereas
  `data_extraction_rules.xml` is load-bearing — `allowBackup="false"` does **not** stop
  device-to-device transfer on API 31+.
- **Three dangerous permissions are declared but never requested — not four.** `CAMERA`,
  `POST_NOTIFICATIONS`, `BLUETOOTH_CONNECT`, `BLUETOOTH_SCAN` are all dangerous, but the search
  behind the "nothing requests them" reading covered `apps/mobile-tauri/src` and
  `crates/kasirmu-hal/src`, which is the wrong layer: a runtime permission request can only live
  in the Android host layer, not in Rust, so a zero found there is not evidence. Read in that
  layer, **CAMERA is already wired**: `RustWebChromeClient.kt:96-121` implements
  `onPermissionRequest`, maps `VIDEO_CAPTURE` → `CAMERA` and `AUDIO_CAPTURE` → `RECORD_AUDIO` +
  `MODIFY_AUDIO_SETTINGS`, and calls `permissionLauncher.launch(...)`, with the launcher
  registered at `:63-64` through
  `registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions(), …)`; the same
  file launches for geolocation (`:266`) and for camera capture in the file chooser (`:298`). So a
  `getUserMedia({ video: true })` from the WebView raises the Android CAMERA dialog today, and
  revision 1's parenthetical was right and understated. What is missing is not a request but any
  code that asks for the camera — `getUserMedia` / `mediaDevices` appear nowhere in `ui/src`, and
  no camera or barcode plugin is declared in `apps/mobile-tauri/Cargo.toml` or
  `capabilities/mobile.json`. **The real finding is `POST_NOTIFICATIONS`, `BLUETOOTH_CONNECT` and
  `BLUETOOTH_SCAN`:** nothing anywhere requests them, and the generated `PermissionHelper.kt` only
  *checks* (`hasPermissions`, `hasDefinedPermissions`) — it never requests. Play's
  unused-permission warning is real, but nothing depends on these yet and the manifest footer
  (`AndroidManifest.xml:65-110`) already says so. **Ruled 2026-09-20: keep them declared and
  documented.** They are prerequisites for the camera-scanner, notification and Bluetooth-printer
  transports; nothing depends on them yet, so nothing is broken, and stripping the declarations
  would delete the record of intent. Revisit when a transport lands — that is when the runtime
  request must appear alongside it.
- **No orientation lock.** Confirmed: nothing sets `android:screenOrientation`. Corroborating
  detail revision 1 did not cite — `AndroidManifest.xml:124` declares
  `configChanges="orientation|…|screenSize|…"`, so the activity absorbs rotation without being
  recreated, which is consistent with free rotation rather than an accident. Cite corrected: the
  decision record is at `TabletAppShell.tsx:55-57` (the comment block spans `:36-57`), not
  `:54-57`. **Ruled 2026-09-20: stay unlocked.** The CSS is responsive and rotation is not
  reported as a defect. If that changes, the manifest attribute — not the Web orientation API —
  is the enforceable mechanism.
- **The debug APK figure: right size, wrong cause.** Measured on disk 2026-09-20 under
  `gen/android/app/build/outputs/apk/`, with zip padding computed as `filesize − Σ compress_size`
  so that none of these is the incremental-packaging padding trap recorded at
  `apps/mobile-tauri/AGENTS.md:210-213` (all three measure 0.1% overhead):

  | Artifact | On disk | ABIs inside |
  |---|---|---|
  | `universal/debug/app-universal-debug.apk` | 161,049,361 B | **`arm64-v8a` only** |
  | `arm64/debug/app-arm64-debug.apk` | 162,599,852 B | `arm64-v8a` only |
  | `universal/release/app-universal-release.apk` | 104,737,268 B | all four |

  - "Release is 104.7 MB" — **exact**. "`keepDebugSymbols` keeps symbols for all four ABIs" —
    **true** (`app/build.gradle.kts:56-59`).
  - "there is no `abiFilters`" — **false**.
    `buildSrc/src/main/java/com/ozpos/tablet/kotlin/RustPlugin.kt:20-46` creates a `universal`
    flavor plus four per-arch flavors and sets `ndk.abiFilters` on every one, `universal`
    defaulting to all four. `abiFilters` is not absent — it is precisely the knob, and it is
    already overridable **without editing the generated file**:
    `-PabiList=arm64-v8a,armeabi-v7a`, or `abiList=` in `gradle.properties`. Neither is set
    anywhere today.
  - "the universal APK ships x86 too" — true for release, **false for the debug APK on disk**,
    which ships `arm64-v8a` alone.
  - **583 MB matches no artifact in the tree**, but it is exactly what a debug build with all four
    ABIs unstripped would weigh: the four debug `.so` under `target/` sum to 577,077,264 B
    (`aarch64` 155,482,896 + `x86_64` 153,039,144 + `i686` 144,898,944 + `armv7` 123,656,280)
    plus ~15 MB of dex and resources. That is what `cargo tauri android build --debug --apk`
    (`apps/mobile-tauri/AGENTS.md:184`) produces — it passes no `--target`. The 161 MB artifact
    came from the `--target aarch64` path documented at `docs/guides/android-install-test.md:112`
    and `scripts/android-cdp.mjs:75`, the invocation whose APK carries exactly one ABI. (The step
    that turns `--target` into a narrowed `abiList` lives in `cargo-mobile2`, which is not
    vendored in this checkout, so that link is inferred from the artifact and not read from its
    source. `tauri-cli-2.11.4/src/mobile/android/project.rs:77` only shows the *generated* default
    — `Target::all()`, i.e. all four.)

  So the repo's two figures are two different commands, and neither was recorded with its command.
  **The discipline to add is: print the command beside the number.** The durable size fix, when
  someone wants one, is `abiList` — it survives scaffold regeneration, which an edit to
  `RustPlugin.kt` or `build.gradle.kts` does not.

  **Resolved in the same pass** (`14c8f58f5`). `apps/mobile-tauri/AGENTS.md`'s build-cost table now
  names the invocation behind each figure and gives the four-ABI debug cost, with a REV 7 stamp. The
  26.9 MB / 152.7 MB figures are qualified rather than re-measured: re-measuring both paths is still
  worth doing, but it no longer blocks reading the table correctly.

---

## Verdict

Two cross-shell defects, both from the same cause — the shared renderer does not account for which
plugins each shell registers. **D1** (`window.open()` is a silent no-op on the Android WebView) is
fixed at all four sites. **D3** (`plugin-dialog` is absent on mobile while three tablet-reachable
paths call it) is **ruled** — the owner chose **(b) full**, executed by
`todo-tablet-dialog-content-uri.md`.

Two findings were withdrawn on inspection (versionCode, `file_paths.xml`) — both looked like
defects and are not.

**All four open decisions are now ruled (2026-09-20), and none of them needs code moved:**
ADR #38 opener routing → keep plugin-direct, `openExternalUrl()` is the seam; the three
unrequested permissions → keep declared and documented; orientation → stay unlocked; D3 →
b-full. What remains is execution of the b-full plan, which has its own gates and its own file.

Revision 2 narrowed one of those: the permission item is **three** permissions
(`POST_NOTIFICATIONS`, `BLUETOOTH_CONNECT`, `BLUETOOTH_SCAN`), not four — CAMERA's runtime
request path already exists in the generated scaffold and only lacks code that asks for the
camera. The one documentation item it raised — the build-cost table in `apps/mobile-tauri/AGENTS.md`
not naming the command behind its 152.7 MB debug figure, and the command it does document producing
a ~583 MB build — is fixed in `14c8f58f5`.
