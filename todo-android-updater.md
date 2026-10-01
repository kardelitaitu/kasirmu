# Android In-App Self-Updater (Method 2)

**Project:** `kasirmu`  
**Document:** `todo-android-updater.md`  
**Status:** Draft for execution  
**Date:** 2026-10-02  
**Target Platform:** Android Tablet & Mobile POS (`apps/mobile-tauri`)  
**Scope:** Programmatic, user-triggered in-app self-update for Android APK releases  

---

## 1. Executive Summary

Kasirmu currently supports auto-updates on desktop (Windows, macOS, Linux) via `@tauri-apps/plugin-updater` and `tauri-plugin-updater`. However, Tauri v2’s official updater plugin does not support mobile targets (Android & iOS).

On Android, updating currently requires manual APK distribution and sideloading via `adb` or manual browser download.

This document specifies the technical design, security model, and implementation phases for **Method 2: Programmatic In-App Self-Update (Inside the App)** on Android. It provides a non-automatic, user-initiated update mechanism triggered via **Settings > Updates / System** (or an update prompt), allowing the app to download the latest signed APK from GitHub Releases (or a custom hosting endpoint) and launch the Android package installer.

---

## 2. Invariants & Security Principles

1. **User-Triggered (Not Automatic / Silent)**:
   - Updates are explicitly initiated or confirmed by the merchant/operator.
   - No silent background APK execution.
2. **Database & Transaction Safety**:
   - Automated SQLite database backup must be created before launching the APK installer (mirrors desktop `UpdateBanner` safety guarantee).
   - No update can be triggered while a POS checkout or payment transaction is in-flight.
3. **Cryptographic & Integrity Verification**:
   - Downloaded APKs must match a published SHA256 checksum or Minisign signature prior to handing off to the Android package installer.
   - APKs must be signed by the identical release keystore; Android OS rejects APK updates if the signing certificate does not match the installed version.
4. **Scoped Storage & FileProvider**:
   - Downloaded APK resides in app-private cache (`context.cacheDir` / `$APPCACHE/updates/`) and is shared exclusively via `androidx.core.content.FileProvider`.
   - Never write to insecure world-readable public storage.
5. **Android 8.0+ (API 26+) Permission Compliance**:
   - Android 8.0+ deprecates global unknown sources and requires `REQUEST_INSTALL_PACKAGES` per-app permission.
   - The app must check `packageManager.canRequestPackageInstalls()` before launching the install intent. If false, guide the user to the system settings screen (`ACTION_MANAGE_UNKNOWN_APP_SOURCES`).

---

## 3. Architecture Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│ UI Layer (React / TypeScript)                                          │
│  - Settings > System / About > Update Card                             │
│  - State: idle | checking | available | downloading | ready | error    │
│  - Actions: Check for Updates | Download & Install                     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ IPC: invoke('check_app_update')
                                    │      invoke('download_and_install_apk')
┌───────────────────────────────────▼────────────────────────────────────┐
│ Tauri Core / Rust Backend (apps/mobile-tauri)                          │
│  - Version resolver: getVersion() vs remote version.json               │
│  - SQLite auto-backup: create_backup()                                 │
│  - Streaming downloader with progress event emitter                    │
│  - Integrity verification: SHA-256 / Minisign check                    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ JNI / Android Plugin Call
┌───────────────────────────────────▼────────────────────────────────────┐
│ Android Native Layer (Kotlin / JNI in apps/mobile-tauri)               │
│  - Check canRequestPackageInstalls()                                   │
│  - FileProvider.getUriForFile(...) -> content://...                    │
│  - Intent(Intent.ACTION_VIEW, "application/vnd.android.package-archive")│
│  - Intent.FLAG_GRANT_READ_URI_PERMISSION + FLAG_ACTIVITY_NEW_TASK     │
│  - startActivity(intent)                                               │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Implementation Phases

### Phase 1: Android Manifest & FileProvider Setup
- [ ] **Declare Package Install Permission**:
  - Add `<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />` in `apps/mobile-tauri/gen/android/app/src/main/AndroidManifest.xml`.
