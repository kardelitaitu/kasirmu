# Release Process — kasir.mu

<!-- Audit stamp: 2026-09-04 · DSH · status: ACCURATE · version lock: 0.0.36 · supersedes the same-day STALE-BY-INFRA-CHANGE stamp. Its central claim ("as of 2026-09-02 this triggers nothing") was accurate when written and was overtaken by R36-11: release.yml is live again, desktop-only. Step 3 rewritten to describe what the restored pipeline actually does, including the two failure modes that are easy to miss -- a missing UPDATER_PRIVATE_KEY hard-fails by design, and unsigned Windows installers only WARN. Mobile (android.yml/ios.yml) and release-time Docker images remain unautomated and are called out as such rather than implied -->

This document captures the operational runbook for shipping a release of
kasir.mu. It exists because the updater pubkey is a security-critical value
that operators must know how to rotate safely (audit finding **L-4**).

## Publishing a release

> **First time shipping?** Follow [`first-release-runbook.md`](./first-release-runbook.md)
> instead — it covers the secrets that must exist, the `release` environment
> approval gate, and how to hold the release as a draft for inspection before
> publishing.

1. **Bump version** — run `scripts/bump-version.ps1 <new-version>` from the
   release branch. This rewrites version strings in `Cargo.toml`,
   `tauri.conf.json`, `ui/package.json`, and inserts the `## [X.Y.Z] — date`
   heading into the canonical `CHANGELOG.md` so they stay in sync.
2. **Generate changelog** — run `bash scripts/release.sh <new-version>`
   (or its `--dry-run` variant) to write the reviewed draft to
   `docs/releases/CHANGELOG-<version>.md` and refresh the canonical
   `CHANGELOG.md` heading. The script then runs the AUDIT-28 version gate
   (   `scripts/check-release-version.mjs`), which fails unless the tag, all
   app version sources, and the `CHANGELOG.md` heading agree. The same
   three release scripts carry `--self-test` mode and are re-validated on
   every local pre-CI gate run via `scripts/check.sh` (release version
   gate / updater manifest generator / updater signature verifier).
 3. **Tag and push** — `git tag -a vX.Y.Z && git push origin vX.Y.Z`.
    ✅ **As of 0.0.36 this runs `release.yml` again** (desktop-only). It had been
    retired to `release.yml.bak` by `23c96330` on 2026-09-02 with an empty commit
    message and nothing replaced it, so for a full release cycle tagging produced
    nothing at all. Restored, it runs `release-validate` → `release-build` →
    `release-publish`: the version gate, then **real Tauri installers**
    (`cargo tauri build`) — AppImage + deb (Linux), NSIS + MSI (Windows,
    code-signed when `UPDATER_CERT` or the SignPath route is configured), and DMG
    (macOS) — then signed `latest.json`/`beta.json`, SHA-256 checksums, provenance
    attestation, and a draft release published only after the asset inventory gate
    passes.

    Two caveats that are easy to get wrong:
      * **`UPDATER_PRIVATE_KEY` must be set as a repository secret.** Without it
        `release-publish` hard-fails rather than shipping an unsigned manifest.
        That is deliberate, and `scripts/verify-release-workflow.py` guards it.
      * **Windows installers are UNSIGNED unless `UPDATER_CERT` or SignPath is
        configured**, and the build only emits a warning. Check the release page
        for a real publisher, not just for attached assets.

    **Mobile is still not automated** — `android.yml` and `ios.yml` remain `.bak`,
    so APK/AAB and IPA still need the manual route below. The release-time Docker
    images were dropped when `release.yml` was restored: backend images are built
    by Northflank (`dev-ci.yml#northflank-deploy`), and an inventory gate
    demanding a `.tar` that no job produces would fail every release.

    The build/sign/publish path cannot be verified without a real tag push, so
    treat the first release after any change to this workflow as a dry run. What
    IS verified automatically on every change to the release toolchain or the
    updater pubkey is `dev-ci.yml#release-readiness`, which proves the signatures
    this pipeline emits are accepted by the real Tauri client verifier.
    Verify the version gate locally first:
    `node scripts/check-release-version.mjs vX.Y.Z`.

   **Windows code signing — the free routes (see the first-release runbook §6):**

   - `UPDATER_CERT` (paid OV/EV cert, optional) — classic signtool signing.
   - **SignPath** (free public-trust signing for qualifying OSS projects) —
     the workflow uploads the Windows installers unsigned, submits them to
     `signpath/github-action-submit-signing-request@v2` (gated on the
     `SIGNPATH_API_TOKEN` secret + three `SIGNPATH_*` variables), and
     uploads the signed result. This is the route that removes SmartScreen
     "unknown publisher" for **end users** without buying a certificate.
     One-time onboarding (OSS application, org/project/signing policy,
     `<zip-file>` artifact config, GitHub App, secrets/vars): see
     [`signpath-onboarding.md`](./signpath-onboarding.md).
   - `scripts/dev-code-sign.ps1` — self-signed cert for **dev/CI machines**
     only (trust is local to the machine that installs the root).

   Shipped Tauri app exes (numeric-24 via `tauri-winres`) and
   `oz-cloud-server.exe`, the `oz` CLI (`crates/oz-cli`, embed-resource
   build.rs), and the license-server Windows build (Go `rsrc_windows_amd64.syso`
   via go-winres, `//go:generate` in main.go) all embed an `asInvoker`
   manifest (numeric RT_MANIFEST type 24), so no UAC elevation prompt
   appears on launch or install. (The `license-server.exe` artifact itself is
   gitignored; the committed `.syso` guarantees any Windows `go build`
   carries the manifest.)
