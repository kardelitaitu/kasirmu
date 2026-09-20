---
name: android-apk-build
description: Build, sign and install the kasir.mu tablet app (apps/mobile-tauri, package mu.kasir.mobile) on a real Android device, and connect to it over wireless ADB. Use when running cargo tauri android build or android dev; when the build dies with "The PATHEXT environment variable isn't set"; when beforeBuildCommand fails with "Could not read package.json"; when the Vite mobile build reports it cannot load a .ftl file; when the produced APK is unsigned and refuses to install; when adb install returns INSTALL_FAILED_USER_RESTRICTED; when adb devices is empty while adb mdns services still advertises the device; when the app opens to a blank black screen; when the WebView shows "Failed to request http://LAN-IP:1422/"; or when the launcher icon is cropped or cut off on the home screen; or when the Android build appears to
hang long after the APK has already been written.
---

<!-- Audit stamp: 2026-09-19 · Budak-Korporat · status: ACCURATE · Derived from a full build/install/debug cycle on 2026-09-19 against the Redmi 23073RPBFG. Verified this pass: a signed release APK installed over wireless ADB (adb install -r → Success, lastUpdateTime advanced) and launched to mu.kasir.mobile/.MainActivity with no FATAL in logcat; aapt2 dump badging reports package mu.kasir.mobile and application-label Kasir.mu; the mobile entry is index.mobile.html and the vite.mobile.config.ts alias plugin is present; the SDK/NDK/build-tools/JDK paths below resolved on this host; both wireless-ADB failure modes were reproduced and the re-pairing recovery confirmed. The MIUI install-gate claim was corrected this pass — it is not absolute. · Pass 2 (2026-09-19, Android build-repair lane): the JBR/JDK-25 trap in §1 was already correct and was re-confirmed end to end — the frozen failing command was reproduced (`> 25.0.3` from `JavaVersion.parse` while configuring `buildSrc`) and then repaired, and the durable `org.gradle.java.home` pin — which this skill did not previously mention — was added and verified against a deliberately hostile `JAVA_HOME`. New section added for the `:app:rustBuildArm64Debug` / `command 'cargo.bat'` decoy: its cause in `BuildTask.kt` rethrowing only the last fallback exception, and the verified stale-daemon remedy. A full debug APK built twice consecutively after the repair. Versions re-measured this pass: JDK 21.0.12.1+1, Android Studio JBR 25.0.3, NDK 30.0.14904198, build-tools 37.0.0, platform android-36, wrapper Gradle 8.14.3. · Pass 3 (2026-09-19, same lane, end-to-end `dev`): a full `cargo tauri android dev` against the Redmi 23073RPBFG was driven to completion — device auto-detected (aarch64), Rust compiled, Gradle assembled `apk/arm64/debug/app-arm64-debug.apk` (420.7 MB), and the app then installed, launched, became the focused activity and rendered the real UI (a 2 063 599-byte screenshot with 9 228 distinct colours, brand green ≈#495A30) with no FATAL. Two new traps recorded from that run: a hand-started `npm run dev:mobile` binds loopback only, because `ui/vite.mobile.config.ts:107` is `host: host || false` and only `cargo tauri android dev` sets `TAURI_DEV_HOST` (this is now Cause 3 of the blank-screen section); and the MIUI install gate is flaky rather than absolute (§4). Also recorded: `screencap` returns pure black while `Display State=OFF`, which coexists with `mWakefulness=Awake` and is easily mistaken for an app failure. The two earlier passes' claims were re-confirmed, none contradicted. · Pass 4 (2026-09-20, build-hang lane): the §8 note "the build process hangs after the artifact is already complete" was **wrong in its diagnosis** and is replaced. The build never hangs — Gradle marks its daemon idle at the exact APK mtime — it is the **background wrapper** that never completes, because it waits for its captured stdout to reach EOF and the build's surviving descendants (`rustup.exe`, `cargo.exe`, and the `sccache` server that `.cargo/config.toml`'s `rustc-wrapper` starts) inherited the write end. Isolated by a controlled A/B with no Rust involved, and the fix — redirect stdout to a file, stdin from `/dev/null` — was verified end to end (started 08:13:11, `EXITCODE:0`, `END 08:15:44`, 153 s, notification delivered normally). Also added: the `.so`-md5 staleness check, which showed a nine-commits-behind HEAD did **not** make the APK stale. · Pass 5 (2026-09-20, rebuild-hygiene lane): the §8 recipe turned out to be executable only from `apps/mobile-tauri` **and** with the §1 env exports, and it stated neither. Reproduced both failures two seconds apart: from the repo root `cargo tauri` falls back to `apps/desktop-tauri` (there is no root `tauri.conf.json`) and dies with `Android Studio project directory C:\dev\ozpos\apps\desktop-tauri\gen/android doesn't exist` — whose `tauri android init` advice is a decoy, since that directory is not supposed to exist and only `apps/mobile-tauri` has an Android project; from the correct directory without the exports it dies with the `PATHEXT` error instead. The recipe now carries the `cd`, the exports and `pwd` in the log header. Also narrowed the `touch apps/mobile-tauri/src/lib.rs` workaround: it is a **fallback for a frontend-only change**, because `generate_context!` reads `frontendDist` at compile time and a cached `.so` would otherwise carry the old bundle — verified that a build whose log shows `Compiling kasirmu-mobile` re-embeds without the `touch`, so the tell is whether the log reaches Gradle with `Compiling` lines or without them. And located the Gradle JDK pin precisely: it is `~/.gradle/gradle.properties:21` in the **user-global** config, not the tracked `apps/mobile-tauri/gen/android/gradle.properties`, which has no such line. · Pass 6 (2026-09-20, frontend-embedding lane): **`cargo tauri android build`
does not run `build.beforeBuildCommand`**, even though `src/mobile/android/build.rs`'s own `--help` text
claims it does — measured against tauri-cli 2.11.4, `run_hook` appears 0 times anywhere under
`src/mobile/` and once in `src/build.rs`, the desktop path. `build.frontendDist` is therefore embedded
exactly as it lies on disk: a build that produced a fresh APK at 11:16:09 embedded a `ui/dist-mobile/`
still dated 10:42:31, i.e. two commits stale, and its md5 *did* change only because a peer's Rust edits
had landed. New subsection records the explicit prebuild and the bundle check that catches it; also
recorded there: a release APK cannot be grepped for a frontend string (the bundle is brotli-compressed
inside the native library, so a plaintext grep returns 0 even when the change IS embedded), the library
is `libkasirmu_mobile_lib.so`, and minifiers strip the space from a media query so
`orientation: landscape` must be grepped as `orientation:landscape`. Also recorded: the recovery for a
build that was piped through `tail` instead of handed a log file — the APK is complete, `apksigner
verify` is what separates written from half-written, and **killing the stalled wrapper also kills the
sccache server**, so the next build dies with `os error 10054` reported as `could not compile
kasirmu-core` and needs a plain re-run. · Pass 7 (2026-09-20, Android audit lane): **the Pass-6 claim that `cargo tauri android build` never runs `build.beforeBuildCommand` was WRONG, and the section it heads is corrected in place.** The grep it rested on (`run_hook` 0 times under `src/mobile/`) is a false negative — the call is in the shared `crate::build::setup`, which `src/mobile/android/build.rs:197` invokes with `mobile = true`. Re-measured two ways: 2.11.4's source (`src/build.rs:187-196`, inside `setup`) and a real `cargo tauri android build --apk --target aarch64` on the installed 2.11.1, whose log printed `Running beforeBuildCommand` and advanced `ui/dist-mobile/index.html` mtime 11:32:18 -> 12:27:04 inside the build. The corrected section keeps the hazard that IS real (a gitignored dist plus a Gradle/Studio-driven `cargo`, which has no hook) and records the other defect this lane found: `apps/mobile-tauri/build-android-frontend.bat` ran the DESKTOP build (`ui/dist`) — a filename that promises the Android frontend and prepared an artifact no Android build reads, and the likeliest source of the `10:42:31` figure the old text cited. · Pass 8 (2026-09-20, device-verification lane): the §8 `adb pull` note was upgraded from a LOUD failure to a SILENT one. Reproduced: a pull reported success (28 330 571 B written) while the shell hashed a stale 10:22 file of 28 188 739 B sitting at the POSIX path, and the conclusion drawn from it — "the installer rewrote the `.so`, so my change is not on the device" — was false, the `.so` delta being exactly that shortfall. The device's own `base.apk` md5'd identically to the artifact (`ff1b1eb3…`), and the installed `.so` was then confirmed by content to carry this lane's frontend (`index-BIAs4Zbr.css`, `SetupWizard-D4zMuoUQ.css`) plus a peer's `link_device_google`. The section now prefers `adb shell md5sum` over any pull. Also verified on hardware this pass: the immersive `MainActivity` (`statusBars` and `navigationBars` both `visible=false` in `dumpsys window`, in BOTH orientations) and the setup wizard's landscape layout (presets three-up plus a right-hand `Feature Preview` column) against portrait (two-up, panel stacked below) — a genuine DOM re-layout on rotation, not just a CSS query flip. Pass 7's refutation of this lane's own Pass-6 claim about the frontend hook stands and was NOT re-litigated; note also that this lane's build passed `beforeBuildCommand: null` explicitly, which is why its log shows no `Running beforeBuildCommand`. Also added the §8 credential caveat: `check_username` is a deliberate non-oracle, so a username advancing to the PIN pad proves the flow runs and NOT that an account exists — `1234` was rejected and there is no credential to be found on the device, which is what makes anything behind the login unreachable on a fresh install. · -->

# Android build, sign, install and wireless ADB

App dir `apps/mobile-tauri`, package **`mu.kasir.mobile`**. The device proven so
far is a Redmi `23073RPBFG` — arm64-v8a, Android 15 / API 35 — so `--target aarch64` and `minSdk 26`
both hold. A full first build is about 15 minutes (the Rust cross-compile dominates); run it in the
background.

---

## 1. Environment: Git Bash, with the Windows vars exported

> **Preflight first (added 2026-09-20):** run `bash scripts/android-preflight.sh`
> (repo root, via Git's bash) before any `cargo tauri android build|dev`. It fails
> fast with the remediation on the traps this section and §2 describe: unset
> `PATHEXT`, a Gradle JVM that is not JDK 21 (it validates the
> `org.gradle.java.home` pin over `JAVA_HOME` in Gradle's own precedence order),
> missing `ANDROID_HOME`/`ANDROID_NDK_HOME`, a missing `aarch64-linux-android`
> rust target, a `CARGO_BUILD_JOBS` cap, and the shared-`%TEMP%` race.

Git Bash does not surface `PATHEXT`, `SystemRoot`, `COMSPEC`, `APPDATA`, `ProgramFiles` or
`ProgramData`. Without `PATHEXT`, Tauri dies in two seconds with "The `PATHEXT` environment variable
isn't set, which is quite weird" — which looks like a broken SDK and is not one.

```bash
export PATHEXT='.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC'
export SystemRoot='C:\WINDOWS';  export COMSPEC='C:\WINDOWS\system32\cmd.exe'
export ProgramData='C:\ProgramData'; export APPDATA='C:\Users\<you>\AppData\Roaming'
export ProgramFiles='C:\Program Files'
export JAVA_HOME='C:\Users\<you>\AppData\Local\Programs\Java\jdk-21.0.12.1+1'
export ANDROID_HOME='C:\Users\<you>\AppData\Local\Android\Sdk'
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export ANDROID_NDK_HOME="$ANDROID_HOME\ndk\30.0.14904198"
cd /c/dev/ozpos/apps/mobile-tauri
cargo tauri android build --apk --target aarch64
```

Nothing else needs installing on a machine with Android Studio: SDK is `%LOCALAPPDATA%\Android\Sdk`,
NDK `30.0.14904198`, build-tools 37.0.0. Verify before assuming otherwise.

**The `PATH` export does not put the SDK `adb` on `PATH`.** `$ANDROID_HOME` holds a Windows `C:\…`
value and bash splits `PATH` on `:`, so the entry is malformed and silently ignored — `which adb`
resolves to a standalone `/c/adb/adb` (31.0.3), not the SDK's 37.0.0. When the version matters (pairing
especially) call `"$ANDROID_HOME/platform-tools/adb.exe"` by full path.

**Do not use Android Studio's JBR as `JAVA_HOME`.** It is not stable — measured 2026-09-19 at 21.0.10
in the morning and 25.0.3 by afternoon, upgraded mid-session by Studio. Gradle's bundled Kotlin cannot
parse the JDK 25 version string, so every build dies at configuration with
`java.lang.IllegalArgumentException: 25.0.3` from `JavaVersion.parse`. That is the whole explanation
for "release built fine an hour ago, debug fails now" on identical commands. Re-measure `java -version`
at the start of every session and pin a JDK 21 (AGP needs 17+, and 21 is the safe ceiling).

**Pin it in Gradle, not only in the shell.** `JAVA_HOME` alone is not enough: a terminal opened
before the variable was set keeps the stale value, and Studio re-points its JBR whenever it updates.
`org.gradle.java.home` **takes precedence over** `JAVA_HOME`, so put it in the machine-local,
never-committed `%USERPROFILE%\.gradle\gradle.properties`:

```properties
org.gradle.java.home=C:/Users/<you>/AppData/Local/Programs/Java/jdk-21.0.12.1+1
```

Verified 2026-09-19: with `JAVA_HOME` deliberately left on the JBR 25 path, `gradlew help` returns
`BUILD SUCCESSFUL`. Do **not** put this line in the tracked `gen/android/gradle.properties` — it
holds an absolute path and would break every other machine.

`java` on `PATH` is Oracle **JDK 8** on this host (`…Common Files\Oracle\Java\java8path`),
so `PATH` tells you nothing about the JVM Gradle actually uses.

`cargo tauri info` prints **no Android environment section** even when SDK and NDK are correct — its
absence is not evidence of a broken setup.

---

## 2. Build-side traps

- **`beforeBuildCommand`/`beforeDevCommand` in the app's `tauri.conf.json` use `--prefix ../ui`, not
  `../../ui`.** Tauri runs those shell commands from the app's parent (`apps/`), so `../../ui` resolves
  to `C:\dev\ui` and dies "Could not read package.json". **`frontendDist` is the opposite** — it
  resolves relative to the app dir and keeps `../../ui`. Do not "make them consistent".
- **The alias block in `ui/vite.mobile.config.ts` must be the array + regex form.** With the object
  shorthand a string key is tested as `importee.startsWith(key + '/')`, so `'@/locales/'` becomes
  `'@/locales//'` and never matches; the generic `@` entry then swallows it and every `?raw` import
  resolves to the old in-`ui` locales directory, which does not exist (the corpus is `shared-ui/locales/`
  after P9a). Failure: `[vite:asset] Could not load …shared.ftl?raw`. `ui/vite.config.ts` uses the regex
  form — keep both in step.

### A blank screen: three unrelated causes, rule them out in order

**Cause 1 — the webview root had nothing to serve.** Tauri resolves the webview root to `index.html`, hardcoded and reused as the 404 fallback. The mobile
build's entry is `index.mobile.html`, and the mobile build script emits only that — nothing emits
`index.html`. The desktop build is unaffected because its entry already is `index.html`.
`scripts/check-bundle.mjs` accepts either basename and prefers `index.html`, so an alias does not
disturb the budget gate. `ui/vite.mobile.config.ts` carries a plugin that serves the entry at `/` in dev
and emits an `index.html` alias at build; **`enforce: 'post'` is required**, because the HTML asset is
emitted from `vite:build-html`'s own `generateBundle`, which runs after normal user plugins — without
it the alias is silently never written and the build still exits 0.

**Cause 2 — no window was declared, so no webview was ever created (measured 2026-09-19).** A blank
*black* screen with the status bar painted, an app process that is alive and emits no chromium lines,
and an activity whose content view is **empty** (`uiautomator dump` shows no `WebView` node;
`dumpsys activity top` shows `android:id/content` with no child) means the webview was never created —
not that one failed to load. `tauri.conf.json` `app.windows` is the list of windows built **at
startup**: the `tauri` crate's `App::setup` iterates it with no platform gate and no mobile fallback,
and the Android `wryCreate` JNI entry only installs a main-pipe listener. So `"windows": []` — which
looks plausible for mobile — yields zero webviews on Android and the window stays black. The tell is
`capabilities/*.json`: capabilities scope permissions by window label (`"windows": ["main"]`), so a
capability file naming a window the config never declares is the inconsistency. The entry needs
`"useHttpsScheme": true` for desktop parity, and **that is load-bearing, not cosmetic**: wry's
`is_work_around_uri` matches the scheme strictly, while the CSP carries `upgrade-insecure-requests`, so
an `http`-origin document would rewrite every asset URL to `https://tauri.localhost/…` that an
`http`-configured interceptor never matches — the assets would not load. The CSP already naming
`https://asset.localhost` is the giveaway that `https` was intended.

**Cause 3 — the dev server bound to loopback, so the tablet cannot reach it (measured 2026-09-19).**
A `dev` build loads `build.devUrl`, whose host the CLI rewrites to this machine's LAN address
(`http://192.168.0.168:1422`). But `ui/vite.mobile.config.ts:107` is `host: host || false`, where
`host = process.env.TAURI_DEV_HOST` — so **without `TAURI_DEV_HOST` Vite binds `localhost`, which on Windows is
`::1` alone**, and nothing is reachable from the tablet. `cargo tauri android dev` sets
`TAURI_DEV_HOST` itself (it is persisted nowhere on this host), so the CLI's own frontend server is fine;
one you start by hand with `npm run dev:mobile` is not.

Diagnose from the tablet, not the PC:

```bash
adb shell 'curl -s -m 8 -o /dev/null -w %{http_code} http://192.168.0.168:1422/'
```

`200` means it can reach the server; `000` means it cannot. Confirm which interface is bound with
`Get-NetTCPConnection -LocalPort 1422 -State Listen`: a `::1`-only row is the broken case, a
`192.168.0.168` row is the good one. `strictPort: true` means a stray server on the port makes the
CLI's own Vite **fail** rather than fall back to another port, so stop any hand-started server first. Fix:
`TAURI_DEV_HOST=192.168.0.168 npm run dev:mobile`, or simply let `cargo tauri android dev` own the server.

**A black screenshot usually means the panel is off, not that the app is broken.** `screencap` returns a
pure-black frame whenever the display is off, so read `dumpsys display` (`Display State=ON/OFF`) and
`dumpsys window policy` (`showing=`, the keyguard) before drawing any conclusion — and note that
`mWakefulness=Awake` can coexist with `Display State=OFF`. A locked device cannot be unlocked from
adb when the user has a credential set; ask for it rather than interpreting black as a failure.

**Changing the frontend does not re-embed it.** Neither `tauri-build` nor `tauri-codegen` emits
`cargo:rerun-if-changed` for `frontendDist`, so Cargo sees no reason to recompile and the APK keeps the
old assets. After any frontend change, force it — `touch apps/mobile-tauri/src/lib.rs` — before building.

### `Failed to request http://<lan-ip>:1422/` — the installed APK is a debug build

The WebView renders a Chromium error page instead of the app. That is **not** a blank screen and not a
frontend bug: a debug APK loads `build.devUrl` instead of the embedded bundle, so the fix is a different
APK, not a code change.

What selects it is the **`custom-protocol` Cargo feature** — not `--release`, and not `debug_assertions`.
`tauri/build.rs:257` is `dev = !has_feature("custom-protocol")`, and `get_app_url`
(`tauri/src/manager/mod.rs:353`) is gated `#[cfg(dev)]`: the `dev` arm takes `dev_url`, the `not(dev)` arm
takes `frontend_dist`. The CLI enables the feature in `Rust::build_options`
(`tauri-cli/src/interface/rust.rs:485`, `features.push("tauri/custom-protocol")`) and then hands the
feature list to Gradle over a **local WebSocket** — `write_options` publishes it, and the
`android-studio-script` command fetches it back with `read_options`. Consequently a bare
`gradlew assembleRelease` is **not** a production build; only `cargo tauri android build` is.

Rule it out in one line:

```bash
adb shell dumpsys package mu.kasir.mobile | grep -E 'flags=|versionCode'
```

`DEBUGGABLE` anywhere in `flags=` means a debug APK is installed. The size gap needs no tooling at all:
debug ≈ **441 MB** (unstripped symbols), release ≈ **28 MB**. Also check *which* file you installed —
`app/build/outputs/apk/` keeps `universal/debug/`, `arm64/debug/` and `universal/release/` side by side.

With the release APK installed the app loads `https://tauri.localhost` and runs its own IPC; corroborate
from the renderer's own console lines (`adb logcat | grep tauri.localhost`). Two red herrings on that
path: the `loading HTTPS URL; you might need to provide a certificate …` WARN is **cosmetic** — the
`client`/`url`/`response_cache` it guards are `#[cfg(all(dev, mobile))]`
(`tauri/src/protocol/tauri.rs:74`), so a correct release build logs it too; and a
`Command <x> not found` for a license command on the tablet is **expected**, because the tablet shell
registers no license commands (`ui/src/__tests__/useAuthConnection.test.tsx:252`).

### `:app:rustBuildArm64Debug` fails with `command 'cargo.bat'` — the message is a decoy

**Symptom (measured 2026-09-19):** Gradle reports

```
Execution failed for task ':app:rustBuildArm64Debug'.
> A problem occurred starting process 'command 'cargo.bat''
```

`cargo.bat` **does not exist on this machine**, and is not what failed. `BuildTask.kt` runs
`cargo tauri android android-studio-script`, and on failure retries `cargo.exe`, `cargo.cmd` and
`cargo.bat`, then rethrows only the **last** exception — so the genuine first failure is thrown away
and the missing batch file is reported in its place. (`BuildTask.kt` now attaches the first failure as a
suppressed exception; re-run with `--stacktrace` to read it.)

The observed trigger was a **reused Gradle daemon holding a broken environment**. Gradle reuses a
daemon across terminals and sessions regardless of their environments, and `Project.exec` starts
children with the *daemon's* environment rather than the current shell's. The daemon log for the
failing runs (`~/.gradle/daemon/8.14.3/daemon-<pid>.out.log`) shows one daemon serving a build from a
Git Bash/MSYS session and the next from PowerShell.

**Remedy, verified:** stop the daemons, then rebuild — two consecutive builds then succeeded.

```bash
cd apps/mobile-tauri/gen/android && ./gradlew.bat --stop
```

Ruled out by measurement, so do not chase them: a missing `cargo` on `PATH` (it resolves to
`C:\Users\<you>\.cargo\bin\cargo.exe`, and Git Bash does hand native children a proper Windows `PATH`);
and an oversized environment block (8 785 chars here, against the 32 767 CreateProcess limit).

### Measurement trap

`curl -o <file>` fails under the sandbox (exit 23) and still reports `size_download=0`, which reads
exactly like a server returning an empty body. Pipe instead of writing a file, and use the byte count
to tell which entry the dev server served (the desktop and mobile entries differ in size):

```bash
curl -s --max-time 15 http://localhost:1422/ | wc -c
```

---

### `beforeBuildCommand` is mangled under the sandbox — build the frontend yourself, then skip the hook

**Symptom (measured 2026-09-19):** the build dies in **7 seconds**, right after
`Running beforeBuildCommand 'npm run build:mobile --prefix ../ui'`, with `The syntax of the command is
incorrect.` followed by `A subdirectory or file .exe already exists.` / `… -c already exists.` Those are
`md`/`copy` errors: the sandbox's command wrapper re-splits the hook string and feeds the fragments to a
shell builtin, so the hook never runs. It is **not** a `--prefix` bug — the identical string works when you
invoke it yourself, which is why the same command can succeed an hour earlier in the same session.

**Workaround, verified end-to-end, no config file edited:**

```bash
cd /c/dev/ozpos && npm run build:mobile --prefix ui     # ✓ built in ~10s
touch apps/mobile-tauri/src/lib.rs                     # force the asset re-embed (see above)
cd apps/mobile-tauri
cargo tauri android build --apk --target aarch64 -c '{"build":{"beforeBuildCommand":null}}'
```

`-c` merges JSON over `tauri.conf.json` for that invocation only, so the repo file stays untouched and no
peer is disturbed. **The frontend must be built first** — with the hook nulled, nothing else produces
`frontendDist`, and Tauri will embed whatever is already there. Proven: 7m51s, then `Finished 1 APK at:
…/universal/release/app-universal-release-unsigned.apk`.

**When the `touch` is actually needed — and when it is not.** `generate_context!` reads `frontendDist`
at *compile* time, so the embedded assets only refresh if the crate is recompiled. `touch` is a
**fallback for a frontend-only change**: nothing in the Rust graph moved, so cargo would hand back the
cached `.so` and the APK would silently carry the previous bundle. When *anything* in the Rust graph is
dirty — a peer's `crates/` commit, or a config change — the app is relinked anyway and the fresh
`frontendDist` is picked up without the `touch`. Measured 2026-09-20: a build with no `touch` compiled
`kasirmu-hal`, `kasirmu-reporting`, `platform-startup` and `kasirmu-bridge`, which is proof enough that
the re-embed will happen. Tell them apart by watching the log for `Compiling` lines before it reaches
Gradle — if the log goes straight to Gradle, add the `touch`.

**Do not try to pre-clear `ui/dist-mobile` instead.** The safe-delete shim now intercepts a plain
`rm -rf ui/dist-mobile` (`SAFE_DELETE_FAIL_CLOSED … reason: trash-failed`) and `mv ui/dist-mobile …`
returns `Permission denied`, so that route is closed. The escalated standalone Vite build clears the
directory itself without tripping the shim.

### Proving the artifact actually contains your change

A successful build is not evidence that the new code is in the APK — the frontend-embed trap above means a
stale `frontendDist` ships silently. Extract and grep the native library:

```bash
APK=apps/mobile-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-signed.apk
unzip -o -j "$APK" "lib/arm64-v8a/libkasirmu_mobile_lib.so" -d /tmp/apkchk
grep -c 'get_own_avatar_scoped' /tmp/apkchk/libkasirmu_mobile_lib.so   # a new command name
grep -c 'index.html' /tmp/apkchk/libkasirmu_mobile_lib.so              # the entry alias
```

Measured 2026-09-19: the new command name ×1 and `index.html` ×10. The same `unzip` also proves the ABI —
if only `lib/arm64-v8a/` resolves, the APK is arm64-only as intended.

### Is the artifact stale? — prove it with the `.so` md5, do not assume from HEAD

`frontendDist` is embedded **into the native library**, so the APK is a pure function of `ui/dist-mobile`
and `apps/mobile-tauri/src`. Three commands settle "is this APK stale?":

```bash
APK=apps/mobile-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
unzip -o -j "$APK" "lib/arm64-v8a/libkasirmu_mobile_lib.so" -d /tmp/apkchk        # what shipped
md5sum /tmp/apkchk/libkasirmu_mobile_lib.so \
  apps/mobile-tauri/gen/android/app/src/main/jniLibs/arm64-v8a/libkasirmu_mobile_lib.so   # fresh build
git log --oneline --since="$(stat -c %y "$APK")" -- ui/ apps/mobile-tauri/src/
```

Measured 2026-09-20: both md5s were `604c3597e22a7e8649e26de665dd72ac` and the `git log` was **empty**,
so the 07:58:54 APK was already current even though nine commits had landed since — none touched `ui/`
or `apps/mobile-tauri/src/` (they were docs, scripts and `desktop-tauri`). **"HEAD moved" is not the same
as "the APK is stale"**; check *which paths* moved. Corollary: Gradle leaves the APK mtime untouched when
the `.so` is unchanged (the assemble task is UP-TO-DATE), so an unmoved mtime is a **pass**, not a missing
build — and the mtime alone cannot tell you which happened, while the md5 can.

---

## 3. The build defaults to release, and there is no keystore

So the product is `…/apk/universal/release/app-universal-release-unsigned.apk`, which will not install.
Use `--debug` for a dev loop. To make an existing release artifact installable, **zipalign first, then
sign** (v2 signing requires that order), with the debug keystore:

```bash
BT="$ANDROID_HOME/build-tools/37.0.0"
"$BT/zipalign.exe" -f -p 4 in.apk aligned.apk
"$BT/apksigner.bat" sign --ks "C:/Users/<you>/.android/debug.keystore" \
  --ks-key-alias androiddebugkey --ks-pass pass:android --key-pass pass:android \
  --out signed.apk aligned.apk
"$BT/apksigner.bat" verify signed.apk
```

**Pass `C:/…` Windows paths to these Java tools.** A Git Bash `/c/…` path reaches the JVM as `\c\…`
and fails with `NoSuchFileException`. Output lands under
`apps/mobile-tauri/gen/android/app/build/outputs/apk/universal/` (`gen/` is gitignored, so the artifact
is disposable). Confirm with `aapt2 dump badging` — expect `native-code: 'arm64-v8a'` only, and launcher
`mu.kasir.mobile.MainActivity`.

---

## 4. Install — and the MIUI gate is not absolute

On HyperOS/MIUI an install **can** be gated on every route (`adb install`, `adb install --user 0`,
`pm install -r` on a `/data/local/tmp` copy) returning
`INSTALL_FAILED_USER_RESTRICTED: Install canceled by user`. Ruled out: device asleep, wrong user,
unknown-sources. The phone-side fix is Developer options → "Install via USB" with the screen unlocked.

**But measured 2026-09-19: a plain `adb install -r` of an already-installed, debug-signed release APK
SUCCEEDED over wireless** (`Performing Incremental Install / Performing Streamed Install / Success`,
`lastUpdateTime` advanced, no gate). So the gate depends on the phone-side state, which changes between
sessions — **attempt the install before assuming it will be blocked.** The practical artifact is the
~28 MB `app-universal-release-signed.apk`; the debug APK is far larger (the `arm64` flavor measured
420.7 MB, the `universal` one 857.9 MB) and transfers slowly over wireless.

**Re-measured 2026-09-19 (second pass), on the debug APK a `dev` run produces:** the first
`adb install -r …/apk/arm64/debug/app-arm64-debug.apk` failed with `INSTALL_FAILED_USER_RESTRICTED`,
and the very next attempt — `adb install -r --user 0` — returned `Success`; a plain
`adb install -r` and `-r -t --user 0` then **also** succeeded. The gate is therefore flaky rather than
absolute: **retry, and try `--user 0`, before concluding it is phone-side.**

That matters for `android dev` specifically, because the CLI installs with a bare `adb install` and
exposes **no flag to add `--user 0`** (`cargo tauri android dev --help` lists no install options).
When the gate bites, the run still reaches `Performing Streamed Install` and then dies: the build and the
APK are fine and only the final push failed, so install by hand and launch, or fix the gate phone-side.

Do **not** try to launch an APK on this device with `am start ACTION_VIEW` — `cmd package
resolve-activity` for `application/vnd.android.package-archive` returns `cn.wps.moffice_eng` (WPS
Office), so the generic intent opens WPS, not the installer. Install with `adb install` instead.

---

## 5. Wireless ADB — connect, diagnose, re-pair

Device: Redmi `23073RPBFG` at `192.168.0.187`, Android 15 / API 35, arm64-v8a, launcher
`mu.kasir.mobile/.MainActivity`. Every install or shell command needs `adb devices` to list it first.

A device advertised over mDNS is not necessarily a connectable device. Two failure modes both present
as "`adb devices` is empty" but need **different** fixes, so probe before acting.

1. `adb devices -l` — device listed? Done.
2. Not listed: `adb mdns services` — note the advertised `<ip>:<port>`.
3. Probe that port (`Test-NetConnection -ComputerName <ip> -Port <port>`, or a .NET `TcpClient`):
   - **CLOSED** — the listener stopped (screen locked, or wireless debugging off). Phone: toggle
     Wireless debugging off/on to re-advertise. The port **rotates** (measured 45079 → 45439 in one
     session), so re-read `adb mdns services` and connect in the *same* command; a port captured minutes
     earlier is already gone.
   - **OPEN, but `adb connect` still fails** — the device accepts TCP and rejects the adb handshake, so
     it no longer trusts this host's `~/.android/adbkey` (a reboot or a Wireless-debugging reset drops
     the pairing). **Re-pair.** Do not keep retrying `connect`.
4. Re-check `adb devices` before believing any device-side diagnosis. A USB cable sidesteps all of this.

### Re-pairing — the fix when the port is open but refuses

Phone → Developer options → Wireless debugging → **"Pair device with pairing code"** → shows
`<ip>:<pairport>` and a 6-digit code (keep the dialog open; the window is brief).

```bash
SDK_ADB="$ANDROID_HOME/platform-tools/adb.exe"      # 37.0.0 — not the /c/adb/adb `which adb` finds
"$SDK_ADB" pair <ip>:<pairport> <6-digit code>
"$SDK_ADB" connect <ip>:<connectport>               # usually NOT needed — pairing auto-connects
```

Confirmed 2026-09-19: `Successfully paired … [guid=adb-e45e28d9-lFE6yH]`, after which the device
**auto-connected with no explicit `connect`**. The pairing port differs from the connect port (42347 vs
45439 here). After pairing the serial is the **mDNS name** `adb-<guid>._adb-tls-connect._tcp` — not the
IP — so target it with `-s adb-e45e28d9-lFE6yH._adb-tls-connect._tcp`.

Host-side attempts that do **not** help (all measured no-ops): both adb clients; `kill-server` /
`start-server`; `disconnect` + reconnect; `ADB_MDNS_AUTO_CONNECT=1`; `adb connect <mdns-instance>` and
`<instance>._adb-tls-connect._tcp`; port 5555 (closed — no legacy-tcpip fallback). When the port is open
and `connect` fails, the remaining variable is on the phone. `_adb-tls-pairing._tcp` appears in mDNS
only while the pairing window is open.

---

## 6. Do not "fix" the sandbox delete shim

The sandbox injects a `node-safe-delete` shim over `fs.rmSync`, so Vite's `emptyOutDir` is refused when
it clears a populated mobile output directory — `SAFE_DELETE_BULK_CONFIRM_REQUIRED`, count against a
threshold of 50. It is an artifact of the sandbox; the same build passes when the Bash call escalates
out of it. Setting `emptyOutDir: false` would paper over a non-bug.

---

## 7. The launcher icon is cropped by the mask — and `tauri icon` alone cannot fix it

**Symptom.** On the home screen the icon looks cut off — the tile's corners and edges are gone.

**Measure it; do not eyeball it.** Android sizes each adaptive-icon layer at **108x108 dp**, but the area
guaranteed to survive an OEM mask is only the central **66x66 dp**; the outer 18 dp on each of the four
sides is reserved for masking and parallax. Artwork must therefore fill at most 66/108 = **61.1%** of the
layer. Compare the foreground's alpha bounding box against that. At `xxxhdpi` the layer is 432x432 px
(4 px/dp) and the safe zone is the central 264x264 px, `x[84..347]`.

Measured 2026-09-19 on `mipmap-xxxhdpi/ic_launcher_foreground.png`: the artwork bbox is **419x419 =
97.0%** of the layer, so **19.4 dp is cut per side — 37% of the tile's width** — and the white mark loses
~9 dp off its top. All five densities agree (the foreground is 108/162/216/324/432 px for
mdpi/hdpi/xhdpi/xxhdpi/xxxhdpi), so the geometry is not the bug — the artwork is.

**Three compounding causes, all upstream of the Gradle build:**

1. **`tauri icon` writes the adaptive foreground with no inset at all.** `resize_and_save_png(fg, size,
   path, None, None)` (`tauri-cli/src/icon.rs:554-563`) is a bare `resize_exact` — no margin, no mask.
   The *legacy* icons generated in the same run **do** get one: `apply_round_mask` with an 8.33% margin
   for `Regular` and a 50% radius for `Rounded` (`icon.rs:586-615`). That asymmetry is exactly why
   `ic_launcher.png` looks acceptable while the adaptive icon is chopped.
   **`android_fg_scale` is honoured only on the legacy path** (`icon.rs:607-609`), so it cannot fix the
   adaptive layer — any inset must be baked into the image itself.
2. **The tile sits in the wrong layer.** The blue rounded square is baked into the *foreground*; Android
   expects the tile to be the *background* layer and only the mark to be the foreground. A tile drawn
   full-bleed in the foreground is guaranteed to be cut, because the mask is applied to the whole layer.
3. **The background layer is `#fff`** — the CLI's default `--ios-color` (`icon.rs:101`), inherited by
   Android because no icon manifest supplies `bg_color`. Nobody chose it, and it shows as a white frame
   wherever the clipped tile no longer reaches.

**Fix — applied and verified 2026-09-19.** Give the foreground its own pre-inset source and pass a
manifest. Two things make this work:

- the adaptive foreground path applies **no inset of its own**, so padding baked into the image survives;
- `android_bg` is not needed. `bg_color` alone emits `values/ic_launcher_background.xml`, giving the tile
  as a **flat full-bleed colour** — which is what a tile-shaped logo wants. The launcher mask then *shapes*
  the tile instead of chopping it.

`apps/mobile-tauri/icons/android-icon-manifest.json`:

```json
{ "default": "icon.png", "android_fg": "android-fg.png", "bg_color": "#147EFB" }
```

`default` must stay the **full** artwork (tile + mark). It still feeds the desktop set and the *legacy*
`ic_launcher.png` / `ic_launcher_round.png`, which take the `else` branch and would become an invisible
white mark on transparent if pointed at `android_fg`.

Generate into a scratch dir and copy only the Android resources — `tauri icon` also rewrites the desktop,
iOS and appx sets:

```bash
cd /c/dev/ozpos/apps/mobile-tauri
cargo tauri icon icons/android-icon-manifest.json -o 'C:\scratch\icongen'
# then copy <scratch>\icongen\android\** over gen/android/app/src/main/res/
```

**Pass `-o` as a Windows path.** From Git Bash a `/c/...` value reaches the Windows binary verbatim and
resolves against the current drive, so `-o /c/Users/x/tmp` silently writes to `C:\c\Users\x\tmp` — and the
`res/` tree you then inspect is not the one that was written. (Same class of trap as the `PATH` note in §1.)

Size the mark to the **66/108 safe zone**, not the 72/108 visible area: 72 dp is the un-masked content
area, and a circular or squircle mask eats its corners. Verified result — the mark at 60% of the layer
fits at every density (mdpi 62x66 inside 66x66; xxxhdpi 241x260 inside 264x264), where the old artwork
measured 419x419 against the same 264x264 zone.

**Recover the mark by un-multiplying — do not mask on whiteness.** The old foreground is the mark
composited over the flat tile blue, so with `o = a*M + (1-a)*B` and `B = #147EFB` the tile's only strong
chroma is its blueness (`B_b - B_r = 231`) while the mark is achromatic. That solves directly:

```
a = 1 - (o_b - o_r) / 231        M = (o - (1-a)*B) / a
```

This keeps the mark's real colours. Using *whiteness as alpha* instead silently turns the master's grey
dot `#B3B3B3` into white at ~54% alpha, which composites to pale blue `#94C4FD` over the tile — off-brand,
and visibly different from the grey dot in the app's own logo. The un-multiply reproduces the original
appearance exactly, precisely because the adaptive background *is* the same blue: the blue-tinted
anti-aliasing around the mark stays invisible.

**Filter the mark's connected components by thickness before taking its bounding box.** The tile's rounded
edge carries a 1 px anti-aliased fringe — here a 318 px-tall column at `x=425` plus ~20 single pixels.
Those stretch the bbox from 304x327 to 421x411, which sizes the mark ~28% too small. Keep only components
whose width **and** height are >= ~8 px: the "k" (224x327) and the dot (52x52) survive, the fringe does not.

Verify **per density** before building: compare the foreground's alpha bbox against the central 66/108
square and require it to be contained at all five densities. Downscale only (0.793 here, from a 432 px
source), so no upscaling is introduced — but a vector or >=1024 px master would be the better long-term
source.

### Verify the icon that actually shipped, not the one on disk

Three things make the *packaged* resource hard to check, and each produces a confident wrong answer:

1. **Release builds obfuscate resource paths.** With `isMinifyEnabled = true` the APK holds `res/-B.png`,
   `res/QZ.png`, … — there is no `mipmap-xxxhdpi/ic_launcher_foreground.png` to grep for. Resolve names
   through `resources.arsc` instead:

   ```bash
   aapt2 dump resources <apk> | grep -A6 "mipmap/ic_launcher_foreground"
   ```

   The same dump yields `mipmap/ic_launcher (anydpi) -> res/XX.xml` — the adaptive icon the launcher
   actually uses at `minSdk 26` — and `color/ic_launcher_background -> #ff147efb`. Dump the XML with
   `aapt2 dump xmltree --file res/XX.xml <apk>` to confirm foreground/background wiring.
2. **AGP palette-converts the PNGs** (colorType 3, with `PLTE` + `tRNS`). A decoder that only understands
   RGBA reads palette pixels as opaque, reports a full-bleed bbox, and makes you conclude the icon is
   cropped when it is not. Honour `tRNS` before believing any bbox.
3. **`aapt2` and `apksigner` need a Windows path.** From Git Bash `/c/dev/...` reaches the binary verbatim
   and dies with `failed opening zip: I/O error` — pass `C:\dev\...`. Same class of trap as the `-o` note
   above.

Then prove the device is running your build: extract the resolved `res/*.png` from the built APK **and**
from `adb pull` of the installed `base.apk`, and compare md5 — a matching whole-APK md5 is the strongest
single check. Signature: `apksigner verify --verbose <apk>` should report `Verified using v2 scheme ...:
true` with `Number of signers: 1`. The absence of `META-INF/*.RSA` means nothing — v2/v3 signatures live
in the APK Signing Block, not in `META-INF`.

## 8. Proving the app WORKS on the device — the positive check

§2's causes tell you how to diagnose a *failure*. This is the complementary recipe, and it settles
"is the app working" without a screenshot — which matters when the panel is off or the keyguard is up.
Run it in order; each line is a distinct failure mode:

```bash
ADB="$ANDROID_HOME/platform-tools/adb.exe"
"$ADB" shell ps -A | grep -i kasir                    # 1. app process
"$ADB" shell ps -A | grep sandboxed_process           # 2. chromium renderer
"$ADB" shell uiautomator dump /sdcard/ui.xml && \
  "$ADB" shell cat /sdcard/ui.xml | tr '>' '>\n' | grep WebView
"$ADB" shell dumpsys activity activities | grep topResumedActivity
"$ADB" shell dumpsys activity top | grep -A2 'android:id/content'
```

Measured 2026-09-20 on a fresh release build, all five agreeing:

```
u0_a246  6568  ... R mu.kasir.mobile
u0_i9188 6616  ... S com.google.android.webview:sandboxed_process0:...  (caller=mu.kasir.mobile)
class="android.webkit.WebView"  bounds="[0,0][1920,1200]"
topResumedActivity=ActivityRecord{... mu.kasir.mobile/.MainActivity t302}
mu.kasir.mobile.RustWebView{67f6701 VFEDHVC.. ........ 0,0-1920,1200}
```

`RustWebView` as a child of `android:id/content` at full size is the one that matters — the broken
signature was "`android:id/content` with no child", and the chromium line is something a
never-created webview cannot produce. Then confirm it is *interactive*, not merely drawn: `input tap`
the first field, `input text`, screenshot — the focus ring and the soft keyboard are the proof. On this
app the login flow's step 2 is a 4-digit PIN pad, so tapping the submit arrow with any username
advances the 2-dot step indicator: a cheap end-to-end check that the JS state machine **and** the
backend round-trip both work, needing no credentials.

**But advancing proves nothing about the ACCOUNT — do not read it as "a user exists".**
`kasirmu_bridge::auth::check_username` (`crates/kasirmu-bridge/src/auth.rs:856`) is deliberately a
**non-oracle**: its doc block says it "always answers `proceed: true` for any syntactically valid
username, whether the account exists, is inactive, or is unknown", behind a 50–200 ms random delay that
masks the timing channel. Measured 2026-09-20: `admin` advanced to the PIN pad and then `1234` — the
dev-mock's PIN for every seeded account — was **rejected**, with no route to a real one (the release
build is not debuggable, `run-as` and `adb root` both refuse, and the PIN is a bcrypt/argon2 hash).
**So this check proves the flow RUNS; it cannot produce a session, and there is no credential to be
found on the device.** Anything behind the login — the tablet shell, its tab bar — is unreachable on a
fresh install without one.

