<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file: 87 lines, and it is the shortest and most useful document audited in this campaign. It exists to correct a false conclusion rather than to record a true one, and it does so with a sentence that applies to this audit's own method: `uiautomator dump` is BLIND to a Tauri WebView — it sees the native shell and never the rendered HTML — so a before/after dump comparison reports no change whether or not the tap landed. The document's own words for why that is dangerous are the point: it is not weak evidence, it is a measurement that CANNOT FAIL, and it reads exactly like a passing experiment. · WHY THIS DOCUMENT MATTERS BEYOND TABLET TESTING, and why the stamp says so. This campaign has spent thirty-one rounds running exactly the kind of automated check that produces confident negatives — a grep that matched, a checker that reported zero, a path that resolved. Every one of those is the same shape as the blind dump: a method whose failure mode is to report success. A reader who has been fooled by one of them is the audience this document is for. It names the working loop too — screenshot, read the PNG, take coordinates off the screenshot rather than off a dump — and marks every claim that is inference rather than measurement, which is a distinction this campaign's own stamps have been trying to maintain. · THE HARDWARE ANCHORS CHECK OUT, which is rare for a device-specific record: the package is `mu.kasir.mobile`, confirmed at `apps/mobile-tauri/gen/android/app/build.gradle.kts:31` with the matching Java namespace path in the activity. The device, OS and Tauri version are named, so a future reader can tell whether a re-measurement is comparable or whether the platform has moved. · A NOTE ON WHAT THIS DOCUMENT IS NOT: it is a record of one session on one device, and platform behaviour of this kind is exactly the kind that changes between Android versions and WebView releases. Its own scope line handles this correctly by naming the device and version, and this stamp adds only the caution that a re-measurement on a different stack is a different measurement rather than a confirmation or a refutation of this one. · No stamp existed; this is the first. -->
# Driving the tablet UI — the method that works, and the blind one that does not — 2026-09-21

Scope: how to drive the Tauri Android app on a physical device from a host shell, and why the
obvious method — reading the accessibility tree — produces confident false negatives here.

Measured on: Redmi Pad SE, package `mu.kasir.mobile` v0.0.39, Tauri v2 WebView, host shell
Git-Bash on Windows. Every fact below is a measurement from this session unless marked
**[inference]**.

## 1. SUMMARY

The false conclusion this session held for many rounds: **"synthetic taps cannot advance the
app's first-run wizard."** It was wrong. Synthetic input works fine on this device — the
failure was in the *verification*, not in the input.

The real reason: `uiautomator dump` is **blind to the Tauri WebView**. The dump sees only the
native shell around the WebView, never the HTML rendered inside it. A dump of the running app
returns roughly 10 KB of XML whose only two non-empty text nodes are the app footer —
`v0.0.39` and `© 2026 kasir.mu. All rights reserved.` The wizard heading
("What kind of store are you running?"), its preset tiles, and the login Username field are
all absent from the accessibility tree. So a before/after dump comparison reports "no change"
whether or not the tap landed. That is not weak evidence — it is a measurement that cannot
fail, and it reads exactly like a passing experiment.

## 2. METHOD — the loop that works

1. **Screenshot.**
   ```
   adb shell screencap -p /sdcard/s.png
   adb pull /sdcard/s.png target/s.png
   ```
2. **Read the PNG.** Open the image and look at it. This is the only reliable way to learn the
   current UI state; there is no text-based equivalent on this platform.
3. **Read coordinates off that screenshot**, not from a dump. Mapping is 1:1: `adb shell wm
   size` reports `1200x1920` and `adb shell wm density` reports `280`, matching the
   screencap pixel dimensions exactly.
4. **Drive.**
   ```
   adb shell input tap <x> <y>
   adb shell input text '...'
   adb shell input keyevent <KEYCODE>
   ```
5. **Screenshot again** and compare the images. Repeat.

Synthetic input is confirmed working on this device, not assumed: `adb shell input keyevent
KEYCODE_HOME` moves focus to the launcher, and `adb shell input tap <x> <y>` on the app's
Username field focuses it — observed by the keyboard opening.

## 3. PITFALLS

### 3.1 The blind dump (the one that caused the false conclusion)

`adb shell uiautomator dump` returns ~10 KB of XML for the running app with two non-empty text
nodes, both footer. Do not use it to decide whether the app changed. It cannot see the WebView
content at all.

### 3.2 `exec-out screencap` produced an empty file

`adb exec-out screencap -p > file` produced an **EMPTY file** in this environment. The
two-step form works: `adb shell screencap -p /sdcard/s.png && adb pull /sdcard/s.png target/s.png`.

### 3.3 Git-Bash rewrites device paths

Under Git-Bash on Windows, a device path in `adb shell ...` is rewritten by MSYS path
conversion — `/sdcard/x.xml` becomes `C:/Program Files/Git/sdcard/x.xml`. Export
`MSYS_NO_PATHCONV=1` (or use the double-slash form, `//sdcard/x.xml`).

### 3.4 `run-as` is unavailable on a release build

`adb shell run-as <pkg>` fails with "package not debuggable" on the shipped release APK, so
the app's SQLite cannot be inspected or reset directly from the host. **[inference]** any
future state-reset tooling will need either a debuggable build or an in-app path; nothing was
built or verified for that here.

### 3.5 Driving the UI mutates real state

Synthetic taps are not a sandbox — they change on-device state. Expect the wizard/login position
to move between runs; do not read that as a defect.

## 4. What this means for automated verification on this platform

Screenshot-driven verification is viable and is the method this session ended on: capture,
read the image, assert against what the image shows. Accessibility-tree-driven verification is
not viable here — the WebView content is not in the tree, so an assertion built on
`uiautomator dump` is structurally incapable of observing the UI it claims to test and will
pass or fail independently of the app's actual state. Build harnesses on pixels plus a
coordinate map read from a screenshot, and treat a dump-based "no change" as no evidence.

> last audited 29-09-26 by docs-auditor
