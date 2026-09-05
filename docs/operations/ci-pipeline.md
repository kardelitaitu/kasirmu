# CI Pipeline Documentation

> **Canonical CI dashboard** (AUDIT-27 CI-08). This document is the single source of truth for what jobs run in CI, what gates they map to, and which workflows exist. It is verified by `scripts/verify-ci-docs-drift.py` on every PR and local `check.sh` run.

---

## Job Matrix

> The heading text `Job Matrix` is a **literal contract** —
> `verify-ci-docs-drift.py` refuses to run without it, so do not rename it away.
> It used to read `Job Matrix (ci.yml)`, which became false the day `23c96330`
> retired that workflow: the suffix described a dead file while the live jobs
> below it went unlisted. **The Workflow column is what tells you where a row
> actually runs.**

> ✅ **What is live.** `dev-ci.yml` is the only workflow GitHub executes. Every
> one of its jobs now has a row here, and `verify-ci-docs-drift.py` enforces that
> — it compares the docs against every job in every live workflow and reports any
> it cannot find. That check used to compare only against a file named `ci.yml`,
> so once that file was retired it silently became "nothing is undocumented" and
> four live jobs (`website`, `cargo-nextest`, `northflank-deploy`,
> `static-gates`) went unlisted without a complaint.
>
> ⚠️ **What is history.** Rows whose Workflow column names `ci.yml`,
> `nightly.yml`, `website.yml` or any other retired file document what *used* to
> gate a merge. The checker recognises them as history and does not count them as
> drift — but only because the row names a workflow that genuinely exists only as
> `.bak`. Claiming a LIVE workflow you don't actually contain is still an error.
>
> Four rows were repointed in this release because CI coverage was added for
> them: `rust-fmt`, `rust-clippy`, `ui-lint` and `ui-typecheck` are **steps**
> inside live `dev-ci.yml` jobs rather than jobs of their own.

| Job ID | Blocks Merge | Workflow | Notes |
|--------|--------------|----------|-------|
| `cargo-check` | ✅ Required | dev-ci.yml | step `cargo fmt --all -- --check` (was job `rust-fmt`) |
| `go` | ✅ Required | ci.yml | `gofmt` + `go vet` + `go test -short` on license-server |
| `unified-healthcheck` | ✅ Required | ci.yml | POSIX sh healthcheck script test |
| `rust-panic-inventory` | ✅ Required | ci.yml | Scan production unwrap/expect |
| `changes` | ✅ Required | ci.yml | Path-based change detection for PR filtering |
| `rust-money-format` | ✅ Required | ci.yml | No hardcoded exp-2 money formatting |
| `architecture-boundaries` | ✅ Required | ci.yml | Static boundary enforcement |
| `cargo-check` | ✅ Required | dev-ci.yml | step `cargo clippy --all-targets --all-features -- -D warnings` (was job `rust-clippy`) |
| `rust-test-fast` | ✅ Required | ci.yml | Sharded crate-group tests (PR only) |
| `sync-slow-tests` | ⚠️ Advisory on PR, ✅ Required on push | ci.yml | Platform-sync integration suite (gated) |
| `rust-test-full` | Push path | ci.yml | Full workspace tests (push only, Ubuntu; full matrix in nightly) |
| `rust-test-apps` | ✅ Required | ci.yml | App crate unit tests |
| `ui-test` | ✅ Required | dev-ci.yml | step `npm run lint` (was job `ui-lint`) |
| `ui-test` | ✅ Required | dev-ci.yml | step `npm run typecheck` (was job `ui-typecheck`) |
| `ui-test` | ✅ Required | ci.yml | `npm run test` (4 shards) |
| `ci-docs-drift` | ✅ Required | dev-ci.yml | step `verify-ci-docs-drift.py` — blocking since R36-10 closed the count to 0 |
| `ci-docs-drift` | ✅ Required | dev-ci.yml | step `bash scripts/test-ci-routing.sh` — the router decides whether every other job runs, so this one blocks |
| `website` | ✅ Required | dev-ci.yml | `cd website && npm ci && npm run check && npm test && npm run build` |
| `cargo-nextest` | ✅ Required | dev-ci.yml | `cargo nextest run --workspace --all-features` — **no `--exclude`**, so this is broader than check.sh's equivalent, which drops `oz-pos-app` |
| `static-gates` | ✅ Required | dev-ci.yml | eight checks that previously had no CI runner at all: architecture boundaries, no-hardcoded-money-format, windows-config, skill-drift, unified-healthcheck, panic inventory, release workflow validation (+ `--self-test`), and Go fmt/vet/test. Each verified green locally before being wired in. |
| `release-readiness` | ✅ Required | dev-ci.yml | `node scripts/check-release-version.mjs --self-test` then `node scripts/check-updater-compat.mjs` — proves the updater signing chain emits signatures the real Tauri client verifier accepts. Path-gated on `changes.outputs.release`; the harness needs a cold cargo build. |
| `release-validate` | ✅ Required | release.yml | tag push only: `check-release-version.mjs <tag>` (tag ↔ version ↔ changelog), its `--self-test`, and the updater compat check. |
| `release-build` | ✅ Required | release.yml | matrix `desktop-linux` / `desktop-windows` / `desktop-macos`: nextest, `cargo tauri build`, bundle-existence gate, Windows asInvoker manifest check, optional SignPath/Authenticode with a loud unsigned fallback. |
| `release-publish` | ✅ Required | release.yml | signed `latest.json`+`beta.json`, signature verification against the committed pubkey, SHA-256 inventory, draft release, provenance attestation, then publish. Hard-fails without `UPDATER_PRIVATE_KEY`. |
| `northflank-deploy` | ✅ Required | dev-ci.yml | Backend deploy to Northflank; `needs` every other live job except `ci-docs-drift`. **Effectively `workflow_dispatch` only**: its `if:` also tests `github.event_name == 'push'`, but `dev-ci.yml` triggers on `pull_request` and `workflow_dispatch` alone, so that half is dead code and no push ever reaches it. The workflow's own comment records this. |
| `lighthouse` | ⚠️ Advisory | ci.yml | Lighthouse a11y audit (continue-on-error) |
| `docker` | ✅ Required | ci.yml | Build + Trivy scan + Compose smoke |
| `coverage` | ⚠️ Advisory | ci.yml | Coverage report (push only, continue-on-error) |
| `audit` | ⚠️ Advisory on PR, ✅ Required on push | ci.yml | `cargo audit` + `npm audit` |
| `security-pr` | ✅ Required | ci.yml | PR baseline security audit |
| `fuzz` | ⚠️ Advisory | ci.yml | Fuzz tests (gated on fuzz targets) |
| `flaky-quarantine` | ✅ Required | ci.yml | Flaky quarantine registry |
| `windows-config` | ✅ Required | ci.yml | NSIS installMode + asInvoker check |
| `skill-drift-tests` | ✅ Required | ci.yml | Skill drift guard bats tests |
| `e2e-docker-image` | Push path | ci.yml | GHCR push (main only) |
| `e2e` | ✅ Required | ci.yml | Playwright E2E (3 shards) |

