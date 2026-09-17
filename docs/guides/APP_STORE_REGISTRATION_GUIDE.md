# App Store Registration & Distribution Guide
<!-- Audit stamp: 2026-09-09 · DSH · status: ACCURATE AFTER REPAIR (1 finding) · Finding: §3 asserted ".github/workflows/android.yml builds a signed aarch64 APK on v* tag push" in present tense; the checker (.agents/skills/docs-auditor/scripts/check-ci-claims.py) flagged it because GitHub reads only *.yml and that file is .github/workflows/android.yml.bak (renamed by 23c963303 on 2026-09-02, git log --name-status shows R100) · Repaired by stating what is live and what is not, with the header of the live release workflow as the citation (.github/workflows/release.yml:24 says Mobile is "Never part of this file"), and by leaving the honest local-build route in place of the deleted automation · VERIFIED from the files: live set is exactly dev-ci.yml + release.yml; release.yml triggers push tags v* with jobs release-validate / release-build / release-publish; dev-ci.yml triggers pull_request branches [main] + workflow_dispatch and has no push trigger; no live workflow mentions ndk, android cargo-ndk, or an IPA step (git grep -in android -- .github/workflows/dev-ci.yml .github/workflows/release.yml → only the release.yml:24 comment) · NOT FIXED, FLAGGED: §2.5 still tells the reader to paste release notes for "Version 0.0.25" while the repo version is locked at 0.0.37 — a stale example in a store-listing step, outside this pass's CI-claim scope · LEFT ALONE: the Partner Center / Play Console manual steps, which are external-process facts no file in this repo can confirm. -->

> **Target Audience:** Developers, Release Engineers, and Store Admins publishing kasir.mu to official App Stores.

This guide provides end-to-end instructions for registering, signing, building, and publishing **kasir.mu** on the **Microsoft Store (Windows Desktop)** and **Google Play Store (Android Tablet)**.

---

## 🪟 1. Microsoft Store (Windows Desktop Client)

### Step 1: Create a Microsoft Partner Center Account
1. Go to the [Microsoft Partner Center Portal](https://partner.microsoft.com/dashboard).
2. Register for a **Windows Developer Account**:
   - **Individual Account**: ~$19 USD one-time registration fee.
   - **Company Account**: ~$99 USD one-time fee (requires company DUNS number & domain verification).

### Step 2: Build Release Packages
From your workspace root, run Tauri's Windows bundler:
```powershell
cd apps/desktop-client
cargo tauri build --bundles msi,nsis
```
- **Output Artifacts**: `apps/desktop-client/target/release/bundle/msi/oz-pos_0.0.25_x64_en-US.msi` and `.exe` (NSIS).

### Step 3: Create App Submission on Partner Center
1. Log into Partner Center → **Apps and Services** → **Windows & Xbox**.
2. Click **Reserve App Name** (e.g., `"kasir.mu Retail & F&B"`).
3. Fill in the **Store Listing**:
   - **Title & Description**: Highlighting local-first SQLite offline reliability, QRIS, and multi-store capabilities.
   - **App Icons & Screenshots**: 512×512px PNG logo + 1920×1080px desktop screenshots.
   - **Privacy Policy URL**: Link to your privacy policy page (e.g., `https://ozpos.id/privacy`).
   - **IARC Age Rating**: Complete the short 5-minute IARC questionnaire (free).
4. **Upload Package**: Upload your `.msi` or `.msix` file.
5. Click **Submit to the Store**. Certification review takes **1 to 3 business days**.

---

## 🤖 2. Google Play Store (Android Tablet Client)

### Step 1: Create a Google Play Console Account
1. Go to the [Google Play Console](https://play.google.com/console).
2. Register for a **Developer Account**: **$25 USD one-time fee**.
3. Complete ID verification (requires passport or national identity card / KTP for Indonesia).

### Step 2: Generate a Signed Android Build
Generate your release signing keystore (keep this file safe and never commit to Git):
```bash
keytool -genkey -v -keystore oz-pos-release.keystore \
  -alias oz-pos-alias -keyalg RSA -keysize 2048 -validity 10000
```

Build the signed APK (the current CI pipeline produces **APKs only** — AAB/Play-bundle support is pending NDK stabilisation):
```powershell
cd apps/tablet-client
cargo tauri android build --apk --target aarch64
```
- **Output Artifact**: `apps/tablet-client/gen/android/app/build/outputs/apk/release/oz-pos-tablet-arm64-v8a.apk`.

### Step 3: Create Play Store Release Submission
1. Log into Google Play Console → Click **Create App**.
2. Set App Details:
   - **App Name**: `"kasir.mu - Kasir & POS Tablet"`
   - **Default Language**: Indonesian (`id-ID`) or English (`en-US`).
   - **App or Game**: App / Business.
3. Complete **Main Store Listing**:
   - **App Icon**: 512×512px 32-bit PNG.
   - **Feature Graphic**: 1024×500px banner.
   - **Screenshots**: At least 4 screenshots for 7-inch & 10-inch tablets.
4. Complete **App Content & Data Safety**:
   - Complete Content Rating survey.
   - Declare Data Safety details (kasir.mu stores data locally on edge SQLite, zero tracking cookies).
   - Provide Privacy Policy URL.
5. Create a **Production Release**:
   - Go to **Release** → **Production** → **Create New Release**.
   - Upload `oz-pos-tablet.aab`.
   - Add Release Notes: *"Version 0.0.25 - Multi-store topology, KDS, Kiosk, and offline SQLite sync."*
6. Click **Review and Roll Out to Production**. Review typically takes **1 to 3 days**.

---

## 🚀 3. CI/CD Automated Store Build Workflows

Only two GitHub Actions workflows are live, and **neither produces a mobile artifact**:

- **Desktop Release Automated Build — LIVE**: `.github/workflows/release.yml` runs on a `v*` tag
  push and compiles the Tauri desktop installers (Linux, Windows MSI, macOS), signs the updater
  manifests, attests provenance and publishes the GitHub Release. Its jobs are `release-validate`,
  `release-build` and `release-publish`. It was restored desktop-only by `3b10ea3a2` on 2026-09-04
  after `23c963303` had retired it; mobile was never part of the restoration — the file's own header
  says so at `.github/workflows/release.yml:24`.
- **Android Automated Build — RETIRED: nothing builds an APK or AAB for you.** The Android workflow
  is inert (`.github/workflows/android.yml.bak`, renamed by `23c963303` on 2026-09-02, and GitHub never
  executes a `.bak` file), so a `v*` tag push yields desktop installers only. Build it locally instead
  (`cargo tauri android build --apk|--aab`, see `apps/tablet-client/AGENTS.md`) and upload through
  Partner Center. iOS is in the identical state (`ios.yml.bak`, also retired, and the `gen/apple/`
  scaffold it needs has never been committed).
- **Dev CI — LIVE but not a release path**: `.github/workflows/dev-ci.yml` validates a PR targeting
  `main` (plus manual dispatch) and builds no installers at all. There is no push trigger, so pushing
  a branch — including `main` — runs nothing.

---

> last audited 09-09-26 by docs-auditor
