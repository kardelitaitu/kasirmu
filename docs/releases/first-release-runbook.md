# First-Release Runbook — OZ-POS

<!-- Audit stamp: 2026-09-08 · DSH · status: ACCURATE · collapses a two-stamp stack into one, keeping both predecessors’ evidence. This file was the last exception to the “replace, do not stack” rule in .agents/skills/docs-auditor/SKILL.md §13; every stamped md file in the repo now carries exactly one.
  · FROM THE 2026-08-31 STAMP (docs-auditor, “ACCURATE (0 findings)”) — re-verified today, all still true: the release.yml SignPath step has continue-on-error: true at line 272, with a comment saying a SignPath failure must not block a release (it degrades to an unsigned fallback); UPDATER_CERT_PASSWORD is still named only in a header comment (release.yml:42) and consumed by no step; apps/desktop-client/tauri.conf.json still carries the updater pubkey; check-release-version.mjs, check-updater-compat.mjs and generate-latest-json.mjs exist; concurrency groups release-/release-android-/release-ios-<ref> match.
  · FROM THE 2026-09-04 STAMP (DSH, “STALE-BY-INFRA-CHANGE”) — the substantive repair, kept because it explains why §0/§3/§4/§5 read the way they do. On 2026-09-02, 23c963303 retired release.yml’s companion workflows android.yml and ios.yml to .bak, so the “whole pipeline” §3 step 4 described stopped existing. Corrected in place that day: the §0 banner, §3 rewritten to take a $V parameter (it hardcoded 0.0.24/0.0.25, which bump-version.ps1 now rejects as a backwards bump), §4/§5 preconditions, gh commands parameterized. Re-confirmed today against scripts/release.sh: it runs the checks, bumps, writes the changelog and creates a LOCAL tag at line 172, and its own header states the tag is NOT pushed — so “release.sh builds and uploads nothing” remains correct.
  · STILL OPEN, unchanged from 09-04 and not a doc problem: mobile release automation has no workflow at all, so any step here that implies an Android or iOS artifact is describing a manual process. -->

> **Purpose:** take a repository through its **first** real release, end to
> end: the secrets that must exist, the `release` environment approval gate,
> cutting the tag, and inspecting the draft before it goes public. Follow in
> order.
>
> **Companion docs:** `release-process.md` (operational runbook),
> `checklist.md` (per-release checklist), `mobile-checklist.md` (APK/IPA).

## 0. The pipeline at a glance