4. **Signed updater manifest** — the workflow generates `latest.json` and
   `beta.json` (Ed25519 signatures over the raw installer bytes, using the
   `UPDATER_PRIVATE_KEY` secret) and verifies them against the pubkey in
   `tauri.conf.json::plugins.updater.pubkey` **before** publishing. The
   release workflow also runs `scripts/check-updater-compat.mjs`, an
   end-to-end compatibility check that signs a dummy installer with
   `generate-latest-json.mjs` and feeds the result through a Rust harness
   pinned to the exact `minisign-verify` version the real Tauri client
   resolves (`tauri-plugin-updater` 2.10.1 → `minisign-verify 0.2.5`),
   proving the emitted signatures are accepted by the real client
   verifier. The release is created as a draft and only published after
   the asset inventory check passes.
5. **Mobile** — the Android/iOS workflows (tag-triggered) upload their
   APK/AAB/IPA directly into the same GitHub Release via `gh release upload`.
6. **Announce** — publish the release notes (mirroring the new
   `CHANGELOG.md` section).

> **Note:** `cargo build --release` produces raw platform binaries only.
> Installers, code signing, and updater manifests come from the Tauri build
> step (`cargo tauri build`) and the release workflow — do not treat a raw
> binary as a shippable release artifact.

## Updater pubkey rotation

L-4 audit note: the Ed25519 pubkey for `tauri-plugin-updater` is currently
hardcoded in `tauri.conf.json::plugins.updater.pubkey`. The configuration
is sufficient for production but operators must know how to rotate the key
when the existing signing key is compromised or reaches end-of-life.

### When to rotate

- **Compromise** — the private signing key has been exposed, leaked, or
  exfiltrated (e.g. developer laptop loss). Rotate **immediately**; treat
  any artifact signed by the old key as untrusted.
- **Scheduled rotation** — every 24 months minimum, per the audit doc's
  recommendation for cryptographic-primitive supply-chain hygiene.
- **Algorithm rotation** — Tauri 2 currently uses Ed25519. If a future
  quantum-safe algorithm is adopted, the pubkey format and signing
  pipeline must be regenerated.

### How to rotate

1. **Generate a fresh signing keypair** using `cargo tauri signer generate`
   or `tauri signer generate -w ~/.tauri/oz-pos.key`. Save the **private**
   key in a secure secrets manager (not the repo).
2. **Encode the new public key** as the standard Tauri base64 string
   (one long line, no newlines).
3. **Edit `apps/desktop-client/tauri.conf.json`** and replace
   `plugins.updater.pubkey` with the new base64 string.
4. **Re-sign all release artifacts** for the next release — the new key
   cannot validate previously-signed artifacts, so clients installed
   via older releases must update through a Tauri-side delta or a fresh
   install.
5. **Document the rotation** in `CHANGELOG.md` under
   `### Security` with the old pubkey prefix (first 8 chars) and the new
   prefix so operators can audit.
6. **PR review** — the pubkey rotation change must be reviewed by at
   least two maintainers; the change is not a routine edit.

### Emergency revocation

If the private key is compromised mid-release:

1. **Publish an advisory** immediately via the project's `SECURITY.md`
   contact channel.
2. **Revoke at the update endpoint** — if the manifest endpoint is under
   operator control, take it offline. Existing client installations
   will fail to update, which is correct (better than running
   compromised artifacts).
3. **Coordinate a forced re-install** with every known downstream
   operator.

## Rollback / downgrade (RELEASE-08)

Rollback is manual but the assets needed for it are always preserved:

1. **Every tagged release is immutable.** GitHub Releases keep all historical
   installers + their `latest.json`/`beta.json` assets, so an old client can
   always be pointed at a previous version's tag-specific manifest
   (`https://github.com/<owner>/<repo>/releases/download/v<old>/latest.json`).
2. **To roll back a store fleet:** reinstall the previous version's installer
   on each terminal. A Tauri updater cannot auto-downgrade — the updater only
   serves versions newer than the installed one, so a downgrade is a manual
   reinstall by design.
3. **Verify before rollout:** install the previous installer on a test
   terminal, confirm `vX.Y.Z` in Settings → About, complete a sale, and
   confirm sync/offline behaviour — then proceed to production terminals.
4. **Never delete old release assets** (e.g. during a cleanup) while any
   terminal still runs a version older than the latest release, or the
   updater endpoint breaks for those terminals.

## Pre-release checklist

See [`docs/releases/checklist.md`](./checklist.md) and
[`docs/releases/mobile-checklist.md`](./mobile-checklist.md) for the
operational pre-release checks. Both are referenced from
`scripts/release.sh`.

> last audited 04-09-26 by docs-auditor
