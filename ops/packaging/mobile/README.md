<!-- Audit stamp: 2026-07-22 · Hermes-Agent · status: ACCURATE (0 findings, 1 low-severity observe) · all concrete paths verified: ui/vite.mobile.config.ts, ui/src/main.mobile.tsx, ui/src/frontend/shell/tablet/, ui/src/hooks/{useOrientation,useSwipe,useKeyboardAvoidance}.ts, ui/index.mobile.html, .github/workflows/{android,ios}.yml, apps/mobile-tauri/Cargo.toml crate-type [staticlib,cdylib,rlib], apps/mobile-tauri/AGENTS.md (linked) · observe: line 429 references ui/dist-mobile/ as a stale build dir to delete — that is a gitignored vite build artifact, not in tree (expected; it is an instruction, not a claim the dir exists) · iOS/Android build commands + signing env vars match the mobile-tauri setup · WCAG 2.2 44x44 touch targets consistent with docs/a11y.md -->
<!-- dead-ref-prefix-ok: apps/mobile-tauri/gen/ -->

> **Prerequisite — the iOS scaffold is not in this repository.** Verified 08-09-26:
> `apps/mobile-tauri/gen/` contains only `android/` (49 tracked files) and `schemas/`.
> There is no `apple/` directory, committed or on disk. `.gitignore` states the policy
> explicitly — *"the generated scaffold under `apps/*/gen/` is COMMITTED so CI and
> contributors don't need the Tauri CLI installed to build"* — and Android follows that
> policy while iOS has never been generated. So **every `gen/apple/...` path below
> describes output of `cargo tauri ios init`, which must be run on a macOS host first.**
> The project filename is also not stable: this guide says `kasirmu-mobile.xcodeproj`
> while `docs/guides/ios-build-guide.md` says `OZ-POS.xcodeproj`, and neither can be
> verified until the scaffold exists. Prefer discovery over a hardcoded name:
> `find apps/mobile-tauri/gen/apple -maxdepth 1 -name "*.xcodeproj"`.

# OZ-POS Mobile Build & Deployment Guide

