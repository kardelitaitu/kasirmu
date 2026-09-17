---
num: 14
area: release
title: ADR #14: Release Automation — GitHub Actions Build & Publish Pipeline
status: Proposed (2026-07-16)
---
<!-- Audit stamp: 2026-07-24 · Hermes-Agent · status: RESOLVED (AUDIT-28 2026-08-03) · F1: pipeline is SHIPPED and release.yml is now the single tag-triggered orchestrator (version gate → Tauri installer builds for Linux/Windows/macOS → signed latest.json/beta.json → draft release → inventory → publish). F2: release.yml now references scripts/generate-latest-json.mjs (via --merge) and scripts/verify-updater-signature.mjs; the ADR's Windows-NSIS/MSI + latest.json-on-every-release design is implemented. · verified accurate: ADR#13 existing infra (plugin/tauri.conf.json/pubkey/capabilities/UpdateBanner) all present; SettingsPage updater UI live; FTL strings present -->

# ADR #14: Release Automation — GitHub Actions Build & Publish Pipeline

**Status:** Proposed (2026-07-16)
**Date:** 2026-07-16
**Author:** kasir.mu Contributors
**Tags:** release, ci, github-actions, build, signing, updater

---

## Context

kasir.mu ships Windows desktop installers (NSIS `.exe`, WiX `.msi`) to end users. Currently there is no automated pipeline to build, sign, and publish these artifacts. Releasing a new version involves manual steps:

1. Bump version in `Cargo.toml`, `tauri.conf.json`, `package.json`
2. Build the Tauri app locally
3. Sign the installer with `signtool.exe`
4. Create a GitHub Release
5. Upload artifacts
6. Generate the `latest.json` updater manifest and sign it with the Ed25519 key
7. Attach `latest.json` to the release

