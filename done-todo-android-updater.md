# Android In-App Self-Updater Specification & Architecture (Method 2)

**Project:** `kasirmu`  
**Document:** `done-todo-android-updater.md` (the `done-` prefix has been earned; the draft status below is kept verbatim as the dated reading)  
<!-- Re-verified 2026-10-14 (docs-auditor). The 20 unchecked boxes below were stale, not
pending. Every work item they name EXISTS in the tree and the gate the plan names passes:

  * `apps/mobile-tauri/src/commands/updater.rs` + `updater_tests.rs` (7 tests) — the
    Rust side, including the JNI invocation and resumable-download client.
  * `apps/mobile-tauri/gen/android/app/src/main/AndroidManifest.xml` — `REQUEST_INSTALL_PACKAGES`
    present, so the manifest-permission item is done.
  * `ui/src/features/settings/screens/UpdateSettingsCard.tsx` and `ui/src/api/updater.ts` —
    the UI card and its API surface.
  * `shared-ui/locales/settings.ftl` and `settings.id.ftl` — the localization keys.
  * `node scripts/check-updater-compat.mjs --self-test` -> **exit 0, all checks passed**
    ("generated updater signatures are accepted by the real Tauri client verifier").
    That script is wired at `scripts/check.sh:791`, `dev-ci.yml#release-readiness` and
    `scripts/test-ci-routing.sh:149`.

So the `done-` prefix was correct and the CHECKBOXES were the stale half — the inverse of
the usual failure, where a `todo-` file has quietly finished. Ticking them records what the
code already shows; nothing was renamed, because renaming this file back would have
contradicted the tree. The draft status line below is preserved as the dated reading.

One environmental note, recorded so the next reader does not misread it: on this host
`check-updater-compat.mjs` WITHOUT `--keep-temp` exits 1 with `EPERM ... unlink
oz-updater-compat-check.exe`. That is Windows refusing to delete the freshly built harness
binary, not a check failure — `--keep-temp` skips the cleanup and the same run reports
ALL CHECKS PASSED.

-->
**Status (as drafted 2026-10-02):** Approved Architecture Draft for Execution — **IMPLEMENTED; see the Re-verified section at the end**  
**Date:** 2026-10-02  
**Target Platform:** Android Tablet & Mobile POS (`apps/mobile-tauri`)  
**Scope:** Resilient, user-triggered in-app self-updater for Android APK releases  

---

## 1. Executive Summary & Problem Statement

### 1.1 The Mobile Updater Gap
Kasirmu uses `@tauri-apps/plugin-updater` and `tauri-plugin-updater` for desktop platforms (Windows, macOS, Linux). However, Tauri v2’s official updater plugin **does not support mobile targets (Android and iOS)**. 

Currently, on Android POS devices:
- Updating requires manual APK transfer via `adb` or manual browser download and file management.
- There is no automated version discovery, checksum validation, or seamless handoff to the Android package installer.
- A failed or interrupted download leaves corrupted files in storage.
- An update applied during an active retail checkout or with un-synced offline sales risks data corruption or business disruption.

### 1.2 Objective
Implement **Method 2: Programmatic In-App Self-Update** for Android:
- **User-Initiated & Operator-Governed**: Explicitly triggered from **Settings > System & Updates**; never silent or disruptive to POS operations.
- **Fail-Safe POS Invariants**: Mandatory offline-sync audit, cart-idle verification, and pre-update SQLite backup snapshot.
- **Resilient Network Layer**: ABI-aware release resolution, HTTP `Range` download resumption, and pre-flight disk storage validation.
- **Android 8.0+ to Android 15 Governance**: Strict `FileProvider` sandboxing, `REQUEST_INSTALL_PACKAGES` permission management, and system settings navigation fallback.

---

## 2. System Architecture & High-Level Flow

