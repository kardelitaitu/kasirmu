<!-- REBRAND 2026-10-08 (owner direction: "it should be use kasirmu, not oz-pos"): the residual pre-rebrand names in this directory were corrected rather than left as records. `kasir.mu.desktop` now carries `Icon=kasir.mu` and `MimeType=application/x-kasirpkg` (the `.ozpkg` extension is legacy-only — `cli.rs:74,86` and `ui/src/api/data.ts:142,177` accept both). `postinst`/`prerm` moved from `/var/lib/oz-pos` to `/var/lib/kasir.mu` WITH a migration (an existing legacy directory is moved, never abandoned, and never allowed to clobber a new one — all three branches exercised in a sandbox). The Dockerfile usage comments were rebranded too (image tags, volume names). `ops/install/uninstall.sh` deliberately still names the legacy `oz-pos` binaries and `.desktop` entry, because that is upgrade cleanup and removing it would strand them. Verified: `verify-shell-syntax.py` = 0 and `sh -n` passes on both scripts; all nine docs detectors green. -->

<!-- FOLLOW-UP 2026-10-08: the earlier note on this page called `/var/lib/oz-pos/` an "unresolved rebrand in the packaging layer". Investigating it properly showed the framing was wrong in BOTH directions, and the page now says what is actually true. (1) The path is NOT the app's data location: the app resolves Tauri's `app_data_dir()` from the bundle identifier `mu.kasir.app` (apps/desktop-tauri/src/commands/branding.rs:124), and no Rust code anywhere reads `/var/lib/oz-pos/`. It was documentation drift, not a live data path. (2) The hand-written `ops/packaging/linux/` files are NOT consumed by any build: `release.yml:113` does build `bundles: appimage,deb`, but Tauri's bundler generates its own .desktop and maintainer scripts from `tauri.conf.json`, and nothing references this directory except `scripts/verify-shell-syntax.py`, which only parses the two deb scripts for syntax. The live Linux installer is `ops/install/install.sh`, which writes its own `kasir.mu.desktop` and already removes the legacy `oz-pos.desktop`. So the `oz-pos` strings were left UNCHANGED deliberately — renaming an artifact no build reads would imply it is load-bearing — and the page now warns that this directory is a reference copy. -->

<!-- Audit stamp: 2026-10-08 · docs-auditor · status: ACCURATE AFTER REPAIR (2 findings) · Supersedes the 2026-07-22 marker below, kept verbatim — including its claim that "all referenced paths exist", which was wrong for one of them. (1) The auto-update line named `oz-pos-updater.key` / `.key.pub`; no such file exists. The public key in this repo is **`kasirmu-updater.key.pub`** (repo root, tracked); the private half is not committed. Corrected. (2) The DB/config path `/var/lib/oz-pos/` is accurate about what the scripts DO — `ops/packaging/linux/deb/postinst:14` and `prerm:6-7` still create and reference it, and `ops/packaging/linux/kasir.mu.desktop:5` still carries `Icon=oz-pos` — so the line is kept and an operator note now flags it as an unresolved rebrand in the packaging layer rather than presenting it as intended. · Repaired against branch 0.0.41. -->
<!-- Audit stamp: 2026-07-22 · Hermes-Agent · status: ACCURATE (0 findings, paths verified) · all referenced paths exist: ops/packaging/linux/kasir.mu.desktop, ops/packaging/linux/deb/postinst, ops/packaging/linux/deb/prerm, ops/packaging/mobile/, oz-pos-updater.key, .github/workflows/release.yml; bundle list (deb,appimage,msi,nsis,dmg) and /var/lib/oz-pos/ DB path consistent with release workflow + Tauri defaults -->

# kasir.mu Packaging

Platform installer metadata for Tauri bundler output.

## Structure

```
ops/packaging/
├── linux/
│   ├── kasir.mu.desktop    # Freedesktop .desktop entry
│   └── deb/
│       ├── postinst      # Post-install script
│       └── prerm         # Pre-removal script
├── mobile/               # Tauri mobile build guide for Android tablets and iPads
```

