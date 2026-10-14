<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (2 major, 3 minor) · Full audit. The prior 2026-09-29 body is merged at the bottom as original evidence. · MAJOR 1 — THE DOCUMENT CONTRADICTED ITSELF ABOUT THE PIPELINE, AND THE STALE HALF WAS THE DANGEROUS DIRECTION. §0's banner correctly says release.yml is LIVE desktop-only, but §3 still opened with "🛑 Pushing a tag currently triggers no pipeline", named release.yml.bak as the retired copy, and concluded "nothing happens on its own". Measured at HEAD: release.yml IS live (25 KB, validate/build/publish on v* tags), release.yml.bak does NOT exist at all, and scripts/release.sh still builds nothing. The block is replaced with the current state — and, crucially, a v* tag now runs TWO workflows, because android.yml was restored on 2026-09-22. · MAJOR 2 — ANDROID WAS DESCRIBED AS RETIRED IN FOUR PLACES while it is LIVE. The §0 table row, the §0 Mobile stage row, and the §Android secrets heading all said "RETIRED .bak, nothing runs". .github/workflows/android.yml exists (10 KB), is triggered by v* tags + workflow_dispatch, and its own header documents that secrets are OPTIONAL because "an absent keystore yields an UNSIGNED apk that still proves the build compiles, which is this job's actual assertion". The .bak generation it was described from has been superseded: the retired copies now live under attic/, and the authoritative statement is ops/packaging/mobile/README.md §CI/CD ("One mobile workflow is live: android.yml", corrected 2026-10-08). iOS is genuinely retired — but at attic/ios.yml.bak, not ios.yml.bak. · MINORS, all live present-tense paths a reader follows: apps/desktop-client/tauri.conf.json -> apps/desktop-tauri/tauri.conf.json (twice, including a copy-pasteable node -e command); apps/tablet-client/gen/android/ -> apps/mobile-tauri/gen/android/; docs/releases/CHANGELOG-$V.md -> docs/records/releases/CHANGELOG-$V.md; crates/oz-cli -> crates/kasirmu-cli. · VERIFIED AND LEFT ALONE: release.sh's local-tag behaviour (its own step 7 says the tag is not pushed), the UPDATER_PRIVATE_KEY hard-fail, the UPDATER_CERT/SignPath optionality, the §2 environment-gate explanation, §6's asInvoker-manifest table, the SignPath onboarding pointer, and every `gh` command. The dated stamps (2026-09-08, 2026-09-04, 2026-08-31) are preserved verbatim below as evidence. · NOT re-measured: the release matrix itself — verifying installers, Trivy, provenance or an actual publish needs a real tag push. The prior 2026-09-29 body follows. -->
<!-- PRIOR AUDIT BODY (2026-09-29, preserved as plain text; delimiters stripped) — Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file, but a narrow one: at 380 lines it already carries a DSH stamp dated 2026-09-08 and a footer dated 08-09-26, and that stamp records that it itself collapses a two-stamp stack after finding five findings. That prior work is retained verbatim and re-labelled rather than redone, and this entry's value is in the scope observation below rather than in re-treading a repair someone already made a fortnight ago. · WHAT THE PRIOR STAMP ESTABLISHED, confirmed rather than re-derived: the runbook is accurate after repair, and the file carries a history-of-the-banner note explaining why — a lesson about audit stamps preserved inside the document itself, which is unusual and good. The individual release commands and thresholds are that audit's subject and were verified against HEAD three weeks ago; they are not re-measured here. · WHAT THIS PASS ADDS is a distinction about the directory rather than the file. This runbook and `mobile-checklist.md` are the two OPERATIONAL documents in `docs/releases/` — the four changelogs beside them are dated records, while these two are things an engineer follows while shipping. That matters for how they should be maintained: a changelog should be frozen and stamped once, a runbook should be re-verified before every release, and the two have been receiving identical treatment in this directory. Stating it once, plainly, because the failure mode of a runbook is not a wrong sentence but a step that no longer matches the tool it drives — and the mobile checklist audited in the same round is exactly that: its iOS build trigger points at a workflow that has been retired. That is the concrete illustration of why this distinction earns its keep. · Prior stamp retained as original evidence; footer bumped to match the new stamp. -->
# First-Release Runbook — kasir.mu