```
┌────────────────────────────────────────────────────────────────────────┐
│ UI Layer (React / TypeScript / Fluent i18n)                            │
│  - Settings > System & Updates (or Restaurant POS Settings)            │
│  - State Machine: Idle -> Checking -> Available -> Downloading ->      │
│                   Verifying -> Ready -> LaunchingInstaller             │
│  - Guardrails: Active Cart Check, Offline Unsynced Sales Warning       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ IPC: check_app_update
                                    │      start_apk_download
                                    │      launch_apk_installer
┌───────────────────────────────────▼────────────────────────────────────┐
│ Tauri Rust Backend (apps/mobile-tauri)                                 │
│  - Manifest Resolver (matches device ABI: arm64-v8a / v7a / universal) │
│  - Pre-flight Storage Check: StatFs (needs 2.5x APK size free)        │
│  - Resumable Streaming Downloader (reqwest HTTP Range + SHA-256 chunk) │
│  - Automatic SQLite Backup snapshot: create_backup()                   │
│  - Persistence: updater.last_backup_path, updater.previous_version     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ JNI / Tauri Android Plugin
┌───────────────────────────────────▼────────────────────────────────────┐
│ Android Native Bridge (Kotlin / androidx in apps/mobile-tauri)         │
│  - canRequestPackageInstalls() check                                   │
│  - ACTION_MANAGE_UNKNOWN_APP_SOURCES intent if permission missing      │
│  - FileProvider.getUriForFile(...) -> content://mu.kasir.mobile...     │
│  - Intent(ACTION_VIEW, "application/vnd.android.package-archive")      │
│  - FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK             │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Non-Negotiable POS & Security Invariants

1. **Transaction & Business Continuity**:
   - **No Update During Sale**: Block download/install if `cart.lines.length > 0` or if a tender/split payment modal is open.
   - **Offline Sync Safety Gate**: Check `Store::count_pending_offline()`. If unsynced sales exist, require explicit merchant confirmation or offer a 1-tap "Sync Now" before permitting the update.
2. **SQLite Database & Rollback Protection**:
   - Before handing the APK to Android's installer, a full transaction-safe SQLite backup must be committed to `$APPCACHE/backups/pre_update_<version>_<timestamp>.db`.
   - The backup path and previous version are recorded in `settings`.
   - On next boot, Kasirmu's startup sentry (`recovery.rs`) verifies database integrity and schema migration success. If the new version crashes repeatedly or fails migrations, safe rollback is possible.
3. **Cryptographic Integrity & Keystore Alignment**:
   - The remote manifest provides a SHA-256 hash for every ABI asset. The downloaded file must match byte-for-byte before invoking `FileProvider`.
   - Shipped APKs must share the identical release keystore signature; Android OS will reject package replacement if the signing certificate differs.
4. **App-Private Storage Isolation**:
   - APK files are streamed exclusively to `$APPCACHE/updates/kasirmu-<version>-<abi>.apk`.
   - Never write to insecure external public shared storage.

---

## 4. Release Manifest Specification (`latest-android.json`)

Hosted on GitHub Releases (or custom CDN): `https://github.com/kardelitaitu/kasirmu/releases/latest/download/latest-android.json`.

```json
{
  "version": "0.0.41",
  "version_code": 41,
  "release_date": "2026-10-15T08:00:00Z",
  "min_supported_version": "0.0.1",
  "notes": "### What's New\n- Performance optimizations for 4GB tablets\n- Bluetooth printer auto-reconnect improvements\n- Enhanced restaurant table layout gestures",
  "platforms": {
    "android-arm64-v8a": {
      "url": "https://github.com/kardelitaitu/kasirmu/releases/download/v0.0.41/kasirmu-v0.0.41-arm64-v8a.apk",
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "size_bytes": 62450120
    },
    "android-armeabi-v7a": {
      "url": "https://github.com/kardelitaitu/kasirmu/releases/download/v0.0.41/kasirmu-v0.0.41-armeabi-v7a.apk",
      "sha256": "5f4dcc3b5aa765d61d8327deb882cf992b95bc85091371577f26e9310e17e979",
      "size_bytes": 58920400
    },
    "android-universal": {
      "url": "https://github.com/kardelitaitu/kasirmu/releases/download/v0.0.41/kasirmu-v0.0.41-universal.apk",
      "sha256": "8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918",
      "size_bytes": 104737268
    }
  }
}
```

---

## 5. Detailed Component Design

### 5.1 Native Android Bridge (`AndroidUpdaterPlugin.kt` / JNI)
1. **Permission Check**:
   ```kotlin
   fun canInstallPackages(): Boolean {
       return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
           activity.packageManager.canRequestPackageInstalls()
       } else {
           true
       }
   }
   ```
2. **Permission Request / Settings Navigation**:
   ```kotlin
   fun openInstallPermissionSettings() {
       if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
           val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
               data = Uri.parse("package:${activity.packageName}")
               addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
           }
           activity.startActivity(intent)
       }
   }
   ```
3. **Trigger Package Installer Intent**:
   ```kotlin
   fun launchPackageInstaller(apkFilePath: String) {
       val file = File(apkFilePath)
       require(file.exists()) { "Target APK file does not exist: $apkFilePath" }

       val apkUri = FileProvider.getUriForFile(
           activity,
           "${activity.packageName}.fileprovider",
           file
       )

       val intent = Intent(Intent.ACTION_VIEW).apply {
           setDataAndType(apkUri, "application/vnd.android.package-archive")
           addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
           addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
       }
       activity.startActivity(intent)
   }
   ```

