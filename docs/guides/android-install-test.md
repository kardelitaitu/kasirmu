# Android APK Install Test — OZ-POS

> **Status:** Implemented (2026-07-21)
> **Target audience:** QA / developers testing on Android 10+ physical tablets
> **Related:** [Mobile Build Guide](https://github.com/kardelitaitu/oz-pos/tree/main/packaging/mobile) · [Tauri Tablet Config](https://github.com/kardelitaitu/oz-pos/blob/main/apps/tablet-client/tauri.conf.json) · [Windows Launch Test](./windows-launch-test.md) · [Linux Launch Test](./linux-launch-test.md)

This guide covers building, installing, and testing the OZ-POS tablet app
on a physical Android device (phone or tablet).

---

## Prerequisites

| Requirement | Version | Check |
|-------------|---------|-------|
| Android device | 8.0+ (API 26 — the app's `minSdkVersion`) | Settings → About → Software info |
| USB cable | Data transfer capable | `adb devices` shows device |
| USB Debugging | Enabled | Developer Options → USB Debugging |
| JDK | 17+ | `javac --version` |
| Android SDK | 36+ (`build.gradle.kts` sets `compileSdk = 36` / `targetSdk = 36`) | `sdkmanager --list \| grep 'platforms'` |
| Android NDK | 27.x | `sdkmanager --list \| grep 'ndk'` |
| Rust toolchain | stable (1.88+) | `rustc --version` |
| Node.js | >=22 LTS | `node --version` |
| cargo-ndk | latest | `cargo install cargo-ndk --locked` |
| Tauri CLI | ^2 | `cargo install tauri-cli --version "^2" --locked` |
| Rust targets (Android) | 4 targets (3 suffice for the aarch64/armv7/x86\_64 flows below) | `rustup target list \| grep android` |

### Setting Up the Android SDK

**Option A — Android Studio (recommended):**

1. Install [Android Studio](https://developer.android.com/studio)
2. SDK Manager → SDK Platforms → Check **Android 15.0 (API 36)** — required by
   `compileSdk = 36`
3. SDK Manager → SDK Tools → Check **NDK (Side by side)** → version 27.x
4. Note the SDK path from **Android Studio → SDK Manager → Android SDK Location**

**Option B — Command line (headless):**

```bash
# Install sdkmanager (requires Java)
wget https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
unzip commandlinetools-linux-*.zip -d ~/Android/cmdline-tools
export ANDROID_HOME=$HOME/Android

# Accept licenses + install SDK + NDK
yes | ~/Android/cmdline-tools/latest/bin/sdkmanager --licenses
~/Android/cmdline-tools/latest/bin/sdkmanager "platforms;android-36"
~/Android/cmdline-tools/latest/bin/sdkmanager "ndk;27.0.12077973"
```

### Environment Variables

```bash
# Add to ~/.bashrc or ~/.zshrc (Linux/macOS)
export ANDROID_HOME=$HOME/Android/Sdk
export ANDROID_NDK_HOME=$HOME/Android/Sdk/ndk/27.0.12077973
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk  # or your JDK path
export PATH=$PATH:$ANDROID_HOME/platform-tools
```

```powershell
# Windows PowerShell — add to $PROFILE
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_NDK_HOME = "$env:LOCALAPPDATA\Android\Sdk\ndk\27.0.12077973"
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
```

### Rust Targets

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```

### Enable Developer Options on Device

1. Open **Settings** → **About tablet** → **Build number**
2. Tap **Build number** 7 times until "You are now a developer!"
3. Go back to **Settings** → **System** → **Developer options**
4. Enable **USB debugging**
5. Enable **Stay awake** (screen won't lock while charging)
6. (Optional) Enable **Show taps** — visual feedback for every touch

---

## Build Steps

### One-Time: Initialize the Android Project

```bash
cd apps/tablet-client
cargo tauri android init
cd ../..
```

The scaffold under `gen/android/` is **committed** (`.gitignore:167-169`: "The
generated scaffold under apps/*/gen/ is COMMITTED so CI and contributors don't
need the Tauri CLI installed to build" — 49 tracked files under
`apps/tablet-client/gen/`, including `app/build.gradle.kts` with its
`signingConfigs` block). So `cargo tauri android init` is only needed if the
directory is missing; if you see "already initialized", skip this step, and if
you do change the scaffold, commit the change.

### Option A — Debug Build (Fast, for Testing)

```bash
# Build the tablet frontend first
cd ui && npx vite build --config vite.tablet.config.ts && cd ..

# Build debug APK from tablet-client
cd apps/tablet-client
cargo tauri android build --apk --target aarch64
cd ../..
```

Output location:
```
apps/tablet-client/gen/android/app/build/outputs/apk/debug/oz-pos-tablet-arm64-v8a-debug.apk
```

### Option B — Release Build (Signed, for Physical Testing)

```bash
# Build the tablet frontend
cd ui && npx vite build --config vite.tablet.config.ts && cd ..

# Generate a keystore if you don't have one — same names the keystore guide
# mandates (android-keystore-guide.md §1): oz-pos-release.keystore / oz-pos-key
# / 1825 days
cd apps/tablet-client
keytool -genkey -v -keystore oz-pos-release.keystore \
  -alias oz-pos-key -keyalg RSA -keysize 2048 -validity 1825
# You will be prompted for the keystore password, then the key password —
# answer with the SAME password. build.gradle.kts feeds one `password` key to
# both keyPassword and storePassword (:44,46); a mismatched keystore fails
# signing at build time.
```

The build then reads `gen/android/keystore.properties` (`password` /
`keyAlias` / `storeFile` — android-keystore-guide.md §3) through the tracked
`build.gradle.kts` `signingConfigs` block; the Tauri CLI has no keystore
flags, so this file is the only signing route. When the file is absent the
APK builds unsigned. Write it from PowerShell:

```powershell
Set-Location apps/tablet-client/gen/android
"password=<same-password>" | Out-File keystore.properties -Encoding ascii
"keyAlias=oz-pos-key" | Add-Content keystore.properties
"storeFile=<full path to>\apps\tablet-client\oz-pos-release.keystore" | Add-Content keystore.properties
```

or from a POSIX shell:

```bash
cat > apps/tablet-client/gen/android/keystore.properties <<'EOF'
password=<same-password>
keyAlias=oz-pos-key
storeFile=/abs/path/to/apps/tablet-client/oz-pos-release.keystore
EOF
```

Then build:

```bash
cd apps/tablet-client
cargo tauri android build --apk --target aarch64
cd ../..
```

Output location:
```
apps/tablet-client/gen/android/app/build/outputs/apk/release/oz-pos-tablet-arm64-v8a.apk
```

> ℹ️ `storeFile` is consumed as written by gradle — give it the keystore's
> real path, not a relative guess.

### Option C — Quick Dev (Hot Reload)

```bash
cd apps/tablet-client
cargo tauri android dev
cd ../..
```

This builds a debug APK, installs it, and opens a dev server for hot reload.
Changes to UI code reflect instantly. Changes to Rust commands require a rebuild.

---

## Install the APK

### Via ADB (Wired)

```bash
# Verify device is connected
adb devices
# Expected: <device-id>  device

# Install debug APK
adb install -r apps/tablet-client/gen/android/app/build/outputs/apk/debug/oz-pos-tablet-arm64-v8a-debug.apk

# Or install release APK
adb install -r apps/tablet-client/gen/android/app/build/outputs/apk/release/oz-pos-tablet-arm64-v8a.apk

# Verify installation
adb shell pm list packages | grep ozpos
# Expected: package:com.ozpos.tablet
```

### Via USB Transfer (No ADB)

1. Copy the APK to the device via USB file transfer
2. On the device, open **Files** → navigate to the APK
3. Tap the APK → **Install** → **Install anyway** (if Play Protect warns)
4. After install → **Open**

> **Note:** If using a release APK, you must enable **Install unknown apps**
> for the file manager app: Settings → Apps → Files → Install unknown apps → Allow.

---

## Launch Test Procedure

### Phase 1: App Launch & Permissions

| Step | Action | Expected Result |
|------|--------|----------------|
| 1.1 | Tap the **OZ-POS Tablet** icon (launcher label from `res/values/strings.xml`) | App icon renders correctly (not missing/blank) |
| 1.2 | Wait for splash screen | Splash screen appears within **8 seconds** |
| 1.3 | Full load | Login screen appears in landscape orientation |
| 1.4 | Check orientation | App locks to **landscape-primary** — rotating to portrait keeps landscape |
| 1.5 | Check notch/notch cutout | UI respects safe-area insets — no content hidden behind notch |

**Pass criteria:** App launches cleanly, orientation is locked to landscape,
no black bars or layout issues on notched devices. There is **no camera
permission prompt to expect** — the tracked `AndroidManifest.xml` declares only
`INTERNET`; no barcode path uses the camera (see Phase 6).

**Common failures:**
- **"App not installed"** — APK architecture mismatch. Ensure you built for
  `aarch64` (most modern devices) or `armeabi-v7a` (older 32-bit tablets).
- **"INSTALL_FAILED_UPDATE_INCOMPATIBLE"** — Previous version installed.
  Uninstall first: `adb uninstall com.ozpos.tablet`.
- **"App keeps stopping" on launch** — Missing Android SDK/NDK version mismatch.
  Rebuild with `cargo tauri android build --apk --target aarch64`.
- **Black bars on sides** — orientation is locked in the UI layer
  (`useOrientation('landscape-primary')` in
  `ui/src/frontend/shell/tablet/TabletAppShell.tsx`); the tablet
  `tauri.conf.json` has `"windows": []` and no per-window `resizable` key to
  "fix". On unusual aspect ratios check the safe-area CSS
  (`ui/src/frontend/shell/tablet/tablet.css`) rather than the config.
- **White screen on launch** — WebView initialization issue. Check `adb logcat`
  for `chromium` or `webview` errors.

### Phase 2: Login Flow (Touch)

| Step | Action | Expected Result | Check |
|------|--------|----------------|-------|
| 2.1 | Tap PIN pad digit 1 | Key highlights on touch (visual feedback) | ☐ |
| 2.2 | Enter PIN digits | Each tap produces haptic feedback (if enabled) | ☐ |
| 2.3 | Tap Submit/OK | Loading spinner; transitions to workspace picker | ☐ |
| 2.4 | Wrong PIN (3 attempts) | Invalid-PIN error with an attempts counter — the Fluent string is `staff-login-attempts-remaining` = "(N attempts remaining)" (`ui/src/locales/staff.ftl:121`); there is no single sentence "Invalid PIN. 3 attempts remaining." | ☐ |
| 2.5 | Wrong PIN (5 attempts) | **Timed** lockout: `staff-login-lockout` = "Locked out. Try again in {seconds}s" (`staff.ftl:122`); on the session lock the variant is `session-lock-lockout` = "Wait {seconds}s." (`:143`). It self-expires — no "Contact administrator" string exists anywhere in the locales, so do NOT file a FAIL when the pad re-enables by itself | ☐ |
| 2.6 | Empty PIN validation | Submit button is **disabled** while the PIN is empty (`StaffLoginScreen.tsx:430`) — no error message fires; "Please enter a PIN." does not exist. Sub-4-digit PINs get `staff-login-pin-min-length` = "PIN must be at least 4 digits." (`staff.ftl:118`) | ☐ |

**Pass criteria:** Touch targets register correctly (≥ 48px), visual feedback
works, PIN entry is reliable with no missed taps.

### Phase 3: Workspace Selection

| Step | Action | Expected Result | Check |
|------|--------|----------------|-------|
| 3.1 | Workspace cards visible | Cards are large enough to tap reliably (≥ 48px) | ☐ |
| 3.2 | Tap a workspace card | Loading state → transitions to POS main screen | ☐ |
| 3.3 | Back gesture | Swipe from left edge or tap hardware back → returns to picker | ☐ |

**Pass criteria:** Touch targets are comfortable to tap, transitions are
smooth, back navigation works correctly.

### Phase 4: POS Main Screen (Tablet Layout)

| Step | Action | Expected Result | Check |
|------|--------|----------------|-------|
| 4.1 | Product grid loads | Products visible with name, price, image thumbnails | ☐ |
| 4.2 | Scroll product grid | Touch scroll works — smooth, no stutter | ☐ |
| 4.3 | Search products | Tap search bar → keyboard opens → results filter in real-time | ☐ |
| 4.4 | Category filter tabs | Tabs are ≥ 48px height. Tap reliably switches category. | ☐ |
| 4.5 | Cart panel | Right-side cart panel visible. Shows "Cart is empty" (`pos-cart-empty`, `ui/src/locales/sales.ftl:16`). | ☐ |
| 4.6 | Bottom navigation bar | Tabs are **workspace-driven**: nav items are filtered to the workspace's screen list and capped at 7 (`ui/src/frontend/shell/tablet/TabletAppLayout.tsx:56-58`), and labels come from each feature's registry (e.g. route `sales` renders as "POS Terminal", `ui/src/features/sales/register.tsx`). A typical POS workspace shows POS Terminal / KDS / Settings; confirm ≥ 48px tap targets | ☐ |

**Pass criteria:** All touch targets meet minimum size, scrolling is smooth,
keyboard does not cover critical UI.

### Phase 5: Cart Operations (Touch Optimised)

| Step | Action | Expected Result | Check |
|------|--------|----------------|-------|
| 5.1 | Tap a product card | Item appears in cart. Visual feedback on tap (ripple/highlight). | ☐ |
| 5.2 | Tap same product again | Quantity increments. Line total doubles. | ☐ |
| 5.3 | Tap +/- in cart | Quantity adjusts with every tap — no missed taps | ☐ |
| 5.4 | **Swipe left** on cart line item | Remove button appears on the right | ☐ |
| 5.5 | Tap remove button | Item removed from cart | ☐ |
| 5.6 | **Swipe right** on cart line item | Remove button hides again | ☐ |
| 5.7 | Cart total refreshes | Subtotal, tax, and total update on every change | ☐ |
| 5.8 | Rapid tapping test | Tap a product 10 times rapidly — quantity = 10, no duplicate lines | ☐ |

**Pass criteria:** Touch interactions are reliable, swipe gestures register
correctly, no ghost taps or missed taps.

### Phase 6: Barcode Scanning (Keyboard-Wedge / Manual)

> ⚠️ **There is no camera barcode scanner.** The tracked `AndroidManifest.xml`
> declares only `android.permission.INTERNET`; no code in `ui/src` uses
> `BarcodeDetector`/`getUserMedia`. The shipped surface is a **text field** on
> the Products lookup screen (`ProductLookupScreen.tsx:280`,
> `aria-label = barcode-input-aria` "Barcode input") — a HID keyboard-wedge
> scanner "types" the code and sends Enter, and the same field accepts manual
> typing.

| Step | Action | Expected Result | Check |
|------|--------|----------------|-------|
| 6.1 | Open the **Products** tab (route `products`) | Lookup screen shows a "Barcode input" field | ☐ |
| 6.2 | Scan a known product with a HID wedge scanner (or type the code + Enter) | Code lands in the field and the lookup resolves the product | ☐ |
| 6.3 | Successful lookup | Product shown in results; add-to-cart path from the result works | ☐ |
| 6.4 | Unknown barcode | "No results" state via `product-lookup-no-results` (`ProductLookupScreen.tsx:364`) — there is no "Product not found for barcode XXXXXX." string | ☐ |
| 6.5 | Clear the field / back out | Screen returns to its normal state; POS unaffected | ☐ |

**Pass criteria:** Wedge-typed and manually-typed codes both resolve reliably,
unknown codes produce the no-results state. Do not test camera scanning — it
is not implemented.

> Note: the retail **quick-return** flow has its own barcode field
> (`RetailModals.tsx:803`) if you also want to cover returns on-device.

### Phase 7: Payment Flow (Touch)

| Step | Action | Expected Result | Check |
|------|--------|----------------|-------|
| 7.1 | Tap **Pay** / **Checkout** | Payment screen opens | ☐ |
| 7.2 | **Swipe left** on cart panel | Payment modal opens (gesture shortcut) | ☐ |
| 7.3 | **Swipe right** on payment modal | Returns to cart (gesture shortcut) | ☐ |
| 7.4 | Select payment method | Cash / Card / Split options — the split entry is "Split Payments" (`payment-split-title`, `ui/src/locales/sales.ftl:122`); there is no "Mixed" label. Each easy to tap | ☐ |
| 7.5 | Cash: enter amount tendered | Numeric keypad is large enough to tap reliably | ☐ |
| 7.6 | Complete payment | Sale completes. Success message. | ☐ |
| 7.7 | Receipt preview | Receipt displays full details on screen | ☐ |
| 7.8 | Dismiss receipt | Returns to POS with empty cart | ☐ |

**Pass criteria:** Payment flow is fully touch-operable. All buttons are
≥ 48px. Swipe gestures work reliably.

### Phase 8: KDS (Kitchen Display Screen)

| Step | Action | Expected Result | Check |
|------|--------|----------------|-------|
| 8.1 | Navigate to KDS | Tap **KDS** in bottom navigation — KDS screen loads | ☐ |
| 8.2 | Ticket board displays | Orders shown as cards/tickets in columns | ☐ |
| 8.3 | Touch-scroll tickets | Vertical scroll on each column — smooth, no missed touches | ☐ |
| 8.4 | Tap a ticket | Opens detail view or expands for actions | ☐ |
| 8.5 | Mark as "Preparing" | Status updates. Ticket moves to next column. | ☐ |
| 8.6 | Mark as "Ready" | Status updates. Visual notification (color change). | ☐ |
| 8.7 | Mark as "Served" | Ticket removes from board or moves to "Completed" | ☐ |
| 8.8 | Pull-to-refresh | Pull down on ticket list → reloads from server | ☐ |

**Pass criteria:** KDS is fully touch-operable with large tap targets,
ticket management works end-to-end, pull-to-refresh works.

### Phase 9: Settings & Device Config

| Step | Action | Expected Result | Check |
|------|--------|----------------|-------|
| 9.1 | Navigate to Settings | Bottom nav → Settings. All sections scrollable. | ☐ |
| 9.2 | Toggle a switch | Switch responds on tap. Visual feedback immediate. | ☐ |
| 9.3 | Edit a text field | Keyboard opens. Input works. Done/Enter dismisses keyboard. | ☐ |
| 9.4 | Select from dropdown | Options are tappable, scrollable if many items. | ☐ |
| 9.5 | Printer configuration | Bluetooth/USB printer settings accessible if available | ☐ |
| 9.6 | Cloud sync settings | Sync URL, sync now button, last sync status visible | ☐ |

**Pass criteria:** All settings controls are touch-optimised. Switches,
dropdowns, and text fields are easy to interact with.

### Phase 10: Edge Cases & Tablet-Specific

| Step | Action | Expected Result | Check |
|------|--------|----------------|-------|
| 10.1 | Rotate device (if allowed) | UI reflows if rotation is unlocked; stays landscape if locked | ☐ |
| 10.2 | Press hardware back button | Navigates back one screen (not exit app) | ☐ |
| 10.3 | Press recent apps button | App is visible in recent apps list — preview renders correctly | ☐ |
| 10.4 | Suspend/resume (press power) | Resume returns to same screen. No data loss. | ☐ |
| 10.5 | Disconnect WiFi | Offline banner appears within 3 seconds | ☐ |
| 10.6 | Reconnect WiFi | Banner disappears. Sync resumes. | ☐ |
| 10.7 | Low battery (≤ 15%) | App continues normally. No performance degradation. | ☐ |
| 10.8 | Headset connected | Audio feedback works (if app plays any sounds) | ☐ |
| 10.9 | Sleep timeout | Screen turns off after system timeout. Unlock returns to app. | ☐ |
| 10.10 | Rapid orientation changes | UI does not crash or corrupt when rapidly rotating | ☐ |
| 10.11 | Screen recording | App renders correctly under screen recording (no black box) | ☐ |
| 10.12 | Split-screen (Android 7.0+) | App works in split-screen mode. May be letterboxed. | ☐ |

**Pass criteria:** All edge cases handled gracefully — no crashes, data loss,
or visual corruption.

---

## Performance Checkpoints

| Metric | Acceptable | Target | Measurement |
|--------|-----------|--------|-------------|
| Cold start (first launch after install) | < 10 s | < 6 s | Stopwatch from tap to login screen |
| Warm start (app in memory) | < 4 s | < 2 s | Stopwatch |
| Product grid load (500 products) | < 3 s | < 1 s | Perceived |
| Search response (type-ahead) | < 500 ms | < 200 ms | Perceived latency |
| Barcode scan (wedge/manual → lookup result) | < 3 s | < 1.5 s | Stopwatch from code entry to product shown (keyboard-wedge scanner or typed; see Phase 6 — no camera path exists) |
| Cart rendering (50 items) | < 500 ms | < 100 ms | Perceived |
| Sale completion (Pay → done) | < 3 s | < 1 s | Stopwatch |
| KDS ticket load (20 tickets) | < 3 s | < 1 s | Perceived |
| Memory usage (idle) | < 150 MB | < 100 MB | Android Studio Profiler |
| Memory usage (loaded) | < 300 MB | < 200 MB | Android Studio Profiler |
| Battery drain | < 5%/hour | < 2%/hour | Battery settings |
| APK size (arm64) | < 80 MB | < 50 MB | File explorer |
| App data size (fresh install) | < 30 MB | < 20 MB | Settings → Apps → OZ-POS → Storage |

### Measuring Performance

**Using Android Studio Profiler:**

1. Connect device via USB
2. Open Android Studio → **View** → **Tool Windows** → **Profiler**
3. Select `com.ozpos.tablet` from the device dropdown
4. Monitor **CPU**, **Memory**, **Network**, and **Energy** in real time

**Using `adb`:**

```bash
# Memory (RSS/PSS in KB)
adb shell dumpsys meminfo com.ozpos.tablet

# Battery stats
adb shell dumpsys batterystats --charged com.ozpos.tablet

# CPU usage — the Android process name is the applicationId `com.ozpos.tablet`
# (build.gradle.kts:34), so grep on `ozpos` WITHOUT the hyphen; `grep oz-pos`
# silently returns nothing.
adb shell top -n 1 | grep ozpos

# Startup time
adb logcat -b events | grep "am_proc_start"
```

---

## Log Capture

### ADB Logcat

```bash
# Continuous log stream (filter by app)
adb logcat -v time -s "oz-pos-tablet" "Tauri" "Rust" "chromium" "WebView"

# Filter to only errors — match `ozpos` (the process is `com.ozpos.tablet`,
# the Rust lib is `oz_pos_tablet_lib`; neither contains "oz-pos")
adb logcat -v time *:E | grep -i "ozpos\|oz_pos\|rust\|panic"

# Save to file
adb logcat -d > android-launch-log-$(date +%Y%m%d).txt

# Filter by PID (get PID first — same un-hyphenated process name)
adb shell ps | grep ozpos
adb logcat -v time --pid=<PID>
```

### Crash Logs

```bash
# Native crashes (ANR / SIGSEGV)
adb logcat -b crash

# ANR traces
adb shell ls -la /data/anr/
adb shell cat /data/anr/traces.txt 2>/dev/null

# Tombstones (native crash dumps)
adb shell ls -la /data/tombstones/
adb shell cat /data/tombstones/tombstone_00
```

### Screenshot Capture

```bash
# Take a screenshot
adb shell screencap /sdcard/oz-pos-screenshot.png
adb pull /sdcard/oz-pos-screenshot.png

# Record screen video (30s)
adb shell screenrecord --time-limit 30 /sdcard/oz-pos-screenrecord.mp4
adb pull /sdcard/oz-pos-screenrecord.mp4
```

---

## Known Android-Specific Issues

| Issue | Symptom | Workaround | Status |
|-------|---------|-----------|--------|
| USB Debugging not detected | `adb devices` shows empty | Re-enable USB Debugging, re-plug cable, check driver | External |
| Bad USB cable | `adb` connects/disconnects repeatedly | Use a known-good data cable | External |
| Android WebView outdated | White screen or JS errors | Update WebView via Google Play Store | External |
| Chinese tablet (no Google Play) | WebView component may be missing | Install GMS or use a WebView APK | External |
| SAMOLED burn-in | Persistent UI elements leave ghost marks | Use dark mode or reduce static elements | Investigate |
| Bluetooth printer pairing | Printer not discovered | Check Bluetooth compatibility list | Investigate |
| Camera barcode on low-light | Scan fails consistently | Enable flashlight or use an external scanner | Investigate |
| Samsung DeX mode | App may launch in DeX desktop mode | Close DeX or test in standard Android mode | External |
| Huawei devices (no GMS) | `cargo tauri android init` may fail | Use AOSP-based SDK instead of Google SDK | External |
| Concurrent notifications | Toast/snackbar overlaps with Android toast | Reduce notification cadence | By Design |

---

## Verification Checklist

```
☐ Prerequisites: JDK 17+, Android SDK 34+, NDK 27, cargo-ndk, Rust targets

☐ BUILD
   ☐ Frontend builds with vite.tablet.config.ts
   ☐ Android project initialized (cargo tauri android init)
   ☐ Debug APK builds successfully
   ☐ APK size < 80 MB

☐ INSTALL
   ☐ Device connected via ADB
   ☐ APK installed without errors
   ☐ App icon visible in launcher

☐ PHASE 1 — Launch & Permissions
   ☐ App launches within 8 seconds
   ☐ Orientation locks to landscape
   ☐ Safe-area insets respected (notch/cutout)
   ☐ Camera permission dialog (if barcode enabled)

☐ PHASE 2 — Login
   ☐ PIN entry works (touch numpad)
   ☐ Wrong PIN rejected
   ☐ Account locks after 5 attempts
   ☐ Valid PIN navigates to workspace picker

☐ PHASE 3 — Workspace
   ☐ Workspace cards tappable
   ☐ Back gesture works
   ☐ Transition to POS smooth

☐ PHASE 4 — POS Screen
   ☐ Product grid loads (< 3 s)
   ☐ Search responsive (< 500 ms)
   ☐ Category tabs tappable (≥ 48px)
   ☐ Bottom navigation accessible

☐ PHASE 5 — Cart (Touch)
   ☐ Add item to cart (tap)
   ☐ Swipe left to reveal remove
   ☐ Swipe right to hide remove
   ☐ Quantity increment/decrement reliable
   ☐ Total recalculates correctly

☐ PHASE 6 — Barcode Scanning (Keyboard-Wedge / Manual)
   ☐ Camera preview opens
   ☐ Barcode scans successfully
   ☐ Unknown barcode shows error
   ☐ Cancel returns to POS

☐ PHASE 7 — Payment
   ☐ Payment modal opens (tap + swipe)
   ☐ Cash/card selection works
   ☐ Change due calculated
   ☐ Sale completes successfully

☐ PHASE 8 — KDS
   ☐ Ticket board loads
   ☐ Touch scroll works
   ☐ Status changes (Preparing/Ready/Served)
   ☐ Pull-to-refresh works

☐ PHASE 9 — Settings
   ☐ Switches toggle reliably
   ☐ Text inputs editable
   ☐ Dropdowns selectable

☐ PHASE 10 — Edge Cases
   ☐ Suspend/resume (no data loss)
   ☐ Offline mode (WiFi disconnect)
   ☐ Hardware back button
   ☐ Split-screen mode

☐ PERFORMANCE
   ☐ Cold start < 10 s
   ☐ Memory usage < 150 MB (idle)
   ☐ Battery drain < 5%/hour
   ☐ Barcode scan < 3 s

☐ LOGS
   ☐ Logcat captured
   ☐ No ERROR or FATAL entries
   ☐ Crash logs saved (if crashed)
```

---

## Reporting Results

```yaml
Date: YYYY-MM-DD
Tester: <name>
Build: debug / release
Version: 0.0.X
Device: <make/model>
Android Version: 10 / 11 / 12 / 13 / 14
Security Patch: <YYYY-MM-DD>
Screen: <resolution> @ <density>dpi
Orientation: landscape-primary
Result: PASS / FAIL / PARTIAL

Failures:
  - Phase X, Step Y: <description>
  - Phase X, Step Y: <description>

Notes:
  - <any observations, flaky tests, or environmental quirks>
  - Barcode scanner model: <model>
  - Printer (if tested): <model>
```

---

## Related

- [Mobile Build & Deployment Guide](https://github.com/kardelitaitu/oz-pos/tree/main/packaging/mobile) — Full Android/iOS build pipeline
- [Tablet Client Notes](https://github.com/kardelitaitu/oz-pos/blob/main/apps/tablet-client/AGENTS.md) — Android dev conventions
- [iPad Launch Test](./ios-install-test.md) — iOS equivalent guide
- [Windows Launch Test](./windows-launch-test.md) — Desktop equivalent guide
- [Linux Launch Test](./linux-launch-test.md) — Linux equivalent guide
- [Tauri Mobile Guide](https://v2.tauri.app/start/mobile/) — Official Tauri mobile docs
- [Android Developer Docs](https://developer.android.com/docs) — SDK reference

---

> last audited 08-08-26 by docs-auditor
