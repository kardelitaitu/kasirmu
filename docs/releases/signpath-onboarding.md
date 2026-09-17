# SignPath Onboarding — Free Windows Code Signing

<!-- Audit stamp: 2026-08-31 · docs-auditor · status: ACCURATE (0 findings) · verified against HEAD: LICENSE §2 "NO OPEN SOURCE OR PUBLIC LICENSE" confirms the proprietary-license qualification caveat (doc correctly states the repo does NOT currently qualify for free OSS signing); SignPath action pinned @v2 (release.yml:296); upload-artifact @v4 (SHA-pinned :280/308/319); step names "Upload unsigned installers (SignPath candidate)" (:277) + "Upload signed installers" (:306) match; release-build permissions {contents:read, actions:read} confirmed (:76); workflow does NOT pass artifact-configuration-slug (project default used, as stated); SignPath step continue-on-error:true + gated on SIGNPATH_API_TOKEN != '' confirmed. Portal steps §2-§6 are external-service procedure -->

> **Goal:** make the `release.yml` workflow actually sign the NSIS/MSI
> installers with a **publicly-trusted** certificate, so end users see a real
> publisher and **no SmartScreen "unknown publisher" warning** — at zero cost
> for a qualifying open-source project.
>
> The workflow is already wired for this: it uploads the Windows installers
> unsigned, submits them to SignPath via
> `signpath/github-action-submit-signing-request@v2`, and uploads the signed
> result. Every step is a **no-op until** `SIGNPATH_API_TOKEN` (secret) plus
> the three `SIGNPATH_*` variables are configured. This guide covers that
> one-time configuration end to end.
>
> **Time:** ~1–2 h of portal/application work, mostly waiting on the
> foundation's approval.
> **References:** [signpath.org](https://signpath.org/) ·
> [docs.signpath.io](https://docs.signpath.io/) ·
> [GitHub integration docs](https://docs.signpath.io/trusted-build-systems/github) ·
> [submit-signing-request action](https://github.com/signpath/github-action-submit-signing-request)

---

## 0. What SignPath signs and how (the mechanics)

`actions/upload-artifact@v4` uploads the NSIS `.exe` + MSI `.msi` as a
**ZIP archive**. The action then submits a signing request referencing that
artifact's ID; SignPath unwraps the ZIP, signs each matching element with a
**cloud-HSM** certificate, and the action downloads the signed files. This
drives two hard requirements:

1. The SignPath **Artifact Configuration** root element must be
   `<zip-file>` (the `upload-artifact` ZIP wrapper — SignPath docs note this
   explicitly).
2. The request must carry the exact `organization-id`, `project-slug`, and
   `signing-policy-slug` the portal assigned, plus a submitter API token.

The workflow's Windows job (`.github/workflows/release.yml`, steps in the
`desktop-windows` matrix row) does the upload → sign → re-upload dance with
`continue-on-error: true`, so a SignPath outage degrades to the unsigned
fallback rather than failing the release.

---

## 1. Apply for free open-source signing

> ⚠️ **License qualification — read before applying.** The SignPath
> Foundation free program is for **open-source** projects only. This
> repository's `LICENSE` is explicitly **proprietary** (see LICENSE §2
> "NO OPEN SOURCE OR PUBLIC LICENSE" — not MIT/Apache/GPL/AGPL), so
> **it does not currently qualify** for the free route. Options:
> - **Relicense the project OSS** (e.g. MIT/Apache-2.0) to qualify — then
>   follow the steps below as-is.
> - **Keep the proprietary license** and use the paid `UPDATER_CERT`
>   (OV/EV Authenticode) route documented in the first-release runbook
>   §6 instead — same end-user result (real publisher, no SmartScreen),
>   at certificate cost.
> - Ship unsigned (default) until one of the above is chosen.
> The mechanics below stay valid verbatim if/when the project relicenses.

1. Open <https://signpath.org/> and click **Apply for Free Code Signing**
   (or follow the same link from docs.signpath.io).
2. Provide the project details the form asks for:
   - **Repository URL** — this repo (`https://github.com/<owner>/oz-pos`).
   - **Download page URL** — where users download the installer.
   - **Project description.**
3. While the application is processed, make sure the project qualifies
   (the foundation verifies these before approving):
   - **OSI-approved open-source license**, no commercial dual-licensing.
   - **Clean of malware / potentially-unwanted programs** (no malware,
     PUP, or hacking tools).
   - **No proprietary components** (standard system libraries per GPLv3
     are fine).
   - **Actively maintained and already released** in the form to be
     signed — the binaries you sign must be built transparently from the
     public repo.
   - **Documented download page**, including a line that says
     *"Free code signing provided by SignPath.io, certificate by SignPath
     Foundation"*, plus a privacy-policy link.
   - **MFA enabled** for team members on both SignPath and the version
     control host (GitHub).
4. Wait for approval (typically days). You'll be notified by email and the
   organization becomes available in the SignPath portal.

---

## 2. Create the organization

1. Sign in at **app.signpath.io** (create an account first if needed).
2. On the organization screen, create the **organization** for the project:
   - Name it after the project/org (e.g. `kasir.mu`).
   - The portal assigns an **organization ID** (a UUID). Note it — this is
     the value of `SIGNPATH_ORGANIZATION_ID` later.

## 3. Create the project

1. In the organization, go to **Projects → Create Project**.
2. Fill in:
   - **Name** — e.g. `kasir.mu Desktop`.
   - **Slug** — a short URL-safe identifier (e.g. `oz-pos`). Note it — this
     is the value of `SIGNPATH_PROJECT_SLUG`.
   - **Repository URL** — the GitHub repo.
3. Assign project roles:
   - **Readers / Configurators** — humans who maintain the config.
   - **Submitters** — the GitHub Actions submitter (the API token user
     must hold submitter rights on the project/signing policy).
4. Save the project.

## 4. Configure the Artifact Configuration (zip-file root)

The ZIP requirement from §0 means the artifact configuration must have a
`<zip-file>` root that declares the installers inside:

1. Open the project → **Artifact Configurations → Add Artifact
   Configuration**.
2. Name it (e.g. `windows-installers-zip`) and note the **slug**.
3. Use the XML editor with content like:

   ```xml
   <artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
     <zip-file>
       <pe-file path="*.exe" max-matches="unbounded">
         <authenticode-sign/>
       </pe-file>
       <msi-file path="*.msi" max-matches="unbounded">
         <authenticode-sign/>
       </msi-file>
     </zip-file>
   </artifact-configuration>
   ```

   Two gotchas from the SignPath schema:
   - The root **must** be `<zip-file>` because `upload-artifact` wraps the
     files in a ZIP before SignPath sees them.
   - `.msi` files are **OLE compound documents, not PE files** — they need
     the `<msi-file>` element, not `<pe-file>`.
   - Wildcard `path` defaults to **exactly one** match; add
     `max-matches="unbounded"` (as above) so multiple installers in the
     ZIP are all signed. Adjust `path` if your artifact layout differs.
4. Save. If you want this to be the project default, set it as the
   **default artifact configuration** — the workflow does not pass an
   `artifact-configuration-slug`, so the project's default is used.

## 5. Create the signing policy

1. Open the project → **Signing Policies → Add Signing Policy**.
2. Fill in:
   - **Slug** — e.g. `release-signing`. Note it — this is the value of
     `SIGNPATH_SIGNING_POLICY_SLUG`.
   - **Certificate** — select the SignPath Foundation OSS certificate.
   - **Approval process** — for automated CI signing, set the policy so a
     build that satisfies the trusted-build-system checks signs **without
     manual approval** (otherwise every release waits on a human click).
   - **Submitters** — the user/group that holds the API token.
3. Enable **Trusted Build System verification** and select the GitHub
   trusted build system (see §6), restricting signing to the release
   workflow / allowed branches (e.g. tags `v*`).
4. Save the policy.

## 6. Install the GitHub App and link the trusted build system

Origin verification requires SignPath to see the build came from a real
GitHub workflow:

1. **Install the SignPath GitHub App** on the repo/organization and grant
   access to the code repository (Approve the "Install SignPath" flow on
   GitHub).
2. In the SignPath portal, add the predefined trusted build system
   **GitHub.com** to the organization and **link it to the project**.
3. Confirm the project's signing policy (from §5) references this trusted
   build system.

> The workflow already sets `permissions: { contents: read, actions: read }`
> on `release-build`, which the action needs to read the job and download
> the unsigned artifact.

---

## 7. Set the GitHub secrets and variables

In **GitHub repo → Settings → Secrets and variables → Actions**:

| Name | Kind | Value |
|---|---|---|
| `SIGNPATH_API_TOKEN` | **Secret** | API token for a user with **submitter** rights on the project/signing policy |
| `SIGNPATH_ORGANIZATION_ID` | Variable | organization ID from §2 |
| `SIGNPATH_PROJECT_SLUG` | Variable | project slug from §3 |
| `SIGNPATH_SIGNING_POLICY_SLUG` | Variable | signing policy slug from §5 |

To mint the token: in app.signpath.io, go to your user/profile →
**API tokens → Create**, scope it to the organization and give it
**submitter** access on the project/signing policy. Keep it in the
GitHub secret store — never commit it.

These names **must match exactly** — `release.yml` reads
`secrets.SIGNPATH_API_TOKEN` and the three `vars.SIGNPATH_*` names. The
SignPath step is gated on the job-level env `SIGNPATH_API_TOKEN != ''`, so
the workflow only starts signing once the token exists.

---

## 8. Verify it works (dry-run on a draft release)

The release workflow is tag-triggered, so the first verification is a real
(draft) tag push — exactly what the first-release runbook does:

1. Push a `v*` tag (or use the runbook's draft-hold flow so nothing is
   published to users yet).
2. In the `release-build` job, watch the Windows row:
   - **"Upload unsigned installers (SignPath candidate)"** must succeed.
   - **"Sign installers with SignPath (free public trust)"** must show
     `success` (not `skipped`) — `skipped` means the token isn't set or
     the job env didn't pick it up.
   - **"Upload signed installers"** must run (the unsigned fallback must
     NOT run).
3. In the **SignPath portal**, the signing request appears with a
   `signing-request-web-url`; you can inspect the signed artifact and the
   certificate chain used.
4. Download the signed `.exe` from the draft release and confirm the
   signature on a Windows machine:

   ```powershell
   Get-AuthenticodeSignature .\oz-pos-app-setup.exe | Format-List
   ```

   The **SignerCertificate** issuer should be the SignPath Foundation /
   publicly-trusted chain, and **Status** should be `Valid` — and the
   installer should install with **no SmartScreen "unknown publisher"**
   warning.

---

## 9. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| SignPath step shows `skipped` | `SIGNPATH_API_TOKEN` secret not set, or not visible in the job env; re-check §7. |
| Step fails with `404` / `not found` | Wrong `organization-id`, `project-slug`, or `signing-policy-slug`; re-check the portal values. |
| Step fails with `403` / `forbidden` | API token lacks **submitter** rights, or the GitHub App is not installed/linked (§5–§6). |
| "No files matched" / nothing signed | Artifact Configuration root isn't `<zip-file>`, or `path` glob doesn't match the `.exe`/`.msi` names (§4). MSI needs the `<msi-file>` element (it isn't a PE file), and wildcards need `max-matches="unbounded"` to sign more than one file. |
| Signing approved manually every time | Set the signing policy to auto-sign builds that pass trusted-build-system checks (§5). |
| Job succeeded but installers unsigned | `continue-on-error: true` degraded to the unsigned fallback; check the step log + portal for the actual error. |

## 10. Teardown / revocation

- **Stop signing:** delete the `SIGNPATH_API_TOKEN` secret (the step becomes
  a no-op) or revoke the token in app.signpath.io.
- **Rotate the token:** mint a new API token and update the secret; no
  workflow change needed.
- **Cancel the OSS subscription:** contact the SignPath Foundation; the
  certificate is revoked on their side.

> last audited 31-08-26 by docs-auditor
