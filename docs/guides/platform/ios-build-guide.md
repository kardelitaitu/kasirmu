# iOS / iPad Build Guide
<!-- Audit stamp: 2026-09-09 · DSH · status: ACCURATE AFTER REPAIR (1 finding) · Finding: §3 told the reader to "configure the GitHub secrets as documented in .github/workflows/ios.yml" — that file is .github/workflows/ios.yml.bak since 23c963303 (2026-09-02) and GitHub never executes a .bak, so no live workflow consumes any of those secrets; the repair keeps the secret manifest (cited at .github/workflows/ios.yml.bak:13-19) but says plainly that it is revival documentation, not today's pipeline · VERIFIED: git grep -l CLOUDFLARE/APPLE secret names across .github/workflows shows the live pair is dev-ci.yml + release.yml only; git grep -in ios -- .github/workflows/dev-ci.yml .github/workflows/release.yml returns exactly one hit, the comment at .github/workflows/release.yml:24 ("Mobile (android.yml.bak / ios.yml.bak). Never part of this file.") · LEFT ALONE deliberately: the whole guide is still forward-looking because the 08-09-26 prerequisite note at the top is true — apps/mobile-tauri/gen/ has no apple/ scaffold committed, so nothing here can be executed end-to-end and no claim below it was re-verified against Xcode behaviour · The macOS/keychain commands are third-party tool usage, not repo claims; unverified from this workstation. -->
<!-- dead-ref-prefix-ok: apps/mobile-tauri/gen/ -->

> **Prerequisite — the iOS scaffold is not in this repository.** Verified 08-09-26:
> `apps/mobile-tauri/gen/` contains only `android/` (49 tracked files) and `schemas/`.
> There is no `apple/` directory, committed or on disk. `.gitignore` states the policy
> explicitly — *"the generated scaffold under `apps/*/gen/` is COMMITTED so CI and
> contributors don't need the Tauri CLI installed to build"* — and Android follows that
> policy while iOS has never been generated. So **every `gen/apple/...` path below
> describes output of `cargo tauri ios init`, which must be run on a macOS host first.**
> The project filename is also not stable: this guide says `oz-pos-tablet.xcodeproj`
> while `docs/guides/ios-build-guide.md` says `kasir.mu.xcodeproj`, and neither can be
> verified until the scaffold exists. Prefer discovery over a hardcoded name:
> `find apps/mobile-tauri/gen/apple -maxdepth 1 -name "*.xcodeproj"`.

