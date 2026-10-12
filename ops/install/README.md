# kasir.mu install scripts

<!-- dead-ref-prefix-ok: install/uninstall · this is the English phrase "One-line install/uninstall", not a path; `install/` is a top-level prefix so the checker extracts it. Suppressed at the page head, where check-dead-refs.py reads the opt-out (first 40 lines). Every other reference on this page is still checked. -->

<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE — 0 findings · Re-audit of the cross-platform installer index; the 2026-08-31 stamp is merged below as original evidence. 0 FINDINGS because every claim on this page is a claim about a script that still says exactly what the page says it says. The four-script table matches the tree (win/install.ps1, win/uninstall.ps1, install.sh, uninstall.sh all present), and the release pipeline attaches all four as assets and covers them with SHA256SUMS.txt (.github/workflows/release.yml:444-448, plus a required-asset loop at :459 that fails the release if any of the four, latest.json, beta.json or SHA256SUMS.txt is missing) — so the headline "every script is attached to each GitHub Release as an immutable, versioned asset" is enforced by CI, not merely intended. · THE DELEGATION SECTION MATCHES install.sh STEP FOR STEP: per-user AppImage to ~/.local/bin with a .desktop entry (install.sh:301-315), per-machine --system preferring the .deb through dpkg and otherwise installing the AppImage to /opt with a /usr/local/bin symlink (install.sh:252-291), macOS DMG to /Applications (install.sh:239-247), and an architecture mapping whose every key the page lists is a key the scripts derive (x86_64/amd64 → linux-x86_64, aarch64/arm64 → linux-aarch64, darwin-* on macOS, windows-x86_64 and windows-aarch64 on Windows). Delegate-not-reimplement is true in both directions: install.sh runs dpkg -i and copies the AppImage rather than unpacking it, and install.ps1 runs the NSIS /S or msiexec /i … /qn. The matrix confirms the formats the page implies: bundle_ext is "AppImage deb" on Linux, "exe msi" on Windows and "dmg" on macOS (release.yml:114, :122, :130). · VERIFIED AND LEFT ALONE: the go-live note, that the releases/latest/download URLs 404 until a first release is published, remains accurate — and it is the honest framing for a page whose behaviour cannot be exercised here, since the repo's only tag is v0.0.5. The %LOCALAPPDATA%\Programs\kasir.mu default is backed by tauri.conf.json's nsis.installMode = "currentUser". The `install/` dead-ref pragma at the head is still correct: it suppresses the English phrase "One-line install/uninstall", and no real path reference on the page is mismatched. · NOT re-measured: an end-to-end install on any of the three platforms — there is no published release to install, which the page's go-live note states. · Superseded 2026-08-31 body preserved verbatim below as plain quoted text, its delimiters stripped so it cannot nest:
Audit stamp: 2026-08-31 · docs-auditor · status: ACCURATE (0 findings) · verified against HEAD: all 4 referenced scripts exist (win/install.ps1, win/uninstall.ps1, install.sh, uninstall.sh); repo URL kardelitaitu/kasirmu matches git remote and install.ps1's default $Repo -->

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
irm https://github.com/kardelitaitu/kasirmu/releases/latest/download/install.ps1 | iex
```

```bash
# Linux / macOS
curl -fsSL https://github.com/kardelitaitu/kasirmu/releases/latest/download/install.sh | bash
```

Both installers default to a **per-user, no-elevation** install:
`%LOCALAPPDATA%\Programs\kasir.mu` on Windows (NSIS `currentUser`),
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

> last audited 11-10-26 by docs-auditor
