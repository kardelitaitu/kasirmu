# kasir.mu Windows install scripts

<!-- Audit stamp: 2026-08-31 · docs-auditor · status: ACCURATE (0 findings) · verified against HEAD: install.ps1 supports all documented flags (-Channel/-Version/-System/-DryRun/-NoLaunch/-Repo, default kardelitaitu/kasirmu); uninstall.ps1 -Purge exists; NSIS installMode=currentUser (tauri.conf.json:47); ../install.sh + ../uninstall.sh exist -->

One-line install and uninstall for Windows, backed by the project's existing
release pipeline. Both scripts are attached to every GitHub Release as
immutable, versioned assets — so `releases/latest/download/install.ps1`
always matches the release it is about to install, and both are covered by
the release's `SHA256SUMS.txt`.

## Install

```powershell
irm https://github.com/kardelitaitu/kasirmu/releases/latest/download/install.ps1 | iex
```

Or download the script and run it (recommended — the script then verifies
its **own** checksum too):

```powershell
./install.ps1
```

Options:

| Flag            | Meaning                                                        |
| --------------- | -------------------------------------------------------------- |
| `-Channel beta` | Install the beta channel (`beta.json` manifest)                |
| `-Version x.y.z`| Pin a specific release (e.g. `-Version 0.0.28`)                |
| `-System`       | Per-machine install to Program Files via the MSI (UAC prompt)  |
| `-DryRun`       | Download + verify everything, but do not run the installer     |
| `-NoLaunch`     | Do not launch kasir.mu after a successful install             |
| `-Repo owner/repo` | Override the GitHub repository (forks)                     |

> **Go-live note:** the `releases/latest/download/…` URLs (and the in-app
> updater's own `latest.json` endpoint) resolve only after **at least one
> release has been published** on the repo. The pipeline publishes on `v*`
> tags; until the first release ships, these URLs 404.

The default install is **per-user, no elevation**: the Tauri NSIS installer
is compiled with `installMode=currentUser`, so it installs to
`%LOCALAPPDATA%\Programs\kasir.mu`, creates the Start Menu shortcut and the
HKCU uninstall registry entry, and never shows a UAC prompt. Running the
script again over an existing install upgrades in place.

## Uninstall

```powershell
irm https://github.com/kardelitaitu/kasirmu/releases/latest/download/uninstall.ps1 | iex
# or
./uninstall.ps1            # keep local data
./uninstall.ps1 -Purge     # also delete local app data (databases, settings)
```

The script locates the uninstall entry the installer itself wrote to the
registry (HKCU for per-user, HKLM for per-machine), stops a running kasir.mu,
and runs the uninstaller silently. `-Purge` additionally removes
`%APPDATA%\mu.kasir.app` / `%LOCALAPPDATA%\mu.kasir.app` and the install
directory — it cannot be undone.

## How it works (security model)

1. **Resolve** — the script reads `latest.json` (or `beta.json`) from the
   release, the *same signed manifest the in-app updater trusts*. No GitHub
   API calls, no rate limits.
2. **Verify** — the installer and the script itself (when run from disk)
   are checked against `SHA256SUMS.txt` published on the same release over
   HTTPS. A checksum mismatch aborts before anything is executed.
3. **Sign** — the installer's Authenticode signature is reported when
   present. Releases may legitimately be unsigned until a signing
   certificate is configured, so an unsigned installer is a warning, not a
   hard fail: the checksum is the integrity guarantee.
4. **Run** — the NSIS installer executes silently (`/S`); `-System` uses
   `msiexec /i … /qn` for the per-machine MSI.

The scripts are deliberately thin: install/uninstall/shortcut/update wiring <!-- dead-ref: ok: prose listing four verbs, not four paths -->
all lives in the Tauri NSIS/MSI installers, keeping the `| iex` attack
surface small and auditable.

## Architecture support

`AMD64` → `windows-x86_64`, `ARM64` → `windows-aarch64` (manifest keys).
The release currently builds the x64 installer; an arm64 build appears in
the manifest automatically when the matrix ships one, and the script picks
it up with no changes.

## Roadmap

Linux and macOS counterparts are shipped in [`../install.sh`](../install.sh)
and [`../uninstall.sh`](../uninstall.sh) — same pattern: resolve the
platform manifest key, verify against `SHA256SUMS.txt`, and delegate to the
native installer (AppImage/deb on Linux, DMG on macOS).

> last audited 31-08-26 by docs-auditor