> **Purpose:** Build, sign, and distribute kasir.mu tablet client for iOS/iPad.
>
> **Related:** [iOS Install Test](./ios-install-test.md) · [Android Keystore Guide](./android-keystore-guide.md)
> · [Mobile Release Checklist](https://github.com/kardelitaitu/oz-pos/blob/main/docs/releases/mobile-checklist.md)

## Prerequisites

### Hardware

- **macOS** (Apple Silicon or Intel) with Xcode 16+
- A physical iPad for testing (simulator works for UI, but not for
  camera/barcode scanning or NFC)

### Accounts

- **Apple Developer Program** ($99/year) — required for TestFlight and
  App Store distribution
- **Apple Team ID** — found at [developer.apple.com](https://developer.apple.com)
  → Account → Membership

### Software

| Tool | Version | Notes |
|------|---------|-------|
| Xcode | 16+ | From Mac App Store or Xcodes.app |
| Rust | Stable (1.88+) | Via rustup |
| Node.js | 22+ (project floor; 24 recommended) | Via nvm or fnm |
| Tauri CLI | 2.x | `cargo install tauri-cli --version "^2"` |
| cocoapods | Latest | `sudo gem install cocoapods` (if needed) |

## 1. Xcode Setup

### Install Xcode

```bash
# Option A: Mac App Store (recommended)
# Search "Xcode" and install

# Option B: Xcodes.app (multiple versions)
brew install xcodesorg/made/xcodes
xcodes install 16.2

# Accept license
sudo xcodebuild -license accept
```

### Install Xcode Command Line Tools

```bash
xcode-select --install
# Or point to the installed Xcode
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

## 2. Tauri iOS Project Initialization

```bash
# From the repo root
cd apps/mobile-tauri

# Initialize the iOS project (generates gen/apple/ directory)
cargo tauri ios init

# Verify the project was created
ls -la gen/apple/
# Should show *.xcodeproj or *.xcworkspace
```

## 3. Code Signing

### Option A: Automatic (Xcode manages profiles)

1. Open the generated Xcode project:
   ```bash
   open apps/mobile-tauri/gen/apple/kasir.mu.xcodeproj
   ```
2. Select the target → **Signing & Capabilities**
3. Check **Automatically manage signing**
4. Select your **Team** from the dropdown
5. Xcode will create provisioning profiles automatically

### Option B: Manual (CI/preferred for release)

Generate a distribution certificate and provisioning profile:

```bash
# From a machine with the Apple Developer account
# These steps are manual in Xcode:

# 1. Xcode → Settings → Accounts → Add Apple ID
# 2. Create a Distribution Certificate:
#    Xcode → Preferences → Accounts → Manage Certificates → [+]
#    → Apple Distribution
# 3. Create a Provisioning Profile:
#    developer.apple.com → Certificates, Identifiers & Profiles
#    → Profiles → [+] → App Store → Select App ID → Select Certificate
# 4. Download and double-click to install
```

### For CI, export the certificate:

```bash
# Export the p12 from Keychain Access
# (requires the certificate installed on a Mac)
security find-identity -v -p basic
# Note the SHA-1 hash of the distribution certificate

# Export to p12
security export -k login.keychain \
  -t certs \
  -f pkcs12 \
  -o /tmp/dist-cert.p12 \
  -P "temporary-password"

# Base64 encode
base64 -w0 /tmp/dist-cert.p12 > dist-cert.p12.b64
```

Then keep these credentials somewhere durable — but note that **no live workflow
consumes them:** the workflow this step pointed at is retired, renamed from
`.github/workflows/ios.yml` to `.github/workflows/ios.yml.bak` by `23c963303` on
2026-09-02, and GitHub never executes a `.bak` file. A GitHub Actions secret of
these names is therefore read by nothing today. The six names and their purposes are still listed in that inert
workflow's own header (`.github/workflows/ios.yml.bak:13-19`: `APPLE_TEAM_ID`,
`APPLE_BUNDLE_ID`, `APPLE_PROV_PROFILE_BASE64`, `APPLE_CERT_BASE64`,
`APPLE_CERT_PASSWORD`, `KEYCHAIN_PASSWORD`) and are the manifest for whoever
restores it. For the local route, the values stay on the macOS host: Xcode's
keychain plus the provisioning profile below. The only release workflow that runs
is desktop-only by design — see `.github/workflows/release.yml:24`.

## 4. Building for Simulator

```bash
cd apps/mobile-tauri

# Build and run on the default iOS simulator
cargo tauri ios build --debug
cargo tauri ios open  # Opens Xcode with the project
```

Then select an iPad simulator and press **Run** (▶).

## 5. Building for Release (IPA)

### Local build

```bash
cd apps/mobile-tauri

# Build a release IPA
cargo tauri ios build --release

# Find the IPA
find gen/apple -name "*.ipa" 2>/dev/null
```

### CI build

Push a tag to trigger the `iOS Build` workflow:

```bash
git tag v0.0.17
git push origin v0.0.17
```

Or trigger manually:
1. GitHub → Actions → **iOS Build** → **Run workflow**

## 6. TestFlight Distribution

### Prerequisites

- Apple Developer Program membership
- App record created in App Store Connect

### Steps

1. **Create app record**:
   - Go to [App Store Connect](https://appstoreconnect.apple.com)
   - → Apps → [+] → New App
   - Platform: **iOS/iPadOS**
   - Name: **kasir.mu Tablet**
   - Bundle ID: Match the `APPLE_BUNDLE_ID` secret

2. **Upload IPA via Transporter**:
   - Download [Transporter](https://apps.apple.com/us/app/transporter/id1450874784)
   from the Mac App Store
   - Open Transporter → [+] → Select IPA → Deliver
   - Wait for validation and delivery (~5–10 minutes)

3. **Set up TestFlight**:
   - App Store Connect → App → TestFlight → **Manage Testers**
   - Add internal testers (Apple ID emails)
   - Enable **TestFlight Beta Testing**

4. **Invite testers**:
   - Once the build is processed (15–30 minutes),
     click the build number → **Start Testing**
   - Testers receive an invitation email from Apple

## 7. Troubleshooting

### "No Xcode project found"

After `cargo tauri ios init`, the project may be in a different location:

```bash
# Search for the generated project
find apps/mobile-tauri/gen -name "*.xcodeproj" -maxdepth 3
find apps/mobile-tauri/gen -name "*.xcworkspace" -maxdepth 3
```

### Code signing fails in CI

```bash
# Verify certificate was imported correctly
security find-identity -v -p basic

# Verify provisioning profile
security cms -D -i /path/to/profile.mobileprovision

# Check for expired profiles
ls -la "$HOME/Library/MobileDevice/Provisioning Profiles/"
```

### IPA not generated

The IPA output path varies by Xcode version:

```bash
# Common locations
find target -name "*.ipa" 2>/dev/null
find apps/mobile-tauri/gen/apple -name "*.ipa" 2>/dev/null
find apps/mobile-tauri/target -name "*.ipa" 2>/dev/null
```

---

> last audited 09-09-26 by docs-auditor