- [ ] **Verify FileProvider Paths**:
  - Confirm `apps/mobile-tauri/gen/android/app/src/main/res/xml/file_paths.xml` includes `<cache-path name="cache" path="." />`.
  - Ensure the target APK is saved inside `context.cacheDir + "/updates/kasirmu.apk"`.

### Phase 2: Native Android Installer Bridge
- [ ] **Android Kotlin Helper / Tauri Plugin**:
  - Implement a native bridge (in Kotlin or Rust JNI) with two operations:
    1. `canInstallPackages(context)`: Returns boolean from `context.packageManager.canRequestPackageInstalls()`.
    2. `openInstallSettings(context)`: Launches `Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.packageName))`.
    3. `launchPackageInstaller(filePath)`:
       ```kotlin
       val file = File(filePath)
       val apkUri = FileProvider.getUriForFile(
           context,
           "${context.packageName}.fileprovider",
           file
       )
       val intent = Intent(Intent.ACTION_VIEW).apply {
           setDataAndType(apkUri, "application/vnd.android.package-archive")
           addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
           addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
       }
       context.startActivity(intent)
       ```
- [ ] **Rust Tauri Command Binding**:
  - Expose `install_apk(file_path: String) -> Result<(), String>` in `apps/mobile-tauri/src/commands/updater.rs`.

### Phase 3: Version Checking & Download Service
- [ ] **Remote Metadata Spec (`latest-android.json`)**:
  - Host or release asset:
    ```json
    {
      "version": "0.0.41",
      "release_date": "2026-10-15T00:00:00Z",
      "apk_url": "https://github.com/kardelitaitu/kasirmu/releases/download/v0.0.41/kasirmu-arm64-v8a.apk",
      "sha256": "4a7d...39b",
      "min_version": "0.0.1",
      "notes": "Bug fixes and performance improvements."
    }
    ```
- [ ] **Rust Download Manager**:
  - Async HTTP client via `reqwest` streaming bytes into temporary file `$APPCACHE/updates/update.apk.tmp`.
  - Progress event emission to webview: `emit("update-download-progress", { received, total, percent })`.
  - Validate SHA-256 against expected hash.
  - Rename to `$APPCACHE/updates/update.apk` upon successful validation.
  - Automatically call `create_backup()` prior to handoff.

### Phase 4: Frontend UI (Settings & Update Dialog)
- [ ] **Settings Integration**:
  - Add **Updates** section or card in `SettingsPage.tsx` or a dedicated system screen.
  - Display current app version, latest remote version, and last checked timestamp.
- [ ] **Interactive States**:
  - **Check for Updates** button with spinner during query.
  - If up-to-date: show green "App is up to date" badge.
  - If update available:
    - Display version delta (`v0.0.40 -> v0.0.41`) and release notes summary.
    - Provide **Download & Install** primary button.
  - During download:
    - Progress bar showing percentage, downloaded MB / total MB.
    - Cancel button.
  - On complete:
    - Prompt confirmation: *"Database backup created. The Android installer will now open to complete the update."*
    - Trigger native installer.
  - Error state with clear retry button and actionable diagnostics.

### Phase 5: Verification & Automated Gates
- [ ] **Unit Tests**:
  - Semver comparison and release metadata parser tests.
  - UI state machine tests (idle -> checking -> available -> downloading -> ready -> error).
  - Checksum validation tests.
- [ ] **Pre-commit & CI Validation**:
  - Bundle parity on all newly added localization keys (English and Indonesian).
  - TypeScript typecheck (`npm run typecheck`).
  - ESLint checks (`npm run lint`).

---

## 5. Acceptance Criteria

```bash
# Acceptance Command
npm run test -- Updater && npm run typecheck && python scripts/verify-bundle-parity.py
```

1. Clicking "Check for Updates" queries the remote metadata endpoint.
2. If a newer version is found, release notes and download actions appear.
3. APK download writes strictly to app-private cache with verifiable progress events.
4. Database backup is executed and stored prior to installer invocation.
5. Android `FileProvider` securely yields an install intent to the OS package installer.
6. Gate suite passes cleanly with 0 type errors, 0 lint errors, and 100% bundle parity.
