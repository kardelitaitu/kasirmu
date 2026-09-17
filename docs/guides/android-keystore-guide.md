# Android Keystore Management
<!-- Audit stamp: 2026-09-09 · DSH · status: ACCURATE AFTER REPAIR (2 major, 2 minor) · First machine-readable stamp this guide ever carried; its footer dates to 08-08-26, before `23c963303` (09-02) renamed `android.yml` to `.bak`, so every CI step in §4/§5 quietly became a dead entrypoint. · §3 note and secrets table: "The workflows write keystore.properties" was true of `android.yml.bak:119-132` only — no live workflow reads `ANDROID_KEYSTORE_BASE64`/`KEYSTORE_PASSWORD`/`KEY_ALIAS` (grep count 0 in both of dev-ci.yml and release.yml); now says so and marks the secrets conditional. · §4: the "Android Build → Run workflow" walkthrough has no button to click — replaced with a retirement banner + the local signed-build path, mirroring `apps/tablet-client/AGENTS.md:92-98`; "~20 minutes" timing removed with it (nothing live left to time). · §4 verify-locally: `oz-pos-tablet-aarch64.apk` is an upload-artifact *label* (`android.yml.bak:160`), never a filename — now points at the gradle output glob. · §5 step 5: same dead entrypoint, now a local build. · §1 command: `-keypass` placeholder now says same-as-storepass up front, because `build.gradle.kts:44,46` feeds ONE `password` key to both `keyPassword` and `storePassword` (the §3 table already warned; the command invited entering two different ones). · Unverifiable and left alone: prereq tooling on operator machines (JDK/OpenSSL/GitHub admin), the keytool/base64 command semantics themselves (verified syntactically against the only decoder in-repo, `android.yml.bak:126`). · Dirty-tree check: none of this guide's anchors intersect the in-flight `ui/` edits; all facts read identically at HEAD and on disk. -->

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
  -keypass <same-as-storepass> \
  -dname "CN=kasir.mu, OU=Engineering, O=OZ Systems, L=Jakarta, ST=DKI Jakarta, C=ID"
```

This creates a keystore valid for 5 years (1825 days). The store and key
passwords **must be identical**: `gen/android/app/build.gradle.kts` feeds one
`password` key from `keystore.properties` to both `keyPassword` and
`storePassword` (`:44,46`), so a keystore generated with two different
passwords will fail signing at build time.

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
| `ANDROID_KEYSTORE_BASE64` | Contents of `oz-pos-release.keystore.b64` | Only when the Android workflow is restored |
| `KEYSTORE_PASSWORD` | The `-storepass` value (also used as key password — the Tauri v2 `keystore.properties` route has a single `password` field for both; generate the keystore with matching `-storepass`/`-keypass`) | Only when the Android workflow is restored |
| `KEY_ALIAS` | The `-alias` value (e.g. `oz-pos-key`) | Only when the Android workflow is restored |

> ⚠️ **No live workflow reads these secrets today.** The retired `android.yml`
> workflow wrote `keystore.properties` (password / keyAlias / storeFile) into
> `apps/tablet-client/gen/android/` (`android.yml.bak:119-132`); `23c963303`
> (2026-09-02) renamed it to `.bak` and nothing replaced it. Locally, you write
> that file yourself. The tracked `build.gradle.kts` `signingConfigs` block still
> reads it. The Tauri CLI has no keystore flags, so this file is the only
> signing route.

## 4. Verify Signing

> ⚠️ **There is no CI path for this right now.** This section used to say
> "GitHub → Actions → Android Build → Run workflow". That workflow has been
> `.github/workflows/android.yml.bak` since `23c963303` (2026-09-02) and GitHub
> never executes `.bak` files; `release.yml` is desktop-only. The steps below are
> the local equivalent (mirrors `apps/tablet-client/AGENTS.md:92-98`), valid once
> the workflow is restored with only its trigger changed.

### Build a signed release APK locally

1. Write `apps/tablet-client/gen/android/keystore.properties` with the three
   keys (`storeFile` pointing at your keystore, `password`, `keyAlias`).
2. `cargo tauri android build --apk --target aarch64` from `apps/tablet-client/`.
3. The signed artifact lands under
   `apps/tablet-client/gen/android/app/build/outputs/apk/` (glob for `*.apk`
   under the `aarch64`/`release` tree — gradle names it like
   `app-aarch64-release.apk`, not the old CI artifact label).

### Verify the signature

```bash
# Install Android SDK tools
# Then verify the APK signature (replace with the actual gradle output path)
apksigner verify --print-certs <path-to>.apk

# Or use jarsigner
jarsigner -verify -verbose -certs <path-to>.apk
```

Expected output should show the certificate CN matching your keystore DN.

## 5. Keystore Rotation

When the keystore expires (or is compromised):

1. Generate a new keystore (step 1 above)
2. Update `ANDROID_KEYSTORE_BASE64` secret
3. Update `KEYSTORE_PASSWORD` secret
4. Update `KEY_ALIAS` if the alias changed
5. Verify with a local signed build (`keystore.properties` +
   `cargo tauri android build`) until the Android workflow is restored

## Security Notes

- **Never** commit `.keystore`, `.jks`, or `.p12` files to git
- ✅ The project `.gitignore` excludes `*.keystore`, `*.jks`, and `*.p12` (added 2026-08-08 alongside the existing `*.key`/`*.pem`) — verify with `git check-ignore oz-pos-release.keystore`
- Rotate the keystore at least 30 days before expiry
- Store the keystore password and key password in a password manager
- The base64-encoded secret in GitHub is encrypted at rest and masked in logs

---

> last audited 09-09-26 by docs-auditor