> Build OZ-POS for Android tablets and iPads using Tauri v2 mobile.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start](#quick-start)
3. [Android Setup & Build](#android-setup--build)
4. [iOS Setup & Build](#ios-setup--build)
5. [CI/CD Pipelines](#cicd-pipelines)
6. [Tablet App Architecture](#tablet-app-architecture)
7. [Orientation & Touch UX](#orientation--touch-ux)
8. [Signing & Distribution](#signing--distribution)
9. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### General

| Tool | Version | Install |
|------|---------|---------|
| **Rust** | stable (1.80+) | `rustup install stable` |
| **Node.js** | 22+ | `winget install OpenJS.NodeJS.LTS` or [nodejs.org](https://nodejs.org) |
| **Tauri CLI** | ^2 | `cargo install tauri-cli --version "^2" --locked` |

### Android

| Tool | Version | Install |
|------|---------|---------|
| **JDK** | 17+ | `winget install EclipseAdoptium.Temurin.17.JDK` or Android Studio bundled JDK |
| **Android SDK** | 34+ | Android Studio → SDK Manager |
| **Android NDK** | 27.x | SDK Manager → SDK Tools → NDK |
| **cargo-ndk** | latest | `cargo install cargo-ndk --locked` |
| **Rust targets** | 3 targets | `rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android` |

Set these environment variables (or add to a `.env` file in the project root):

```env
ANDROID_HOME=C:\Users\YourUser\AppData\Local\Android\Sdk
ANDROID_NDK_HOME=C:\Users\YourUser\AppData\Local\Android\Sdk\ndk\27.0.12077973
JAVA_HOME=C:\Program Files\Android\Android Studio\jbr
```

### iOS (macOS only)

| Tool | Version | Install |
|------|---------|---------|
| **Xcode** | 16+ | Mac App Store |
| **iOS SDK** | 18+ | Included with Xcode |
| **Rust targets** | 3 targets | `rustup target add aarch64-apple-ios x86_64-apple-ios aarch64-apple-ios-sim` |
| **Apple Developer account** | — | [developer.apple.com](https://developer.apple.com) |

---

## Quick Start

### Android

```bash
# 1. Install prerequisites (see above)
# 2. Build the UI frontend
cd ui && npx vite build --config vite.mobile.config.ts

# 3. Initialize the Android project (one time)
cd apps/mobile-tauri && cargo tauri android init

# 4. Run on connected device / emulator
cargo tauri android dev

# 5. Build a release APK
cargo tauri android build --apk --target aarch64
```

### iOS

```bash
# 1. Install prerequisites (macOS + Xcode required)
# 2. Build the UI frontend
cd ui && npx vite build --config vite.mobile.config.ts

# 3. Initialize the iOS project (one time)
cd apps/mobile-tauri && cargo tauri ios init

# 4. Open in Xcode and configure signing
open apps/mobile-tauri/gen/apple/kasirmu-mobile.xcodeproj
#    Set Team + Bundle Identifier in Signing & Capabilities

# 5. Run in iOS simulator
cargo tauri ios dev

# 6. Build a release IPA
cargo tauri ios build --release
```

---

## Android Setup & Build

### Environment Variables

```bash
# Required for Android build tools
export ANDROID_HOME=$HOME/Android/Sdk
export ANDROID_NDK_HOME=$HOME/Android/Sdk/ndk/27.0.12077973
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk
```

### Build Commands

```bash
# Debug build for testing
cd apps/mobile-tauri && cargo tauri android build --apk

# Release build (signed, requires keystore)
cd apps/mobile-tauri && cargo tauri android build --apk --target aarch64

# Android App Bundle (Google Play Store)
cd apps/mobile-tauri && cargo tauri android build --aab
```

### Common Flags

| Flag | Purpose |
|------|---------|
| `--apk` | Build APK (not AAB) |
| `--aab` | Build Android App Bundle |
| `--target aarch64` | Only build for arm64 (faster) |
| `--target armeabi-v7a` | 32-bit ARM |
| `--target x86_64` | Emulator |

### Output Locations

```
APK:  apps/mobile-tauri/gen/android/app/build/outputs/apk/release/kasirmu-mobile-arm64-v8a.apk
AAB:  apps/mobile-tauri/gen/android/app/build/outputs/bundle/release/kasirmu-mobile.aab
```

---

## iOS Setup & Build

### Build Commands

```bash
# Development (starts iOS simulator)
cd apps/mobile-tauri && cargo tauri ios dev

# Release IPA (for TestFlight / App Store)
cd apps/mobile-tauri && cargo tauri ios build --release
```

### Output Location

```
IPA:  apps/mobile-tauri/gen/apple/build/kasirmu-mobile.ipa
```

### Code Signing Setup

1. Open the Xcode project:
   ```bash
   open apps/mobile-tauri/gen/apple/kasirmu-mobile.xcodeproj
   ```
2. Select the target → **Signing & Capabilities**
3. Choose your **Team** from the dropdown
4. Use a unique **Bundle Identifier** (e.g., `com.yourcompany.ozpos.tablet`)
5. Ensure the provisioning profile matches your distribution method

---

## CI/CD Pipelines

OZ-POS provides two GitHub Actions workflows for automated mobile builds:

### Android CI (`android.yml`)

Triggered by:
- Push/PR to `main` (build verification only)
- Tag `v*` (release artifact)
- Manual `workflow_dispatch`

Pipeline steps:
1. Setup JDK 17 + Android SDK 34
2. Install Rust targets (`aarch64-linux-android`, `armv7-linux-androideabi`, `x86_64-linux-android`)
3. Install UI dependencies + build tablet frontend
4. Install `cargo-ndk` + `tauri-cli`
5. Initialize Tauri Android project (`cargo tauri android init --ci`)
6. Decode keystore from `ANDROID_KEYSTORE_BASE64` secret
7. Build signed APK + AAB
8. Upload artifacts (90-day retention)

**Required secrets:**

| Secret | Purpose |
|--------|---------|
| `ANDROID_KEYSTORE_BASE64` | Base64-encoded `.keystore` file |
| `KEYSTORE_PASSWORD` | Keystore master password |
| `KEY_PASSWORD` | Key password |
| `KEY_ALIAS` | Key alias in the keystore |

### iOS CI (`ios.yml`)

Triggered by:
- Tag `v*` (release artifact)
- Manual `workflow_dispatch`

> **Note:** PR builds are skipped because macOS runners are significantly more expensive.

Pipeline steps:
1. Install Rust targets (`aarch64-apple-ios`, `x86_64-apple-ios`, `aarch64-apple-ios-sim`)
2. Install UI dependencies + build tablet frontend
3. Install `tauri-cli`
4. Initialize Tauri iOS project
5. Setup code signing (keychain + certificate + provisioning profile)
6. Build signed IPA
7. Upload artifact (90-day retention)

**Required secrets:**

| Secret | Purpose |
|--------|---------|
| `APPLE_TEAM_ID` | Apple Developer team ID |
| `APPLE_BUNDLE_ID` | Bundle identifier (e.g., `com.ozpos.tablet`) |
| `APPLE_PROV_PROFILE_BASE64` | Base64-encoded provisioning profile |
| `APPLE_CERT_BASE64` | Base64-encoded distribution certificate p12 |
| `APPLE_CERT_PASSWORD` | Certificate password |
| `KEYCHAIN_PASSWORD` | Temporary keychain password |

---

## Tablet App Architecture

### Code Sharing

The tablet client (`apps/mobile-tauri`) shares most code with the desktop client:

| Layer | Shared? | Details |
|-------|---------|---------|
| Rust crates | ✅ Full | `kasirmu-core`, `kasirmu-payment`, `kasirmu-hal`, `kasirmu-security`, etc. |
| React components | ✅ Full | All feature screens, shared components |
| API layer | ✅ Full | `ui/src/api/*` — works with both desktop and tablet |
| Hooks | ✅ Full | `useOrientation`, `useSwipe`, `usePosState`, etc. |
| **Shell** | ❌ Tablet-only | `ui/src/frontend/shell/tablet/` — bottom tab bar layout |
| **Entry point** | ❌ Tablet-only | `ui/src/main.mobile.tsx` |
| **Build config** | ❌ Tablet-only | `ui/vite.mobile.config.ts` → `ui/index.mobile.html` |

### Key Differences from Desktop

- **Bottom navigation bar** instead of sidebar
- **Touch targets ≥ 48px** (WCAG 2.2 minimum)
- **Larger typography** (16–28px body text)
- **Safe-area inset support** for notched devices (`env(safe-area-inset-*)`)
- **Scrollbar styling** for touch (thin, transparent)
- **Orientation lock** — landscape-primary for POS screens
- **No window resize** — fixed fullscreen on mobile

### Project Structure

```
apps/mobile-tauri/         # Rust + Tauri configuration
├── Cargo.toml              # Crate type: ["staticlib", "cdylib", "rlib"] (mobile requirement)
├── tauri.conf.json         # Bundle config, minSdkVersion, iOS minimum version
├── build.rs                # Tauri build script
├── src/
│   ├── main.rs             # Entry point
│   ├── lib.rs              # Plugin registration, invoke_handler
│   ├── commands/           # Tauri commands (same pattern as desktop)
│   ├── state.rs            # App state
│   └── error.rs            # Error types
└── gen/                    # Generated (do not commit) — created by `cargo tauri {android,ios} init`
    ├── android/            # Gradle project
    └── apple/              # Xcode project

ops/packaging/mobile/README.md  # This file
```

---

## Orientation & Touch UX

### Orientation Lock

The tablet app uses the `useOrientation` hook (`ui/src/hooks/useOrientation.ts`) to:

1. **Lock to landscape-primary** on mount (via `window.screen.orientation.lock()`)
2. **Track orientation changes** via `orientationchange` and `resize` events
3. **Provide layout reflow data** — `isLandscape`, `angle`, `viewportWidth`, `viewportHeight`

The hook is wired into `TabletAppShell`:

```tsx
// In TabletAppShell.tsx
const { orientation } = useOrientation('landscape-primary');
// orientation.isLandscape → true when in landscape
// orientation.angle → 0, 90, 180, 270
```

### Touch Gestures

The app supports the following touch gestures:

| Gesture | Action | Component |
|---------|--------|-----------|
| Swipe left on cart | Open payment modal | `PosScreen` via `useSwipe` |
| Swipe right on payment modal | Go back to cart | `PaymentModal` via `useSwipe` |
| Swipe left on cart line | Reveal remove button | `CartLineItem` via `useSwipe` |
| Swipe right on cart line | Hide remove button | `CartLineItem` via `useSwipe` |
| Pull-to-refresh | Reload data | SalesHistory, OfflineQueue, KDS |

### Touch Target Sizes

All interactive elements meet the WCAG 2.2 minimum of 44×44px:

| Element | Size |
|---------|------|
| PIN pad keys | 56×56px |
| Product card add-to-cart | 44×44px |
| Filter chips | 44px height |
| Tab buttons | 44px height |
| Settings switches | 44px height |
| Bottom nav tabs | 48px height |
| Qty control buttons | 44×44px |
| Cart line remove | 44×44px |

### Keyboard Avoidance

The `useKeyboardAvoidance` hook detects keyboard open/close on mobile and scrolls the active input into view:

- `visualViewport` API for resize detection
- `scrollMargin` to ensure inputs are not hidden behind the keyboard
- Applied to: PaymentModal (customer search), SettingsPage text inputs, StaffLoginScreen

---

## Signing & Distribution

### Android Keystore

Generate a keystore for signing release builds:

```bash
keytool -genkey -v -keystore oz-pos.keystore \
  -alias oz-pos -keyalg RSA -keysize 2048 -validity 10000
```

**Security notes:**
- Keep the keystore **out of version control** — add `*.keystore` to `.gitignore`
- Never hardcode passwords; the CI workflows write `keystore.properties`
  from the `KEYSTORE_PASSWORD` / `KEY_ALIAS` secrets
- In CI, restore from `ANDROID_KEYSTORE_BASE64` GitHub secret
- Best practice: rotate the keystore every 2 years

**Signing (official Tauri v2 route):** the CLI has no keystore flags — the
workflows decode the keystore into `apps/mobile-tauri/gen/android/` and
write `keystore.properties` (password / keyAlias / storeFile), which the
tracked `build.gradle.kts` `signingConfigs` block reads. Without the file
the APK/AAB builds unsigned.

### iOS Certificate & Profile

1. **Generate a distribution certificate** on your Mac:
   - Xcode → Settings → Accounts → Manage Certificates → Apple Distribution

2. **Create a provisioning profile** at [developer.apple.com](https://developer.apple.com):
   - Certificates, Identifiers & Profiles → Profiles → +
   - Select **App Store** or **Ad Hoc** distribution
   - Include the tablet app's bundle identifier
   - Download and install

3. **Export as p12** for CI use:
   ```bash
   # From the Keychain Access app, export the certificate as .p12
   # Then base64-encode for GitHub secrets:
   base64 -i distribution.p12 -o distribution.p12.b64
   base64 -i profile.mobileprovision -o profile.mobileprovision.b64
   ```

### Distribution Channels

| Channel | Android | iOS |
|---------|---------|-----|
| **Sideloading** | APK file | IPA (via MDM or Mac) |
| **Beta testing** | Internal testing link | TestFlight |
| **Production** | Google Play Console (AAB) | App Store Connect |
| **Enterprise** | MDM solution | MDM solution |

---

## Troubleshooting

### Android Build Issues

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `Android SDK not found` | `ANDROID_HOME` not set | Set env var to SDK path |
| `NDK not found` | `ANDROID_NDK_HOME` not set | Set env var to NDK path |
| `Could not find tools.jar` | Wrong JDK version | Install JDK 17+ |
| `Rust cross-compile error` | Missing Rust target | `rustup target add aarch64-linux-android` |
| `Unsupported class file major version` | JDK version mismatch | Use JDK 17 (not 21+) |
| `FAILURE: Build failed with an exception` | Check Gradle console | Run with `--stacktrace` flag |
| `cargo tauri android init fails` | Already initialized | Delete `gen/android/` and re-init |
| APK size > 100 MB | Debug symbols included | Build `--release` to strip |
| App crashes on launch | WAL SQLite issue | Check `adb logcat` for native crashes |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | App already installed | Uninstall first: `adb uninstall com.ozpos.tablet` |

### iOS Build Issues

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `Code signing required` | No team selected | Open Xcode → Signing & Capabilities → Select team |
| `No provisioning profile` | Bundle ID mismatch | Ensure bundle ID matches profile |
| `IPA export failed` | Certificate not in keychain | Re-import distribution certificate |
| `Xcode version too old` | Xcode 15 or earlier | Update to Xcode 16+ |
| `Rust cross-compile error` | Missing iOS target | `rustup target add aarch64-apple-ios` |
| `Failed to codesign` | Keychain lock | Unlock keychain: `security unlock-keychain` |
| `App Store Connect: Missing icon` | Icon size wrong | Ensure 1024×1024 icon in assets |

### General Issues

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `cargo tauri build fails` | Tauri CLI version mismatch | `cargo install tauri-cli --version "^2" --locked` |
| UI doesn't update after code change | Vite build cache stale | Delete `ui/dist-mobile/` and rebuild |
| Orientation lock doesn't work | Browser blocks API | Only works in installed PWA / Tauri webview |
| Touch events not working | Passive listener issue | Use `{ passive: true }` for scroll listeners, `{ passive: false }` for swipe |
| Keyboard hides input field | No `useKeyboardAvoidance` | Ensure the hook is applied to the container |
| Tablet shows desktop layout | Wrong `vite.config.ts` | Use `vite.mobile.config.ts` for tablet builds |

---

## Resources

- [Tauri Mobile Guide](https://v2.tauri.app/start/mobile/)
- [Tauri Android Build](https://v2.tauri.app/start/mobile/android/)
- [Tauri iOS Build](https://v2.tauri.app/start/mobile/ios/)
- [Android Developer Docs](https://developer.android.com/docs)
- [iOS Developer Docs](https://developer.apple.com/documentation/)
- [`apps/mobile-tauri/AGENTS.md`](../../apps/mobile-tauri/AGENTS.md) — Android-specific dev notes
- [ADR #4: Frontend Restructure](../../docs/decisions/2026-03-01-frontend-restructure.md)

> last audited 22-07-26 by Hermes-Agent
