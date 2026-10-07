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

## Platform notes

| Platform | Format | Requirements |
|----------|--------|-------------|
| Windows | MSI / NSIS | WiX / NSIS on PATH (or Tauri-bundled) |
| Linux | .deb / AppImage | Bundled with Tauri CLI |
| macOS | DMG | Code signing: Apple Developer ID cert |

- DB and config: `/var/lib/oz-pos/` (Linux), app data dir (Windows/macOS)
  > ⚠️ The `/var/lib/oz-pos/` path is a **pre-rebrand name still hardcoded in the packaging code** — `ops/packaging/linux/deb/postinst:14` and `prerm:6-7` create and reference it, and `ops/packaging/linux/kasir.mu.desktop:5` carries `Icon=oz-pos`. The path above is therefore accurate about what the scripts do, not what they should do. Flagged 2026-10-08 as an unresolved rebrand in the packaging layer, not as documentation drift.
- Auto-update uses Tauri's updater plugin; the **public** signing key is `kasirmu-updater.key.pub` (repo root). The private half is not committed. (This line said `oz-pos-updater.key` until 2026-10-08 — no such file has existed since the rebrand; the 2026-07-22 stamp that certified it as existing was wrong.)
- Release workflow in `.github/workflows/release.yml` builds all platforms on tag push

> last audited 08-10-26 by docs-auditor
