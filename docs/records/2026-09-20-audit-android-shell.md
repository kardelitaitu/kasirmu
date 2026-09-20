# Android shell audit — 2026-09-20

Scope: `apps/mobile-tauri` (Tauri 2 Android target), the manifest, the generated Gradle
project, and the shared renderer paths the tablet actually reaches.
Method: read the sources, then confirm each claim against a built artifact or against the
dependency source (`wry-0.55.1`), not against assumption.

Repo state at audit time: HEAD `c45497c12`, 34 dirty files (all peers'), `cargo check -p
kasirmu-mobile` clean, IPC parity 25 scoped orphans (unchanged).

**Revision 2 — 2026-09-20, re-audit of the "Hardening notes" section only.** All five notes were
re-derived against the artifacts on disk rather than re-read. The revision-1 readings are
preserved verbatim in git at `c45497c12`. Sections D1–D2 and N1–N7 are revision 1 and were not
re-measured — except D1, whose status line was updated to FIXED when that work landed. Repo state
at revision 2: HEAD `c45497c12`, 42 dirty files (all peers').

| Note | Revision 1 said | Revision 2 finds |
|---|---|---|
| H1 `file_paths.xml` | over-broad; narrow it if used | **withdrawn** — the root path is load-bearing |
| H2 `backup_rules.xml` | duplicate line | duplicate removed; the note's stated cause was wrong |
| H3 permissions | nothing requests them | scope was the wrong layer; CAMERA is wired; three permissions, not four |
| H4 orientation | no lock | confirmed; cite corrected |
| H5 debug APK | 583 MB, no `abiFilters` | size right, cause wrong in two places |

**A false zero this re-audit produced, recorded because it nearly became a finding.** Checking
H1 first ran `grep -rn --no-ignore …` — a ripgrep flag GNU grep rejects. The error went to
`2>/dev/null`, stdout was empty, and that emptiness was read as "no such code exists"; on that
basis H1's withdrawal was briefly treated as unsupported. The code is at
`RustWebChromeClient.kt:471`. Two lessons, the first already implied by H3: the `generated/` tree
must be searched with a tool that genuinely ignores `.gitignore` (ripgrep, or `grep` with no flag
at all), and **a suppressed stderr must never be read as evidence.**

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

**D2 — the granted permission is dead code.** `grep -rn "openUrl\|plugin-opener" ui/src`
returns nothing. The permission exists for precisely this purpose and no code exercises it.

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

### Still gated on an owner decision

`crates/kasirmu-bridge/src/browser.rs` is a stub for the ADR #38 opener surface
(`lib.rs:130`: "External-browser command bodies (ADR #38 opener surface) (Wave F)"). If that
lane is the intended home for external-browser opens, the renderer should call the bridge
command (session-scoped, auditable) instead of the plugin directly. The helper above is the
right seam either way — only its body would change.

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
- **dialog** — `plugin-dialog.open()/save()` appear in `ui/src/api/data.ts:65,74`,
  `EditProductModal.tsx`, `PosScreen.tsx`. The file-picking screens
  (`DataManagementScreen` → `BackupSection`/`ExportSection`/`ImportSection`) are **not** in
  `WorkspaceSettingsModal` and **not** in the page registry, so the tablet never mounts them.
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
  (`AndroidManifest.xml:65-110`) already says so. Left as-is.
- **No orientation lock.** Confirmed: nothing sets `android:screenOrientation`. Corroborating
  detail revision 1 did not cite — `AndroidManifest.xml:124` declares
  `configChanges="orientation|…|screenSize|…"`, so the activity absorbs rotation without being
  recreated, which is consistent with free rotation rather than an accident. Cite corrected: the
  decision record is at `TabletAppShell.tsx:55-57` (the comment block spans `:36-57`), not
  `:54-57`. Left as-is; reopen as a product decision.
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
  `RustPlugin.kt` or `build.gradle.kts` does not. **Open item, recorded rather than edited:**
  `apps/mobile-tauri/AGENTS.md:189-190` gives the debug APK as 152.7 MB without naming its
  command, and 152.7 MB is the `--target aarch64` path, while the same table's command at `:184`
  passes no `--target` and would produce the ~583 MB build. Correcting that needs a REV stamp plus
  a re-measurement of both paths, which this revision did not run.

---

## Verdict

One real, high-severity, cross-shell defect (D1), now fixed at all four sites. Two findings
were withdrawn on inspection (versionCode, `file_paths.xml`) — both looked like defects and
are not. Remaining items are product/Play decisions (ADR #38 opener routing, runtime
permission requests, orientation lock), not code defects.

Revision 2 narrows one of those: the permission item is **three** permissions
(`POST_NOTIFICATIONS`, `BLUETOOTH_CONNECT`, `BLUETOOTH_SCAN`), not four — CAMERA's runtime
request path already exists in the generated scaffold and only lacks code that asks for the
camera. It also leaves one documentation item open rather than settled: the build-cost table in
`apps/mobile-tauri/AGENTS.md` does not name the command behind its 152.7 MB debug figure, and
the command it does document would produce a ~583 MB build.