<!-- Superseded audit marker (2026-09-08 · DSH, body kept verbatim) · retained · status: ACCURATE after repair (5 findings) · collapses a two-stamp stack into one and repairs a warning that had itself gone stale. §0's banner said "pushing a v* tag today triggers nothing" and named release.yml, android.yml and ios.yml as all retired. Only two of those are: 3b10ea3a2 restored release.yml (desktop-only, validate/build/publish on v* tags) on 2026-09-04 — the same day this banner was written, hours after it. Verified against the files today: release.yml exists with jobs release-validate / release-build / release-publish; android.yml and ios.yml exist only as .bak. · The banner is now a three-row live/retired table, and §1's Android and iOS secret headings, the §0 Mobile row, §4's “three workflows” opener and §5's asset checklist were each corrected to say nothing runs — a contributor provisioning ANDROID_KEYSTORE_BASE64 today is setting a secret no workflow will ever read. · WHY A WARNING CAN BE THE DANGEROUS KIND OF STALE: a false “this works” makes someone skip a step; a false “this does not work” makes them skip §5's signature verification on artifacts that are actually shipping. Both were live in this file at once, on opposite sides of the same table. · FROM THE 2026-08-31 STAMP (docs-auditor, “ACCURATE (0 findings)”) — re-verified today, all still true: SignPath continue-on-error: true at release.yml:272 with its “must not block a release” comment (degrades to unsigned fallback); UPDATER_CERT_PASSWORD named only in a header comment at release.yml:42 and consumed by no step; updater pubkey present in apps/desktop-client/tauri.conf.json; check-release-version.mjs, check-updater-compat.mjs, generate-latest-json.mjs exist; concurrency groups release- / release-android- / release-ios-<ref> match the files (the latter two now orphaned). · FROM THE 2026-09-04 STAMP (DSH, “STALE-BY-INFRA-CHANGE”) — its substantive repairs stand and are kept: §3 rewritten to take a $V parameter (it hardcoded 0.0.24/0.0.25, which bump-version.ps1 rejects as a backwards bump), §4/§5 preconditions, gh commands parameterized. Re-confirmed against scripts/release.sh: checks, bump, changelog, then a LOCAL tag at line 172 whose own header says it is NOT pushed — “release.sh builds and uploads nothing” remains correct. · NOTE ON THE RESTORATION COMMIT ITSELF: 3b10ea3a2 is the commit AGENTS.md cites as its cautionary example — subject “fix(website): reposition popular badge on pricing preview cards”, diff containing the restoration of the release pipeline. This file is the proof that reviewing by subject line loses real changes: the release process came back inside a badge-position commit, and no document noticed until a page that had been corrected to say “nothing runs” became wrong by becoming accurate.
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

