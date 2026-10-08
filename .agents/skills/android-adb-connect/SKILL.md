---
name: android-adb-connect
description: Connect to the kasir.mu Android tablet over wireless ADB and get a trustworthy read of what it is doing - wait for the mDNS device, prove the app process and WebView are alive, capture a screenshot, dump the UI hierarchy, and confirm which build is installed. Use when adb devices is empty, when adb shell dies with no devices/emulators found, when a wireless tablet will not connect or appears to have dropped its pairing, when screencap or adb pull fails with a Windows path in the error message, when you need a screenshot of the tablet, when you need to know what is actually on the tablet home screen, when a claim about the running app needs device evidence, or before concluding the app crashed on launch. For building, signing or installing the APK use android-apk-build; for driving the live DOM over Chrome DevTools Protocol use android-ui-automation.
---

<!-- Audit stamp: 2026-10-02 · Budak-Korporat · status: ACCURATE — new skill, rev 1, no predecessor ·
     Audited against branch `0.0.41` at `bd203ac99`. Every claim below was measured on the device or
     read out of the tree during this pass; nothing is inherited from another document. Measured:
     all five liveness commands returned the values quoted in §3; the MSYS path-conversion failure in
     §2 and its fix were both observed end to end (63,779-byte screencap saved and pulled); the §1
     wait loop was observed empty on a first probe and resolving within ~10 s later in the same
     session; the §6 home-screen reading came from a real `uiautomator dump` on the tablet. Paths
     tested for existence before publication: ui/src/features/workspaces/WorkspaceHome.tsx,
     ui/src/features/workspaces/tools.tsx, ui/src/app/tablet/TabletAppShell.tsx,
     scripts/android-cdp.mjs and scripts/android-screen.mjs all exist. NOT re-measured (needs a
     device state this pass never entered): the re-pairing procedure, which stays in
     android-apk-build §5 — no pairing was lost during this pass. -->

# Connecting to the Android tablet over wireless ADB

Building, signing and installing is `android-apk-build`. Driving the live DOM is
`android-ui-automation`. This skill is the layer underneath both: **get a trustworthy read
of the tablet itself** — is it connected, is the app alive, which build is installed, and
what is actually on the screen.

## 0. The device

| | |
|---|---|
| Model | Redmi `23073RPBFG`, Android 15 / API 35, arm64-v8a |
| Package | `mu.kasir.mobile`, launcher `.MainActivity` |
| mDNS serial | `adb-e45e28d9-lFE6yH._adb-tls-connect._tcp` |
| SDK adb | `C:/Users/Dika/AppData/Local/Android/Sdk/platform-tools/adb.exe` |
| Login used for manual checks | user `budi`, PIN `1234` (role: owner) |

Call the SDK adb by full path. `which adb` resolves to a standalone `/c/adb/adb` at
31.0.3, not the SDK's build-tools adb — and the version matters when pairing.

## 1. The wait loop is mandatory on EVERY shell call

**Every Bash invocation in this sandbox starts a fresh adb daemon** — the first adb
command of each call prints `* daemon not running; starting now at tcp:5037`. mDNS
discovery then takes 2–16 s. `adb devices` against the new daemon returns empty and
`adb shell` dies with `no devices/emulators found`, even though the tablet is paired,
awake and on the same LAN.

Do not conclude the tablet dropped its pairing — it did not. Put this at the top of
every call:

```bash
A="C:/Users/Dika/AppData/Local/Android/Sdk/platform-tools/adb.exe"
for i in 1 2 3 4 5 6 7 8; do
  D=$("$A" devices | sed -n '2p' | awk '{print $1}')
  [ -n "$D" ] && break
  sleep 2
done
[ -z "$D" ] && { echo "no device after 16s"; exit 1; }
```

Two consequences people get wrong:

- **`-s adb-<guid>._adb-tls-connect._tcp` fails with "device not found"** until discovery
  completes. That is a fresh daemon, not a stale serial.
- **`adb mdns services` returns the empty list on this host** while the device is in fact
  connectable. Treat it as a dead end — the auto-connect path needs no port from you.
  When a port is genuinely needed (a first-time pairing), that procedure lives in
  `android-apk-build` §5.

## 2. Git Bash rewrites remote `/sdcard/...` paths — `MSYS_NO_PATHCONV=1`

Without the export, MSYS2 path conversion turns every remote `/sdcard/...` argument into
a Windows path relative to the bash install dir *before* adb sees it. The device's own
`screencap` then reports:

```
Error opening file: C:/Users/Dika/.workbuddy-ai/binaries/PortableGit/versions/1.2.0/sdcard/kh.png
```

and `adb pull` becomes `failed to stat remote object 'C:/.../sdcard/kh.png'`. This is the
same class as the "pass Windows paths to `-o` and `aapt2`" trap in `android-apk-build`,
but the conversion runs in the *other* direction and silently breaks `screencap`,
`uiautomator dump`, `adb shell cat /sdcard/...` and every `adb pull /sdcard/...`.

```bash
export MSYS_NO_PATHCONV=1                       # once per shell
"$A" shell screencap -p /sdcard/kh.png
"$A" pull /sdcard/kh.png C:/Users/Dika/AppData/Local/Temp/kh.png
```