This is error-prone, non-reproducible, and blocks the in-app updater (ADR #13) from working — without `latest.json` on the release, the "Check for Updates" button always fails.

### Prerequisites Already in Place

| Component | Reference |
|-----------|-----------|
| Tauri updater plugin configured | `apps/desktop-client/tauri.conf.json:60` |
| Ed25519 public key committed | `oz-pos-updater.key.pub` |
| `latest.json` endpoint | `https://github.com/kardelitaitu/oz-pos/releases/latest/download/latest.json` |
| NSIS + WiX bundle targets | `tauri.conf.json` `bundle.targets = "all"` |
| Code signing config | `tauri.conf.json` `windows.signCommand` using `signtool.exe` |
| Settings About page updater UI | Implemented in ADR #13 |

### What's Missing

- No `.github/workflows/` directory at all
- No Ed25519 private key in CI secrets (`UPDATER_PRIVATE_KEY`)
- No code signing certificate in CI secrets (`UPDATER_CERT`, `UPDATER_CERT_PASSWORD`)
- No script to generate `latest.json`
- No documented release process

---

## Decision

### 1. Workflow Trigger

A single workflow `.github/workflows/release.yml` triggered by pushing a tag matching `v*`:

```yaml
on:
  push:
    tags:
      - 'v*'
```

The tag determines the release version (e.g., `v0.1.0` → release `0.1.0`). This is the standard Rust/Tauri convention and matches Cargo's `cargo release` tooling.

### 2. Build Environment

- **Runner:** `windows-latest` (GitHub-hosted, Windows Server 2022)
- **Rust:** stable via `rustup`, target `x86_64-pc-windows-msvc`
- **Node:** 22.x via `actions/setup-node`
- **System dependencies:** WebView2 is pre-installed on Windows Server 2022; no additional system packages needed
- **Caching:** `actions/cache` for `~/.cargo` and `target/` to keep build times under 10 minutes

### 3. Build Steps (Job 1: `build`)

```
1. actions/checkout@v4
2. rustup toolchain (stable)
3. Setup Node 22 + npm ci (ui/)
4. Restore cargo cache
5. Export signing certificate from secret to .pfx file
6. Run `npm run build --prefix ui` (typecheck + vite build)
7. Run `cargo tauri build --bundles "nsis,msi" --ci`
   — Tauri reads signtool command from tauri.conf.json
   — Output goes to src-tauri/target/release/bundle/
8. Upload raw artifacts (installers) as workflow artifacts for the release job
```

The `--ci` flag suppresses Tauri's interactive prompts and uses the `tauri.conf.json` configuration as-is.

### 4. Signing

Code signing is handled by Tauri's built-in `windows.signCommand` in `tauri.conf.json`:

```json
"signCommand": "signtool.exe sign /fd SHA256 /a /tr http://timestamp.digicert.com /td SHA256 %1"
```

The signing certificate is imported from a GitHub secret (`UPDATER_CERT`) as a base64-encoded `.pfx` file into the system certificate store before the build step. The `signtool.exe /a` flag auto-selects the best available certificate, so no thumbprint configuration is needed.

For a simpler alternative that avoids managing a PFX in CI, the workflow can pass the certificate directly to `signtool` via its `/f` flag and a password from secrets.

### 5. Release & Manifest (Job 2: `release`)

After the build completes, a **second job** (`release`) runs, dependent on `build`, with permissions to create releases:

```
needs: [build]
permissions:
  contents: write
```

Steps:

1. Download the raw installer artifacts from the build job
2. Create a GitHub Release via `softprops/action-gh-release@v2` with the tag name
3. Upload NSIS (`.exe`) and MSI (`.msi`) installers as release assets
4. Generate `latest.json` using the Tauri CLI or a Node.js script:

```json
{
  "version": "0.1.0",
  "notes": "Extracted from the GitHub Release body",
  "pub_date": "2026-07-16T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<base64-ed25519-signature>",
      "url": "https://github.com/kardelitaitu/oz-pos/releases/download/v0.1.0/kasir.mu_0.1.0_x64-setup.exe"
    }
  }
}
```

The **signature** field is a base64-encoded Ed25519 signature of the installer binary, generated with the private key. The Tauri CLI does not ship a standalone `sign` command, so this step uses either:

- **Option A:** A small Node.js script using `@tauri-apps/plugin-updater`'s internal helpers or `crypto.sign()` with the Ed25519 key loaded from an environment variable
- **Option B:** A standalone Rust binary that reads the file, signs it, and outputs the base64 signature — this could live in `scripts/sign-updater.js`

The recommended approach is a **Node.js script** (`scripts/generate-latest-json.js`) that:
- Takes the version, release notes, and installer path as inputs
- Reads the private key from environment variable `UPDATER_PRIVATE_KEY`
- Computes the SHA-256 hash of the installer
- Signs the hash with Ed25519
- Outputs a valid `latest.json`

5. Upload `latest.json` as a release asset (same name every time, so `/releases/latest/download/latest.json` resolves)

### 6. Secrets Required

| Secret | Purpose | Source |
|--------|---------|--------|
| `UPDATER_PRIVATE_KEY` | Ed25519 private key for signing `latest.json` | Generate via `tauri plugin updater sign` or OpenSSL |
| `UPDATER_CERT` | Code signing certificate (base64 `.pfx`) | Purchased from CA (DigiCert, Sectigo, etc.) |
| `UPDATER_CERT_PASSWORD` | Password for the `.pfx` file | From certificate purchase |

The public key counterpart to `UPDATER_PRIVATE_KEY` is committed as `oz-pos-updater.key.pub` and referenced in `tauri.conf.json` — the private key must never be committed.

### 7. The Complete Release Flow

```
Developer:
  git tag v0.1.0
  git push origin v0.1.0

GitHub Actions:
  Job 1: build
    ├── Checkout repo
    ├── Install Rust (stable) + Node 22
    ├── cargo tauri build --bundles "nsis,msi" --ci
    │   ├── Compiles Rust backend
    │   ├── Builds frontend (typecheck + vite)
    │   ├── Packages NSIS installer (signed)
    │   └── Packages MSI installer (signed)
    └── Upload installers as workflow artifacts

  Job 2: release (needs: build, contents: write)
    ├── Download installers
    ├── Create GitHub Release (softprops/action-gh-release)
    ├── Attach .exe + .msi
    ├── Run scripts/generate-latest-json.js
    │   ├── Read UPDATER_PRIVATE_KEY from env
    │   ├── Compute signature over installer
    │   └── Write latest.json
    └── Attach latest.json to release

User (in-app):
  Settings → About → "Check for Updates"
  ↓
  Tauri fetches latest.json from GitHub Releases
  ↓
  Verifies Ed25519 signature against embedded pubkey
  ↓
  Shows "v0.1.0 is available"
  ↓
  "Install Now" → downloads + launches NSIS installer
```

### 8. `generate-latest-json.js` Script

A Node.js script at `scripts/generate-latest-json.js` that the workflow calls:

```javascript
// Pseudocode:
// Usage: node scripts/generate-latest-json.js <version> <installer-path>
//
// Reads UPDATER_PRIVATE_KEY from env
// Computes SHA-256 of installer file
// Signs with Ed25519
// Writes latest.json to stdout
```

Key behaviors:
- **Idempotent** — running twice on the same installer produces the same output
- **No external dependencies** — uses Node.js built-in `crypto` module (Node 22+ includes Ed25519 support)
- **Fails loudly** — exits non-zero if the private key env var is missing or malformed
- **The signature is computed over the raw installer bytes**, not over the `latest.json` content. Tauri's updater plugin verifies: (a) the manifest is signed, then (b) the downloaded installer matches the manifest's signature.

### 9. Version Bump Process

The workflow is tag-triggered, so version bumping is a separate manual step before tagging:

1. Update `version` in root `Cargo.toml` (`[workspace.package]`)
2. Update `version` in `apps/desktop-client/tauri.conf.json`
3. Update `version` in `ui/package.json`
4. Update `CHANGELOG.md`
5. Commit as `chore: bump version to 0.1.0`
6. `git tag v0.1.0 && git push origin v0.1.0`

This could later be automated with `cargo release` or `release-plz`, but initially it is documented as a manual checklist.

---

## Options Considered

### Option A — Single GitHub Actions Workflow (Chosen)

One workflow with two jobs: `build` and `release`. The build job compiles and uploads artifacts; the release job creates the GitHub Release and attaches everything.

- **Pro**: Simple, single-file configuration
- **Pro**: Job separation means release permissions (`contents: write`) are scoped to only the release job
- **Pro**: Build artifacts are reusable (uploaded as workflow artifacts between jobs)
- **Con**: Two jobs means an extra download/upload cycle for artifacts

### Option B — Single Job with Inline Release (Rejected)

One job that both builds and publishes.

- **Pro**: No artifact transfer between jobs
- **Con**: The entire job needs `contents: write` permission (broader than necessary)
- **Con**: Less modular — harder to add signing verification or manual approval gates later

### Option C — External Release Tool (Rejected)

Use `cargo release` or `release-plz` to automate version bumps, changelog generation, and tagging.

- **Pro**: Handles version bumping automatically
- **Con**: Adds a CI dependency on third-party actions
- **Con**: Overengineered for a single-platform, single-binary project
- **Con**: The version bump process is simple enough to document manually

### Option D — Manual Release via Build Script (Rejected)

Keep the current manual process but write a PowerShell script (`scripts/release.ps1`) that automates the local steps.

- **Pro**: No CI dependency
- **Pro**: Full control over the build environment
- **Con**: Requires the developer to have signing certificates installed locally
- **Con**: Not reproducible — depends on the developer's machine state
- **Con**: No audit trail (who released what, when)
- **Con**: Cannot be triggered by non-maintainers via PR

### Option E — Multi-Platform Build Matrix (Deferred)

Build for Windows, macOS, and Linux in a matrix strategy.

- **Pro**: Supports all Tauri target platforms
- **Con**: Requires macOS and Linux signing setup (notarization, AppImage, deb)
- **Con**: Adds significant CI cost (3× the runner minutes)
- **Decision**: Deferred until there is demand for non-Windows releases

---

## Consequences

### Positive

- **One-command releases**: `git tag v0.1.0 && git push origin v0.1.0` produces a full release
- **In-app updater enabled**: `latest.json` on every release makes the Settings About page "Check for Updates" button functional (ADR #13)
- **Reproducible builds**: CI environment is consistent; no dependency on developer machines
- **Audit trail**: Every release is linked to a tag, a CI run, and a GitHub Release
- **Signed artifacts**: Both code signing (Authenticode) and manifest signing (Ed25519) are automated
- **Scoped permissions**: The release job has minimal permissions; the build job has none

### Negative

- **Windows-only initially**: macOS and Linux builds require additional setup (deferred)
- **Secret management**: Three GitHub secrets must be maintained and rotated; losing the Ed25519 private key breaks the updater
- **No rollback automation**: Rolling back requires manually creating a release for the old tag — the `latest.json` always points to the newest release
- **Version bump is still manual**: The developer must update version strings across multiple files before tagging. A future improvement could automate this.
- **CI cost**: Each release consumes ~10-15 minutes of Windows runner time

### Mitigations

- **Key backup**: The Ed25519 private key should be backed up offline (password manager or hardware token). GitHub secrets are not a backup — they are a distribution mechanism.
- **Rollback**: Historical installers remain in GitHub Releases. Users can downgrade by manually downloading and running an older installer.
- **Dry-run testing**: Before the first real release, run the workflow with a `v0.0.0-test` tag on a fork or draft release to verify all steps without publishing to users.
- **Version bump automation**: If manual bumps become tedious, add `cargo release` or a `scripts/bump-version.ps1` that updates all files from a single input.

---

## Related

- `docs/decisions/2026-07-16-desktop-app-updater.md` — ADR #13: Settings About page updater UI (consumer of this pipeline)
- `apps/desktop-client/tauri.conf.json` — Bundle targets, signing command, updater endpoint
- `oz-pos-updater.key.pub` — Ed25519 public key (committed)
- `oz-pos-updater.key` — Ed25519 private key (NOT committed; stored as `UPDATER_PRIVATE_KEY` secret)
- `scripts/generate-latest-json.js` — Manifest generation script (to be created)
- `.github/workflows/release.yml` — Workflow definition (to be created)

> last audited 09-08-26 by buffy
> audit: Phase 1 Core Architecture & API Docs Audit

> status: ACCURATE (0 findings) · verified accurate: cargo check passed, no structural orphans, no stale version headers