Package builds are handled by Tauri's bundler during `cargo tauri build`:

```bash
cargo tauri build --bundles deb,appimage,msi,nsis,dmg
```

> ℹ️ **These hand-written files are not consumed by that bundler.** Tauri generates its own
> `.desktop` entry and maintainer scripts from `apps/desktop-tauri/tauri.conf.json`; the only
> reference to `ops/packaging/linux/` outside its own README is `scripts/verify-shell-syntax.py`,
> which parses the two `deb/` scripts for syntax rather than running them. The live
> user-facing Linux installer is `ops/install/install.sh`. They are still maintained as the
> reference copy of the Debian packaging behaviour, and were rebranded 2026-10-08 (see the
> data-path note below). **A parse error here still fails `verify-shell-syntax.py`**, so
> edits to them are graded even though no package build reads them.

## Platform notes

| Platform | Format | Requirements |
|----------|--------|-------------|
| Windows | MSI / NSIS | WiX / NSIS on PATH (or Tauri-bundled) |
| Linux | .deb / AppImage | Bundled with Tauri CLI |
| macOS | DMG | Code signing: Apple Developer ID cert |

- DB and config: **the Tauri app-data directory** on every platform, resolved from the bundle
  identifier `mu.kasir.app` via `AppHandle::path().app_data_dir()` (e.g.
  `apps/desktop-tauri/src/commands/branding.rs:124`). On Linux that is `~/.local/share/mu.kasir.app/`, and the
  Debian maintainer scripts also provision `/var/lib/kasir.mu/`.
  > **Rebranded 2026-10-08.** This line previously stated `/var/lib/oz-pos/` as the data path. The
  > app data location was documented wrong — no Rust code reads `/var/lib/oz-pos/`, the app uses
  > `app_data_dir()` — and the pre-rebrand name was also stale in the packaging files themselves:
  > `postinst` and `prerm` now use `/var/lib/kasir.mu/`, and `kasir.mu.desktop` now carries
  > `Icon=kasir.mu` and `MimeType=application/x-kasirpkg`.
  >
  > **Upgrades are handled, not abandoned:** `postinst` moves an existing `/var/lib/oz-pos/` to
  > the new name when the new one does not already exist, and `prerm` mentions the old directory if
  > it is still present. `ops/install/uninstall.sh` deliberately still lists the legacy
  > `oz-pos` binaries and `.desktop` entry, so an upgrade cleans them up rather than
  > leaving both installed.
- **Some `oz-pos` strings elsewhere in the tree are load-bearing and must NOT be
  rebranded.** The naming cleanup above applies to names that were simply stale. Three sites
  outside this directory hold `oz-pos` as a real infrastructure identifier: the Northflank
  **project id** (an API path segment — `/v1/projects/oz-pos/services/cloud/…`, and
  `NF_PROJECT_ID` at .github/workflows/dev-ci.yml:1675), the Cloudflare **Worker name**, and
  the historical image tags. Renaming any of them turns working URLs into 404s; the
  skill-drift guard allow-lists them for exactly this reason (`PREFIX_ALLOWLIST` in
  `.agents/skills/skill-drift-guard/scripts/detect.sh`). The live skills say so themselves —
  `deploy-northflank/SKILL.md`, `northflank-deploy-diagnosis/SKILL.md`, `deploy-cloudflare/SKILL.md`.
  Flagged here because "finish the rebrand" is the natural next move for a reader who finds
  them, and on those three it is the wrong one.
- Auto-update uses Tauri's updater plugin; the **public** signing key is `kasirmu-updater.key.pub` (repo root). The private half is not committed. (This line said `oz-pos-updater.key` until 2026-10-08 — no such file has existed since the rebrand; the 2026-07-22 stamp that certified it as existing was wrong.)
- Release workflow in `.github/workflows/release.yml` builds all platforms on tag push

> last audited 08-10-26 by docs-auditor
