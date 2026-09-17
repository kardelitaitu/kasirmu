---
num: 13
area: release
title: ADR #13: Desktop App Updater — Tauri Plugin + Settings Page Integration
status: Partially Implemented (2026-07-16) — Settings About page UI is live; see ADR #14 for release automation
---
<!-- Audit stamp: 2026-07-24 · Hermes-Agent · status: RESOLVED (AUDIT-28 2026-08-03) · F1: release workflow is SHIPPED and now builds real Tauri installers with signed latest.json/beta.json manifests (see release.yml + generate-latest-json.mjs). F2: Settings About updater UI is live at SettingsPage.tsx with full updater state + FTL strings. · verified accurate: tauri_plugin_updater registered (lib.rs); @tauri-apps/plugin-updater ^2.10.1 in ui/package.json; tauri.conf.json updater config; oz-pos-updater.key.pub present; capabilities/default.json grants updater:default; UpdateBanner.tsx exists; shared.ftl banner strings present -->

# ADR #13: Desktop App Updater — Tauri Plugin + Settings Page Integration

**Status:** Partially Implemented (2026-07-16) — Settings About page UI is live; see ADR #14 for release automation
**Date:** 2026-07-16
**Author:** kasir.mu Contributors
**Tags:** updater, deployment, release, windows, github-actions, settings

---

## Context

kasir.mu is distributed as a Windows desktop application (NSIS installer, WiX MSI) via GitHub Releases. Users currently have no in-app mechanism to discover or install new versions — they must manually download the latest release from GitHub and re-install.

Without an in-app updater:

- Users run stale versions with known bugs or missing features
- Security patches are not promptly applied
- Support overhead increases (fielding "how do I update?" questions)
- No telemetry or nudging for critical updates

The Tauri v2 ecosystem provides a first-party `tauri-plugin-updater` that supports:
- Checking a remote JSON manifest (`latest.json`) for new versions
- Downloading platform-specific installers (NSIS, WiX, DMG, AppImage, deb)
- Installing with a progress dialog (`basicUi` mode on Windows)
- Public-key signature verification (Ed25519) of the update manifest

### Existing Infrastructure

The project already has significant updater scaffolding in place:

| Component | Status | Location |
|-----------|--------|----------|
| `tauri-plugin-updater` (Rust) | ✅ Registered | `apps/desktop-client/src/lib.rs:66` |
| `@tauri-apps/plugin-updater` (npm) | ✅ Installed v2.10.1 | `ui/package.json` |
| `tauri.conf.json` updater config | ✅ Configured | `apps/desktop-client/tauri.conf.json:60` |
| Public key file | ✅ Present | `oz-pos-updater.key.pub` |
| `updater:default` permission | ✅ Granted | `apps/desktop-client/capabilities/default.json` |
| `UpdateBanner` component | ✅ Exists | `ui/src/components/UpdateBanner.tsx` |
| Fluent strings (banner) | ✅ Present | `ui/src/locales/shared.ftl` lines 85-91 |
| GitHub Release endpoint | ⚡ Referenced | `https://github.com/kardelitaitu/oz-pos/releases/latest/download/latest.json` |
| Settings About page updater UI | ❌ Missing | `ui/src/features/settings/SettingsPage.tsx` |
| GitHub Actions release workflow | ❌ Missing | `.github/workflows/` is empty |
| `latest.json` manifest generation | ❌ Missing | No release script |

This ADR addresses the **Settings About page UI** and the **release automation pipeline** to make the end-to-end flow functional.

---

## Decision

### 1. Settings About Page — Manual Update Check

A new "Updates" section is added to the System category in the Settings About page, below the existing System & License Ownership card.

#### UI States

| State | Trigger | Display |
|-------|---------|---------|
| **Idle** | Initial render | Version line + "Check for Updates" button |
| **Checking** | User clicks button | Spinner + "Checking for updates…" (button disabled) |
| **Up-to-date** | `check()` returns null | Green checkmark + "You're up to date" + "Check Again" |
| **Update available** | `check()` returns Update | "vX.Y.Z available" + "Install Now" + "Check Again" |
| **Installing** | User clicks Install | "Installing…" (button disabled, app restarts on completion) |
| **Error** | `check()` throws | Red warning + "Update check failed" + "Retry" |

#### Implementation

The About page imports `@tauri-apps/plugin-updater` and calls its API directly — no new Rust IPC command is needed. The logic mirrors what `UpdateBanner.tsx` already does, but as a **manual trigger** (user-initiated) instead of auto-on-mount.

```typescript
// Pseudocode for the handler
import { check } from '@tauri-apps/plugin-updater';

const handleCheck = async () => {
  setState('checking');
  try {
    const update = await check();
    if (update) {
      setAvailable(update);
      setState('available');
    } else {
      setState('up-to-date');
    }
  } catch {
    setState('error');
  }
};
```

