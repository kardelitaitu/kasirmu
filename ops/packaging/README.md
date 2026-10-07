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

> ⚠️ **The hand-written files in this directory are NOT consumed by that bundler.**
> Tauri generates its own `.desktop` entry and its own maintainer scripts from
> `apps/desktop-tauri/tauri.conf.json`; nothing in `tauri.conf.json`, any workflow, or any
> script references `ops/packaging/linux/` (checked 2026-10-08: the only appearance of this
> directory outside its own README is `scripts/verify-shell-syntax.py`, which parses the two
> `deb/` scripts for syntax — it does not run them). The live user-facing Linux installer is
> `ops/install/install.sh`, which writes its own `kasir.mu.desktop` and already removes the
> legacy `oz-pos.desktop`. Treat this directory as a reference copy: editing it changes what
> the bundler produces for exactly nothing.

## Platform notes

| Platform | Format | Requirements |
|----------|--------|-------------|
| Windows | MSI / NSIS | WiX / NSIS on PATH (or Tauri-bundled) |
| Linux | .deb / AppImage | Bundled with Tauri CLI |
| macOS | DMG | Code signing: Apple Developer ID cert |

- DB and config: **the Tauri app-data directory** on every platform, resolved from the bundle
  identifier `mu.kasir.app` via `AppHandle::path().app_data_dir()` (e.g.
  `apps/desktop-tauri/src/commands/branding.rs:124`). On Linux that is `~/.local/share/mu.kasir.app/`,
  **not** `/var/lib/oz-pos/`.
  > ⚠️ Corrected 2026-10-08. This line previously stated `/var/lib/oz-pos/` as the data path and
  > attributed it to the deb scripts. Two things were wrong: (a) no Rust code anywhere reads that
  > path — the app uses `app_data_dir()` — and (b) the `deb/postinst` that creates it is not consumed
  > by any build (see the note above), so the directory is never created by a Tauri release either.
  > The `oz-pos` strings survive only inside those unwired hand-written files —
  > `postinst:14`, `prerm:6-7`, and the `Icon=oz-pos` /
  > `MimeType=application/x-ozpkg` lines of `kasir.mu.desktop`. They are harmless there and are
  > left alone rather than renamed: editing an artifact no build reads would suggest it is
  > load-bearing.
- Auto-update uses Tauri's updater plugin; the **public** signing key is `kasirmu-updater.key.pub` (repo root). The private half is not committed. (This line said `oz-pos-updater.key` until 2026-10-08 — no such file has existed since the rebrand; the 2026-07-22 stamp that certified it as existing was wrong.)
- Release workflow in `.github/workflows/release.yml` builds all platforms on tag push

> last audited 08-10-26 by docs-auditor
