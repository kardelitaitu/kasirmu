# CI Pipeline Dashboard — kasir.mu

<!-- Audit stamp: 2026-08-03 · AUDIT-27 remediation · status: REWRITTEN — matrix and gate policy reconciled with current workflows (ci.yml, e2e-pr.yml, nightly.yml, release.yml, security.yml, docs.yml) and local runners (check.sh, check-ui.mjs). Updated 2026-08-16: website.yml added to workflow inventory. Updated 2026-08-17: website.yml check job catalog (docs portal build + internal-link audit). Updated 2026-08-17: docs.yml REMOVED - the GitHub Pages deploy is retired; the docs portal now ships exclusively via website.yml -> Cloudflare. Updated 2026-08-17: deploy.yml added (Northflank auto-deploy of the unified image on main push). -->

> Last updated: 2026-08-17

## Workflow inventory

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | PR + push to `main` | Required PR/push gate: Rust fmt/clippy/panic-inventory/tests, architecture-boundaries, UI lint/typecheck/tests, Lighthouse, Docker build+scan+smoke, coverage (advisory), dependency audit, fuzz (advisory), skill drift, flaky-quarantine registry, CI-docs-drift, PR security baseline, E2E (3-shard) |
| `e2e-pr.yml` | PR (`ui/e2e/**` + E2E infra only) | Fast, changed-spec E2E complement — main CI already runs full E2E on every PR. `run-e2e.mjs` exits 2 (`SKIPPED-NO-SPEC`) when no spec changed; the workflow treats it as a neutral skip with a notice, never a false pass |
| `nightly.yml` | Daily 03:00 UTC + manual | Full matrix: cross-platform Rust tests, docs, UI shards, E2E shards, release builds, benchmarks, flaky detection |
| `release.yml` | Tag push `v*` | Build + blocking Trivy scan + publish all artifacts |
| `security.yml` | Weekly Monday + manual | Full-tree cargo audit, cargo deny, Trivy scans |
| `website.yml` | PR (website paths) + push to `main` (website paths) | Marketing site (Astro, `website/`): `check` job runs astro check + i18n audit, **builds the full docs portal** (mdBook hub + cargo doc + TypeDoc via `scripts/build-docs.sh`, hard-fail), `npm run build`, then the **internal-link audit** (`check:links`, failing gate) + a portal-staged smoke — on every PR/push. `deploy` job runs on main only and `wrangler deploy`s to Cloudflare Workers static assets (its portal build is soft-fail; the hub degrades to the Get Started card on failure). Fail-closed: a missing `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` secret fails the deploy job loudly instead of silently skipping. See [Job Matrix (website.yml)](#job-matrix-websiteyml) |
| `deploy.yml` | Push to `main` (unified-image paths) + manual dispatch | Backend auto-deploy: triggers the Northflank `oz-cloud` service to build `Dockerfile.unified` at the exact pushed commit via the API, polls to build conclusion (success => the service rolls the image), then smoke-tests the public health endpoints. Fail-closed: a missing `NORTHFLANK_API_TOKEN` / project / service IDs fails the job loudly. See [Job Matrix (deploy.yml)](#job-matrix-deployyml) |
| `android.yml` / `ios.yml` | Push to `main` | Mobile build pipelines |

## Job Matrix (ci.yml)

| Job | Trigger | Runtime | Cache | Shards | Blocks |
|-----|---------|---------|-------|--------|--------|
| `rust-fmt` | PR + push | ~30s | none | — | ✅ Required |
| `rust-panic-inventory` | PR + push | ~10s | none | — | ✅ Required |
| `rust-money-format` | PR + push | ~5s | none | — | ✅ Required (no hardcoded `/100` or `{}.{:02}` money formatting) |
| `architecture-boundaries` | PR + push | ~5s | none | — | ✅ Required (new boundary violations only; existing debt is expiring-baselined) |
| `rust-clippy` | PR + push | ~3min | rust-cache + sccache | — | ✅ Required |
| `rust-test-fast` | PR only | ~2min each | rust-cache + sccache | 5-way | ✅ Required |
| `rust-test-apps` | PR + push | ~3min | rust-cache + sccache | — | ✅ Required (AUDIT-27 CI-01) |
| `sync-slow-tests` | Push + PR (sync paths) | ~3min | rust-cache + sccache | — | ✅ Required |
| `rust-test-full` | Push only | ~5min | rust-cache + sccache | 2 OS | ✅ Required |
| `ui-lint` | PR + push | ~40s | npm cache | — | ✅ Required |
| `ui-typecheck` | PR + push | ~30s | npm cache | — | ✅ Required |
| `ui-test` | PR + push | ~2min each | npm + vitest cache (per-shard key) | 4-way | ✅ Required |
| `lighthouse` | PR + push | ~2min | npm cache | — | ⚠️ Advisory (≥ 90) |
| `docker` | PR + push | ~3min | Docker layer cache | — | ✅ Required (build + blocking Trivy + smoke) |
| `coverage` | PR + push | ~5min | rust-cache | — | ⚠️ Advisory |
| `audit` | PR + push | ~30s | — | — | ⚠️ Advisory on PR, ✅ Required on push (AUDIT-27 CI-03) |
| `security-pr` | PR only | ~40s | — | — | ✅ Required when manifests changed — fail-closed if base SHA can't be resolved (AUDIT-27 CI-10) |
| `fuzz` | Push + PR (fuzz paths) | ~30min cold / ~8min cached | rust-cache (no sccache) | — | ⚠️ Advisory (crash artifacts uploaded) |
| `skill-drift-tests` | PR + push | ~20s | — | — | ✅ Required |
| `unified-healthcheck` | PR + push | ~5s | none | — | ✅ Required (unified image healthcheck SMTP gate, fake-wget harness) |
| `flaky-quarantine` | PR + push | ~10s | — | — | ✅ Required (AUDIT-27 CI-09) |
| `windows-config` | PR + push | ~10s | — | — | ✅ Required (AUDIT-28 — NSIS installMode + asInvoker manifests) |
| `ci-docs-drift` | PR + push | ~10s | — | — | ✅ Required (AUDIT-27 CI-08 — verifies this table stays true) |
| `e2e-docker-image` | Push only | ~4min | Docker GHCR | — | Push path |
| `e2e` | PR + push | ~6min each | npm + rust-cache + Docker GHCR | 3-way | ✅ Required |

## Job Matrix (website.yml)

`check` is the PR/push gate for the marketing site. Because the docs portal
ships inside the website bundle, the check builds the portal too — that is what
makes the 4-card docs hub render in CI (the `portalExists` gate is fs-based at
build time) and lets the internal-link audit validate the full portal tree, not
just the site's own pages. `deploy` (main only) mirrors the same portal steps but
**soft-fails** them (`continue-on-error`) so a docs hiccup can never block the
marketing deploy; when it fails, `docs/book` stays absent, staging is skipped,
and the hub degrades to the single Get Started card (no dead links, site still
ships). Keep the two jobs' portal steps in sync — they are intentionally
copy-pasted with only the fail mode differing.

| Step | What it runs | Fails |
|------|--------------|-------|
| Install deps | `npm ci` + Playwright chromium (build-time Mermaid only) | hard |
| `npm run check` | astro check + i18n audit (`audit-i18n.mjs`) + password-policy drift guard (`check-password-policy.mjs`) | hard |
| Rust toolchain + cache | `dtolnay/rust-toolchain@stable` + `rust-cache` (save on main only) + `sccache` — needed for `cargo doc` in the portal build | hard |
| System deps | gtk3 / libwebkit2gtk / libudev (`platform-startup` → tauri, `oz-hal` → serialport must compile even for `--no-deps` docs) | hard |
| mdBook + `bash scripts/build-docs.sh` | Full portal: cargo doc → TypeDoc → mdBook hub. **Hard-fail** in `check` (a portal build hiccup on a PR must surface before merge) | hard |
| `npm run build` | Astro build; `import-portal.sh` stages `docs/book` → `dist/docs-portal`, flipping the hub's `portalExists` gate to 4 cards | hard |
| `npm run check:links` | **Internal-link audit** (`scripts/check-links.mjs`): every href on a built page must resolve to a file in `dist/`. Tool-generated targets are skipped via documented rules — rustdoc JS template strings (`${…}`), rustdoc unresolved intra-doc identifier links (scoped to `/docs-portal/api/rust/`), mdBook/TypeDoc `assets/` refs, Windows `\` normalization; the portal subtree is skipped entirely when unstaged. Exit 1 on any broken link | hard |
| Portal staged smoke | Asserts `dist/docs-portal/intro.html` + `api/rust/index.html` + `api/ts/index.html` shipped, so a silent staging failure can't pass the job | hard |

> Path filter note: the `check` job's PR `paths` filter is `website/**` only, so a
> **docs-only** PR (no `website/` changes) runs no portal build or link audit at
> all - `docs.yml`'s cargo-doc compile was removed along with the GitHub Pages
> deploy. Cargo-doc compilation is still covered by nightly.yml's `docs` job, and
> every PR compiles the whole workspace via `rust-test-apps`/`rust-test-fast`.

## Job Matrix (deploy.yml)

`deploy` is the backend ship path: on push to `main` (filtered to the
unified-image inputs — `Dockerfile.unified`, `Cargo.toml`/`Cargo.lock`,
`rust-toolchain.toml`, `crates/**`, `foundation/**`, `platform/**`,
`modules/**`, `apps/**`) it asks Northflank to build `Dockerfile.unified` at
the exact commit via the API, polls until the build concludes (a combined
service auto-deploys after a successful build), then smoke-tests
`$NORTHFLANK_SERVICE_URL/health` + `/api/health`. Not a merge gate — it runs
only on `main`, so it is not in `gates.json`; its job appears here for the
workflow-inventory audit.

| Step | What it runs | Fails |
|------|--------------|-------|
| Fail-closed credential gate | missing `NORTHFLANK_API_TOKEN` secret or project/service IDs -> `::error::` + exit 1 (website.yml convention) | hard |
| Trigger build | `POST /v1/projects/{id}/services/{id}/build` with `{"sha": <full commit sha>}`. A 409 (native git trigger already building this commit) is **adopted**, not failed: the active build for the same sha is polled instead | hard (non-409 rejection, or 409 with no matching active build) |
| Poll to conclusion | `GET …/build/{buildId}` until `concluded`; `success:false` (FAILURE/CRASHED/ABORTED) fails the job — the deployment was NOT shipped | hard |
| Smoke test | `$NORTHFLANK_SERVICE_URL/health` + `/api/health` must return 200 within 10 min (retries); prints the gate-status payload. Skipped when the URL var is unset. 503s = fail-fast env gates not yet applied (§8 env table), not a workflow bug | hard |

## Gate manifest — single source of truth (AUDIT-27 CI-08)

All gate **names** and **status** live in `scripts/gates.json`. It is the one place a gate is added, renamed, or re-leveled:

- **Shared gates** (declared by BOTH `check.sh` and `check:all`): UI lint, UI typecheck, UI unit tests, i18n lint, FTL dedupe.
- **check.sh-only** (repo gate): Rust fmt/clippy/tests, architecture-boundaries, migration, skill-drift, panic-inventory, hardcoded-money-format, a11y (advisory), feature registry, plugin-guide parity, windows config drift (NSIS installMode + asInvoker), CI docs drift.
- **check:all-only** (UI gate): bundle budget, E2E, perf smoke.
- **CI-only / nightly** gates carry the enforcing `workflow` + `job` and a `status` of `required` | `advisory` | `required-on-push`.

`scripts/verify-ci-docs-drift.py` (wired into `ci.yml`, `nightly.yml`, and `check.sh`) derives everything from this manifest and **fails closed** when:

1. a job referenced in the tables below no longer exists in `.github/workflows/*.yml`, or a documented workflow file is missing;
2. a manifest gate is not declared by the runners it lists (`check.sh` / `check:all`);
3. a gate's enforcing job contradicts its status — `required` jobs must NOT set `continue-on-error: true`; `advisory` jobs must (at job or step level); `required-on-push` jobs must gate it on a `${{ ... }}` condition (e.g. the `audit` gate).

`check-ui.mjs` self-audits against the same manifest and fails `check:all` if a manifest `check:all` gate is not declared.

## Required vs advisory policy (AUDIT-27 CI-03)

Checks are split into **required** (block merges) and **advisory** (informational, must not be confused with pass):

- **Required:** format, clippy, panic-inventory, hardcoded-money-format, all Rust tests (incl. app crates), UI lint/typecheck/tests, Docker build + blocking Trivy scan, E2E, skill drift, flaky-quarantine registry.
- **Advisory on PR, required on push:** dependency audit (`cargo audit`, `npm audit --audit-level=high`) — findings recorded on PR, blocking on `main` pushes.
- **Reviewed baseline:** `.cargo/audit.toml` documents the single accepted advisory (RUSTSEC-2023-0071, `rsa` medium, no fix available — private key used only for operator-side signing; re-audit on release). Every ignore entry there carries owner/review-date/justification. Adding entries requires review.
- **Advisory:** Lighthouse a11y, coverage, fuzz (crash artifacts uploaded), UI A11y regression suite (`continue-on-error`).

## Caching Strategy

### Rust (cargo)
- **rust-cache** (`Swatinem/rust-cache@v2`): Caches `target/` keyed by `Cargo.lock`. `save-always: true` persists cache even on job failure.
- **sccache** (`mozilla/sccache-action@v0.0.10`): Compiler cache shared across jobs.
- **Exception — the `fuzz` job sets `RUSTC_WRAPPER: ''`** (job env): the ubuntu runner image globally wraps `rustc` with sccache, and that wrapper breaks `cargo-fuzz`'s `--target` build — its rustc version probe execs the resolved toolchain path directly and dies with `could not execute process sccache .../bin/rustc -vV (No such file or directory)`. The fuzz job is the only one affected (nightly + `--target`), so sccache is deliberately disabled there and must not be re-added; its caching comes from `rust-cache@v2` with `workspaces: fuzz` (cargo-fuzz builds everything, including path deps, into `fuzz/target/`, which default workspace discovery misses).

### Node.js (npm)
- **npm cache** (`actions/setup-node@v4` with `cache: 'npm'`): Caches `~/.npm` keyed by `package-lock.json`.
- **vitest cache** (`actions/cache@v4`): Persists `node_modules/.cache/vitest`. **Per-shard save key** (`vitest-cache-${{ runner.os }}-${{ matrix.shard }}-...`) so concurrent shard writes don't contend (AUDIT-27 CI-05).

### Docker
- **BuildKit inline cache** (`type=gha` backend).
- **GHCR pre-built images** (`e2e-docker-image` job) on push to main; E2E jobs pull before building.

### E2E
- Playwright browsers via `npx playwright install chromium --with-deps` (desktop-only project runs in ci.yml + nightly).
- The PR E2E workflow (`e2e-pr.yml`) runs the FULL project matrix (desktop + tablet) via `npm run e2e`, split into 2 project shards (`--project=desktop` / `--project=tablet`) that run in parallel — so it installs `chromium webkit --with-deps` (the `tablet` project is iPad Pro 11 emulation, a WebKit engine).
- Docker layer cache pulled from GHCR before local build.

## Pre-Merge Validation Gates

Enforced via GitHub branch protection (`Settings → Branches → main → Require status checks`). The CI config alone does not auto-enforce these.

| Gate | Job | Blocks Merge |
|------|-----|-------------|
| Format | `rust-fmt` | ✅ Required |
| Panic policy | `rust-panic-inventory` | ✅ Required |
| Money format (no hardcoded `/100` or `{}.{:02}`) | `rust-money-format` | ✅ Required |
| Lint (Rust) | `rust-clippy` | ✅ Required |
| Lint (UI) | `ui-lint` | ✅ Required |
| TypeCheck | `ui-typecheck` | ✅ Required |
| Unit Tests (Rust) | `rust-test-fast` (5 shards) + `rust-test-apps` | ✅ Required |
| Unit Tests (UI) | `ui-test` (4 shards) | ✅ Required |
| E2E Tests | `e2e` (3 shards) | ✅ Required |
| Docker Build + Scan | `docker` (blocking Trivy CRITICAL/HIGH) | ✅ Required |
| Security (manifests changed) | `security-pr` | ✅ Required |
| Flaky quarantine registry | `flaky-quarantine` | ✅ Required |
| Windows config drift | `windows-config` | ✅ Required |
| Skill Drift | `skill-drift-tests` | ✅ Required |
| Unified healthcheck script | `unified-healthcheck` | ✅ Required |
| CI docs drift | `ci-docs-drift` | ✅ Required |
| Dependency audit | `audit` | ⚠️ Advisory on PR / ✅ on push |
| Lighthouse a11y | `lighthouse` | ⚠️ Advisory (≥ 90) |
| Coverage | `coverage` | ⚠️ Advisory |
| Fuzz | `fuzz` | ⚠️ Advisory |

## Local validation (AUDIT-27 CI-06)

The canonical local entry points and what each covers:

| Command | Covers | Skips |
|---------|--------|-------|
| `bash scripts/check.sh` (root) | Rust fmt/clippy/tests, architecture-boundaries, migration, skill-drift, panic-inventory, hardcoded-money-format, UI lint/typecheck/tests, i18n lint, **FTL dedupe**, a11y (advisory), feature registry, plugin-guide parity, windows config drift (NSIS installMode + asInvoker), optional `--docker-dry-run` build | Production UI build, E2E (backend not provisioned) |
| `cd ui && npm run check:all` | UI lint/typecheck/tests, i18n lint, FTL dedupe, bundle budget, E2E (**provisioned** via `npm run e2e` when Docker is up), perf smoke | Rust gates |
| `cd ui && npm run e2e` | Full managed E2E (Docker backend + Vite + Playwright + cleanup) | — |

`check.sh` is the **repository** gate; `check:all` is the **UI-only** gate. Both now share the same gate vocabulary for the gates they have in common, and both record skipped/advisory gates with reasons.

## Flaky-test lifecycle (AUDIT-27 CI-09)

- `scripts/report-flaky.sh` runs the suite N times and lists tests failing intermittently.
- Quarantines live in `scripts/flaky-quarantine.json` — each entry needs `owner`, `issue`, `reason`, `date`, `expiry`.
- `scripts/verify-flaky-quarantine.py` (wired into `flaky-quarantine` CI job and nightly) **fails** on expired, ownerless, or issueless entries.
- `nightly.yml` runs the detector (`flaky-detect`, 2 workspace runs, informational) and a separate fail-closed `flaky-quarantine-registry` verifier, so a detector timeout can never skip the registry gate.

## Failure Modes & Remediation

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `rust-clippy` fails | New warning introduced | Run `cargo clippy --workspace --all-targets -- -D warnings` locally |
| `rust-money-format` fails | Hardcoded `/100` or `{}.{:02}` money formatting in production `.rs` | Route through `foundation::format_minor()` / `Currency::minor_unit_exponent()` |
| `rust-test-apps` fails | Tauri app crate test/compile failure | The app crates ARE tested now (AUDIT-27 CI-01) — fix the crate; system deps are already installed on the runner |
| `ui-test` act() warning | Component effect fires async without `renderInAct` | Use `renderInAct` / `renderHookInAct` from `ui/src/test-utils/` |
| `e2e` timeout | Server didn't start in time | Check Docker health, Vite port conflict |
| `docker` fails | Binary > 50 MB, or Trivy CRITICAL/HIGH finding | Strip/slim the binary; fix or document the vuln in `.trivyignore` |
| `audit` fails on push | Dependency has known CVE | `cargo update` / pin patched version — this gate is **required on `main` pushes** |
| `fuzz` fails with `sccache .../bin/rustc -vV (No such file or directory)` | Runner-image sccache wrapper vs cargo-fuzz `--target` build | Keep `RUSTC_WRAPPER: ''` on the fuzz job env — sccache must stay disabled there (see Caching Strategy). If the job times out, check that `cargo fuzz build` runs before the `timeout 65` loop and that `rust-cache` has `workspaces: fuzz` |
| `flaky-quarantine` fails | An entry is expired / missing issue or owner | Re-investigate the flake, fix it, or renew with an updated issue |
| Cache miss (all jobs slow) | `Cargo.lock` or `package-lock.json` changed | Expected after dependency updates — first run is cold |

## SLO Targets

| Pipeline Phase | Target | Current |
|---------------|--------|---------|
| Total CI (PR, parallel) | < 8 min | ~6 min |
| Rust test (fast, 5 shards + apps) | < 3 min | ~2 min |
| UI test (4 shards) | < 2 min | ~1.5 min |
| E2E (3 shards) | < 8 min | ~6 min |
| Docker build | < 5 min | ~3 min |

> last audited 09-08-26 by buffy
> audit: Phase 1 Core Architecture & API Docs Audit

> status: ACCURATE (0 findings) · verified accurate: cargo check passed, no structural orphans, no stale version headers, all file references valid