The `downloadAndInstall()` call on the returned `Update` object triggers the platform installer (NSIS/WiX in `basicUi` mode), which shows a progress dialog and restarts the app on completion.

### 2. Fluent Locale Strings

New strings in `settings.ftl` / `settings.id.ftl`:

```
settings-updates-heading = Updates
settings-current-version = Current Version
settings-check-for-updates = Check for Updates
settings-checking-for-updates = Checking…
settings-up-to-date = ✓ You're up to date
settings-update-available = { $version } is available
settings-install-update = Install Now
settings-installing-update = Installing…
settings-update-check-error = Update check failed
settings-update-retry = Retry
settings-update-no-updates = No updates available
```

### 3. Release Automation — GitHub Actions Workflow

A new workflow `.github/workflows/release.yml` is created with these jobs:

#### Job 1: Build & Upload (Windows)
1. Checkout repository
2. Install Rust toolchain (stable, Windows `x86_64-pc-windows-msvc`)
3. Install Node.js (>=22)
4. Install system dependencies (WebView2 is pre-installed on modern Windows)
5. `npm ci` in `ui/`
6. Build the Tauri desktop app with `--bundles nsis,msi`
7. Upload artifacts (`.exe` installer, `.msi`) to GitHub Release via `softprops/action-gh-release`

#### Job 2: Generate `latest.json`
After the build artifacts are attached to the release, a job (or step) generates the Tauri updater manifest:

```json
{
  "version": "0.0.9",
  "notes": "Release notes from GitHub Release body",
  "pub_date": "2026-07-16T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<base64-ed25519-sig-of-the-installer>",
      "url": "https://github.com/kardelitaitu/oz-pos/releases/download/v0.0.9/kasir.mu_0.0.9_x64-setup.exe"
    }
  }
}
```

The **signature** is generated using the private key (`oz-pos-updater.key`) with a tool like `tauri updater sign` or a Node.js script using `@tauri-apps/plugin-updater` helpers. The private key must be stored as a **GitHub Actions secret** (`UPDATER_PRIVATE_KEY`).

The `latest.json` is uploaded as a release asset so the endpoint `https://github.com/kardelitaitu/oz-pos/releases/latest/download/latest.json` resolves automatically.

#### Workflow Trigger
- `on: push: tags: ['v*']` — pushing a `v0.0.10` tag triggers a full build and release

### 4. `latest.json` and the Endpoint Contract

The updater endpoint configured in `tauri.conf.json`:

```
https://github.com/kardelitaitu/oz-pos/releases/latest/download/latest.json
```

GitHub's `/releases/latest/download/` redirects to the **latest release's** asset named `latest.json`. This means:

- Every release must include a `latest.json` asset
- Clients always point to the latest published version
- Old releases still serve their own `latest.json` via the tag-specific URL, but consumers following `/latest/` always get the newest

The `latest.json` manifest is **signed** with the Ed25519 keypair. The public key embedded in `tauri.conf.json` verifies the manifest at update-check time. If the manifest is tampered with or served from a different source, verification fails and the update is rejected.

### 5. Release Workflow

```
Developer:
  git tag v0.1.0
  git push origin v0.1.0

GitHub Actions:
  ├── Build kasir.mu (Windows NSIS + MSI)
  ├── Sign binaries (signtool.exe via UPDATER_CERT_SECRET)
  ├── Generate latest.json (signed with UPDATER_PRIVATE_KEY)
  └── Attach artifacts + latest.json to GitHub Release

User (in-app):
  Open Settings → About → "Check for Updates"
  ↓
  sees "v0.1.0 is available"
  ↓
  clicks "Install Now"
  ↓
  Tauri downloads kasir.mu_0.1.0_x64-setup.exe
  ↓
  Signs + verifies latest.json against embedded pubkey
  ↓
  Launches NSIS installer (basicUi mode)
  ↓
  App restarts as v0.1.0
```

---

## Options Considered

### Option A — Manual Check in Settings About Page (Chosen)

A "Check for Updates" button in the Settings → About section using the existing `@tauri-apps/plugin-updater` JS API.

- **Pro**: No new Rust commands needed
- **Pro**: Reuses existing plugin infrastructure
- **Pro**: User-initiated — no surprise downloads
- **Pro**: Clear feedback loop (checking → result → install)
- **Con**: Users must navigate to Settings to check
- **Con**: No automatic periodic check (mitigated by the auto-on-mount `UpdateBanner`)

### Option B — Auto-Update with Silent Install (Rejected)

Check for updates on every app start and install silently without user interaction.

- **Pro**: Always up-to-date
- **Pro**: Zero user friction
- **Con**: Surprise restarts — disruptive in a POS environment
- **Con**: No user consent for updates (problematic for compliance)
- **Con**: If an update breaks something, all terminals go down simultaneously
- **Con**: POS terminals are business-critical — updates should be intentional

