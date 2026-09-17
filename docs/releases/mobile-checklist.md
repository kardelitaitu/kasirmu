# Mobile Release Checklist

<!-- Audit stamp: 2026-08-31 · docs-auditor · status: ACCURATE (build claims verified) · verified against HEAD: Android minSdkVersion 26 (tauri.conf.json:34 + gen/android/app/build.gradle.kts:35); iOS minimumSystemVersion 16.0 (tauri.conf.json:37); APK artifact name oz-pos-tablet-aarch64.apk (android.yml:156); APPLE_TEAM_ID in ios.yml; Android Build + iOS Build workflows exist (android.yml/ios.yml). NFC removed (round-14 fix confirmed absent). QA targets (cold-start ≤5s, memory ≤200MB, touch ≥44px, iPad sizes) are test criteria, not code-falsifiable -->

> **Purpose:** Pre-release verification for Android APK and iOS IPA builds.
> Run through this checklist before every mobile release.
>
> **Estimated time:** 45–60 minutes

## Android

### Build Verification

- [ ] **APK builds without errors**
  - Trigger: GitHub Actions **Android Build** workflow
  - Download the APK artifact
- [ ] **APK is signed**
  - `apksigner verify --print-certs oz-pos-tablet-aarch64.apk`
  - CN matches the release keystore DN
- [ ] **APK size is reasonable**
  - Compare against previous release (±5 MB is normal)
  - If >100 MB, investigate debug symbols or unused assets

### Installation

- [ ] **APK installs cleanly**
  - `adb install oz-pos-tablet-aarch64.apk`
  - No INSTALL_FAILED_* errors
- [ ] **App launches without crash**
  - Cold start ≤ 5 seconds on a mid-range device (e.g., Samsung A54)
- [ ] **Permissions granted correctly**
  - Camera (barcode scanning)
  - Storage (backup export)
  - Bluetooth (receipt printer, barcode scanner)

### Functional Testing

- [ ] **Staff login works** (PIN entry)
- [ ] **Barcode scanner** scans a test barcode
- [ ] **POS flow:** Add item → complete sale → receipt
- [ ] **Settings:** All tabs open without error
- [ ] **Offline mode:** Enable airplane mode → complete sale → reconnect → sync
- [ ] **Touch targets ≥ 44px** (all interactive elements)
- [ ] **Orientation:** App works in both portrait and landscape
- [ ] **Back button:** Does not accidentally close the app (uses in-app navigation)

---

## iOS

### Build Verification

- [ ] **IPA builds without errors**
  - Trigger: GitHub Actions **iOS Build** workflow (macOS runner)
  - Download the IPA artifact
- [ ] **IPA is signed**
  - `codesign -dv --verbose=4 kasir.mu.app`
  - Team ID matches `APPLE_TEAM_ID`
- [ ] **IPA size is reasonable**
  - Compare against previous release (typically 30–80 MB)

### Installation (TestFlight)

- [ ] **IPA passes App Store Connect validation**
  - No "Invalid Binary" or missing icon errors
- [ ] **Build appears in TestFlight** within 30 minutes of upload
- [ ] **Test invitation email received** by internal testers
- [ ] **App installs from TestFlight** without errors

### Functional Testing

- [ ] **Staff login works** (PIN entry)
- [ ] **Touch targets ≥ 44px** (all interactive elements)
- [ ] **Split-view multitasking:** App renders correctly in 1/2 and 1/3 width
- [ ] **Swipe gestures:** Swipe-left/right on cart panel works (P7-1)
- [ ] **Keyboard:** Hardware keyboard shortcuts work (F1–F12)
- [ ] **Orientation:** App works in both portrait and landscape
- [ ] **Home indicator:** Nothing is obscured by the home indicator or notch
- [ ] **Dynamic Type:** UI remains usable with larger accessibility text sizes

### Device Coverage

Test on at least these iPad sizes:

| iPad Model | Screen Size | Notes |
|-----------|-------------|-------|
| iPad Pro 12.9" | 2048×2732 | Full layout |
| iPad Air 10.9" | 1640×2360 | Mid-range |
| iPad Mini 8.3" | 1488×2266 | Compact layout |
| iPad (gen 10) 10.9" | 1620×2160 | Common enterprise device |

---

## Common Checklist

### Security & Compliance

- [ ] **No debug logs in release build**
  - Check Logcat (Android) / Console (iOS) for `DEBUG`, `TRACE`, or
    sensitive data exposure
- [ ] **okhttp3/NSURLSession logging disabled**
- [ ] **SSL pinning enabled** (if cloud sync is configured)
- [ ] **Minimum OS version verified**
  - Android: API 26 (Android 8.0)
  - iOS: 16.0

### Performance

- [ ] **Cold start ≤ 5 seconds**
- [ ] **Warm start ≤ 2 seconds**
- [ ] **Memory usage ≤ 200 MB** during normal POS operation
- [ ] **No jank / dropped frames** during cart operations

### Data Integrity

- [ ] **Offline queue** works: 10+ transactions queued, then synced
- [ ] **Backup & restore** works end-to-end
- [ ] **No data loss** after force-kill + relaunch

---

## Sign-off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| QA Tester | | | |
| Developer | | | |
| Product Owner | | | |

> Once signed off, tag the release: `git tag v<version> && git push origin v<version>`

> last audited 31-08-26 by docs-auditor
