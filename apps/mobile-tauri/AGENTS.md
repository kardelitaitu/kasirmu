<!-- Audit stamp: 2026-07-22 · Hermes-Agent · status: ACCURATE (0 findings, paths/claims verified) · capabilities/mobile.json exists; Cargo.toml crate-type ["staticlib","cdylib","rlib"] matches; src/commands/ exists; tauri.conf.json has android/minSdkVersion 26; CI-on-main note matches root AGENTS.md policy · the hardcoded ANDROID_NDK_HOME path (27.0.12077973) is a local env hint, not a code-claim error · REV 2 (09-09-26, DSH docs-auditor, CI-claim pass) — status: ACCURATE AFTER REPAIR (1 finding) + 2 adjacent CI claims in the same file corrected; the older text above is kept verbatim, including the "CI-on-main note matches root AGENTS.md policy" clause, which the rev-2 note below now contradicts (root AGENTS.md has since been rewritten: dev-ci.yml has NO push trigger). Finding: the Signing section asserted "CI (android.yml / nightly.yml) decodes the base64 keystore secret into gen/android/ and writes this file" — both workflows were renamed to .bak by 23c963303 on 2026-09-02 and GitHub never executes a .bak file, so nothing does this; replaced with the retired file plus the line range where the logic still reads (.github/workflows/android.yml.bak:119-132) and the plain statement that release.yml is desktop-only (.github/workflows/release.yml:24). Also fixed: the CI notes section claimed a CI job "should" build the APK for PRs to main without saying no such job exists, and "The CI-only trigger on main push/pull_request ... feature-branch pushes skip CI" — wrong in both halves (pull_request to main + workflow_dispatch only; a main push runs nothing). Re-verified true: gen/android/app/build.gradle.kts exists and is tracked, capabilities/mobile.json exists, tauri.conf.json still carries android/minSdkVersion 26, crate-type is unchanged. Left alone: the keystore-properties format and the build/flag tables (Tauri CLI behaviour, not a repo claim I can measure here). · REV 3 (2026-09-16, DSH agents-3 lane): the rev-2 note and the Signing section both assert that root AGENTS.md was rewritten to say dev-ci.yml has NO push trigger. That is inverted: `dev-ci.yml:3-8` declares `pull_request: branches: [main]`, `push: branches: [main]` and `workflow_dispatch:`, and root AGENTS.md names this very denial as one of two false CI claims it corrected. Both prose sites are fixed; the stamp keeps rev 2 verbatim because this file preserves superseded readings. No Android, signing or build claim moved. The per-directory mirror is NOT policed: `scripts/verify-agents-mirrors.py` compares root AGENTS.md with `.agents/AGENTS.md` only ("all 2 mirrors agree"), so a green from it says nothing about this file, which is how the false note survived a correction pass. · REV 4 (2026-09-19, Android build-repair lane): three measured defects in the Prerequisites block are corrected. (a) `JAVA_HOME` pointed at Android Studio's JBR; the installed JBR is JDK **25.0.3**, which Gradle 8.14.3 cannot run on, so every `cargo tauri android dev` died at configuration with `A problem occurred configuring project ':buildSrc'. > 25.0.3` / `Caused by: java.lang.IllegalArgumentException: 25.0.3` at `JavaVersion.parse`. That was the frozen root cause of the reported failure; it is repaired by pinning JDK 21 in `HKCU\Environment` plus `org.gradle.java.home` in the non-committed `%USERPROFILE%\.gradle\gradle.properties` (verified: `gradlew help` is `BUILD SUCCESSFUL` with `JAVA_HOME` deliberately left on JBR 25). (b) `ANDROID_NDK_HOME` named `ndk\27.0.12077973`; the only NDK installed is `30.0.14904198`; the same stale `27.x` figure sat in the Prerequisites table and is corrected too. (c) the scaffold tree claimed `gen/android/` is generated and "do not commit"; `git ls-files` shows 44 tracked files and root `.gitignore:166-175` documents the committed-scaffold policy, and the real file is `settings.gradle`, not `settings.gradle.kts`. Also corrected: the bundled UI path (`../../ui/dist` → `../../ui/dist-mobile`, per `tauri.conf.json` `frontendDist`) and the restored-workflow recipe's tool versions. Left alone: the Signing and CI-trigger sections, which rev 2/3 already settled. · REV 5 (2026-09-19, build-cost lane): the Build section's two commands were both spelled `cargo tauri android build --apk` while one was labelled “Debug” — plain `--apk` is release, so the debug line was wrong and is now `--debug --apk`. Added the measured release-vs-debug cost table (26.9 MB / 1m 56s vs 152.7 MB / 14s), the note that release is unsigned without the gitignored `keystore.properties`, the incremental-packaging padding trap that made a 152.7 MB debug APK weigh 412.6 MB, and the `CARGO_BUILD_JOBS` cap (was 3 on a 32-thread CPU) that was quietly costing roughly 10×. `[profile.dev]` `debug` is now `line-tables-only` (Cargo.toml, commit 166a73133), shrinking the Android debug `.so` from 413.5 to 145.9 MB. All figures measured this pass; the CI and Signing sections were not touched. -->

