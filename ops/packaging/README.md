<!-- Audit stamp: 2026-07-22 · Hermes-Agent · status: ACCURATE (0 findings, paths verified) · all referenced paths exist: ops/packaging/linux/oz-pos.desktop, ops/packaging/linux/deb/postinst, ops/packaging/linux/deb/prerm, ops/packaging/mobile/, oz-pos-updater.key, .github/workflows/release.yml; bundle list (deb,appimage,msi,nsis,dmg) and /var/lib/oz-pos/ DB path consistent with release workflow + Tauri defaults -->

# OZ-POS Packaging

Platform installer metadata for Tauri bundler output.

## Structure

```
ops/packaging/
├── linux/
│   ├── oz-pos.desktop    # Freedesktop .desktop entry
│   └── deb/
│       ├── postinst      # Post-install script
│       └── prerm         # Pre-removal script
├── mobile/               # Tauri mobile build guide for Android tablets and iPads
```

Package builds are handled by Tauri's bundler during `cargo tauri build`:

```bash
cargo tauri build --bundles deb,appimage,msi,nsis,dmg
```

## Platform notes

| Platform | Format | Requirements |
|----------|--------|-------------|
| Windows | MSI / NSIS | WiX / NSIS on PATH (or Tauri-bundled) |
| Linux | .deb / AppImage | Bundled with Tauri CLI |
| macOS | DMG | Code signing: Apple Developer ID cert |

- DB and config: `/var/lib/oz-pos/` (Linux), app data dir (Windows/macOS)
- Auto-update uses Tauri's updater plugin; signing key pair in `oz-pos-updater.key` / `.key.pub`
- Release workflow in `.github/workflows/release.yml` builds all platforms on tag push

> last audited 29-08-26 by docs-auditor