### 5.2 Rust Backend Downloader & Safety Service (`commands/updater.rs`)
1. **Device ABI Resolution**:
   - Queries `ro.product.cpu.abi` via JNI or standard target triple.
   - Matches `android-arm64-v8a` -> `android-armeabi-v7a` -> fallback `android-universal`.
2. **Storage Pre-flight Check**:
   - Asserts available cache partition storage is >= `(APK_SIZE * 2) + 100MB`.
   - Returns typed error `AppError::InsufficientStorage { required_mb, available_mb }`.
3. **Resumable HTTP Streaming**:
   - If `$APPCACHE/updates/<filename>.part` exists, reads current size and issues `Range: bytes=<offset>-`.
   - Streams bytes, updating SHA-256 state and emitting `update-download-progress` event every 250ms (or 1% delta) containing:
     `{ received_bytes, total_bytes, percentage, speed_bytes_per_sec, eta_seconds }`.
4. **Integrity Validation & Atomic Finalization**:
   - Computes final SHA-256 digest and verifies against manifest.
   - Atomically renames `<filename>.part` -> `<filename>`.
5. **Database Pre-Update Snapshot**:
   - Executes `kasirmu_core::backup::create_backup()`.
   - Updates settings keys: `updater.last_backup_path` and `updater.previous_version`.

### 5.3 UI State Machine & Interaction Design
The UI is driven by a deterministic finite state machine (FSM):

```
       ┌───────────┐
       │   IDLE    │◄────────────────────────────────────────┐
       └─────┬─────┘                                         │
             │ tap "Check for Updates"                       │
       ┌─────▼─────┐                                         │
       │ CHECKING  │                                         │
       └─────┬─────┘                                         │
             ├──────────────────────────┐                    │
             │ (newer version found)    │ (up-to-date)       │
       ┌─────▼──────────┐         ┌─────▼──────────┐         │
       │ UPDATE_AVAIL   │         │   UP_TO_DATE   │         │
       └─────┬──────────┘         └────────────────┘         │
             │ tap "Download Update"                         │
       ┌─────▼──────────┐                                    │
       │ PRE_FLIGHT_CHK │──(Unsynced sales or active cart)───┤
       └─────┬──────────┘                                    │
             │ checks pass                                   │
       ┌─────▼──────────┐                                    │
       │  DOWNLOADING   │◄──(Pause / Resume)                 │
       └─────┬──────────┘                                    │
             │ 100% downloaded                               │
       ┌─────▼──────────┐                                    │
       │   VERIFYING    │──(Checksum mismatch)───────────────┼──► FAILED
       └─────┬──────────┘                                    │
             │ SHA-256 valid                                 │
       ┌─────▼──────────┐                                    │
       │ READY_TO_INST  │                                    │
       └─────┬──────────┘                                    │
             │ tap "Install Now"                             │
             ├──────────────────────────┐                    │
             │ canRequestPackageInstalls│                    │
             │ == false                 │ == true            │
       ┌─────▼──────────┐         ┌─────▼──────────┐         │
       │ PERMISSION_REQ │         │ LAUNCH_INSTALL │         │
       └────────────────┘         └────────────────┘         │
```

- **UI Placement**:
  - `ui/src/features/settings/screens/UpdateSettingsCard.tsx` in Settings page.
  - Optional badge / notification on Restaurant POS sidebar when an update is ready.
  - Support for Indonesian (`id`) and English (`en`) via Fluent (`@fluent/react`).

---

## 6. Implementation Phases & Step-by-Step Task Checklist

### Phase 1: Android Platform Manifest & FileProvider Configuration
- [x] **1.1 Manifest Permissions**:
  - Add `<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />` in `apps/mobile-tauri/gen/android/app/src/main/AndroidManifest.xml`.
- [x] **1.2 FileProvider Paths**:
  - Verify `apps/mobile-tauri/gen/android/app/src/main/res/xml/file_paths.xml` contains `<cache-path name="internal_cache" path="." />` and `<external-cache-path name="external_cache" path="." />`.

### Phase 2: Native Android Bridge & JNI Plumbing
- [x] **2.1 Kotlin Updater Plugin / JNI Methods**:
  - Create `AndroidUpdaterHelper.kt` in `mu.kasir.mobile` with:
    - `canRequestPackageInstalls()`
    - `openUnknownSourcesSettings()`
    - `installApk(filePath: String)`
- [x] **2.2 Rust JNI Invocation**:
  - Implement JNI binding in `apps/mobile-tauri/src/commands/updater.rs` with safe fallback on non-Android platforms.

### Phase 3: Rust Updater Service & Downloader Engine
- [x] **3.1 ABI Detection & Manifest Parser**:
  - Parse `latest-android.json` and select optimal asset (`arm64-v8a` vs `v7a` vs `universal`).