# Android Development — OZ-POS Tablet

This file covers the Android build pipeline, signing, and conventions for the
`apps/mobile-tauri/` Tauri v2 mobile app.

---

## Prerequisites (one-time setup)

| Tool | Version | Install |
|------|---------|---------|
| **JDK** | **21 (pin it)** | `winget install EclipseAdoptium.Temurin.21.JDK`. **Never** Android Studio's bundled JBR — see the JBR note below. |
| **Android SDK** | 36 (platform `android-36`) | Android Studio SDK Manager |
| **Android NDK** | 30.0.14904198 | SDK Manager → SDK Tools → NDK |
| **cargo-ndk** | latest | `cargo install cargo-ndk` |
| **Rust targets** | 3 targets | `rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android` |

Set these environment variables (or add to `.env` in the project root):

```env
ANDROID_HOME=C:\Users\Dika\AppData\Local\Android\Sdk
ANDROID_NDK_HOME=C:\Users\Dika\AppData\Local\Android\Sdk\ndk\30.0.14904198
JAVA_HOME=C:\Users\Dika\AppData\Local\Programs\Java\jdk-21.0.12.1+1
```

### ⚠️ `JAVA_HOME` must be a JDK 21 — never Android Studio's JBR

The Gradle wrapper in `gen/android/` is **8.14.3**, which runs on Java 17–24.
Android Studio's bundled JBR (`C:\Program Files\Android\Android Studio\jbr`) tracks the
newest JDK and measured **25.0.3** on 2026-09-19. Studio can upgrade it mid-session, so
"release built fine an hour ago, debug fails now" is the ordinary symptom, not a regression.
On JDK 25 every Gradle invocation dies during configuration, because Gradle's embedded
Kotlin cannot parse the version string:

```
FAILURE: Build failed with an exception.
* What went wrong:
A problem occurred configuring project ':buildSrc'.
> 25.0.3

Caused by: java.lang.IllegalArgumentException: 25.0.3
    at org.jetbrains.kotlin.com.intellij.util.lang.JavaVersion.parse(JavaVersion.java:307)
```

Two guards, because the ambient `JAVA_HOME` is the unreliable part:

1. The **user-scope** `JAVA_HOME` in `HKCU\Environment` points at the JDK 21 above.
   A terminal opened *before* that change keeps the stale value — open a new one, or set
   `$env:JAVA_HOME='C:\Users\Dika\AppData\Local\Programs\Java\jdk-21.0.12.1+1'` for the current shell.
   `java -version` on `PATH` is Oracle **JDK 8** on this host, so never infer the Gradle
   JVM from `PATH`.
2. `org.gradle.java.home` in the **machine-local, never-committed**
   `%USERPROFILE%\.gradle\gradle.properties`:

   ```properties
   org.gradle.java.home=C:/Users/Dika/AppData/Local/Programs/Java/jdk-21.0.12.1+1
   ```

   This **takes precedence over** `JAVA_HOME`, so `cargo tauri android dev|build` keeps working
   regardless of what the shell or Studio exports. Verified 2026-09-19 with `JAVA_HOME` deliberately
   left on the JBR 25 path: `gradlew help` reports `BUILD SUCCESSFUL`.