### Verify the *installed* build, not just the artifact

A current artifact does **not** mean a current device. Measured 2026-09-20: the tablet still ran the
07:34 build while the repo's artifact was the 07:58 one, because `be96322ac` (*resolve the attested
server origin at boot*) landed at **07:44** — *between* the two builds. The device was missing a real
feature, not merely running a re-signed copy. Cheapest tell first:

```bash
"$ADB" shell dumpsys package mu.kasir.mobile | grep -E 'lastUpdateTime|versionName|flags='
# then hash the device's OWN file — no pull, so no local path to disagree about
"$ADB" shell "md5sum '$("$ADB" shell pm path mu.kasir.mobile | sed 's/^package://' | tr -d '\r')'"
md5sum "$APK"
```

Measured: the stale install md5'd `cc6245b2…` (28 191 963 B) against the artifact's `80ac7bd2…`
(28 190 795 B), and its `.so` differed too (`bf7dcc96…` vs `604c3597…`). After `adb install -r` the two
APK md5s matched exactly.

**Prefer `adb shell md5sum` to `adb pull`. A pull to a POSIX path fails SILENTLY, not loudly.** `adb` is
a Windows binary: given `/tmp/x.apk` it writes `C:\tmp\x.apk`, while the shell's `/tmp` is
`%LOCALAPPDATA%\Temp`. With nothing at the POSIX path you get a loud `not found` — but if a file is
already sitting there, e.g. one an *earlier* session pulled, `md5sum` **happily hashes that stale file**
and hands you a plausible wrong answer. Measured 2026-09-20: a pull reported success (28 330 571 B
written) while the shell hashed a 10:22 file of 28 188 739 B, and the conclusion drawn — *"the installer
rewrote the `.so`, so my change is not on the device"* — was false. The `.so` delta was *exactly* the
stale file's shortfall, which is what made it look like real evidence. The device's own `base.apk`
md5'd identically to the artifact. Same class as the §1 and §7 notes. `lastUpdateTime` alone settles it
without any pull at all.

