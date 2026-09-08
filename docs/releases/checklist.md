# Release Checklist — OZ-POS

<!-- Audit stamp: 2026-09-04 · DSH · status: ACCURATE · version lock: 0.0.36 · supersedes the same-day STALE-BY-INFRA-CHANGE stamp, whose central claim had become false in the other direction: it asserted "the release pipeline is not currently running" and "tagging v* triggers nothing", which was true when written and is not any more -- release.yml was restored desktop-only under R36-11. Re-verified this pass against the workflows rather than against prose: dev-ci.yml has exactly the 10 jobs listed in the Pre-Release item, release.yml has exactly release-validate/release-build/release-publish, the five scripts the pipeline calls all exist (check-release-version.mjs, check-updater-compat.mjs, generate-latest-json.mjs, verify-updater-signature.mjs, verify-windows-config.py), and plugins.updater.pubkey IS present in tauri.conf.json. The two caveats in the warning block are code-falsifiable and are now guarded by scripts/verify-release-workflow.py; mobile automation is NOT, and remains stated as manual. Size targets (<100MB/<50MB/<5MB) and smoke-test steps remain operational, not code-falsifiable -->

> Follow these steps in order for every release. Mark each item as completed.

> ## ⚠️ The release pipeline is desktop-only
>
> `release.yml` was renamed to `release.yml.bak` by `23c96330` on 2026-09-02 with
> an empty commit message and nothing replaced it, so for a whole release cycle
> pushing a `v*` tag triggered no workflow at all. It was **restored in 0.0.36 as
> a desktop-only pipeline** (R36-11): three Tauri targets, signed updater
> manifests, checksums, provenance, GitHub Release.
>
> | Checklist step | What actually happens |
> |---|---|
> | `git tag -a vX.Y.Z` + push | runs `release.yml`: `release-validate` → `release-build` → `release-publish` |
> | Desktop installers built + attached | ✅ Linux (AppImage/deb), Windows (NSIS/MSI), macOS (dmg) |
> | `latest.json` / `beta.json` | ✅ generated, signed, verified against the committed pubkey |
> | SHA-256 + provenance attestation | ✅ over every released asset |
> | **Mobile APK/AAB + IPA** | 🔴 **still `.bak`** — must be produced by hand |
> | **Container images at release time** | 🔴 dropped from this workflow; backend images are built by Northflank on deploy |
>
> **Two things to check before trusting a release:**
>
> 1. **`UPDATER_PRIVATE_KEY` must be configured as a repository secret.** Without
>    it `release-publish` hard-fails rather than shipping an unsigned manifest —
>    that is deliberate, and the static gate
>    (`scripts/verify-release-workflow.py`) exists partly to stop anyone making
>    it optional again.
> 2. **Windows installers are UNSIGNED unless `UPDATER_CERT` or SignPath is
>    configured.** The build emits a `::warning::` and a no-op signCommand; it
>    does not fail. Check the release page for a publisher, not just for assets.
>
> The build/sign/publish path itself **cannot be verified without a real tag
> push**, so treat the first release after any change to this file as a dry run.
> What *is* verified automatically, on every change to the release toolchain or
> the updater pubkey, is `dev-ci.yml#release-readiness` — it proves the
> signatures this pipeline emits are accepted by the real Tauri client verifier
> and that a tampered installer is rejected. That check previously ran nowhere.


## Pre-Release

- [ ] All CI jobs pass — `dev-ci.yml` jobs are `changes` (path router),
      `website`, `cargo-check` (fmt → check → clippy), `cargo-nextest`,
      `ui-test` (typecheck → lint → vitest → tz-invariance), `i18n`,
      `ci-docs-drift`, `static-gates` (architecture boundaries, money format,
      windows config, skill drift, healthcheck, panic inventory, release
      workflow validation, Go fmt/vet/test), `release-readiness` (updater
      signing chain), `northflank-deploy`.
      `release.yml` is live again as of 0.0.36 (desktop-only): `release-validate`
      → `release-build` → `release-publish`. It runs on a `v*` tag, not on a PR,
      so nothing here proves it works — see its header comment for what is and is
      not verified. `verify-ci-docs-drift.py` checks this list against the
      workflows.
- [ ] `cargo nextest run --workspace --all-features --profile ci` passes locally
- [ ] `cd ui && npm run typecheck && npm run lint && npm run test` passes locally
- [ ] `bash scripts/lint-i18n.sh` clean (no duplicate FTL keys, no verbatim ID bundles)
- [ ] Changelog generated at `docs/releases/CHANGELOG-{version}.md` with all changes since last release
- [ ] `## [{version}]` heading present in canonical `CHANGELOG.md` (the release version gate `node scripts/check-release-version.mjs v{version}` passes locally)
- [ ] Version bumped in: `Cargo.toml` (workspace), `ui/package.json`, `tauri.conf.json` files (via `scripts/bump-version.ps1 {version}`)
- [ ] Breaking changes documented with migration guide if needed

## Build Verification

- [ ] Docker image builds: `docker build -f Dockerfile.server -t oz-pos-cloud:latest .`
- [ ] Docker image size < 100 MB
- [ ] Desktop **installers** build (raw `cargo build --release` is not a release artifact):
  - Linux: `cargo tauri build --bundles appimage,deb`
  - Windows: `cargo tauri build --bundles nsis,msi` (code-signed when `UPDATER_CERT` is set)
  - macOS: `cargo tauri build --bundles dmg`
- [ ] Desktop binary size < 50 MB
- [ ] UI bundle builds: `cd ui && npm run build`
- [ ] UI bundle size < 5 MB

## Updater Manifest (RELEASE-04)

- [ ] Release contains `latest.json` + `beta.json` (matching `tauri.conf.json` updater endpoints)
- [ ] `node scripts/generate-latest-json.mjs --self-test` and `node scripts/verify-updater-signature.mjs --self-test` pass
- [ ] `node scripts/verify-updater-signature.mjs latest.json <platform> <installer>` verifies for every shipped platform
- [ ] `UPDATER_PRIVATE_KEY` secret derives to the pubkey embedded in `tauri.conf.json` (the workflow fails otherwise)
- [ ] Release contains `SHA256SUMS.txt` and provenance attestations for the exact installers

## Smoke Test

- [ ] App launches without errors
- [ ] Login flow works (PIN entry → workspace picker → POS screen)
- [ ] Basic sale works (add product → pay → receipt)
- [ ] Settings page loads and saves
- [ ] Offline mode works (disable network, complete sale)

## Release

- [ ] Git tag created: `git tag -a vX.Y.Z -m "Release vX.Y.Z"`
- [ ] Version gate verified **manually**: `node scripts/check-release-version.mjs vX.Y.Z`
      passes locally. The `release-validate` job that used to enforce this in CI
      lived in `release.yml`, which is `.bak` — pushing the tag does not run it.
- [ ] GitHub Release created (draft → published only after asset inventory passes)
- [ ] Docker image pushed to GHCR
- [ ] Desktop installers built + attached (AppImage/deb, NSIS/MSI, DMG)
- [ ] Mobile APK/AAB + IPA attached to the same release (via their tag workflows)
- [ ] Rollback verified: previous version installer reinstalls cleanly on a test terminal (see `release-process.md`)
- [ ] Release announced to team/channel

> last audited 04-09-26 by docs-auditor