> ### ⚠️ This pipeline is not currently live
>
> Everything in this table describes `release.yml`, `android.yml` and `ios.yml` —
> all three were **retired to `.bak` on 2026-09-02** by `23c96330` ("backup full
> workflows to .bak and introduce streamlined Quick Dev CI"). GitHub never
> executes a `.bak` file, so **pushing a `v*` tag today triggers nothing**. The
> only live workflow is `dev-ci.yml` (`pull_request` → `main` +
> `workflow_dispatch`).
>
> The audit stamp above last re-checked this file on **2026-08-31**, when the
> three workflows were still live — so it was accurate as written. It was
> invalidated two days later by an infrastructure change that did not trigger a
> re-audit. Read the table below as **the design to restore**, not the current
> state; §3–§5 cannot be followed as written until it is.

Pushing a `v*` tag triggers three workflows, all keyed to the tag by
concurrency (`release-<tag>`, `release-android-<tag>`, `release-ios-<tag>` —
no cancel-in-progress):

| Stage | Workflow · job | What it does |
|---|---|---|
| Gate | `release.yml` · `release-validate` | Tag ↔ version parity (`check-release-version.mjs`) + updater client compat check (`check-updater-compat.mjs`) |
| Build | `release.yml` · `release-build` | Matrix: Linux AppImage+deb, Windows NSIS+MSI, macOS DMG, Docker cloud + license images; per-artifact existence gate; blocking Trivy scans |
| Publish | `release.yml` · `release-publish` | Toolchain self-tests → signed `latest.json` + `beta.json` → signature verification → `SHA256SUMS.txt` → **draft release** → inventory gate → **auto-publish** → provenance attestation |
| Mobile | `android.yml` / `ios.yml` | Signed APK/AAB + IPA, uploaded into the **same** release via `gh release upload --clobber` (poll up to 60 min for the release to exist) |

`release-publish` is gated by `environment: release` (see §2).

---

## 1. Secrets that must exist

Set everything in **Settings → Secrets and variables → Actions** of the
repository, **before** cutting the tag — the workflows fail fast when a
required secret is missing.

### Desktop (`release.yml`)

| Secret | Required | Format | Used by |
|---|---|---|---|
| `UPDATER_PRIVATE_KEY` | ✅ | Ed25519 **seed** — 64 hex chars, or base64 of the 32-byte seed | `release-publish` manifest signing (`generate-latest-json.mjs`) |
| `UPDATER_CERT` | optional | base64-encoded PFX (Authenticode) | Windows `signtool.exe` installer signing |
| `UPDATER_CERT_PASSWORD` | optional | PFX password | documented in the workflow header; **not currently consumed** by the import step |
| `SIGNPATH_API_TOKEN` | optional* | SignPath API token (submitter) | Windows installer code-signing via **SignPath** (free public trust for OSS) |
| `SIGNPATH_ORGANIZATION_ID` / `SIGNPATH_PROJECT_SLUG` / `SIGNPATH_SIGNING_POLICY_SLUG` | optional* | repo **variables** (not secrets) | identify the SignPath org / project / signing policy |

\* Both `UPDATER_CERT` and the SignPath route are **optional but recommended** —
see § End-user install experience below for what each one does (or doesn't) fix.
When neither is set, Windows installers ship **unsigned** (SmartScreen
"unknown publisher" appears on end-user machines).

**`UPDATER_PRIVATE_KEY` is the one secret a release cannot go without.**
It must be the raw Ed25519 **seed** whose public half equals the pubkey
embedded in `apps/desktop-client/tauri.conf.json::plugins.updater.pubkey`.
The workflow runs `--verify-pubkey` and aborts with `PUBKEY MISMATCH` if they
disagree. Before the first release, confirm you hold the seed for the
**current committed pubkey**; if you don't, follow the rotation procedure in
`release-process.md` (§ Updater pubkey rotation) to install a keypair you
control and commit the new pubkey **first**.

Local preflight of the key before tagging (fails fast on mismatch):

```bash
SEED="<64-hex or base64 seed>"
PUBKEY=$(node -e "const c=require('./apps/desktop-client/tauri.conf.json');process.stdout.write(c.plugins.updater.pubkey)")
echo "dummy" > /tmp/dummy-installer.bin
# The version argument is arbitrary here — this step only exercises the keypair.
UPDATER_PRIVATE_KEY="$SEED" node scripts/generate-latest-json.mjs 0.0.0-preflight preflight linux-x86_64 /tmp/dummy-installer.bin --verify-pubkey "$PUBKEY"
```

**`UPDATER_CERT` (optional):** base64-encoded Windows code-signing PFX.
Without it the workflow logs `::warning:: … installers will be UNSIGNED` and
uses a no-op `signCommand`, so the release still succeeds with **unsigned**
Windows installers. With it, `Import-PfxCertificate` imports the PFX and
Tauri signs via `signtool.exe`. Note the current import step does not pass
`UPDATER_CERT_PASSWORD` — a password-protected PFX may not import cleanly;
export the PFX without a password, or verify the step succeeds in a
`workflow_dispatch` dry run first.

### Android (`android.yml`)

| Secret | Required | Format |
|---|---|---|
| `ANDROID_KEYSTORE_BASE64` | ✅ | base64-encoded `.keystore` file |
| `KEYSTORE_PASSWORD` | ✅ | keystore master password |
| `KEY_PASSWORD` | ✅ (falls back to `KEYSTORE_PASSWORD`) | key password |
| `KEY_ALIAS` | ✅ | key alias in the keystore |

The workflow decodes the keystore into `apps/tablet-client/gen/android/` and
writes `keystore.properties` (password / keyAlias / storeFile) from
`KEYSTORE_PASSWORD` / `KEY_ALIAS` — the official Tauri v2 signing route
consumed by the tracked `build.gradle.kts` `signingConfigs` block (the CLI
has no keystore flags). Without the keystore the APK/AAB build is not
signed.

### iOS (`ios.yml`)

| Secret | Required | Format |
|---|---|---|
| `APPLE_TEAM_ID` | ✅ | Apple Developer team ID |
| `APPLE_BUNDLE_ID` | ✅ | bundle id, e.g. `com.ozpos.tablet` |
| `APPLE_CERT_BASE64` | ✅ | base64-encoded distribution certificate `.p12` |
| `APPLE_CERT_PASSWORD` | ✅ | p12 password |
| `APPLE_PROV_PROFILE_BASE64` | ✅ | base64-encoded provisioning profile |
| `KEYCHAIN_PASSWORD` | ✅ | temporary build-keychain password (any value) |

The workflow creates a throwaway keychain, imports the cert + profile, and
builds a signed IPA with `APPLE_DEVELOPMENT_TEAM` set (the tauri CLI reads
it at build time and syncs it into the generated Xcode project — the CLI
has no other signing flags; a bare `xcodebuild -showBuildSettings` step
persists nothing and is intentionally omitted). Apple signing is a hard
requirement for a device-installable IPA — missing secrets fail the job.

---

## 2. Configure the `release` environment approval

`release-publish` declares `environment: release`. GitHub **auto-creates**
environments on first reference, so until you configure it the gate does
**nothing** — the publish job runs straight through. To make publishing
require human approval:

1. GitHub repo → **Settings → Environments** → **New environment**.
2. Name it exactly **`release`**.
3. **Required reviewers** → add at least one person or team.
4. (Optional) **Deployment branches** → `main`, so only tags reachable from
   main can deploy.

> **What the gate does and doesn't do:** a job-level environment gate pauses
> the whole `release-publish` job **before it executes** — before the draft
> exists, before any key material is used. It is a *pre-publish review
> point*, not a draft-inspection window. To inspect the draft itself, see §4.

---

## 3. Cut the tag

> ### 🛑 Read this before following the steps below
>
> **Pushing a tag currently triggers no pipeline.** As of this writing the only
> live workflow is `.github/workflows/dev-ci.yml`, which fires on
> `pull_request` → `main` and `workflow_dispatch` — it has **no `push` trigger
> and no `tags:` trigger at all**. The release pipeline that used to answer a
> `v*` tag push was `release.yml` (`on: push: tags: ['v*']`), retired to
> `release.yml.bak` by `23c96330`; GitHub never executes a `.bak` file. Eleven
> workflows are in that state.
>
> `scripts/release.sh` does **not** fill the gap: it runs checks, writes the
> changelog and creates a **local annotated tag** — it builds nothing, uploads
> nothing, and opens no GitHub release (its own step 7 says the tag is not
> pushed). So after step 4 below, **nothing happens on its own**. Producing
> release artifacts means either restoring `release.yml` or building and
> publishing by hand with `gh release create`.
>
> Earlier revisions of this runbook said step 4 "triggers the whole pipeline".
> That was true before `23c96330` and is false now.

Version is locked at the current release — **read it, don't assume it**:

```bash
python -c "import re,sys;print(re.search(r'(?m)^version\s*=\s*\"([^\"]+)\"',open('Cargo.toml').read()).group(1))"
```

Only bump when you mean to cut. `bump-version.ps1` **refuses to go backwards**,
so a stale example version is not a cosmetic problem — it is a hard error.
Substitute the next version for `V` throughout:

```bash
V=0.0.36   # the release being cut
```

1. **Bump versions** (Windows):
   ```powershell
   powershell -File scripts/bump-version.ps1 $env:V
   ```
   Rewrites `Cargo.toml`, both `tauri.conf.json` files, `ui/package.json`,
   the website package and i18n strings, the three `AGENTS.md` mirrors, and
   inserts the canonical `## [$V]` heading into `CHANGELOG.md`. It then refreshes
   all three lockfiles, sweeps for stale references to the old version, and runs
   the AUDIT-28 gate — and **hard-fails if any pattern did not match**, so a
   partial bump cannot pass silently.
2. **Generate changelog + create tag:**
   ```bash
   bash scripts/release.sh --dry-run "$V"   # preview only
   bash scripts/release.sh "$V"             # writes docs/releases/CHANGELOG-$V.md, refreshes heading, runs the version gate, creates the local tag
   ```
3. **Verify parity locally** (optional but cheap):
   ```bash
   node scripts/check-release-version.mjs "v$V"
   ```
   Compares the tag against `Cargo.toml`, `ui/package.json`, both
   `tauri.conf.json` files, and the `CHANGELOG.md` heading.
4. **Push the tag:**
   ```bash
   git push origin main
   git push origin "v$V"
   ```
   Remember the warning above: this publishes the ref, it does **not** build or
   publish anything.

---

## 4. Cut the tag as a draft and inspect it

> **Precondition:** this section and §5 describe behaviour of `release.yml`,
> which is retired to `.bak` (§0). Until it is restored there is no draft, no
> artifacts, and nothing to inspect or verify — `scripts/release.sh` stops at a
> local tag.

**Behavior once `release.yml` is restored:** `release-publish` creates the
release as a **draft** (`softprops/action-gh-release`, `draft: true`) and then
**automatically** flips it to published (`gh release edit "$TAG" --draft=false`)
in the same job, after its inventory gate passes. There is **no built-in pause**
between draft creation and publish. For the first release, use one of these:

### Option A — hold the draft (recommended for the first release)

1. Temporarily comment out the publish flip in `.github/workflows/release.yml`
   inside the **"Verify release assets and publish"** step:
   ```yaml
   # echo "Publishing draft release $TAG"
   # gh release edit "$TAG" --draft=false
   # echo "Release $TAG published"
   ```
   Keep the inventory `grep` checks above it — they still fail the job if an
   asset is missing.
2. Cut the tag (§3). The job builds everything, signs the manifest, creates
   the **draft**, and stops.
3. Inspect the draft:
   ```bash
   gh release view v"$V"
   gh release download v"$V" -D /tmp/relcheck
   cd /tmp/relcheck
   sha256sum -c SHA256SUMS.txt
   # verify every platform's installer against the signed manifest
   # (run from the repo root so the scripts/ helper paths resolve):
   VERIFY="$PWD/scripts/verify-updater-signature.mjs"  # run from repo root
   cd /tmp/relcheck
   node "$VERIFY" latest.json linux-x86_64   OZ-POS_*.AppImage
   node "$VERIFY" latest.json windows-x86_64 OZ-POS_*.exe
   node "$VERIFY" latest.json darwin-aarch64 OZ-POS_*.dmg
   ```
   Confirm the full asset set: `latest.json`, `beta.json`, `SHA256SUMS.txt`,
   AppImage/deb, exe/msi, dmg — and, once the mobile jobs finish, the
   APK/AAB/IPA (they attach to the draft via `gh release upload --clobber`).
4. Publish when satisfied, then restore the workflow line:
   ```bash
   gh release edit v"$V" --draft=false
   ```

### Option B — environment gate only

Configure §2 reviewers. The publish job pauses **before** it runs; review the
Actions run (artifacts tab, Trivy SARIFs, test logs), then **Approve**. The
job then creates the draft and publishes back-to-back. You review before any
signing or publication, but you never see the draft itself.

---

## 5. Post-publish verification

- [ ] `gh release view v"$V"` shows the release as **Published** with every
      expected asset attached.
- [ ] Desktop updater endpoint resolves: `latest.json` (and `beta.json`) are
      attached and their signatures verify against the committed pubkey
      (§4 commands).
- [ ] Mobile APK/AAB + IPA attached to the same release (android.yml / ios.yml
      completed without `::error::`).
- [ ] Trivy scans green; SHA-256 checksums verified; provenance attestations
      present (`attest-build-provenance` runs on every asset class).
- [ ] One smoke install per platform on a test terminal (see `checklist.md`).
- [ ] Rollback path confirmed (previous version's installers + manifest are
      still attached to their own tags; `release-process.md` § Rollback).

> First release should also be the one that proves the **draft** mechanics
> (Option A). After it, the normal flow is Option B or plain auto-publish —
> the environment reviewers remain the standing human gate.

---

## 6. End-user install experience: zero-popup goal

Two independent mechanisms decide what an end user sees when they install
or first run the app:

| Layer | Mechanism | How it's fixed | Status |
|---|---|---|---|
| UAC elevation prompt | Missing/ignored `requestedExecutionLevel` manifest → Windows installer-detection heuristics | Embed a manifest with `<requestedExecutionLevel level="asInvoker"/>` | ✅ **None** — shipped Tauri apps (numeric-24 via `tauri-winres`), `oz-cloud-server.exe` (embed-resource build.rs), the `oz` CLI (`crates/oz-cli`, same pattern), and the license-server Windows build (Go `.syso` via go-winres) all carry a loadable `asInvoker` manifest. |
| SmartScreen / "Publisher: Unknown" | Unsigned Authenticode | Sign with a **publicly-trusted** certificate | ⚠️ **None only when** `UPDATER_CERT` **or** SignPath is configured |

### The free routes (no paid CA)

1. **Self-signed cert — `scripts/dev-code-sign.ps1` (dev/CI only).**
   Generates a `CN=OZ-POS Development` code-signing cert in the **CurrentUser**
   store (no admin), installs it into the user's Trusted Root (`-YesTrust`
   does this silently via the `X509Store` API; without it you'll get Windows'
   standard "install this root certificate?" Security Warning once), signs
   exes with `signtool`, and verifies. This kills "Publisher: Unknown" **on
   that one machine** — end users elsewhere still see the warning unless they
   install the same root. Use for local dev and CI-internal builds.
2. **SignPath — `release.yml` (public free route).** Free code signing for
   qualifying open-source projects, cloud-HSM key, publicly trusted chain.
   The workflow now uploads the Windows NSIS/MSI installers unsigned, submits
   them to SignPath (`signpath/github-action-submit-signing-request@v2`),
   and uploads the signed result — a **no-op until** `SIGNPATH_API_TOKEN`
   (secret) plus the three `SIGNPATH_*` variables are configured. This is the
   only free route that removes SmartScreen for **end users**.
3. **Paid `UPDATER_CERT` (OV/EV).** Existing optional path; unchanged.

### What still pops for end users if nothing is configured

- **SmartScreen "Windows protected your PC" / "unknown publisher":** appears
  for **unsigned** installers (the default until `UPDATER_CERT` or SignPath
  is configured). Configure SignPath to eliminate it for free on the public
  release.
- **UAC consent:** does **not** appear — the `asInvoker` manifests handle it.

### One-time setup for the SignPath route

> **Full walkthrough:** [`signpath-onboarding.md`](./signpath-onboarding.md)
> — applying for free OSS signing, creating the org / project / signing
> policy, configuring the `<zip-file>` Artifact Configuration, installing the
> SignPath GitHub App, and setting the `SIGNPATH_*` secrets/vars so the
> release workflow actually signs.

Summary of the one-time setup:

1. Apply for free open-source signing at signpath.org (org + project +
   signing policy must be approved; GitHub App or API token required).
2. Configure the SignPath **Artifact Configuration** as `<zip-file>` root —
   `actions/upload-artifact@v4` uploads ZIP archives by default, and SignPath
   needs the artifact configuration to unwrap them (SignPath docs note this
   explicitly).
3. Set `SIGNPATH_API_TOKEN` as a **secret**; the three `SIGNPATH_*` values as
   **variables**.
4. Verify the workflow's "Sign installers with SignPath" step runs on the
   next release (it's Windows-target only and skipped when the token is
   unset). The step is `continue-on-error: true`, so a SignPath outage
   degrades to the unsigned fallback upload instead of failing the release.

> last audited 08-09-26 by docs-auditor