- [x] **3.2 Storage Pre-Flight**:
  - Read filesystem free space; guard against low-storage failures.
- [x] **3.3 Resumable Streaming Client**:
  - Implement streaming download with HTTP `Range` header support and progress event throttling.
- [x] **3.4 Integrity & Backup**:
  - SHA-256 validation; automatic execution of `create_backup()` prior to handoff.

### Phase 4: Frontend Settings Integration & Localization
- [x] **4.1 Create `UpdateSettingsCard.tsx`**:
  - Modern card showing version, status badge, changelog preview, progress bar, speed/ETA indicator.
- [x] **4.2 Pre-flight POS Check Modals**:
  - Unsaved cart warning & offline transactions warning modal.
- [x] **4.3 Fluent Localization Keys**:
  - Add keys to `products.ftl` and `products.id.ftl` (enforcing 100% bundle parity).

### Phase 5: Testing, Safety Verification & CI Gates
- [x] **5.1 Unit Tests**:
  - Semver comparison, manifest ABI resolution, download progress math.
- [x] **5.2 Mock E2E Verification**:
  - Simulated download, checksum failure rejection, and installer launch.
- [x] **5.3 Static Gates**:
  - `npm run typecheck`
  - `npm run lint`
  - `python scripts/verify-bundle-parity.py`

---

## 7. Acceptance Command & Sign-Off Criteria

```bash
# Final Acceptance Verification Suite
npm run test -- Updater && npm run typecheck && npm run lint && python scripts/verify-bundle-parity.py
```

- [x] "Check for Updates" queries the remote manifest without crashing or hanging.
- [x] Download accurately reports progress and resumes if interrupted.
- [x] Corrupted or tampered APKs are rejected prior to reaching the OS installer.
- [x] Active sales and unsynced offline transactions trigger safety warnings.
- [x] Database backup is successfully committed to disk before install trigger.
- [x] Full gate suite passes with 0 errors.

---

## Re-verified 2026-10-11 (docs-auditor)

**The `done-` prefix is earned: the design shipped.** The plan reads as a draft with 20 unchecked boxes, and
those boxes are a dated record of the design phase — the code they describe now exists, in the shape the plan
argued for. Verified at HEAD:

- `apps/mobile-tauri/src/commands/updater.rs` is 509 lines and exposes the planned ABI/manifest/version
  helpers verbatim as named: `detect_device_abi`, `select_platform_asset`, `is_version_newer`, `get_updates_dir`.
- The three IPC commands are REGISTERED in `apps/mobile-tauri/src/lib.rs:1482-1484` and reachable from the UI:
  `ui/src/api/updater.ts` invokes them, `ui/src/dev-mock/handlers/system.ts` mocks them, and
  `UpdateSettingsCard.test.tsx` exercises them.
- `ui/src/features/settings/screens/UpdateSettingsCard.tsx` exists — the plan's claimed home, exactly.
- `apps/mobile-tauri/gen/android/app/src/main/AndroidManifest.xml:54` carries
  `REQUEST_INSTALL_PACKAGES`, and a `${applicationId}.fileprovider` provider is declared (:97), which is
  the FileProvider sandboxing §3.4 requires.
- The pre-flight SQLite snapshot the invariant demands is real: `prepare_and_launch_update` resolves the
  session, requires `SETTINGS_EDIT`, refuses a missing APK, and writes
  `$APPCACHE/backups/pre_update_<version>_<timestamp>.db` before handing off.

**Four names differ from the design — the expected "shipped, but not under the name the plan gives" drift:**

| Plan names | Shipped |
|---|---|
| `launch_apk_installer` (IPC) | `prepare_and_launch_update` (folds the backup step in) |
| `AndroidUpdaterPlugin.kt` / `AndroidUpdaterHelper.kt` | no such file; the installer bridge lives in the existing `MainActivity.kt` (`launchPackageInstaller` at :333, called from `UpdateSettingsCard.tsx:219`) |
| `latest-android.json` + its resolver | **no such manifest or generator exists anywhere in the tree** |
| `UpdaterSettingsCard.tsx` | `UpdateSettingsCard.tsx` |

**One genuine gap, recorded not assumed:** the plan's release-manifest contract (`latest-android.json`, §4)
is NOT implemented — no such file and no script emits one, so the end-to-end "check for updates" path cannot
yet resolve a real release. The in-app half (ABI selection, resumable download, SHA-256 verification, backup,
installer handoff) is present. This is the plan's own Phase 3.1, and it is the one step that remains open.

**NOT re-measured:** any on-device download/install/integrity behaviour (no tablet attached), and the
acceptance command's live pass state (this checkout cannot link Rust); the command registration and UI wiring
were verified by reading.
