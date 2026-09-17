# OZ-POS install scripts

<!-- Audit stamp: 2026-08-31 · docs-auditor · status: ACCURATE (0 findings) · verified against HEAD: all 4 referenced scripts exist (win/install.ps1, win/uninstall.ps1, install.sh, uninstall.sh); repo URL kardelitaitu/oz-pos matches git remote and install.ps1's default $Repo -->

One-line install/uninstall for all three desktop platforms, backed by the
project's release pipeline. Every script is attached to each GitHub Release
as an immutable, versioned asset, and all four are covered by the release's
`SHA256SUMS.txt` — so each script can verify its **own** checksum when run
from disk, and the installer it downloads is verified the same way.

| Platform | Install | Uninstall |
| -------- | ------- | --------- |
| Windows  | [`win/install.ps1`](win/install.ps1) | [`win/uninstall.ps1`](win/uninstall.ps1) |
| Linux / macOS | [`install.sh`](install.sh) | [`uninstall.sh`](uninstall.sh) |

## One-liners

```powershell
# Windows (PowerShell)
irm https://github.com/kardelitaitu/oz-pos/releases/latest/download/install.ps1 | iex
```

```bash
# Linux / macOS
curl -fsSL https://github.com/kardelitaitu/oz-pos/releases/latest/download/install.sh | bash
```

Both installers default to a **per-user, no-elevation** install:
`%LOCALAPPDATA%\Programs\OZ-POS` on Windows (NSIS `currentUser`),
`~/.local/bin` + launcher entry on Linux (AppImage), `/Applications` on
macOS (DMG). `--system` / `-System` opts into a per-machine install where
the platform supports it (`.deb`/`/opt` on Linux, MSI on Windows).

## How it works (all platforms)

1. **Resolve** — read `latest.json` / `beta.json` from the release (the
   same signed manifest the in-app updater trusts); no GitHub API, no rate
   limits.
2. **Verify** — the installer and the script itself (when run from disk)
   are SHA-256 checked against `SHA256SUMS.txt` from the same release over
   HTTPS. Mismatch aborts before anything executes.
3. **Delegate** — native installer runs silently (`/S` NSIS, `msiexec /qn`,
   AppImage install, `dpkg -i`, DMG → `/Applications`). No re-implemented
   installer logic.

Architecture mapping: `x86_64`/`AMD64` → `linux-x86_64` /
`windows-x86_64`, `arm64`/`aarch64` → `windows-aarch64` / `linux-aarch64` /
`darwin-aarch64`. Builds that aren't published yet fail with a clear
message instead of downloading the wrong artifact.

> **Go-live note:** the `releases/latest/download/…` URLs (and the in-app
> updater's own `latest.json` endpoint) resolve only after **at least one
> release has been published**. The pipeline publishes on `v*` tags; until
> then these URLs 404.

> last audited 31-08-26 by docs-auditor