**`grep -i kasirmu` does NOT match `mu.kasir.mobile`.** "kasirmu" is not a substring of
"kasir.mobile", so `ps -A | grep kasirmu` returns empty while the app is running — which reads exactly
like "the app died on launch". Measured 2026-09-20: it cost a false crash conclusion. **Use
`grep -i kasir`.**

### The build does not hang — the background wrapper waits on a pipe the build's daemons inherit

Measured 2026-09-20. `cargo tauri android build` launched with `run_in_background` still reported
*running* at 26 min and at 8 min, while `app-universal-release.apk` had been complete and mtime-stable
since minute 7. The build was **never** hanging. The Gradle daemon log settles it — in
`~/.gradle/daemon/8.14.3/daemon-<pid>.out.log`:

```
07:31:58.288 [DEBUG] [DaemonStateCoordinator] Command execution: started DaemonCommandExecution[…Build…]
07:34:16.994 [INFO ] [DaemonRegistryUpdater]  Marking the daemon as idle, address: [87b25bf9-…]
```

Gradle finished at `07:34:16.994` — *exactly* the APK mtime — and logged nothing but idle-timer churn
afterwards. The CLI had already printed `Finished 1 APK at: …`.

**The mechanism is the wrapper's completion test, not the build.** A background task is declared complete
when its captured **stdout reaches EOF**, and EOF requires *every* holder of the write end to close it.
`cargo tauri android build` leaves descendants alive that inherited that pipe: `rustup.exe`, `cargo.exe`,
and `sccache.exe` — the repo sets `rustc-wrapper = "sccache"` in `.cargo/config.toml`, and the first rustc
invocation starts a **persistent sccache server** by design. Isolated with a controlled A/B, no Rust
involved:

```bash
bash -c 'bash -c "sleep 300" & echo parent done'                    # parent exits, task stays "running"
bash -c 'bash -c "sleep 300" >/dev/null 2>&1 & echo parent done'    # task completes in ~4 s
```

Both print `parent done` immediately; only the second *finishes*. Mind the trap when writing this test:
redirecting the orphan's own stdout is what makes it pass, so a version that redirects it and then
concludes "no hang" proves nothing (that mistake was made here first).

**Recipe — hand the build a file, not a pipe.** Verified end to end 2026-09-20: started `08:13:11`,
`EXITCODE:0`, `END 08:15:44` (**153 s**), completion notification delivered normally. The `cd` and the
env exports are **not optional** — see the two traps below.

```bash
export PATHEXT='.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC'
export SystemRoot='C:\WINDOWS';  export COMSPEC='C:\WINDOWS\system32\cmd.exe'
export ProgramData='C:\ProgramData'; export APPDATA='C:\Users\<you>\AppData\Roaming'
export ProgramFiles='C:\Program Files'
export JAVA_HOME='C:\Users\<you>\AppData\Local\Programs\Java\jdk-21.0.12.1+1'
export ANDROID_HOME='C:\Users\<you>\AppData\Local\Android\Sdk'
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export ANDROID_NDK_HOME="$ANDROID_HOME\ndk\30.0.14904198"
cd /c/dev/ozpos/apps/mobile-tauri          # NOT the repo root — see below
LOG=/tmp/tauri-build.log
{ date +'START %T'; pwd; } > "$LOG"
cargo tauri android build --apk --target aarch64 \
  -c '{"build":{"beforeBuildCommand":null}}' >> "$LOG" 2>&1 < /dev/null
echo "EXITCODE:$?" >> "$LOG"; date +'END %T' >> "$LOG"
```