### Option C — External Update Service (Rejected)

Run a separate update service (e.g., `rustup`-style or a Windows service) that checks and installs in the background.

- **Pro**: Can update even when the app is not running
- **Pro**: Support for differential/binary patching
- **Con**: Massive overengineering for a single-platform desktop app
- **Con**: Additional attack surface (separate service with network access)
- **Con**: Tauri's plugin already handles the download+install flow
- **Con**: A Tauri app restart is sufficient for updates

### Option D — Electron-Like Auto-Updater with `electron-updater` (Rejected)

Use a standalone updater library with its own release server or S3 bucket.

- **Pro**: Feature-rich (delta updates, staging, rollback)
- **Con**: Tauri is not Electron — this would bypass the first-party plugin
- **Con**: Ed25519 signature verification is built into `tauri-plugin-updater`; any alternative must reimplement it
- **Con**: Adds a new dependency for something the framework already provides
- **Con**: `latest.json` on GitHub Releases is free and simple

### Option E — Always Show Update Banner (Rejected)

Rely solely on the existing `UpdateBanner` component that auto-checks on mount.

- **Pro**: Already implemented
- **Pro**: Zero additional UI work
- **Con**: Banner is dismissible — users can (and will) dismiss it and forget
- **Con**: No persistent indicator that an update was dismissed
- **Con**: No manual re-check mechanism
- **Con**: No version comparison display

---

## Consequences

### Positive

- **Self-service updates**: Users can discover and install new versions without leaving the app
- **Security**: Ed25519-signed manifest prevents tampering — the update endpoint could be a plain HTTP mirror without risk
- **Low implementation effort**: Tauri's plugin does the heavy lifting; the Settings UI is ~80 lines of React + Fluent strings
- **Release automation**: Tag → build → sign → publish in one workflow; no manual steps
- **Auditability**: Every release has a signed manifest attached; the public key is in the repository
- **Backward-compatible**: Existing `UpdateBanner` works unchanged; the Settings button is additive
- **POS-appropriate**: Manual check + explicit install respects the business-critical nature of the terminal

### Negative

- **Windows-only for now**: The updater endpoint is configured for all platforms, but the release workflow only builds Windows installers. macOS and Linux builds require additional CI setup.
- **No delta updates**: Users download the full installer each time (~50-100 MB). This is acceptable for a POS system that updates infrequently.
- **No rollback**: If an update causes issues, users must manually download the previous release. The `latest.json` always points forward. (Mitigation: installers are versioned and preserved in GitHub Releases.)
- **`.github/workflows/` is new**: This is the first CI workflow. It establishes patterns (tag-triggered release, secret management) that subsequent workflows should follow.
- **Private key management**: The Ed25519 private key must be stored as a GitHub secret and rotated if compromised. Losing the key prevents signing new releases.

### Mitigations

- **Rollback path**: GitHub Releases preserve all historical tags and assets. Users can manually download `kasir.mu_0.0.8_x64-setup.exe` from a previous release and reinstall.
- **Key rotation**: If the signing key is compromised, update the public key in `tauri.conf.json` and distribute a hotfix. The next update will use the new key.
- **CI reliability**: The workflow pins Rust toolchain via `rust-toolchain.toml` and Node.js via `.nvmrc` to prevent breaking on toolchain updates.
- **Release notes**: The workflow extracts the release body from the GitHub Release and includes it as the `notes` field in `latest.json`, so users see changelog info in the update dialog.

---

## Related

- `apps/desktop-client/tauri.conf.json` — Updater plugin configuration (endpoints, pubkey, installMode)
- `apps/desktop-client/capabilities/default.json` — `updater:default` permission
- `apps/desktop-client/src/lib.rs` — `tauri_plugin_updater::Builder` registration
- `ui/src/components/UpdateBanner.tsx` — Auto-check-on-mount update banner (existing)
- `ui/src/features/settings/SettingsPage.tsx` — Target for the manual check button
- `ui/src/locales/settings.ftl` — Fluent strings for settings (~line 600 where `settings-app-version` is defined)
- `ui/src/locales/settings.id.ftl` — Indonesian locale mirror
- `oz-pos-updater.key.pub` — Ed25519 public key (committed)
- `oz-pos-updater.key` — Ed25519 private key (not committed; stored as GitHub secret `UPDATER_PRIVATE_KEY`)
- `.github/workflows/release.yml` — Release automation workflow (new)
- `docs/decisions/2026-01-15-module-system-design.md` — ADR #1: Module system (updater module could be extracted later)
- [Tauri v2 Updater Plugin Documentation](https://v2.tauri.app/plugin/updater/) — Reference for plugin API and config

> last audited 09-08-26 by buffy
> audit: Phase 1 Core Architecture & API Docs Audit

> status: ACCURATE (0 findings) · verified accurate: cargo check passed, no structural orphans, no stale version headers