---

## Pre-Merge Validation Gates

| Gate | Job | Status | Runners |
|------|-----|--------|---------|
| UI lint | `ui-test` (dev-ci.yml step) | Required | `check.sh` (ui lint), `check:all` (eslint) |
| UI typecheck | `ui-test` (dev-ci.yml step) | Required | `check.sh` (ui typecheck), `check:all` (type check) |
| UI unit tests | `ui-test` | Required | `check.sh` (ui test), `check:all` (unit tests) |
| i18n lint | `i18n` | Required | `check.sh` (i18n lint), `check:all` (i18n lint) |
| FTL dedupe | `i18n` | Required | `check.sh` (ftl dedupe), `check:all` (ftl dedupe) |
| Rust fmt | `cargo-check` (dev-ci.yml step) | Required | `check.sh` (cargo fmt) |
| Clippy | `cargo-check` (dev-ci.yml step) | Required | `check.sh` (clippy) |
| Rust tests | `rust-test-fast` | Required | `check.sh` (test workspace, test doctests) |
| Go (license-server) | `go` | Required | `check.sh` (go fmt, go vet, go test (short)) |
| Website unit tests | `check` (website.yml) | Required | `check.sh` (website test) |
| Architecture boundaries | `architecture-boundaries` | Required | `check.sh` (architecture boundaries) |
| No raw params (ADR #7 Phase 4) | — | Required | `check.sh` (no-raw-params) |
| No hardcoded money format | `rust-money-format` | Required | `check.sh` (hardcoded-money-format) |
| Docker build smoke | — | Required | `check.sh` (docker build) |
| Migration smoke | — | Required | `check.sh` (migration) |
| Skill drift guard | `static-gates` | Required | `check.sh` (skill-drift) |
| Panic inventory | `static-gates` | Required | `check.sh` (panic-inventory) |
| IPC invoke token parity | `static-gates` | Required | `check.sh` (ipc invoke token parity) |
| A11y regression | `ui-test` | Advisory | `check.sh` (a11y) |
| Feature registry parity | — | Required | `check.sh` (feature registry) |
| Plugin-guide parity | — | Required | `check.sh` (plugin-guide parity) |
| CI docs drift | `ci-docs-drift` | Required | `check.sh` (ci docs drift) |
| CI path router test | `ci-docs-drift` | Required | `check.sh` (ci routing test) |
| Windows config drift | `windows-config` | Required | `check.sh` (windows config) |
| Unified healthcheck | `unified-healthcheck` | Required | `check.sh` (healthcheck script test) |
| Bundle budget | — | Required | `check:all` (bundle budget) |
| E2E tests | `e2e` | Required | `check:all` (e2e) |
| Perf smoke | — | Required | `check:all` (perf smoke) |
| Rust test apps | `rust-test-apps` | Required | — |
| Rust test full | `rust-test-full` | Required | — |
| Sync slow tests | `sync-slow-tests` | Required | — |
| Docker build + scan | `docker` | Required | — |
| Security PR baseline | `security-pr` | Required | — |
| Lighthouse a11y | `lighthouse` | Advisory | — |
| Coverage | `coverage` | Advisory | — |
| Dependency audit | `audit` | Required on push | — |
| Fuzz | `fuzz` | Advisory | — |
| Flaky quarantine registry | `flaky-quarantine` | Required | — |
| E2E Docker image | `e2e-docker-image` | Required | — |
| Nightly rust test | `rust-test` (nightly.yml) | Required | — |
| Nightly rust doc | `rust-doc` (nightly.yml) | Required | — |
| Nightly UI tests | `ui-test` (nightly.yml) | Required | — |
| Nightly E2E | `e2e` (nightly.yml) | Required | — |
| Nightly flaky detection | `flaky-detect` (nightly.yml) | Advisory (step) | — |
| Nightly flaky registry | `flaky-quarantine-registry` (nightly.yml) | Required | — |
| Nightly benchmarks | `benchmarks` (nightly.yml) | Required | — |
| Nightly license-server full Go tests | `license-server-test` (nightly.yml) | Required | — |

---

## Workflow inventory

> **Status is the column that matters.** As of 2026-09-02, `23c96330` retired
> every workflow below to `.bak` and replaced them with a single streamlined dev
> CI. GitHub never executes a `.bak` file, so a row marked 🔴 contributes nothing
> to a merge decision regardless of what its Purpose column says. The Trigger and
> Purpose columns are retained as the historical record of what each workflow
> *used* to do — several are candidates for restoration. `release.yml` was
> restored desktop-only in 0.0.36 (R36-11); the rest remain retired.

| Workflow | Status | Trigger | Purpose |
|----------|--------|---------|---------|
| `dev-ci.yml` | 🟢 **LIVE** | PR to main, dispatch | Per-PR validation. Jobs: `changes`, `website`, `cargo-check`, `cargo-nextest`, `ui-test`, `i18n`, `ci-docs-drift`, `static-gates`, `release-readiness`, `northflank-deploy`. **No build or artifact step** — it validates the release toolchain but does not produce release assets; that is `release.yml`. |
| `release.yml` | 🟢 **LIVE** (restored, desktop-only) | tag push (v*) | Builds the three Tauri desktop installers, generates the signed `latest.json`/`beta.json` updater manifests, checksums, attests provenance, and publishes a GitHub Release. Restored in 0.0.36 after `23c96330` renamed it to `.bak` with no replacement. **Docker matrix targets were dropped** — backend images are built by Northflank via `dev-ci.yml#northflank-deploy`. Mobile remains retired (`android.yml`, `ios.yml`). |
| `ci.yml` | 🔴 retired `.bak` | push/PR to main | Primary CI pipeline (lint, test, build, scan) |
| `nightly.yml` | 🔴 retired `.bak` | schedule (daily) + dispatch | Nightly Rust/doc/UI/E2E + flaky detection |
| `security.yml` | 🔴 retired `.bak` | schedule (weekly) + dispatch | Cargo audit/deny + container scan |
| `android.yml` | 🔴 retired `.bak` | push/PR to main | Android build |
| `ios.yml` | 🔴 retired `.bak` | push/PR to main | iOS build |
| `e2e-pr.yml` | 🔴 retired `.bak` | PR to main | E2E on PRs |
| `deploy.yml` | 🔴 retired `.bak` | push to main | Website deploy |
| `docker-digest-drift.yml` | 🔴 retired `.bak` | schedule | Docker digest drift check |
| `docker-persistence.yml` | 🔴 retired `.bak` | schedule | Docker persistence check |
| `website.yml` | 🔴 retired `.bak` | push to main | Website build + deploy |

---

## Gate Vocabulary

The gate vocabulary is defined in `scripts/gates.json` and shared by:
- `.github/workflows/ci.yml` (CI jobs)
- `.github/workflows/nightly.yml` (nightly jobs)
- `scripts/check.sh` (local pre-push)
- `scripts/check-ui.mjs` (`npm run check:all`)
- `scripts/verify-ci-docs-drift.py` (this document)

Every gate has:
- **id** — stable identifier
- **label** — human-readable name
- **status** — `required` | `advisory` | `required-on-push` | `retired`
- **runners** — which local runners declare it (`check.sh`, `check:all`)
- **ci** — workflow + job mapping (for CI enforcement); **absent when nothing
  enforces the gate**, which is what makes `retired` expressible

### Status semantics

| Status | Meaning | Workflow enforcement |
|--------|---------|---------------------|
| `required` | Must pass on every PR and push | Job has NO `continue-on-error` |
| `advisory` | Reports status, never blocks merge | Job/step HAS `continue-on-error: true` |
| `required-on-push` | Advisory on PR, required on push | Job has conditional `continue-on-error: ${{ ... }}` |
| `retired` | **Enforces nothing today.** Recorded so the check is not silently forgotten. | No `ci` block at all — the checker REJECTS a `retired` gate that carries one |

`retired` was added when R36-10 closed. Before it, the vocabulary could express
"blocks", "reports" and "blocks on push" but not "does not run", so 16 gates whose
workflow had been retired to `.bak` had nowhere honest to go and stayed marked
`required` — pointing at a file GitHub never executes. Restoring any of them means
adding the job back and flipping the status; the `_note` on each entry records
where it went and what still covers it.

---

## Local runners

### `scripts/check.sh` (bash)

Comprehensive pre-push gate mirroring CI. Runs:
1. `cargo fmt`
2. `cargo clippy --workspace`
3. No raw params (ADR #7)
4. Architecture boundaries
5. No hardcoded money format
6. `cargo nextest run --workspace`
7. Migration smoke
8. Skill drift guard
9. Panic inventory
10. IPC registration parity
11. IPC invoke token parity
12. `npm ci` + UI lint/typecheck/test
13. i18n lint
14. FTL dedupe
15. Feature registry parity
16. Topology contract parity
17. Plugin-guide parity
18. Windows config drift
19. Release toolchain self-tests
20. Healthcheck script test
21. CI docs drift
22. Optional: Docker build (`--docker-dry-run`)

### `scripts/check-ui.mjs` (Node, cross-platform)

`npm run check:all` from `ui/` directory. Runs:
1. ESLint
2. TypeScript typecheck
3. Unit tests (vitest)
4. i18n lint
5. FTL dedupe
6. Bundle budget
7. E2E tests (if Docker available)
8. Perf smoke (if Playwright available)

---

## Adding a new gate

1. Add entry to `scripts/gates.json` with `id`, `label`, `status`, `runners`, and `ci` mapping
2. Add the gate declaration to `scripts/check.sh` and/or `scripts/check-ui.mjs`
3. Add the corresponding job to the appropriate workflow (`.github/workflows/*.yml`)
4. Update this document (`docs/operations/ci-pipeline.md`) — the Job Matrix and Pre-Merge Validation Gates tables
5. Update the job list in `docs/releases/checklist.md` — it is checked too, and omitting a live job is a finding
6. Run `python3 scripts/verify-ci-docs-drift.py` locally to verify

---

## Retiring a gate

A check that no longer runs anywhere must say so. Do **not** leave it `required`
while pointing at a workflow that GitHub never executes — that is the state
`gates.json` was in for 16 of 47 gates, and it is why R36-10 exists.

1. Set `"status": "retired"` and **remove the `ci` block entirely**. The checker
   rejects a `retired` gate that still carries one, so the status cannot be used
   to mute a finding.
2. Add a `_note` saying where the check went and what, if anything, still covers
   it. Retiring is a factual claim about today, not a policy verdict about
   whether the check should exist.
3. Run the checker. `gates.json` should now report the gate under "marked retired
   and claim no CI enforcement".

Restoring a retired gate is the reverse: add the job, put the `ci` block back,
flip the status, and delete the `_note`.

---

## Removing a gate

1. Remove from `scripts/gates.json`
2. Remove from `scripts/check.sh` and/or `scripts/check-ui.mjs`
3. Remove or disable the corresponding workflow job
4. Update this document
5. Update the job list in `docs/releases/checklist.md`
6. Run `python3 scripts/verify-ci-docs-drift.py` to verify

---

*Generated and maintained by the OZ-POS team. Last verified by `verify-ci-docs-drift.py`.*