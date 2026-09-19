---
name: android-apk-build
description: Build, sign and install the kasir.mu tablet app (apps/mobile-tauri, package mu.kasir.mobile) on a real Android device, and connect to it over wireless ADB. Use when running cargo tauri android build or android dev; when the build dies with "The PATHEXT environment variable isn't set"; when beforeBuildCommand fails with "Could not read package.json"; when the Vite mobile build reports it cannot load a .ftl file; when the produced APK is unsigned and refuses to install; when adb install returns INSTALL_FAILED_USER_RESTRICTED; or when adb devices is empty while adb mdns services still advertises the device.
---

<!-- Audit stamp: 2026-09-19 · Budak-Korporat · status: ACCURATE · Derived from a full build/install/debug cycle on 2026-09-19 against the Redmi 23073RPBFG. Verified this pass: a signed release APK installed over wireless ADB (adb install -r → Success, lastUpdateTime advanced) and launched to mu.kasir.mobile/.MainActivity with no FATAL in logcat; aapt2 dump badging reports package mu.kasir.mobile and application-label Kasir.mu; the mobile entry is index.mobile.html and the vite.mobile.config.ts alias plugin is present; the SDK/NDK/build-tools/JDK paths below resolved on this host; both wireless-ADB failure modes were reproduced and the re-pairing recovery confirmed. The MIUI install-gate claim was corrected this pass — it is not absolute. · Pass 2 (2026-09-19, Android build-repair lane): the JBR/JDK-25 trap in §1 was already correct and was re-confirmed end to end — the frozen failing command was reproduced (`> 25.0.3` from `JavaVersion.parse` while configuring `buildSrc`) and then repaired, and the durable `org.gradle.java.home` pin — which this skill did not previously mention — was added and verified against a deliberately hostile `JAVA_HOME`. New section added for the `:app:rustBuildArm64Debug` / `command 'cargo.bat'` decoy: its cause in `BuildTask.kt` rethrowing only the last fallback exception, and the verified stale-daemon remedy. A full debug APK built twice consecutively after the repair. Versions re-measured this pass: JDK 21.0.12.1+1, Android Studio JBR 25.0.3, NDK 30.0.14904198, build-tools 37.0.0, platform android-36, wrapper Gradle 8.14.3. · Pass 3 (2026-09-19, same lane, end-to-end `dev`): a full `cargo tauri android dev` against the Redmi 23073RPBFG was driven to completion — device auto-detected (aarch64), Rust compiled, Gradle assembled `apk/arm64/debug/app-arm64-debug.apk` (420.7 MB), and the app then installed, launched, became the focused activity and rendered the real UI (a 2 063 599-byte screenshot with 9 228 distinct colours, brand green ≈#495A30) with no FATAL. Two new traps recorded from that run: a hand-started `npm run dev:mobile` binds loopback only, because `ui/vite.mobile.config.ts:107` is `host: host || false` and only `cargo tauri android dev` sets `TAURI_DEV_HOST` (this is now Cause 3 of the blank-screen section); and the MIUI install gate is flaky rather than absolute (§4). Also recorded: `screencap` returns pure black while `Display State=OFF`, which coexists with `mWakefulness=Awake` and is easily mistaken for an app failure. The two earlier passes' claims were re-confirmed, none contradicted. -->

# Android build, sign, install and wireless ADB

App dir `apps/mobile-tauri`, package **`mu.kasir.mobile`**. The device proven so
far is a Redmi `23073RPBFG` — arm64-v8a, Android 15 / API 35 — so `--target aarch64` and `minSdk 26`
both hold. A full first build is about 15 minutes (the Rust cross-compile dominates); run it in the
background.

---

## 1. Environment: Git Bash, with the Windows vars exported

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

### A blank screen: two unrelated causes, rule them out in order

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

> last audited 19-09-26 by Budak-Korporat