Pass a **Windows** path as the pull destination. A POSIX destination silently lands under
the Git Bash install dir, and a file an earlier session left there will then be hashed as
if it were fresh.

## 3. The liveness check — five lines, each a distinct failure mode

```bash
"$A" shell ps -A | grep -i kasir            # 1. app process
"$A" shell ps -A | grep -i sandboxed        # 2. chromium renderer
"$A" shell dumpsys activity activities | grep topResumedActivity
"$A" shell dumpsys display | grep 'Display State'
"$A" shell uiautomator dump /sdcard/ui.xml  # 5. needs MSYS_NO_PATHCONV
```

Measured 02-10-26, all five agreeing:

```
u0_a246  27715 ... S mu.kasir.mobile
u0_i9075 27763 ... S com.google.android.webview:sandboxed_process0:...
    topResumedActivity=ActivityRecord{... mu.kasir.mobile/.MainActivity t394}
  Display State=ON
UI hierchary dumped to: /sdcard/ui.xml
```

**`grep -i kasirmu` does NOT match `mu.kasir.mobile`** — "kasirmu" is not a substring of
"kasir.mobile". It returns empty while the app is running and reads exactly like a crash
on launch. Use `grep -i kasir`.

A WebView node inside `android:id/content` at full size is the one that matters; the
broken signature is `android:id/content` with **no child**, which means no webview was
ever created.

## 4. A black screenshot is a panel state, not an app failure

Read `Display State` and the keyguard before interpreting any frame. `screencap` returns a
valid all-black PNG whenever the display is off, and `mWakefulness=Awake` can coexist with
`Display State=OFF`. A device with a credential set cannot be unlocked from adb — ask for
it rather than reporting the app as broken.

## 5. Which build is installed

```bash
"$A" shell dumpsys package mu.kasir.mobile | grep -E 'flags=|versionName=|lastUpdateTime'
```

`DEBUGGABLE` anywhere in `flags=` means a debug APK is installed, so it loads
`build.devUrl` from the dev server instead of the embedded bundle — a Chromium error page
naming a LAN IP is that, not a frontend bug. `flags=0x0` is a release build. When
comparing against a local artifact, prefer `"$A" shell md5sum <the pm path>` over
`adb pull`; a pull to a POSIX path can silently hash a stale file from an earlier session.

## 6. Reading the screen, and mapping it back to code

`uiautomator dump` is the cheap way to see the rendered WebView's text and accessibility
tree, and it settles questions unit tests cannot. Worked example, measured 02-10-26:

> The tablet home showed one card, "Tambah Workspace", and **no Tools grid at all**.

The dump proved it — a `WORKSPACE` header, one button, nothing below — and the code
explains it. `ui/src/features/workspaces/WorkspaceHome.tsx:937-943` renders
`{toolGroups.length > 0 && <ToolsCategoryGrid ... />}` **inside** the branch reached when
`sortedWorkspaces.length > 0`. With zero workspaces the render takes the
`canAddWorkspace` empty branch instead (`:738`), so the grid is never mounted — even
though `canSeeTools` (`:435`) was `true` for the owner role and the catalogue itself
(`ui/src/features/workspaces/tools.tsx:82`) was intact.

The lesson generalises: **a screen that renders "nothing" is usually a branch, not a dead
component.** Read the UI tree first, then find the `&&` or ternary that gates it, and only
then suspect the platform. There is no `isAndroid`, `isMobile` or `isTablet` guard
anywhere around the home screen's Tools grid, and the tablet shell
(`ui/src/app/tablet/TabletAppShell.tsx`) mounts the same lazy component as the desktop.
When the two platforms differ, suspect **device database state**, not the code.

## 7. What this skill is not

| Need | Where |
|---|---|
| Build, sign, install; pair or re-pair wireless debugging | `android-apk-build` |
| Drive the live DOM, tap an element, read the WebView console | `android-ui-automation` (`scripts/android-cdp.mjs`) |
| A frame when CDP cannot produce one (locked or panel-off tablet) | `scripts/android-screen.mjs` |

### Caveat: `scripts/android-cdp.mjs` may not be able to spawn adb

In a sandboxed shell the script's `execFileSync("adb", …)` fails with
`spawnSync adb EBUSY`, and the script then reports *"mu.kasir.mobile is not
running"* even though `adb shell pidof mu.kasir.mobile` returns a pid in the
same call. Workaround, measured 2026-10-07:

1. From bash, run the §1 wait loop, then
   `adb forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell pidof mu.kasir.mobile)`.
2. Read `curl -s http://127.0.0.1:9222/json` and attach any WebSocket client
   straight to that page's `webSocketDebuggerUrl`, then speak
   `Runtime.enable` + `Runtime.evaluate`. No adb call from the child process, so
   nothing can hit EBUSY.

Two related traps: `uiautomator dump` **cannot see inside the WebView** — the
node is `NAF="true"` with no children, so CDP is the only way to read the
rendered DOM; and a `location.reload()` closes the CDP target
(`Inspected target navigated or closed`), so re-attach after one.

> last audited 02-10-26 by Budak-Korporat
> amended 2026-10-07 by Budak-Korporat (adb EBUSY / direct-WebSocket workaround)
