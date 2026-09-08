# App Store Registration & Distribution Guide

> **Target Audience:** Developers, Release Engineers, and Store Admins publishing OZ-POS to official App Stores.

This guide provides end-to-end instructions for registering, signing, building, and publishing **OZ-POS** on the **Microsoft Store (Windows Desktop)** and **Google Play Store (Android Tablet)**.

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
2. Click **Reserve App Name** (e.g., `"OZ-POS Retail & F&B"`).
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
   - **App Name**: `"OZ-POS - Kasir & POS Tablet"`
   - **Default Language**: Indonesian (`id-ID`) or English (`en-US`).
   - **App or Game**: App / Business.
3. Complete **Main Store Listing**:
   - **App Icon**: 512×512px 32-bit PNG.
   - **Feature Graphic**: 1024×500px banner.
   - **Screenshots**: At least 4 screenshots for 7-inch & 10-inch tablets.
4. Complete **App Content & Data Safety**:
   - Complete Content Rating survey.
   - Declare Data Safety details (OZ-POS stores data locally on edge SQLite, zero tracking cookies).
   - Provide Privacy Policy URL.
5. Create a **Production Release**:
   - Go to **Release** → **Production** → **Create New Release**.
   - Upload `oz-pos-tablet.aab`.
   - Add Release Notes: *"Version 0.0.25 - Multi-store topology, KDS, Kiosk, and offline SQLite sync."*
6. Click **Review and Roll Out to Production**. Review typically takes **1 to 3 days**.

---

## 🚀 3. CI/CD Automated Store Build Workflows

OZ-POS provides automated GitHub Actions workflows for continuous integration and release artifacts:

- **Android Automated Build**: `.github/workflows/android.yml` builds a signed `aarch64` APK on `v*` tag push (AAB/Play bundles pending NDK stabilisation).
- **Desktop Release Automated Build**: `.github/workflows/release.yml` compiles Windows MSI installers automatically.

---

> last audited 08-08-26 by docs-auditor
