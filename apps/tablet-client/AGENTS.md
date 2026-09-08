<!-- Audit stamp: 2026-07-22 · Hermes-Agent · status: ACCURATE (0 findings, paths/claims verified) · capabilities/mobile.json exists; Cargo.toml crate-type ["staticlib","cdylib","rlib"] matches; src/commands/ exists; tauri.conf.json has android/minSdkVersion 26; CI-on-main note matches root AGENTS.md policy · the hardcoded ANDROID_NDK_HOME path (27.0.12077973) is a local env hint, not a code-claim error -->

# Android Development — OZ-POS Tablet

This file covers the Android build pipeline, signing, and conventions for the
`apps/tablet-client/` Tauri v2 mobile app.

---

## Prerequisites (one-time setup)

| Tool | Version | Install |
|------|---------|---------|
| **JDK** | 17+ | Android Studio bundles one, or `winget install EclipseAdoptium.Temurin.17.JDK` |
| **Android SDK** | 34+ | Android Studio SDK Manager |
| **Android NDK** | 25+ / 27.x | SDK Manager → SDK Tools → NDK |
| **cargo-ndk** | latest | `cargo install cargo-ndk` |
| **Rust targets** | 3 targets | `rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android` |

Set these environment variables (or add to `.env` in the project root):

```env
ANDROID_HOME=C:\Users\Dika\AppData\Local\Android\Sdk
ANDROID_NDK_HOME=C:\Users\Dika\AppData\Local\Android\Sdk\ndk\27.0.12077973
JAVA_HOME=C:\Program Files\Android\Android Studio\jbr
```

---

## Initialise the Android project

Run once from this directory (`apps/tablet-client/`):

```bash
cargo tauri android init
```

This **generates** (do not commit):
```
gen/android/
  app/build.gradle.kts
  app/src/main/AndroidManifest.xml
  app/src/main/java/com/ozpos/tablet/MainActivity.kt
  build.gradle.kts
  gradle/
  gradle.properties
  gradlew / gradlew.bat
  local.properties
  settings.gradle.kts
```

After init you can customise `AndroidManifest.xml` (permissions, orientation,
splash screen) and `build.gradle.kts` (signing configs, build variants).

---

## Signing

### 1. Generate a keystore

```bash
keytool -genkey -v -keystore oz-pos.keystore   -alias oz-pos -keyalg RSA -keysize 2048 -validity 10000
```

Keep the keystore **out of version control**. Add `*.keystore` to
`../../.gitignore` if not already there. In CI, restore it from a base64-encoded
GitHub secret.

### 2. Configure signing (official Tauri v2 route)

The Tauri v2 CLI has **no keystore flags** on `android build`; release
signing is configured via `gen/android/keystore.properties`
(https://v2.tauri.app/distribute/sign/android/), which the tracked
`gen/android/app/build.gradle.kts` `signingConfigs` block reads. When the
file is absent (local unsigned builds) the release build simply skips
signing.

```properties
# gen/android/keystore.properties (never commit)
password=<keystore password>
keyAlias=<alias>
storeFile=/abs/path/to/oz-pos.keystore
```

CI (`.github/workflows/android.yml` / `nightly.yml`) decodes the base64
keystore secret into `gen/android/` and writes this file from
`KEYSTORE_PASSWORD` / `KEY_ALIAS` secrets. The same two secrets plus
`ANDROID_KEYSTORE_BASE64` are all that release signing needs.

---

## Build

```bash
# Debug APK (installable directly)
cargo tauri android build --apk

# Release APK (signed)
cargo tauri android build --apk

# AAB for Google Play Store
cargo tauri android build --aab
```

Output is at `gen/android/app/build/outputs/apk/` or `.../bundle/`.

### Common flags

| Flag | Purpose |
|------|---------|
| `--apk` | Build APK (not AAB) |
| `--aab` | Build Android App Bundle |
| `--target aarch64` | Only build for arm64 (faster) |
| `--target armeabi-v7a` | 32-bit ARM |
| `--target x86_64` | Emulator |
| `--bundles` | Comma-separated release types: `debug`, `release` |

---

## Run on device / emulator

```bash
cargo tauri android dev
```

This builds a debug APK, installs it on a connected device (or starts an AVD),
and opens the Tauri dev server for hot-reload.

**Requirements:**
- USB debugging enabled on device (or AVD running)
- `adb devices` shows the device

---

## Project structure reminders

- **`apps/tablet-client/tauri.conf.json`** — Android config lives in `bundle.android`
- **`apps/tablet-client/capabilities/mobile.json`** — Mobile-specific permissions (add Tauri plugin permissions here)
- **`apps/tablet-client/Cargo.toml`** — Crate type `["staticlib", "cdylib", "rlib"]` for mobile targets (already set)
- **UI** at `../../ui/dist` is bundled into the APK by `beforeBuildCommand`
- **Rust commands** follow the same pattern as desktop (`apps/tablet-client/src/commands/`)

---

## CI notes (GitHub Actions)

For PRs targeting `main`, a CI job should:

1. Install JDK 17, Android SDK 34, NDK 27
2. `rustup target add aarch64-linux-android`
3. `cargo install cargo-ndk`
4. Decode keystore from `${{ secrets.ANDROID_KEYSTORE_BASE64 }}`
5. `cargo tauri android build --apk --target aarch64`
6. Upload APK as an artifact

The CI-only trigger on `main` push/pull_request (per root `AGENTS.md`) applies;
feature-branch pushes skip CI.

> last audited 22-07-26 by Hermes-Agent
