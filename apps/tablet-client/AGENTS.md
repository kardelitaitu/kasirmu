<!-- Audit stamp: 2026-07-22 · Hermes-Agent · status: ACCURATE (0 findings, paths/claims verified) · capabilities/mobile.json exists; Cargo.toml crate-type ["staticlib","cdylib","rlib"] matches; src/commands/ exists; tauri.conf.json has android/minSdkVersion 26; CI-on-main note matches root AGENTS.md policy · the hardcoded ANDROID_NDK_HOME path (27.0.12077973) is a local env hint, not a code-claim error · REV 2 (09-09-26, DSH docs-auditor, CI-claim pass) — status: ACCURATE AFTER REPAIR (1 finding) + 2 adjacent CI claims in the same file corrected; the older text above is kept verbatim, including the "CI-on-main note matches root AGENTS.md policy" clause, which the rev-2 note below now contradicts (root AGENTS.md has since been rewritten: dev-ci.yml has NO push trigger). Finding: the Signing section asserted "CI (android.yml / nightly.yml) decodes the base64 keystore secret into gen/android/ and writes this file" — both workflows were renamed to .bak by 23c963303 on 2026-09-02 and GitHub never executes a .bak file, so nothing does this; replaced with the retired file plus the line range where the logic still reads (.github/workflows/android.yml.bak:119-132) and the plain statement that release.yml is desktop-only (.github/workflows/release.yml:24). Also fixed: the CI notes section claimed a CI job "should" build the APK for PRs to main without saying no such job exists, and "The CI-only trigger on main push/pull_request ... feature-branch pushes skip CI" — wrong in both halves (pull_request to main + workflow_dispatch only; a main push runs nothing). Re-verified true: gen/android/app/build.gradle.kts exists and is tracked, capabilities/mobile.json exists, tauri.conf.json still carries android/minSdkVersion 26, crate-type is unchanged. Left alone: the keystore-properties format and the build/flag tables (Tauri CLI behaviour, not a repo claim I can measure here). · REV 3 (2026-09-16, DSH agents-3 lane): the rev-2 note and the Signing section both assert that root AGENTS.md was rewritten to say dev-ci.yml has NO push trigger. That is inverted: `dev-ci.yml:3-8` declares `pull_request: branches: [main]`, `push: branches: [main]` and `workflow_dispatch:`, and root AGENTS.md names this very denial as one of two false CI claims it corrected. Both prose sites are fixed; the stamp keeps rev 2 verbatim because this file preserves superseded readings. No Android, signing or build claim moved. The per-directory mirror is NOT policed: `scripts/verify-agents-mirrors.py` compares root AGENTS.md with `.agents/AGENTS.md` only ("all 2 mirrors agree"), so a green from it says nothing about this file, which is how the false note survived a correction pass. -->

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

**Nothing does this in CI any more.** It used to be done by the `android.yml`
and `nightly.yml` workflows, which `23c963303` renamed on 2026-09-02 to
`.github/workflows/android.yml.bak` and `.github/workflows/nightly.yml.bak` —
GitHub never executes a `.bak` file, so no pipeline decodes the base64 keystore
secret or writes this file today. The decode logic is still readable in that inert
file (`.github/workflows/android.yml.bak:119-132`: base64 -d into
`oz-pos-release.keystore`, then `keyAlias`/`password`/`storeFile` written to
`keystore.properties` from the `ANDROID_KEYSTORE_BASE64` / `KEY_ALIAS` /
`KEYSTORE_PASSWORD` secrets). The only live workflows are `dev-ci.yml` (PR to
`main`, a push to `main` and `workflow_dispatch`, three events re-read from
`dev-ci.yml:3-8`) and `release.yml` (`v*` tags), and `release.yml` is
desktop-only by design — its own header at `.github/workflows/release.yml:24`
lists "Mobile (`android.yml.bak` / `ios.yml.bak`). Never part of this file." So
restoring an Android release build means writing a workflow again; until then,
signing is local: create `gen/android/keystore.properties` yourself.

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

**There is no Android CI job.** No live workflow builds an APK: the job that did
lives in the inert `.github/workflows/android.yml.bak` (retired by `23c963303`,
2026-09-02), and `dev-ci.yml#static-gates` has no Android or NDK step. So the list
below is the recipe for whoever restores the workflow, not a description of
today's CI. For PRs targeting `main`, a CI job should:

1. Install JDK 17, Android SDK 34, NDK 27
2. `rustup target add aarch64-linux-android`
3. `cargo install cargo-ndk`
4. Decode keystore from `${{ secrets.ANDROID_KEYSTORE_BASE64 }}`
5. `cargo tauri android build --apk --target aarch64`
6. Upload APK as an artifact

Trigger note (corrected 09-09-26; **corrected again 2026-09-16**): what the 09-09-26
fix got right is its last clause — a feature-branch push runs nothing until a
PR is opened. What it got wrong it asserted twice over, and it then pointed at the root
file for agreement the root file does not give: `dev-ci.yml:3-8` declares
`pull_request: branches: [main]`, `push: branches: [main]` and `workflow_dispatch:`, so
there IS a push trigger, a push to `main` does run CI, and per the comment at
`dev-ci.yml:662-663` such a push also deploys: the `if:` condition on
`northflank-deploy` at `dev-ci.yml:695` matches `github.event_name` equal to
`push` on `refs/heads/main`. Re-derive with
`sed -n 3,8p` on that file. What a PR gates is the merge, not the validation.

> last audited 09-09-26 by docs-auditor
