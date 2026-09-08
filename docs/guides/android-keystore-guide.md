# Android Keystore Management

> **Purpose:** Generate a release keystore, configure GitHub Actions secrets,
> and verify APK signing works end-to-end.

## Prerequisites

- Java JDK 17+ (`keytool` must be on `PATH`)
- OpenSSL (for base64 encoding)
- GitHub Admin access to the repository (to set secrets)

## 1. Generate a Release Keystore

Run the following command **on a trusted local machine** (never commit the
keystore to git):

```bash
keytool -genkey -v \
  -keystore oz-pos-release.keystore \
  -alias oz-pos-key \
  -keyalg RSA \
  -keysize 2048 \
  -validity 1825 \
  -storepass <your-keystore-password> \
  -keypass <your-key-password> \
  -dname "CN=OZ-POS, OU=Engineering, O=OZ Systems, L=Jakarta, ST=DKI Jakarta, C=ID"
```

This creates a keystore valid for 5 years (1825 days).

### Parameters

| Parameter | Description | Example |
|-----------|-------------|---------|
| `-alias` | Key alias used in gradle/CI | `oz-pos-key` |
| `-validity` | Validity in days | `1825` (5 years) |
| `-storepass` | Keystore master password | Keep secret |
| `-keypass` | Private key password | Keep secret |

## 2. Export Keystore for CI

Base64-encode the keystore so it can be stored as a GitHub secret:

```bash
# Encode
base64 -w0 oz-pos-release.keystore > oz-pos-release.keystore.b64

# Verify it decodes correctly
base64 -d oz-pos-release.keystore.b64 > /tmp/verify.keystore
keytool -list -keystore /tmp/verify.keystore -storepass <password>
```

## 3. Configure GitHub Actions Secrets

Add these secrets to the repository (Settings → Secrets and variables → Actions):

| Secret Name | Value | Required |
|-------------|-------|----------|
| `ANDROID_KEYSTORE_BASE64` | Contents of `oz-pos-release.keystore.b64` | Yes |
| `KEYSTORE_PASSWORD` | The `-storepass` value (also used as key password — the Tauri v2 `keystore.properties` route has a single `password` field for both; generate the keystore with matching `-storepass`/`-keypass`) | Yes |
| `KEY_ALIAS` | The `-alias` value (e.g. `oz-pos-key`) | Yes |

> The workflows write `keystore.properties` (password / keyAlias / storeFile) into
> `apps/tablet-client/gen/android/`; the tracked `build.gradle.kts`
> `signingConfigs` block reads it. The Tauri CLI has no keystore flags, so this
> file is the only signing route.

## 4. Verify Signing in CI

### Trigger a manual build

1. Go to GitHub → Actions → **Android Build**
2. Click **Run workflow** → select branch → **Run workflow**
3. Wait for the build to complete (~20 minutes on first run)
4. Download the APK artifact

### Verify locally

```bash
# Install Android SDK tools
# Then verify the APK signature
apksigner verify --print-certs oz-pos-tablet-aarch64.apk

# Or use jarsigner
jarsigner -verify -verbose -certs oz-pos-tablet-aarch64.apk
```

Expected output should show the certificate CN matching your keystore DN.

## 5. Keystore Rotation

When the keystore expires (or is compromised):

1. Generate a new keystore (step 1 above)
2. Update `ANDROID_KEYSTORE_BASE64` secret
3. Update `KEYSTORE_PASSWORD` secret
4. Update `KEY_ALIAS` if the alias changed
5. Run a manual workflow build to verify

## Security Notes

- **Never** commit `.keystore`, `.jks`, or `.p12` files to git
- ✅ The project `.gitignore` excludes `*.keystore`, `*.jks`, and `*.p12` (added 2026-08-08 alongside the existing `*.key`/`*.pem`) — verify with `git check-ignore oz-pos-release.keystore`
- Rotate the keystore at least 30 days before expiry
- Store the keystore password and key password in a password manager
- The base64-encoded secret in GitHub is encrypted at rest and masked in logs

---

> last audited 08-08-26 by docs-auditor
