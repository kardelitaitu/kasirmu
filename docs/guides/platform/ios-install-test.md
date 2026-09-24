# iPad (iOS) Install Test — kasir.mu
<!-- Audit stamp: 2026-09-09 · DSH · status: ACCURATE AFTER REPAIR (2 findings) · Both were the same retirement: "Option D — Via CI" asserted that .github/workflows/ios.yml builds a signed IPA on tag or manual trigger, and the Related links pointed at the live blob URL for that file. Reality verified from the files: GitHub only executes *.yml, ios.yml has been .github/workflows/ios.yml.bak since 23c963303 on 2026-09-02 (git log --name-status shows the R100 rename), and the sole tag-triggered live workflow is release.yml, which is desktop-only by its own admission at .github/workflows/release.yml:24 · Repaired by marking Option D unavailable, keeping the secret manifest as revival documentation (cited at .github/workflows/ios.yml.bak:13-19) and retargeting the link to the .bak path, which is the only one that resolves · NOT WEAKENED: no claim here was upgraded — the guide's own 08-09-26 prerequisite note at the top still stands (no gen/apple/ scaffold is committed), and that is the deeper reason this option cannot work: even restoring the workflow needs the scaffold first · LEFT ALONE: Options A–C, TestFlight and provisioning steps — third-party Xcode/Apple behaviour, unverifiable from this Windows workstation, so they were not re-checked and must not be read as verified. -->
<!-- dead-ref-prefix-ok: apps/mobile-tauri/gen/ -->

> **Prerequisite — the iOS scaffold is not in this repository.** Verified 08-09-26:
> `apps/mobile-tauri/gen/` contains only `android/` (49 tracked files) and `schemas/`.
> There is no `apple/` directory, committed or on disk. `.gitignore` states the policy
> explicitly — *"the generated scaffold under `apps/*/gen/` is COMMITTED so CI and
> contributors don't need the Tauri CLI installed to build"* — and Android follows that
> policy while iOS has never been generated. So **every `gen/apple/...` path below
> describes output of `cargo tauri ios init`, which must be run on a macOS host first.**
> The project filename is also not stable: this guide says `oz-pos-tablet.xcodeproj`
> while `docs/guides/platform/ios-build-guide.md` says `kasir.mu.xcodeproj`, and neither can be
> verified until the scaffold exists. Prefer discovery over a hardcoded name:
> `find apps/mobile-tauri/gen/apple -maxdepth 1 -name "*.xcodeproj"`.

