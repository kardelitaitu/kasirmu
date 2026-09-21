<!-- Audit stamp: 2026-07-22 · Hermes-Agent · status: ACCURATE (0 findings, paths/claims verified) · capabilities/mobile.json exists; Cargo.toml crate-type ["staticlib","cdylib","rlib"] matches; src/commands/ exists; tauri.conf.json has android/minSdkVersion 26; CI-on-main note matches root AGENTS.md policy · the hardcoded ANDROID_NDK_HOME path (27.0.12077973) is a local env hint, not a code-claim error · REV 2 (09-09-26, DSH docs-auditor, CI-claim pass) — status: ACCURATE AFTER REPAIR (1 finding) + 2 adjacent CI claims in the same file corrected; the older text above is kept verbatim, including the "CI-on-main note matches root AGENTS.md policy" clause, which the rev-2 note below now contradicts (root AGENTS.md has since been rewritten: dev-ci.yml has NO push trigger). Finding: the Signing section asserted "CI (android.yml / nightly.yml) decodes the base64 keystore secret into gen/android/ and writes this file" — both workflows were renamed to .bak by 23c963303 on 2026-09-02 and GitHub never executes a .bak file, so nothing does this; replaced with the retired file plus the line range where the logic still reads (.github/workflows/android.yml.bak:119-132) and the plain statement that release.yml is desktop-only (.github/workflows/release.yml:24). Also fixed: the CI notes section claimed a CI job "should" build the APK for PRs to main without saying no such job exists, and "The CI-only trigger on main push/pull_request ... feature-branch pushes skip CI" — wrong in both halves (pull_request to main + workflow_dispatch only; a main push runs nothing). Re-verified true: gen/android/app/build.gradle.kts exists and is tracked, capabilities/mobile.json exists, tauri.conf.json still carries android/minSdkVersion 26, crate-type is unchanged. Left alone: the keystore-properties format and the build/flag tables (Tauri CLI behaviour, not a repo claim I can measure here). · REV 3 (2026-09-16, DSH agents-3 lane): the rev-2 note and the Signing section both assert that root AGENTS.md was rewritten to say dev-ci.yml has NO push trigger. That is inverted: `dev-ci.yml:3-8` declares `pull_request: branches: [main]`, `push: branches: [main]` and `workflow_dispatch:`, and root AGENTS.md names this very denial as one of two false CI claims it corrected. Both prose sites are fixed; the stamp keeps rev 2 verbatim because this file preserves superseded readings. No Android, signing or build claim moved. The per-directory mirror is NOT policed: `scripts/verify-agents-mirrors.py` compares root AGENTS.md with `.agents/AGENTS.md` only ("all 2 mirrors agree"), so a green from it says nothing about this file, which is how the false note survived a correction pass. · REV 4 (2026-09-19, Android build-repair lane): three measured defects in the Prerequisites block are corrected. (a) `JAVA_HOME` pointed at Android Studio's JBR; the installed JBR is JDK **25.0.3**, which Gradle 8.14.3 cannot run on, so every `cargo tauri android dev` died at configuration with `A problem occurred configuring project ':buildSrc'. > 25.0.3` / `Caused by: java.lang.IllegalArgumentException: 25.0.3` at `JavaVersion.parse`. That was the frozen root cause of the reported failure; it is repaired by pinning JDK 21 in `HKCU\Environment` plus `org.gradle.java.home` in the non-committed `%USERPROFILE%\.gradle\gradle.properties` (verified: `gradlew help` is `BUILD SUCCESSFUL` with `JAVA_HOME` deliberately left on JBR 25). (b) `ANDROID_NDK_HOME` named `ndk\27.0.12077973`; the only NDK installed is `30.0.14904198`; the same stale `27.x` figure sat in the Prerequisites table and is corrected too. (c) the scaffold tree claimed `gen/android/` is generated and "do not commit"; `git ls-files` shows 44 tracked files and root `.gitignore:166-175` documents the committed-scaffold policy, and the real file is `settings.gradle`, not `settings.gradle.kts`. Also corrected: the bundled UI path (`../../ui/dist` → `../../ui/dist-mobile`, per `tauri.conf.json` `frontendDist`) and the restored-workflow recipe's tool versions. Left alone: the Signing and CI-trigger sections, which rev 2/3 already settled. · REV 5 (2026-09-19, build-cost lane): the Build section's two commands were both spelled `cargo tauri android build --apk` while one was labelled “Debug” — plain `--apk` is release, so the debug line was wrong and is now `--debug --apk`. Added the measured release-vs-debug cost table (26.9 MB / 1m 56s vs 152.7 MB / 14s), the note that release is unsigned without the gitignored `keystore.properties`, the incremental-packaging padding trap that made a 152.7 MB debug APK weigh 412.6 MB, and the `CARGO_BUILD_JOBS` cap (was 3 on a 32-thread CPU) that was quietly costing roughly 10×. `[profile.dev]` `debug` is now `line-tables-only` (Cargo.toml, commit 166a73133), shrinking the Android debug `.so` from 413.5 to 145.9 MB. All figures measured this pass; the CI and Signing sections were not touched. · REV 6 (2026-09-20, Android production-readiness lane): three defects in the existing scaffold repaired (`a12f64085` — BACK button finishing the activity because `TauriActivity.kt:35` sets `handleBackNavigation=false`; missing `windowSoftInputMode`; dead `activity_main.xml`). All three survived R8 in the release APK (`45117508ff5eb74a2999287f2b7d311d`, 104.7 MB) and the back-button guard was confirmed on-device (screenshot 24). The Vite tablet dev config (`f1a1a2cec`) now binds to `'0.0.0.0'` (string — the boolean `true` triggers `getaddrinfo ENOTFOUND true` in Vite 6) so the device can reach the host's LAN IP that `cargo tauri android dev` auto-detects. A new prerequisite subsection above documents the per-process `TMP`/`TEMP`/`TMPDIR` fix for the WebSocket-RPC race in `tauri-cli-2.11.4/src/mobile/mod.rs:343-403`: Tauri's CLI writes its WS server's bound port to `<temp>/<identifier>-server-addr` and Gradle's `cargo-tauri-bin` wrapper connects back to it — two concurrent `cargo tauri android` invocations on the same host clobber each other and Gradle's `:rustBuildArm64Debug` panics with `code 10061 ConnectionRefused`. Set `TMP=/tmp/tauri-cli-$$` (plus `TEMP`/`TMPDIR`) and Tauri's full pipeline runs end-to-end. Verified on 2026-09-20 against a Redmi Pad SE: `cargo tauri android dev --no-dev-server-wait -c '{"build":{"beforeDevCommand":""}}'` reached `Performing Streamed Install / Success` in ~95s, and the WebView's logcat showed `[vite] connecting...` plus `http://192.168.0.168:1422/...` asset requests (asset fetch is AP-isolated on the test tablet's WiFi — network config, not code). The Signing, Build-cost, and CI sections are unchanged. · REV 7 (2026-09-20, Android shell audit lane): the Build cost table did not name its command or its ABI set, and they are not the same command. Both figures are single-ABI (arm64) — the release column proves it, 26.9 MB matching the 25.8 MB arm64 `.so` plus packaging, where the four-ABI universal release APK is 104,737,268 B (the artifact REV 6 recorded at 104.7 MB) — while the commands the table sits under pass no `--target` and build all four ABIs. The table now says so, and adds the four-ABI debug cost (the four debug `.so` sum to 577,077,264 B; APK ~583 MB per `docs/records/2026-09-20-audit-android-shell.md` H5). The 26.9 MB / 152.7 MB figures are not re-measured here, only qualified. No Build, Signing or CI claim moved. -->

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

0. **Automated:** `bash scripts/android-preflight.sh` (added 2026-09-20) checks all of
   this before a build — Gradle-JVM precedence (`org.gradle.java.home` pin over
   `JAVA_HOME`, matching Gradle), `ANDROID_HOME`/`ANDROID_NDK_HOME`, the
   `aarch64-linux-android` rust target, `cargo-ndk`, a `CARGO_BUILD_JOBS` cap at
   process *or* user scope, and the shared-`%TEMP%` advisory — and exits 1 with the
   remediation on any fatal miss. Run it before `cargo tauri android build|dev`.
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

### ⚠️ `TMP` must be a REAL Windows dir — a POSIX path breaks sccache

`~/.cargo/config.toml` on this host sets `build.rustc-wrapper = "sccache"`, so
**every** `rustc` call is wrapped. sccache creates a per-compile temp directory
*under `TMP`*, and if that path is not creatable it fails the whole build with a
message that does not name the wrapper:

```
sccache: encountered fatal error
sccache: error: Failed to create temp dir
sccache: caused by: The system cannot find the path specified. (os error 3)
          at path "C:\Users\<user>\AppData\Local\Temp\tauri-cli-<pid>\sccacheXXXXXX"
  ... exit code: 0xfffffffe
```

**Two distinct traps**, both hit on 2026-09-22 while verifying the ADR #57
fingerprint read:

1. **Do not set `TMP=/tmp/...` on Windows.** The per-process recipe above is
   written for Git-bash, where `/tmp` resolves for *shell* commands — but the
   native `sccache.exe` receives the literal string and cannot create it. Use a
   real path, e.g. `TMP=C:\dev\ozpos\.tmp-build` (created first).
2. **A failure POISONS every later build until the daemon is killed.** sccache
   runs a persistent server that keeps the environment it was first started
   with, so after one bad run every subsequent `cargo tauri android build` fails
   with the *same stale* `tauri-cli-<old-pid>` path no matter how the calling
   shell is fixed:

   ```powershell
   Get-Process sccache | Stop-Process -Force   # then rebuild
   ```

   The stale `tauri-cli-<pid>` directory it names will not exist on disk, which
   is the tell that you are looking at a leftover daemon rather than a bad path
   in the current shell.

Setting `RUSTC_WRAPPER=` in the shell does **not** help: the wrapper comes from
`config.toml`, not the environment.

### ⚠️ Set `TMP` / `TEMP` / `TMPDIR` to a per-process dir (avoids the WebSocket RPC race)

Tauri 2's CLI starts a WebSocket server on `127.0.0.1:<random>` and writes the
bound port to `<temp>/<identifier>-server-addr` (the tempfile path is computed
from `std::env::temp_dir()` at `tauri-cli-2.11.4/src/mobile/mod.rs:343-372`).
Gradle's `rust` plugin then calls a `cargo-tauri-bin` wrapper that reads that
file and connects back to the parent Tauri CLI process for options
(`mobile/mod.rs:395-403`). On Windows, `temp_dir()` reads `TMP` then `TEMP` —
both default to `C:\Users\<user>\AppData\Local\Temp`, which is **shared by
every process on the host**. Two concurrent `cargo tauri android` invocations
(across peer agents, multi-shell sessions, or just two tabs) will clobber each
other's addr file and Gradle's `:rustBuildArm64Debug` will panic with:

```
thread 'main' panicked at .../tauri-cli-2.11.1/src/mobile/mod.rs:403:6:
failed to read CLI options: Context("failed to build WebSocket client",
  Io(Os { code: 10061, kind: ConnectionRefused, ... }))
```

The fix is one line — point `TMP`/`TEMP`/`TMPDIR` at a per-process dir:

```bash
export TMP=/tmp/tauri-cli-$$  TEMP=$TMP  TMPDIR=$TMP
cargo tauri android build --apk       # or: cargo tauri android dev
```

Verified 2026-09-20 against a Redmi Pad SE: with the shared `TMP`, release
builds intermittently failed the same way; with the per-process `TMP`,
`cargo tauri android dev --no-dev-server-wait -c
'{"build":{"beforeDevCommand":""}}'` ran end-to-end (Rust 41.81s, Gradle
7.74s, install + launch) and `logcat` showed the WebView hit
`http://192.168.0.168:1422/node_modules/.vite/deps/react.js` (i.e. dev
mode reached the asset fetch step).

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
`.github/workflows/*.bak` — GitHub never executes a `.bak` file, so no pipeline
decodes the base64 keystore secret or writes this file today. Those backups were
then moved out of the live directory by `54f64de83` (`chore(ci): move retired
workflow backups into attic/`, 2026-09-18), which left `.github/workflows/` holding
only the two workflows GitHub actually runs. **The paths below were corrected
2026-09-22 — they had pointed at `.github/workflows/android.yml.bak`, which no
longer exists, so a reader following them found nothing.**

The decode logic is readable in the attic copy
(`.github/workflows/attic/android.yml.bak:119-129` — corrected from `:119-132`,
which over-ran the block: base64 -d into `oz-pos-release.keystore` at `:126`, then
`keyAlias`/`password`/`storeFile` appended to `keystore.properties` at `:127-129`,
from the `ANDROID_KEYSTORE_BASE64` / `KEY_ALIAS` / `KEYSTORE_PASSWORD` secrets). The only live workflows are `dev-ci.yml` (PR to
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

**Read both figures as single-ABI (arm64), which is not what the commands above produce.** They
pass no `--target`, so they build the `universal` flavor across all four ABIs; the numbers here
came from the `--target aarch64` path that `docs/guides/android-install-test.md` and
`scripts/android-cdp.mjs` use, which narrows `abiList` to `arm64-v8a`. The release column proves
it: 26.9 MB matches the 25.8 MB arm64 `.so` plus packaging, whereas the four-ABI
`apk/universal/release/app-universal-release.apk` measured 2026-09-20 is **104,737,268 B** and
ships `arm64-v8a`, `armeabi-v7a`, `x86` and `x86_64`. A four-ABI *debug* APK is far larger again —
the four debug `.so` under `target/` sum to 577,077,264 B, and the audit records the resulting APK
at ~583 MB (`docs/records/2026-09-20-audit-android-shell.md`, H5). Add `--target aarch64` to either
command to reproduce the table.

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
lives in the inert `.github/workflows/attic/android.yml.bak` (retired by
`23c963303` on 2026-09-02, then moved into `attic/` by `54f64de83`; the old
`.github/workflows/android.yml.bak` path cited here until 2026-09-22 no longer
exists), and `dev-ci.yml#static-gates` has no Android or NDK step. So the list
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