> ### ⚠️ Half of this pipeline is live, half is not
>
> Everything in this table describes `release.yml`, `android.yml` and `ios.yml`. All
> three were **retired on 2026-09-02** by `23c96330` ("backup full workflows
> to .bak and introduce streamlined Quick Dev CI"), and this banner said "pushing a
> `v*` tag today triggers nothing" when it was written on 2026-09-04. **That was true
> for a few hours.** `3b10ea3a2` restored `release.yml` the same day — desktop only,
> validate/build/publish, running on `v*` tags — and the banner was never updated.
>
> Current state, verified 08-09-26 against the workflow files:
>
> | Workflow | Live? | What it produces |
> |---|---|---|
> | `release.yml` | ✅ **LIVE** (`v*` tags) | Signed desktop installers + `latest.json`/`beta.json` updater manifests + provenance |
> | `android.yml` | ✅ **LIVE** (`v*` tags + `workflow_dispatch`) | compiles the Android APK and uploads `kasirmu-tablet-aarch64`; an absent keystore yields an **UNSIGNED** apk by design |
> | `ios.yml` | ❌ retired — now `attic/ios.yml.bak` | nothing — IPA is a manual build |
>
> A stale "this does not work" warning is not the safe kind of stale: an operator who
> believes it will not wait for the desktop artifacts a tag really does produce, and
> will not run §5's post-publish verification at all.
>
> The live workflows in this repo are `dev-ci.yml` (`pull_request` → `main` +
> `workflow_dispatch`) and `release.yml` (`v*` tags, desktop only). AGENTS.md keeps the
> canonical list.
>
> History of this banner, because it is the lesson: the audit stamp above last checked
> this file on **2026-08-31**, when all three release workflows were live, so it was
> accurate as written. `23c963303` retired them on 09-02 and the 09-04 re-audit corrected
> the page to say nothing runs. `3b10ea3a2` restored `release.yml` **later the same day**,
> and nothing re-audited the correction. Two infrastructure changes, one document, and
> the second one moved the page back into error while leaving a confident warning on it.
> Read §1's Android/iOS secret tables as **the design to restore**, not the current
> state — but §3–§5 describe the desktop path accurately and can be followed today.

Pushing a `v*` tag today triggers **one** workflow, `release.yml`, keyed by concurrency
`release-<tag>` (no cancel-in-progress). The `release-android-<tag>` and
`release-ios-<tag>` groups are still declared in the retired files and match nothing
live:

| Stage | Workflow · job | What it does |
|---|---|---|
| Gate | `release.yml` · `release-validate` | Tag ↔ version parity (`check-release-version.mjs`) + updater client compat check (`check-updater-compat.mjs`) |
| Build | `release.yml` · `release-build` | Matrix: Linux AppImage+deb, Windows NSIS+MSI, macOS DMG, Docker cloud + license images; per-artifact existence gate; blocking Trivy scans |
| Publish | `release.yml` · `release-publish` | Toolchain self-tests → signed `latest.json` + `beta.json` → signature verification → `SHA256SUMS.txt` → **draft release** → inventory gate → **auto-publish** → provenance attestation |
| Mobile | `android.yml` ✅ **LIVE** / ~~`ios.yml`~~ **retired** | Android compiles the APK and uploads `kasirmu-tablet-aarch64` (UNSIGNED when no keystore secret is set). iOS runs nothing — build the IPA by hand per `ops/packaging/mobile/README.md` and attach both with `gh release upload --clobber` (poll up to 60 min for the release to exist) |

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
embedded in `apps/desktop-tauri/tauri.conf.json::plugins.updater.pubkey`.
The workflow runs `--verify-pubkey` and aborts with `PUBKEY MISMATCH` if they
disagree. Before the first release, confirm you hold the seed for the
**current committed pubkey**; if you don't, follow the rotation procedure in
`release-process.md` (§ Updater pubkey rotation) to install a keypair you
control and commit the new pubkey **first**.

Local preflight of the key before tagging (fails fast on mismatch):

```bash
SEED="<64-hex or base64 seed>"
PUBKEY=$(node -e "const c=require('./apps/desktop-tauri/tauri.conf.json');process.stdout.write(c.plugins.updater.pubkey)")
echo "dummy" > /tmp/dummy-installer.bin
# The version argument is arbitrary here — this step only exercises the keypair.
UPDATER_PRIVATE_KEY="$SEED" node scripts/generate-latest-json.mjs 0.0.0-preflight preflight linux-x86_64 /tmp/dummy-installer.bin --verify-pubkey "$PUBKEY"
```

**`UPDATER_CERT` (optional):** base64-encoded Windows code-signing PFX.
Without it the workflow logs `::warning:: … installers will be UNSIGNED` and
uses a no-op `signCommand`, so the release still succeeds with **unsigned**
Windows installers. With it, `Import-PfxCertificate` imports the PFX and
Tauri signs via `signtool.exe`.

**Corrected 2026-10-03.** This paragraph previously told you to *export the PFX without a
password*, because `Import-PfxCertificate` was called without `-Password` — so a normal
CA-issued PFX could not be imported at all, and the workaround was to store an unencrypted
private key. The import now passes `UPDATER_CERT_PASSWORD`, so:

- set **both** `UPDATER_CERT` and `UPDATER_CERT_PASSWORD`;
- a passwordless PFX still works (an empty password secret is handled);
- the import step publishes the certificate's thumbprint and the build pins it, so the job
  fails loudly rather than signing with an unrelated certificate on the runner. If the
  certificate does not import, expect `refusing to sign blindly` rather than a silent
  unsigned or mis-signed installer.

### Android (`android.yml` — ✅ LIVE; these secrets are optional, not required)

| Secret | Required | Format |
|---|---|---|
| `ANDROID_KEYSTORE_BASE64` | ✅ | base64-encoded `.keystore` file |
| `KEYSTORE_PASSWORD` | ✅ | keystore master password |
| `KEY_PASSWORD` | ✅ (falls back to `KEYSTORE_PASSWORD`) | key password |
| `KEY_ALIAS` | ✅ | key alias in the keystore |

The workflow decodes the keystore into `apps/mobile-tauri/gen/android/` and
writes `keystore.properties` (password / keyAlias / storeFile) from
`KEYSTORE_PASSWORD` / `KEY_ALIAS` — the official Tauri v2 signing route
consumed by the tracked `build.gradle.kts` `signingConfigs` block (the CLI
has no keystore flags). Without the keystore the APK/AAB build is not
signed.

### iOS (`ios.yml` — ⚠️ retired; nothing runs. Design to restore, not current state)

| Secret | Required | Format |
|---|---|---|
| `APPLE_TEAM_ID` | ✅ | Apple Developer team ID |
| `APPLE_BUNDLE_ID` | ✅ | bundle id, e.g. `mu.kasir.tablet` |
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

> ### ✅ Read this before following the steps below
>
> **Pushing a `v*` tag now runs TWO workflows: `release.yml` and `android.yml`.**
> `release.yml` is live again as a desktop-only pipeline (`release-validate` →
> `release-build` → `release-publish`) and `android.yml` was **restored on
> 2026-09-22** — it compiles the Android APK on a `v*` tag or
> `workflow_dispatch` and uploads it as the workflow artifact
> `kasirmu-tablet-aarch64`, not as a release asset.
>
> **This block previously said the opposite**, and the correction matters in
> both directions. It read "pushing a tag currently triggers no pipeline" and
> named `release.yml.bak` as the retired copy — but `release.yml.bak` no longer
> exists at all, and no `.bak` has sat beside a live workflow since the
> `attic/` consolidation. The stale framing was dangerous the way §0 says: an
> operator who believed it would not wait for the desktop artifacts a tag really
> does produce, and would not run §5's post-publish verification.
>
> `scripts/release.sh` still does **not** build anything: it runs checks, writes
> the changelog and creates a **local annotated tag** (its own step 7 says the
> tag is not pushed). So after step 4 the workflow runs, but the artifacts come
> from `release.yml`, not from the script.
>
> Earlier revisions said step 4 "triggers the whole pipeline" (true before
> `23c96330`), then that it triggers nothing (true for a few hours). The current
> state is: it triggers the desktop pipeline plus the Android APK build, and iOS
> still needs a manual build.

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
   bash scripts/release.sh "$V"             # writes docs/records/releases/CHANGELOG-$V.md, refreshes heading, runs the version gate, creates the local tag
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
   node "$VERIFY" latest.json linux-x86_64   kasir.mu_*.AppImage
   node "$VERIFY" latest.json windows-x86_64 kasir.mu_*.exe
   node "$VERIFY" latest.json darwin-aarch64 kasir.mu_*.dmg
   ```
   Confirm the full asset set: `latest.json`, `beta.json`, `SHA256SUMS.txt`,
   AppImage/deb, exe/msi, dmg. **`android.yml` does run on a `v*` tag** and uploads its APK
   as a WORKFLOW ARTIFACT (not to the GitHub Release); `ios.yml` is retired, so an
   IPA appears here only if you build it by hand and
   attach them with `gh release upload --clobber`.
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
- [ ] Mobile APK/AAB + IPA attached to the same release — **no CI check will ever
      show green here**: `ios.yml` is retired and `android.yml` uploads an artifact rather
      than a release asset. Verify by build
      provenance, not by workflow run.
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
| UAC elevation prompt | Missing/ignored `requestedExecutionLevel` manifest → Windows installer-detection heuristics | Embed a manifest with `<requestedExecutionLevel level="asInvoker"/>` | ✅ **None** — shipped Tauri apps (numeric-24 via `tauri-winres`), `oz-cloud-server.exe` (embed-resource build.rs), the `kasir` CLI (`crates/kasirmu-cli`, same pattern), and the license-server Windows build (Go `.syso` via go-winres) all carry a loadable `asInvoker` manifest. |
| SmartScreen / "Publisher: Unknown" | Unsigned Authenticode | Sign with a **publicly-trusted** certificate | ⚠️ **None only when** `UPDATER_CERT` **or** SignPath is configured |

### The free routes (no paid CA)

1. **Self-signed cert — `scripts/dev-code-sign.ps1` (dev/CI only).**
   Generates a `CN=kasir.mu Development` code-signing cert in the **CurrentUser**
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

> last audited 11-10-26 by docs-auditor