> **Status:** Implemented (2026-07-21)
> **Target audience:** QA / developers testing on iPadOS 16+ physical iPads
> **Related:** [Mobile Build Guide](https://github.com/kardelitaitu/kasirmu/tree/main/ops/packaging/mobile) · [Tauri Tablet Config](https://github.com/kardelitaitu/kasirmu/blob/main/apps/mobile-tauri/tauri.conf.json) · [Android Install Test](./android-install-test.md) · [Windows Launch Test](./windows-launch-test.md)

This guide covers building, installing, and testing the kasir.mu tablet app
on a physical iPad device via TestFlight or direct sideloading.

---

## Prerequisites

| Requirement | Version | Check |
|-------------|---------|-------|
| Mac computer | Apple Silicon (M1+) or Intel | `system_profiler SPHardwareDataType` |
| Xcode | 16+ | `xcodebuild -version` |
| iOS SDK | 18+ | Included with Xcode |
| iPad device | iPadOS 16.0+ | Settings → General → About → iPadOS Version |
| Apple Developer account | Paid ($99/yr) or free | [developer.apple.com](https://developer.apple.com) |
| Rust toolchain | stable (1.88+) | `rustc --version` |
| Node.js | >=22 LTS | `node --version` |
| Tauri CLI | ^2 | `cargo install tauri-cli --version "^2" --locked` |
| Rust targets (iOS) | 3 targets | `rustup target list --installed \| grep ios` |
| TestFlight app | Installed on iPad | App Store → TestFlight |

### Installing Prerequisites

**Xcode:**

```bash
# Install from the Mac App Store, or:
xcode-select --install  # Command Line Tools
# Full Xcode: https://developer.apple.com/xcode/
```

**Rust + iOS targets:**

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
rustup default stable
rustup target add aarch64-apple-ios x86_64-apple-ios aarch64-apple-ios-sim
```

**Node.js:**

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
# Or on macOS: brew install node@22
```

**Tauri CLI:**

```bash
cargo install tauri-cli --version "^2" --locked
```

### Apple Developer Account Setup

1. Enroll in the **Apple Developer Program** ($99/year) at
   [developer.apple.com](https://developer.apple.com/programs/)
2. **If you don't have a paid account**, you can still test on a physical
   device with a free account, but you'll need to reinstall every 7 days.
   TestFlight requires a paid account.

### Add Device to Apple Developer Portal

For TestFlight or direct deployment, your iPad's UDID must be registered:

```bash
# Get the UDID by connecting the iPad via USB
xcrun xctrace list devices 2>&1 | grep -i ipad
# Example output: kasir.mu iPad (00008030-XXXXXXXXXXXX) ...

# Or find UDID in Xcode: Window → Devices and Simulators → select iPad
```

Then add it at [developer.apple.com](https://developer.apple.com/account/resources/devices/add).

---

## Build Steps

### One-Time: Initialize the iOS Project

```bash
cd apps/mobile-tauri
cargo tauri ios init
cd ../..
```

This generates `gen/apple/` (do **not** commit — it is .gitignored).

> **Important:** If you see "already initialized", delete it first:
> `rm -rf apps/mobile-tauri/gen/apple/` then re-run. <!-- dead-ref: ok: that dir is created by `tauri ios init` on the reader's machine; the command exists to remove it -->

### Option A — Quick Simulator Test (No Physical Device)

```bash
# Build frontend first
cd ui && npx vite build --config vite.mobile.config.ts && cd ..

# Launch in iOS simulator
cd apps/mobile-tauri
cargo tauri ios dev
cd ../..
```

This opens the iOS simulator and runs the app with hot-reload.
Useful for initial layout verification before deploying to a physical device.

### Option B — Debug IPA for Physical Device

```bash
# Build frontend
cd ui && npx vite build --config vite.mobile.config.ts && cd ..

# Build debug IPA
cd apps/mobile-tauri
cargo tauri ios build
cd ../..
```

Output location:
```
apps/mobile-tauri/gen/apple/build/oz-pos-tablet.ipa
```

### Option C — Release IPA (Signed, for TestFlight)

```bash
# Build frontend
cd ui && npx vite build --config vite.mobile.config.ts && cd ..

# Open the Xcode project to configure signing first
cd apps/mobile-tauri
cargo tauri ios init  # if not done already
open gen/apple/oz-pos-tablet.xcodeproj
```

In Xcode:
1. Select the **oz-pos-tablet** target
2. Go to **Signing & Capabilities**
3. Select your **Team** from the dropdown
4. Ensure **Bundle Identifier** is unique (e.g., `com.yourcompany.ozpos.tablet`)
5. Switch **Build Configuration** to **Release** in the scheme editor

Then build from terminal:

```bash
cargo tauri ios build --release
```

Output location:
```
apps/mobile-tauri/gen/apple/build/oz-pos-tablet.ipa
```

> ℹ️ The exact IPA output path may vary by Tauri CLI version and project name.
> If the file is not at the expected path, run:
> ```bash
> find apps/mobile-tauri/gen/apple -name "*.ipa" 2>/dev/null
> ```

### Option D — Via CI (GitHub Actions): **not available, nothing builds an IPA**

This was a live path and is not one any more. The workflow it named is retired —
`.github/workflows/ios.yml` was renamed to `.github/workflows/ios.yml.bak` by
`23c963303` on 2026-09-02 and GitHub never executes a `.bak` file — so a `v*` tag
push builds the three desktop installers and **no iOS artifact**; the live release
workflow states its own scope at `.github/workflows/release.yml:24` ("Mobile
(`android.yml.bak` / `ios.yml.bak`). Never part of this file."). Options A–C are
the only ways to get an IPA onto a device today.

What follows is kept as the recipe for whoever restores the workflow. The secret
names are the ones its retired header declares
(`.github/workflows/ios.yml.bak:13-19`):

1. Set up the required **secrets** in your GitHub repository:

   | Secret | Purpose |
   |--------|---------|
   | `APPLE_TEAM_ID` | Your Apple Developer Team ID |
   | `APPLE_BUNDLE_ID` | Bundle identifier (e.g., `mu.kasir.mobile`) |
   | `APPLE_PROV_PROFILE_BASE64` | Base64-encoded provisioning profile |
   | `APPLE_CERT_BASE64` | Base64-encoded distribution certificate p12 |
   | `APPLE_CERT_PASSWORD` | Certificate password |
   | `KEYCHAIN_PASSWORD` | Temporary keychain password (any value) |

2. Only **if the workflow is restored**, create and push a tag:
   ```bash
   git tag v0.0.16
   git push origin v0.0.16
   ```

3. Then download the IPA artifact from that Actions run. Today there is no such run:
   the only tag-triggered workflow that executes is the desktop-only release
   pipeline, so no IPA is produced and none can be downloaded.

---

## Install on iPad

### Via TestFlight (Recommended)

TestFlight is the standard Apple-sanctioned beta distribution method.
It allows you to distribute builds to up to 10,000 testers without
manual UDID registration.

**App Store Connect setup:**

1. Go to [appstoreconnect.apple.com](https://appstoreconnect.apple.com)
2. **Apps** → **+** → **New App**
3. Fill in:
   - **Platform:** iOS
   - **Name:** kasir.mu Tablet
   - **Bundle ID:** `mu.kasir.mobile` (must match Xcode)
    - **SKU:** `KASIRMU_TABLET_001`
4. Submit (app does not need to be "complete" for TestFlight)

**Upload build to TestFlight:**

```bash
# Install Xcode command line tools (includes altool/transporter)
# Option A: Xcode Organizer (GUI)
open ~/Library/Developer/Xcode/Archives/
# Find the .xcarchive → Distribute App → TestFlight

# Option B: Using Transporter (App Store Connect)
# Open the Transporter app → Add IPA → Deliver

# Option C: Using notarytool or altool (CLI)
xcrun altool --upload-app \
  -f apps/mobile-tauri/gen/apple/build/oz-pos-tablet.ipa \
  -t ios \
  -u "your-apple-id@example.com" \
  -p "@keychain:AC_PASSWORD"
```

**Add internal testers:**

1. App Store Connect → **TestFlight** → **Internal Testing**
2. Add yourself and your team members as testers
3. Build status: **Processing** (5–30 min) → **Ready to Submit**
4. Click **Submit for Review** (automated, < 1 hour)
5. Testers receive an email invitation with a TestFlight link

**Install on iPad:**

1. Install **TestFlight** from the App Store
2. Tap the invitation link (or open TestFlight → **Redeem** → enter code)
3. Tap **Install** → wait for download
4. Tap **Open** to launch kasir.mu

### Via Direct Sideloading (Free Account, 7-Day Limit)

For developers without a paid account, you can sideload with a 7-day expiry:

```bash
# Build a debug IPA
cargo tauri ios build

# Install directly via Xcode
open apps/mobile-tauri/gen/apple/oz-pos-tablet.xcodeproj
# Xcode → select your iPad from the device dropdown → Run (▶)

# Or install via iOS Console.app and ideviceinstaller
brew install ideviceinstaller
ideviceinstaller -i apps/mobile-tauri/gen/apple/build/oz-pos-tablet.ipa
```

### Update Existing Build

TestFlight handles updates seamlessly:

1. Upload a new build to App Store Connect
2. The new build appears in TestFlight automatically
3. Testers get a notification: "An update is available"
4. Tap **Update** — no data loss

---

## Launch Test Procedure

### Phase 1: App Launch & Permissions

| Step | Action | Expected Result |
|------|--------|----------------|
| 1.1 | Tap kasir.mu icon | App icon renders correctly (no broken placeholder) |
| 1.2 | Splash screen | Launch screen appears within **8 seconds** |
| 1.3 | Full load | Login screen in **landscape** orientation |
| 1.4 | Orientation lock | Rotating iPad keeps landscape. Status bar matches orientation. |
| 1.5 | Safe-area check | Content not hidden behind the **Dynamic Island** or rounded corners |
| 1.6 | Home indicator | The home indicator bar does not overlap interactive elements |
| 1.7 | Notch/bezel check | On iPad Pro (notchless): full rectangle. On iPad mini: rounded corners respected. |

**Pass criteria:** App launches cleanly, respects safe-area insets, locks to
landscape, no visual glitches on different iPad models.

**Common failures:**
- **"Unable to install"** — Device UDID not registered in Apple Developer Portal.
- **"This app cannot be installed because its integrity could not be verified"** —
  Code signing issue. Rebuild with correct certificate and provisioning profile.
- **"kasir.mu" would like to access the camera** — First-launch permission dialog.
  Must be accepted for barcode scanning.
- **"kasir.mu" Would Like to Send You Notifications** — KDS ticket alerts.
  Accept for full functionality.
- **App crashes on launch** — Check **Settings → Privacy → Analytics & Improvements →
  Analytics Data** for crash logs prefixed with `kasir.mu`.
- **Split-screen causes crash** — iPadOS 16+ split-screen compatibility issue.

### Phase 2: Login Flow (Touch + Apple Pencil)

| Step | Action | Expected Result | Check |
|------|--------|----------------|-------|
| 2.1 | Tap PIN pad key (finger) | Key highlights. Haptic feedback (if enabled in Settings). | ☐ |
| 2.2 | Tap PIN pad key (Apple Pencil) | Pencil tap registers same as finger | ☐ |
| 2.3 | Enter valid PIN | Loading spinner → workspace picker | ☐ |
| 2.4 | Wrong PIN (3 attempts) | "Invalid PIN. 3 attempts remaining." | ☐ |
| 2.5 | Account locked (5 attempts) | "Account locked. Contact administrator." | ☐ |
| 2.6 | Empty PIN | "Please enter a PIN." | ☐ |

**Pass criteria:** Touch targets ≥ 48px, Apple Pencil works as touch input,
haptic feedback when enabled.

### Phase 3: Workspace Selection

| Step | Action | Expected Result | Check |
|------|--------|----------------|-------|
| 3.1 | Workspace cards visible | Cards are large, clearly tappable | ☐ |
| 3.2 | Tap a workspace card | Transitions to POS screen with smooth animation | ☐ |
| 3.3 | Swipe from left edge (back) | Returns to workspace picker (navigation controller style) | ☐ |
| 3.4 | Multitasking gesture | Four-finger swipe left/right does not accidentally trigger | ☐ |

**Pass criteria:** Touch targets are comfortable, transitions smooth, back
navigation works, multitasking gestures don't interfere.

### Phase 4: POS Main Screen (iPad Layout)

| Step | Action | Expected Result | Check |
|------|--------|----------------|-------|
| 4.1 | Product grid loads | Grid displays with images, names, prices | ☐ |
| 4.2 | Scroll grid | Two-finger scroll. Inertia scrolling feels natural. | ☐ |
| 4.3 | Search products | Tap search → iOS keyboard slides up → results filter | ☐ |
| 4.4 | Dismiss keyboard | Tap outside search → keyboard slides down smoothly | ☐ |
| 4.5 | Category tabs | Tabs are ≥ 48px. Tap switches category reliably. | ☐ |
| 4.6 | Cart panel | Right panel visible. Shows empty state. | ☐ |
| 4.7 | Bottom nav bar | All 4+ tabs accessible. Active tab highlighted. | ☐ |

**Pass criteria:** All UI elements are touch-optimised. Keyboard appears and
dismisses naturally.

### Phase 5: Cart Operations (Swipe Gestures)

| Step | Action | Expected Result | Check |
|------|--------|----------------|-------|
| 5.1 | Tap a product | Appears in cart. Haptic confirmation. | ☐ |
| 5.2 | Tap product multiple times | Quantity increments reliably | ☐ |
| 5.3 | Tap +/- buttons | Each tap adjusts quantity. No missed taps. | ☐ |
| 5.4 | **Swipe left** on cart line item | Remove button slides in from right | ☐ |
| 5.5 | Tap remove button | Item removed. Cart total updates. | ☐ |
| 5.6 | **Swipe right** on cart line item | Remove button slides back (hides) | ☐ |
| 5.7 | **Swipe left** on cart panel | Payment modal opens (gesture shortcut) | ☐ |
| 5.8 | **Swipe right** on payment modal | Returns to cart (gesture shortcut) | ☐ |
| 5.9 | Rapid tap test (10x in 2 seconds) | Quantity = 10. No duplicate entries. | ☐ |

**Pass criteria:** All swipe gestures register reliably. iOS-native swipe
gesture feel (velocity-sensitive, rubber-banding).

### Phase 6: Barcode Scanner (Camera)

| Step | Action | Expected Result | Check |
|------|--------|----------------|-------|
| 6.1 | Tap barcode scan button | Camera preview opens (fullscreen) | ☐ |
| 6.2 | Camera permission | If first time: system dialog appears. Accept. | ☐ |
| ▶ | _Note: Barcode scanner cannot be tested in the iOS simulator_ | _(no camera hardware)_ | _Test on physical iPad_ |
| 6.3 | Scan a barcode | Auto-detects. Brief haptic + sound on success. | ☐ |
| 6.4 | Product added to cart | Item appears. Scanner may close automatically. | ☐ |
| 6.5 | Unknown barcode | "Product not found for barcode XXXXXX." | ☐ |
| 6.6 | Cancel scan | Tap X or press Home button → returns to POS | ☐ |
| 6.7 | Low-light scan | Scanner still works. iPad flash may activate. | ☐ |
| 6.8 | Switch camera (front/back) | Toggle available if multi-camera iPad | ☐ |

**Pass criteria:** Camera opens, barcodes scan reliably, permission flow works,
cancellation returns to POS.

### Phase 7: Payment Flow

| Step | Action | Expected Result | Check |
|------|--------|----------------|-------|
| 7.1 | Tap Pay / Checkout | Payment screen with amount displayed | ☐ |
| 7.2 | Select payment method | Cash / Card / Apple Pay options | ☐ |
| 7.3 | **Apple Pay** (if configured) | Apple Pay sheet slides up. Authenticate with Face ID. | ☐ |
| 7.4 | Cash: enter amount | Numeric keypad is comfortable for finger tapping | ☐ |
| 7.5 | Complete payment | Sale completes. Success animation. | ☐ |
| 7.6 | Receipt preview | Full-screen receipt. Scrollable if long. | ☐ |
| 7.7 | Share receipt | iOS share sheet available (AirDrop, Messages, Mail) | ☐ |
| 7.8 | Dismiss receipt | Returns to POS. Cart is empty. | ☐ |

**Pass criteria:** Payment flow is fully touch-operable. Apple Pay sheet works.
Share sheet integrates with iOS.

### Phase 8: KDS (Kitchen Display Screen)

| Step | Action | Expected Result | Check |
|------|--------|----------------|-------|
| 8.1 | Navigate to KDS | Bottom nav → KDS. Ticket board loads. | ☐ |
| 8.2 | Ticket columns | Pending / Preparing / Ready columns visible | ☐ |
| 8.3 | Two-finger scroll on columns | Scroll independently per column | ☐ |
| 8.4 | Tap a ticket | Expands or shows detail | ☐ |
| 8.5 | Mark as "Preparing" | Status updates. Ticket moves to next column. | ☐ |
| 8.6 | Mark as "Ready" | Status updates. Visual highlight. | ☐ |
| 8.7 | Mark as "Served" | Ticket removes from board | ☐ |
| 8.8 | Pull-to-refresh | Pull down → refresh indicator → board reloads | ☐ |

**Pass criteria:** KDS is fully touch-operable. Column scrolling works.
Pull-to-refresh feels native.

### Phase 9: Settings & Configuration

| Step | Action | Expected Result | Check |
|------|--------|----------------|-------|
| 9.1 | Navigate to Settings | All settings sections scrollable | ☐ |
| 9.2 | Toggle switches | iOS-native toggle style. Immediate response. | ☐ |
| 9.3 | Text input | Keyboard appears. Auto-correct/autocomplete works. | ☐ |
| 9.4 | Printer setup | Bluetooth printer scanning works (if available) | ☐ |
| 9.5 | AirPrint | Receipts can be printed via AirPrint | ☐ |
| 9.6 | iCloud sync | Settings persist (if iCloud-enabled) | ☐ |

**Pass criteria:** All settings controls use native iOS feel. AirPrint works
if a printer is available.

### Phase 10: iPad-Specific Edge Cases

| Step | Action | Expected Result | Check |
|------|--------|----------------|-------|
| 10.1 | **Split View** (drag app to left/right) | App resizes to half-width. UI reflows. No cutoff. *(May require `UIApplicationSupportsMultipleScenes` in Info.plist.)* | ☐ |
| 10.2 | **Slide Over** (swipe from right edge) | App runs in compact slide-over panel | ☐ |
| 10.3 | **Stage Manager** (iPadOS 16+) | App window can be resized freely. UI adapts. | ☐ |
| 10.4 | Keyboard shortcut (if hardware keyboard) | Cmd+N new sale, Cmd+F search, etc. | ☐ |
| 10.5 | Apple Pencil hover (iPad Pro M2+) | Hover state on buttons when pencil approaches | ☐ |
| 10.6 | **Suspend/resume** (press Home/Power) | Resume returns to same screen. No data loss. | ☐ |
| 10.7 | **App Switcher** (four-finger swipe up) | App visible in switcher. Thumbnail renders correctly. | ☐ |
| 10.8 | **Force quit** (swipe up in app switcher) | Re-launch works. No persistent state corruption. | ☐ |
| 10.9 | Battery at 10% | App continues normally. No performance drop. | ☐ |
| 10.10 | WiFi disconnect | Offline banner appears within 3 seconds | ☐ |
| 10.11 | WiFi reconnect | Banner disappears. Sync resumes. | ☐ |
| 10.12 | Low Power Mode | App functionality unaffected. Possible slight lag. | ☐ |
| 10.13 | Orientation lock toggle | If user disables portrait lock on iPad → app stays landscape | ☐ |
| 10.14 | **VoiceOver** (accessibility) | All interactive elements have accessible labels | ☐ |
| 10.15 | **Full Guide Access** (kiosk mode) | App works within Guided Access session | ☐ |

**Pass criteria:** All iPadOS multitasking modes work. Orientation is preserved.
Data integrity maintained through suspend/resume. Accessibility features work.

---

## Performance Checkpoints

| Metric | Acceptable | Target | Measurement |
|--------|-----------|--------|-------------|
| Cold start (first launch after install) | < 10 s | < 6 s | Stopwatch from tap to login screen |
| Warm start (app in memory) | < 4 s | < 2 s | Stopwatch |
| Product grid load (500 products) | < 3 s | < 1 s | Perceived |
| Search response (type-ahead) | < 500 ms | < 200 ms | Perceived latency |
| Barcode scan (camera → result) | < 3 s | < 1.5 s | Stopwatch |
| Cart rendering (50 items) | < 500 ms | < 100 ms | Perceived |
| Sale completion (Pay → done) | < 3 s | < 1 s | Stopwatch |
| KDS ticket load (20 tickets) | < 3 s | < 1 s | Perceived |
| Memory usage (idle) | < 150 MB | < 100 MB | Xcode Debug Navigator |
| Memory usage (loaded) | < 300 MB | < 200 MB | Xcode Debug Navigator |
| Battery drain | < 5%/hour | < 2%/hour | Settings → Battery |
| IPA size (arm64) | < 80 MB | < 50 MB | Finder |
| App data size (fresh install) | < 30 MB | < 20 MB | Settings → General → iPad Storage |

### Measuring Performance

**Using Xcode Debug Navigator:**

1. Connect iPad via USB
2. Open the Xcode project: `open apps/mobile-tauri/gen/apple/oz-pos-tablet.xcodeproj`
3. Select your iPad from the device dropdown
4. Build and run (▶)
5. The **Debug Navigator** (⌘7) shows CPU, Memory, and Energy in real time

**Using Instruments (profiling):**

```bash
# Launch Instruments from command line
xcodebuild -project apps/mobile-tauri/gen/apple/oz-pos-tablet.xcodeproj \
  -scheme "oz-pos-tablet" \
  -destination "platform=iOS,id=<device-udid>" \
  profile
```

**Using `vmmap` / `heap` (macOS):**

```bash
# These work for the iOS simulator
xcrun vmmap --summary oz-pos-tablet
xcrun heap oz-pos-tablet
```

---

## Log Capture

### Xcode Console

While running from Xcode, logs appear in the **Xcode Console** (⌘⇧C).
Filter by "oz-pos-tablet" or "Tauri".

### macOS Console.app

1. Connect iPad via USB
2. Open **Console.app** on your Mac
3. Select your iPad under **Devices** in the sidebar
4. Filter by `oz-pos-tablet`
5. Logs stream in real time

### Device Crash Logs

```bash
# Symbolicate and view crash logs
# Option A: Xcode → Window → Organizer → Crashes
# Option B: From the device:
xcrun symbolicatecrash -v crashlog.crash

# Download crash logs from device
# Settings → Privacy → Analytics & Improvements → Analytics Data
# Look for kasir.mu_*.ips → Share → save to Files
```

### App Store Connect Crash Data

For TestFlight builds:

1. App Store Connect → **TestFlight** → select build
2. **Crash Reports** tab shows anonymized crash logs
3. **Feedback** tab shows tester-submitted screenshots and logs

### Screenshot Capture

```bash
# Take a screenshot (iPad button combo: Power + Volume Up)
# Or via QuickTime Player:
# File → New Movie Recording → select iPad → screenshot button

# Simulator screenshots (to file):
xcrun simctl io booted screenshot oz-pos-screenshot.png
```

---

## Known iOS-Specific Issues

| Issue | Symptom | Workaround | Status |
|-------|---------|-----------|--------|
| Provisioning profile expires | App crashes on launch after 7 days (free account) | Reinstall via Xcode every 7 days | External |
| Certificate expires | TestFlight build rejected | Renew Apple Distribution certificate yearly | External |
| iPadOS 16 WebKit bug | White screen on some iPad models | Update to iPadOS 16.4+ | External |
| Split-View layout breakage | UI elements overlap in 50% width | Ensure responsive layout handles compact width | Investigate |
| Keyboard covers input | Bottom nav hidden when keyboard is up | Scroll input into view | Verify |
| AirPrint not discovered | Printer not listed in AirPrint | Check printer compatibility | External |
| Apple Pay not configured | Apple Pay sheet doesn't appear | Set up a payment token in Settings | By Design |
| Bluetooth printer pairing | Printer not discovered in iOS | Check MFi certification | Investigate |
| Stage Manager vs fullscreen | UI may appear in windowed mode | User can drag to fullscreen | By Design |
| Memory pressure (older iPads) | App crashes under memory pressure | Reduce image cache on iPad Air 2/3 | Investigate |
| Dark Mode rendering | Colors look different in dark mode | Ensure CSS supports `prefers-color-scheme` | Verify |
| VoiceOver focus order | Accessibility focus jumps unexpectedly | Audit ARIA labels and tab order | Investigate |

---

## Verification Checklist

```
☐ Prerequisites: macOS, Xcode 16+, Apple Developer account,
    Rust iOS targets, Tauri CLI

☐ BUILD
   ☐ iOS project initialized (cargo tauri ios init)
   ☐ Xcode project opens without errors
   ☐ Signing configured (Team + Bundle ID)
   ☐ Debug IPA builds successfully
   ☐ IPA size < 80 MB

☐ INSTALL
   ☐ TestFlight build uploaded and processed
   ☐ TestFlight invitation received on iPad
   ☐ App installs without errors
   ☐ App icon visible on home screen

☐ PHASE 1 — Launch & Permissions
   ☐ App launches within 8 seconds
   ☐ Orientation locks to landscape
   ☐ Safe-area insets respected
   ☐ Camera permission dialog

☐ PHASE 2 — Login
   ☐ PIN entry works (finger + Apple Pencil)
   ☐ Wrong PIN rejected, account locks
   ☐ Valid PIN → workspace picker

☐ PHASE 3 — Workspace
   ☐ Workspace cards tappable
   ☐ Back gesture works
   ☐ Multitasking gestures don't interfere

☐ PHASE 4 — POS Screen
   ☐ Product grid loads (< 3 s)
   ☐ Search responsive with iOS keyboard
   ☐ Keyboard dismisses gracefully
   ☐ Bottom navigation accessible

☐ PHASE 5 — Cart & Swipe Gestures
   ☐ Add item to cart (tap)
   ☐ Swipe left on line → reveal remove
   ☐ Swipe right on line → hide remove
   ☐ Swipe left on cart → open payment
   ☐ Swipe right on payment → back to cart
   ☐ Rapid tap test (no duplicates)

☐ PHASE 6 — Barcode Scanner
   ☐ Camera preview opens
   ☐ Barcode scans successfully
   ☐ Unknown barcode shows error
   ☐ Cancel returns to POS

☐ PHASE 7 — Payment
   ☐ Payment methods selectable
   ☐ Apple Pay (if configured)
   ☐ Cash/card/mixed payment
   ☐ Receipt preview + share sheet
   ☐ Sale completes successfully

☐ PHASE 8 — KDS
   ☐ Ticket board loads
   ☐ Two-finger scroll on columns
   ☐ Status changes work
   ☐ Pull-to-refresh works

☐ PHASE 9 — Settings
   ☐ Switches toggle reliably
   ☐ Text inputs editable (iOS keyboard)
   ☐ AirPrint (if printer available)

☐ PHASE 10 — iPad Edge Cases
   ☐ Split View (half-width UI)
   ☐ Slide Over
   ☐ Stage Manager (iPadOS 16+)
   ☐ Suspend/resume (no data loss)
   ☐ Offline mode
   ☐ VoiceOver accessibility
   ☐ Guided Access (kiosk mode)

☐ PERFORMANCE
   ☐ Cold start < 10 s
   ☐ Memory usage < 150 MB (idle)
   ☐ Battery drain < 5%/hour
   ☐ Barcode scan < 3 s

☐ LOGS
   ☐ Console logs captured
   ☐ No ERROR or FATAL entries
   ☐ Crash logs saved (if crashed)
```

---

## Reporting Results

```yaml
Date: YYYY-MM-DD
Tester: <name>
Build: debug / release / TestFlight
Version: 0.0.X
Device: iPad Pro 11" (M4) / iPad Air 5 / iPad mini 6 / ...
iPadOS Version: 16.x / 17.x / 18.x
Distribution: TestFlight / Xcode Direct / Sideload
Result: PASS / FAIL / PARTIAL

Failures:
  - Phase X, Step Y: <description>
  - Phase X, Step Y: <description>

Notes:
  - <any observations, flaky tests, or environmental quirks>
  - Printer (if tested): <model>
  - Barcode scanner: Camera / External
  - Apple Pay: Configured / Not configured
```

---

## Related

- [Mobile Build & Deployment Guide](https://github.com/kardelitaitu/kasirmu/tree/main/ops/packaging/mobile) — Full Android/iOS build pipeline
- [Android Install Test](./android-install-test.md) — Android equivalent guide
- [Windows Launch Test](./windows-launch-test.md) — Desktop equivalent guide
- [Linux Launch Test](./linux-launch-test.md) — Linux equivalent guide
- [Tauri iOS Guide](https://v2.tauri.app/start/mobile/ios/) — Official Tauri iOS docs
- [Apple Developer Documentation](https://developer.apple.com/documentation/)
- [TestFlight Guide](https://developer.apple.com/testflight/)
- [iOS CI Workflow — retired](https://github.com/kardelitaitu/kasirmu/blob/main/.github/workflows/ios.yml.bak) — inert `.bak` since `23c963303`; kept only as the build recipe for a future restoration

---

> last audited 09-09-26 by docs-auditor