**Running it from the repo root silently builds the *desktop* app.** The root has no `tauri.conf.json`,
so `cargo tauri` falls back to the workspace default — `apps/desktop-tauri` — and dies in two seconds
with a message that names the wrong app and the wrong problem:

```
Error Android Studio project directory C:\dev\ozpos\apps\desktop-tauri\gen/android
      doesn't exist. Please run `tauri android init` and try again.
```

There is nothing to `init`: `apps/desktop-tauri/gen/android` **should not exist** (only
`apps/mobile-tauri` has an Android project). The fix is the `cd`, not an `android init`. Measured
2026-09-20 — it cost a build cycle, and the "run `tauri android init`" advice in the message is a decoy
that would create a desktop Android project nobody wants.

**And the env exports are mandatory on every run.** Without them the *same command from the right
directory* dies instead with `failed to setup Android environment: The PATHEXT environment variable
isn't set` (§1). Two different errors, both two seconds, both about the harness rather than the code.

The Gradle JDK pin is at **`~/.gradle/gradle.properties:21`** (`org.gradle.java.home=…jdk-21.0.12.1+1`),
i.e. in the *user-global* Gradle config — **not** in the repo's `apps/mobile-tauri/gen/android/
gradle.properties`, which has no such line and is tracked. Do not "fix" the tracked file by adding it;
`org.gradle.java.home` takes precedence over `JAVA_HOME` precisely so a hostile shell cannot pick the
wrong JDK, and that only works if it stays outside the repo.

Poll `$LOG` for `EXITCODE:` and the APK mtime. **Never read a "running" task status as a failed build** —
check the log's last line first, because from the task list a hung wrapper and a finished build are
indistinguishable. `gradlew.bat --stop` afterwards is still tidy.

**If you already piped it, nothing is lost — the APK is complete.** Measured 2026-09-20: the recipe above
was skipped for `cargo tauri android build --apk --target aarch64 2>&1 | tail -30`, and the task then sat
at "running" for **20 minutes** while the APK had been written at minute 8. Recovery, in order:

```bash
ls -la --time-style=+%H:%M:%S apps/mobile-tauri/gen/android/app/build/outputs/apk/universal/release/
"$ANDROID_HOME/build-tools/37.0.0/apksigner.bat" verify --print-certs "$APK"   # truncated APK fails here
"$ANDROID_HOME/build-tools/37.0.0/aapt2.exe" dump badging "$APK" | head -1      # package + version
```

`apksigner verify` succeeding is what distinguishes "written" from "half-written", so run it before
trusting an APK rescued from a killed build. Then kill the wrapper and carry on. The `build-tools/`
version directory must exist — list it rather than assuming `37.0.0`, and note that `$ANDROID_HOME` is
**not** exported in a fresh shell, so re-export it or use the literal path.

### `cargo tauri android build` DOES build the frontend — the "0 hits under `src/mobile/`" test was a false negative

*(Refuted and corrected 2026-09-20, Android audit. This section said the opposite for a day, on the
strength of a lexical grep. Kept with its correction rather than deleted, because that grep is a trap
somebody will reach for again.)*

The `--help` line — *"It also runs your `build.beforeBuildCommand`"* — is truthful. Two independent
measurements of the code path:

1. **Source, tauri-cli 2.11.4.** `run_hook` *is* absent from `src/mobile/`, because the mobile path does
   not call the hook itself: `src/mobile/android/build.rs:197` calls
   `crate::build::setup(&interface, &mut build_options, tauri_config, dirs, true)`, and `setup` — the only
   `pub fn` in that region of `src/build.rs` — is where `run_hook("beforeBuildCommand", …)` sits
   (`src/build.rs:187-196`). A grep scoped to the directory misses a call made one level up.
2. **The installed CLI, run for real.** `cargo tauri android build --apk --target aarch64` (tauri-cli
   2.11.1) printed `Running beforeBuildCommand` for `npm run build:mobile --prefix ../ui`, ran
   `tsc -b && vite build --config vite.mobile.config.ts`, and advanced `ui/dist-mobile/index.html` from
   `11:32:18` to `12:27:04` inside that build. The APK it produced embeds the bundle written during it.

**What is still true, and is the only SILENT route to a stale embed:**

* `ui/dist-mobile` is **gitignored** (`ui/.gitignore:4`), so it is whatever the last frontend build on
  *this machine* left. A fresh clone has none, and `generate_context!` embeds whatever is there.
* **A Gradle-driven `cargo` does not run the hook.** `gen/android`'s `:app:rustBuildArm64*` task invokes
  `cargo` directly — Android Studio's Run button, or a bare `gradlew assembleRelease` — and the hook belongs
  to the Tauri CLI. With a dist older than the frontend sources, that path embeds the stale bundle silently,
  and an md5 that moved because a peer's Rust edits landed proves nothing about your own change.

So the prebuild below is the right habit for the Gradle path and harmless for the CLI path:

```bash
cd /c/dev/ozpos/ui && npm run build:mobile      # tsc -b && vite build --config vite.mobile.config.ts
# then the §8 recipe; the CLI runs the hook again, in 9-30 s
```

**A `ui/dist` mtime is not evidence about the APK.** `apps/mobile-tauri/build-android-frontend.bat` ran the
DESKTOP `npm run build` — writing `ui/dist`, which no Android build reads — until the Android audit
corrected it to `build:mobile` on 2026-09-20. Only `ui/dist-mobile` is embedded.

**Verify the bundle, not the binary.** `ui/dist-mobile/assets/` is the thing Tauri embeds, so check it
directly — grep for a *value* your change introduced, which survives minification (a CSS keyword like
`safe center`, a custom property name, a `72rem`):

```bash
ls -la --time-style=+%H:%M:%S ui/dist-mobile/assets/ | grep index
grep -oh '\.tablet-shell \.tablet-tab-bar{[^}]*}' ui/dist-mobile/assets/index-*.css
```

Minifiers also strip the space in a media query (`@media (orientation: landscape)` becomes
`@media(orientation:landscape)and (min-width:48rem)`), so grep `orientation:landscape` too — a search for
the spaced form returns 0 and reads as "missing".

**Do not try to grep the APK for it.** In a release build the frontend is brotli-compressed inside the
native library, so a plaintext `grep -a` for your string returns **0 even when the change is embedded** —
a false negative that looks exactly like a stale bundle. The library is also named
`libkasirmu_mobile_lib.so`, not `libkasirmu_mobile.so`; grep a wrong filename and every count is 0 for a
reason unrelated to your change, which is the same trap in a second disguise.

`ps -W` accumulates the corpses: after the killed runs it still listed `rustup.exe`, `cargo.exe` and
`cargo-tauri.exe` from the *previous day*, each holding a pipe whose reader is long gone. Check the
`STIME` column before concluding a build is currently running — a stale entry looks like a live one.

### The sccache server can die mid-build — and the APK you keep is the previous one

Measured 2026-09-20. The build ran, compiled for **4m 43s**, then exited **1** with the APK mtime
*unchanged* — so the failure is easy to misread as "the build did nothing". The tell is at the top of
the Rust output, not the bottom:

```
sccache: error: failed to execute compile
sccache: caused by: error reading compile response from server
sccache: caused by: Failed to read response header
sccache: caused by: An existing connection was forcibly closed by the remote host. (os error 10054)
error: could not compile `kasirmu-core` (lib)
…
Execution failed for task ':app:rustBuildArm64Release'.
BUILD FAILED in 47s
```

**This is not a code error.** `.cargo/config.toml` sets `rustc-wrapper = "sccache"`, so every `rustc`
call is proxied through a persistent server (§8's pipe trap describes the same process). When that
server is killed or crashes — a sandbox teardown, a `taskkill`, a neighbouring agent's cleanup — the
in-flight compile dies with `os error 10054` and cargo reports it as a *compile* failure of whatever
crate was in flight. Here that was `kasirmu-core`, and the cascade reached Gradle.

**Diagnose it in one command**, because the wrapper's own stats separate "dead" from "slow":

```bash
sccache --show-stats | head -8     # Compile requests executed 0 + Cache errors 0 on a long build = it restarted
ps -W | grep -i sccache            # check STIME: a server younger than your build start is a new one
```

**Remedy:** re-run the build. The wrapper starts a fresh server on the next `rustc` invocation, and
cargo reuses every artifact that compiled before the death, so the retry only redoes the failed
subtree. Do **not** reach for `RUSTC_WRAPPER=""` as the first move — it works, but it throws away the
whole Android cache and turns a 5-minute retry into a ~15-minute cold build.

`gradlew.bat --stop` first is still worthwhile: a daemon that inherited the dead server's environment
is the §2 trap, and it will otherwise re-report the same failure from a cached environment.

**A silent no-op looks exactly like success.** Un-escalated, `npm run build:mobile --prefix ui` exits
**0** with **no output and no writes** (the shim blocking Vite's `emptyDir`, §6), while escalated it
prints the vite banner and `✓ built in ~10s`. The exit code cannot tell you which happened — check that
`ui/dist-mobile` mtimes moved. Same reason the "Proving the artifact" section exists: a green status is
not evidence that the new code shipped.

---

> last audited 20-09-26 by Budak-Korporat