---

## Initialise the Android project

Run once from this directory (`apps/mobile-tauri/`):

```bash
cargo tauri android init
```

This generates the scaffold below. **It is committed** — 44 files under
`apps/mobile-tauri/gen/android/` are tracked, and the root `.gitignore` spells out the policy
(lines 166–175): the scaffold ships so CI and contributors can build without the
Tauri CLI. Tauri only regenerates it when it is missing:
```
gen/android/
  app/build.gradle.kts
  app/src/main/AndroidManifest.xml
  app/src/main/java/mu/kasir/mobile/MainActivity.kt
  build.gradle.kts
  gradle/
  gradle.properties
  gradlew / gradlew.bat
  local.properties      ← the only path listed here that is gitignored
  settings.gradle
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
# Release APK — the default, and the one to install on a tablet (~27 MB)
cargo tauri android build --apk

# Debug APK (~153 MB) — only when you actually want a debugger attached
cargo tauri android build --debug --apk

# AAB for Google Play Store
cargo tauri android build --aab
```

Output is at `gen/android/app/build/outputs/apk/` or `.../bundle/`.

### Prefer the release APK on device

Measured 2026-09-19 on this host (16 cores / 32 threads):

| Build | APK on disk | Rust compile |
|---|---|---|
| release (`--apk`) | **26.9 MB** | 1m 56s |
| debug (`--debug --apk`) | **152.7 MB** | 14s incremental |

The gap is debug info, not code. `[profile.dev]` had `debug = true`, which put **413.5 MB** of
DWARF into `libkasirmu_mobile_lib.so`; with `debug = "line-tables-only"` it is **145.9 MB**, and
`file:line` still appears in Rust backtraces. The release profile already sets `strip = "symbols"`.

Two consequences worth knowing:

- **Release is unsigned without a keystore and will not install.** The gitignored
  `gen/android/keystore.properties` supplies the SDK debug keystore for local work — see
  “Configure signing” above.
- **Packaging is incremental, so an APK can be far larger than its contents.** After the `.so`
  shrank, a debug APK still measured 412.6 MB on disk while holding only 152.7 MB: the
  packager kept the previous entry offsets and left the difference as padding. A
  `gradlew clean` (or deleting `gen/android/app/build/outputs/apk/`) reports the true size.

### Build speed: check `CARGO_BUILD_JOBS` first

An environment `CARGO_BUILD_JOBS` silently caps cargo's parallelism. This machine had
`CARGO_BUILD_JOBS=3` set at *user* scope on a 32-thread CPU, which made every build roughly
10× slower than it needed to be — and reads as “slow machine” rather than a
misconfiguration. Check it before blaming the hardware:

```powershell
[Environment]::GetEnvironmentVariable('CARGO_BUILD_JOBS','User')   # expect nothing
```

Clear it with `[Environment]::SetEnvironmentVariable('CARGO_BUILD_JOBS',$null,'User')` and open a
new terminal. A full cold aarch64 rebuild then takes about **2m 20s** here.

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

- **`apps/mobile-tauri/tauri.conf.json`** — Android config lives in `bundle.android`
- **`apps/mobile-tauri/capabilities/mobile.json`** — Mobile-specific permissions (add Tauri plugin permissions here)
- **`apps/mobile-tauri/Cargo.toml`** — Crate type `["staticlib", "cdylib", "rlib"]` for mobile targets (already set)
- **UI** at `../../ui/dist-mobile` (the `frontendDist` in `tauri.conf.json`) is bundled into the APK by `beforeBuildCommand`
- **Rust commands** follow the same pattern as desktop (`apps/mobile-tauri/src/commands/`)

---

## CI notes (GitHub Actions)

**There is no Android CI job.** No live workflow builds an APK: the job that did
lives in the inert `.github/workflows/android.yml.bak` (retired by `23c963303`,
2026-09-02), and `dev-ci.yml#static-gates` has no Android or NDK step. So the list
below is the recipe for whoever restores the workflow, not a description of
today's CI. For PRs targeting `main`, a CI job should:

1. Install JDK 21, Android SDK 36, NDK 30
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
