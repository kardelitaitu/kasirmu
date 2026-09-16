# CI Pipeline Documentation
<!-- Audit stamp: 2026-09-08 · DSH · status: ACCURATE (rev 1 · FIRST STAMP THIS PAGE EVER CARRIED. It also had no footer, which is how a document could be substantially repaired earlier today - commit 404853032 un-retired ten rows from the dead ci.yml onto the jobs that actually run them, and corrected seven more that claimed Required/Advisory for gates running nowhere - and still hold no evidence that anyone had looked at it. Content work without a stamp is work that cannot be cited later, and my own notes in other docs had started referring to this page as audited merely because I had fixed it, which is a different claim. · Re-verified against .github/workflows/ directly rather than against another doc: 2 live workflows (dev-ci.yml, release.yml), 11 .bak files, dev-ci triggers pull_request + workflow_dispatch with no push trigger, ten jobs, 28 named steps in static-gates. · New: the release.yml.bak row and the note beneath the table - the retired copy of a live pipeline, the only same-name twin in that directory, previously named by no document in the repo. · REV 2 (09-09-26, docs-auditor, CI-claim pass) — status: ACCURATE AFTER REPAIR (2 findings) + 3 adjacent CI claims corrected while re-reading the same tables. Fixed: Gate Vocabulary named `ci.yml` and `nightly.yml` as gate consumers, both retired `.bak` since `23c963303`; the two LIVE workflow files are `dev-ci.yml` and `release.yml` and those are the rows now. The `northflank-deploy` row claimed it `needs` every live job except `ci-docs-drift`; the actual `needs:` list at `dev-ci.yml:656` has 7 of the 10 jobs and omits `release-readiness` too, so the deploy is NOT gated on the updater signing chain (recorded at `docs/plans/0.0.36-backlog.md:3690`) - the row said the opposite. The `audit` row asserted `security.yml` never existed at all; false: `git log --name-status -1 23c963303` shows `R100 .github/workflows/security.yml -> security.yml.bak` and 12 commits touch the live path, and `cargo audit`/`cargo deny` are at `security.yml.bak:19-34`/`:36-50`. The `deploy.yml` inventory row called it a website deploy; `deploy.yml.bak:46` is `name: Deploy Backend (Northflank)`. Verified from the files themselves: 2 live workflows, `dev-ci.yml` triggers `pull_request: branches: [main]` + `workflow_dispatch` with no `push:` key, `release.yml` triggers `push: tags: ['v*']` with jobs `release-validate`/`release-build`/`release-publish`; `static-gates` holds 28 named steps. Left alone: the `release.yml.bak` deletion is a CODE/CONFIG finding already recorded at the note under the inventory table, and the historical Purpose/Trigger columns are retained by design per the note at the top of that table. -->

> **Canonical CI dashboard** (AUDIT-27 CI-08). This document is the single source of truth for what jobs run in CI, what gates they map to, and which workflows exist. It is verified by `scripts/verify-ci-docs-drift.py` on every PR and local `check.sh` run.

---

## Job Matrix

> The heading text `Job Matrix` is a **literal contract** —
> `verify-ci-docs-drift.py` refuses to run without it, so do not rename it away.
> It used to read `Job Matrix (ci.yml)`, which became false the day `23c96330`
> retired that workflow: the suffix described a dead file while the live jobs
> below it went unlisted. **The Workflow column is what tells you where a row
> actually runs.**

> ✅ **What is live.** GitHub executes TWO workflows, not one (repro: `ls .github/workflows/*.yml`, measured 2026-09-14; both carry a 🟢 **LIVE** row in the Workflow inventory below): `release.yml` on `v*` tags, and `dev-ci.yml` on `pull_request` + `push` to main + `workflow_dispatch`. Retired here is the claim that `dev-ci.yml` was the only workflow GitHub executes — this page's own live `release.yml` row contradicts it. For `dev-ci.yml`, Every
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
> Three rows were repointed in this release because CI coverage was added for
> them: `rust-fmt`, `ui-lint` and `ui-typecheck` are **steps**
> inside live `dev-ci.yml` jobs rather than jobs of their own (`rust-clippy` is local-only).

| Job ID | Blocks Merge | Workflow | Notes |
|--------|--------------|----------|-------|
| `cargo-check` | ✅ Required | dev-ci.yml | step `cargo fmt --all -- --check` (was job `rust-fmt`) |
| `static-gates` | ✅ Required | dev-ci.yml | `gofmt -l` + `go vet` + `go test -short` on license-server. gates.json names `dev-ci.yml/static-gates`; the row said `ci.yml` until 08-09-26, which made live coverage look historical |
| `static-gates` | ✅ Required | dev-ci.yml | `sh apps/unified/test-healthcheck.sh` (dev-ci.yml:471-472) |
| `static-gates` | ✅ Required | dev-ci.yml | Step "Panic inventory (ADR #33)". **No gates.json record** |
| `changes` | ✅ Required | dev-ci.yml | Path-based change detection for PR filtering. `changes` is the FIRST job in dev-ci.yml's own job list — the `ci.yml` attribution was never ambiguous, just stale |
| `static-gates` | ✅ Required | dev-ci.yml | `python3 scripts/verify-no-hardcoded-money-format.py`, step "No hardcoded money formatting". **No gates.json record** — see the blind-spot note below |
| `static-gates` | ✅ Required | dev-ci.yml | Static boundary enforcement, step "Architecture boundaries" |
| `rust-clippy` | Local only | ci.yml | Clippy is skipped in CI and run locally via `check.sh` / `cargo clippy` (was job `rust-clippy` in `ci.yml`) |
| `rust-test-fast` | Superseded | ci.yml | The sharded crate-group layout is gone; `dev-ci.yml#cargo-nextest` covers the same ground in one unsharded `--workspace --all-features` run |
| `sync-slow-tests` | ❌ Runs nowhere | ci.yml | Platform-sync integration suite. gates.json: **retired**, no runner — "advisory" still implied it executed somewhere |
| `cargo-nextest` | ✅ Required | dev-ci.yml | gates.json maps this gate to `dev-ci.yml/cargo-nextest`, which runs `cargo nextest run --workspace --all-features` on every PR — not push-only |
| `cargo-nextest` | ✅ Required | dev-ci.yml | App-crate tests run inside the same workspace nextest invocation (no `--exclude`) |
| `ui-test` | ✅ Required | dev-ci.yml | step `npm run lint` (was job `ui-lint`) |
| `ui-test` | ✅ Required | dev-ci.yml | step `npm run typecheck` (was job `ui-typecheck`) |
| `ui-test` | ✅ Required | dev-ci.yml | step "Run Vitest" in the live `ui-test` job. The `ci.yml` row described the 4-shard layout; the shards are gone, the coverage is not |
| `ci-docs-drift` | ✅ Required | dev-ci.yml | step `verify-ci-docs-drift.py` — blocking since R36-10 closed the count to 0 |
| `ci-docs-drift` | ✅ Required | dev-ci.yml | step `bash scripts/test-ci-routing.sh` — the router decides whether every other job runs, so this one blocks |
| `website` | ✅ Required | dev-ci.yml | `cd website && npm ci && npm run check && npm test && npm run build` |
| `cargo-nextest` | ✅ Required | dev-ci.yml | `cargo nextest run --workspace --all-features` — **no `--exclude`**, so this is broader than check.sh's equivalent, which drops `oz-pos-app` |
| `release-bridge-test` | ✅ Required (push to `main` only) | dev-ci.yml | `cargo nextest run -p oz-bridge --release`. The release profile is where `BOOTSTRAP_FREE` stops verifying, so every command doing `sub.verify_signature()?` fails closed there — that produced 76 reds no gate could see. Landable only because release went green at `2dc500382`. Deliberately **not** on PRs (a release compile is much colder) and **not** scheduled (this workflow costs ~75 runner-minutes per run). No `check.sh` runner for the same reason. Flag trap: `-P release` is the *nextest* profile and would silently re-run the debug build; `-r`/`--release` is the cargo one |
| `static-gates` | ✅ Required | dev-ci.yml | eight checks that previously had no CI runner at all: architecture boundaries, no-hardcoded-money-format, windows-config, skill-drift, unified-healthcheck, panic inventory, release workflow validation (+ `--self-test`), and Go fmt/vet/test. Each verified green locally before being wired in. |
| `release-readiness` | ✅ Required | dev-ci.yml | `node scripts/check-release-version.mjs --self-test` then `node scripts/check-updater-compat.mjs` — proves the updater signing chain emits signatures the real Tauri client verifier accepts. Path-gated on `changes.outputs.release`; the harness needs a cold cargo build. |
| `release-validate` | ✅ Required | release.yml | tag push only: `check-release-version.mjs <tag>` (tag ↔ version ↔ changelog), its `--self-test`, and the updater compat check. |
| `release-build` | ✅ Required | release.yml | matrix `desktop-linux` / `desktop-windows` / `desktop-macos`: nextest, `cargo tauri build`, bundle-existence gate, Windows asInvoker manifest check, optional SignPath/Authenticode with a loud unsigned fallback. |
| `release-publish` | ✅ Required | release.yml | signed `latest.json`+`beta.json`, signature verification against the committed pubkey, SHA-256 inventory, draft release, provenance attestation, then publish. Hard-fails without `UPDATER_PRIVATE_KEY`. |
| `northflank-deploy` | ✅ Required | dev-ci.yml | Backend deploy to Northflank; `needs: [changes, website, cargo-check, cargo-nextest, ui-test, i18n, static-gates]` (`dev-ci.yml:657`) — seven of ten jobs, so it excludes **two**, and **both exclusions are decisions, now written into the workflow comment at `dev-ci.yml:658-691`** (they were unexplained until 2026-09-14, when `AGENTS.md` and this row said “no comment accounts for it” and the comment above them called `ci-docs-drift` advisory). `release-readiness`: this deploy POSTs `$GITHUB_SHA` to Northflank, which builds `Dockerfile.unified` — a **backend** container that consumes no installer, no `latest.json` and no updater pubkey — so the desktop signing chain is gated where it binds instead: `release.yml` runs the same `scripts/check-updater-compat.mjs` in `release-validate`, `release-build` `needs` `release-validate`, `release-publish` `needs` `release-build`. Wiring it into the deploy too would bind 100% of deploys to it regardless of desktop churn (the router forces `release=true` on every non-PR event; the release router paths held 140 of 7,841 commits in the last 90 days = 1.79%), on a failure surface unrelated to what it protects (unstable `rust-toolchain` pin, node 24, a cold cargo build under workflow-wide `RUSTFLAGS=-D warnings`); narrowing the route instead is a no-op on this path. **Residual risk, recorded honestly: `main` is unprotected, so a red signing-chain check is still mergeable** — the gate holds on the tag path, not on the merge. Opened as a question at `docs/plans/0.0.36-backlog.md`; the question is now closed as a decision. **A push to `main` does reach it** (2026-09-14): the `if:` at `dev-ci.yml:695` matches `github.event_name == 'push'` on `refs/heads/main` *and* on `refs/heads/0.0.*`, and `dev-ci.yml:6-7` declares the `push` trigger — what used to be asserted here, "effectively `workflow_dispatch` only … no push ever reaches it", was made false by `e3aff7b56` the same morning; the deploy still requires `NORTHFLANK_API_TOKEN` (`dev-ci.yml:693-694`). **Tightened 2026-09-15 at `dev-ci.yml:695`:** the `if:` now reads `(github.event_name == 'push' || github.event_name == 'workflow_dispatch') && github.ref == 'refs/heads/main'`, so `refs/heads/0.0.*` reaches the deploy by **neither** route. This also corrects the superseded reading above, which named the wrong arm: a `0.0.*` **push** runs nothing (`on.push.branches` lists only `main`) — the arm that was live and undeclared was a **`workflow_dispatch` off a `0.0.*` branch**, because `workflow_dispatch` at `dev-ci.yml:8` carries no branch filter. `ci-docs-drift` is **blocking in CI**, not advisory: its `drift` step ends on `[ "$status" = "PASS" ]` (`dev-ci.yml:407`), and the job's last step is `AGENTS.md mirror truthfulness` (`:426-429`); the job carries no `continue-on-error` (`:336` is inside the `i18n` job) — omitting it from `needs` is a deploy-topology choice, recorded as one in `dev-ci.yml:658-691` (the comment that used to call it advisory was fixed on 2026-09-14) |
| `lighthouse` | ❌ Runs nowhere | ci.yml | Lighthouse a11y audit. gates.json: **retired** |
| `docker` | ❌ Runs nowhere | ci.yml | No Trivy or docker-build step exists in either live workflow (verified by grep), and the gate has no gates.json record at all |
| `coverage` | ❌ Runs nowhere | ci.yml | Coverage report. gates.json: **retired**. `scripts/coverage.sh` exists; nothing invokes it in CI |
| `audit` | ❌ Runs nowhere | ci.yml | `cargo audit` + `npm audit`. gates.json: **retired**; the runner lived in `security.yml`, which was renamed to `security.yml.bak` by `23c963303` on 2026-09-02 (cargo-audit job at `security.yml.bak:19-34`, cargo-deny at `:36-50`) — so the file did exist live before that rename, contrary to what this row claimed until 09-09-26. This is the row AGENTS.md means by "security suites are not enforced" |
| `security-pr` | ❌ Runs nowhere | ci.yml | gates.json marks this **retired** with no CI runner. The row claimed ✅ Required until 08-09-26 |
| `fuzz` | ❌ Runs nowhere | ci.yml | Fuzz targets exist under `fuzz/`; gates.json marks the runner **retired**, so nothing executes them |
| `flaky-quarantine` | ❌ Runs nowhere | ci.yml | gates.json: **retired**, no runner. `scripts/verify-flaky-quarantine.py` exists and passes, but no live workflow and not `check.sh` invoke it |
| `static-gates` | ✅ Required | dev-ci.yml | `python3 scripts/verify-windows-config.py`, step "Windows config drift" |
| `static-gates` | ✅ Required | dev-ci.yml | `bash .agents/skills/skill-drift-guard/scripts/detect.sh --report` (dev-ci.yml:469-470), no `continue-on-error`, so it blocks. **No gates.json record** |
| `e2e-docker-image` | ❌ Runs nowhere | ci.yml | GHCR push of the E2E image. With it gone, `npm run e2e` builds images locally on first use |
> ⚠️ **The history exemption is a blind spot, and ten rows were living in it.**
> `verify-ci-docs-drift.py` treats any row naming a `.bak`-only workflow as
> documentation-of-history and does not count it as drift. That is the right rule for a
> genuinely dead job. It is the wrong rule when the *coverage* moved into a live job and
> only the row was left behind — which is what ten of the twenty-two `ci.yml` rows were
> doing: `go`, `unified-healthcheck`, `architecture-boundaries` and `windows-config` run
> today inside `#static-gates`; `rust-test-full` and `rust-test-apps` inside
> `#cargo-nextest`; and `changes`, `ui-test`, `rust-money-format`, `rust-panic-inventory`
> plus `skill-drift-tests` are live jobs or steps. Each named a dead file while its real
> runner sat in a live one, so the checker waved all ten through and reported **0 drift**
> against a table where nearly half the retired-attributed rows were misfiled. The
> exemption asks whether the *workflow named in the row* exists; it never asks whether
> the *gate itself* still runs somewhere.
>
> Four of those live steps have **no `gates.json` record at all** — `changes`,
> `rust-money-format`, `rust-panic-inventory`, `skill-drift-tests` — so they are
> invisible to the checker twice over. This is the same hole AGENTS.md records for the
> migration-column-type and PG-drift gates before 0.0.37 restored them: a gate with no
> `gates.json` entry cannot be reported as unenforced, because the tool has never seen
> it. Adding those four records is a data change to `scripts/gates.json` and is
> deliberately not made here.
| `e2e` | Local only | ci.yml | gates.json: status `required`, `ci: null`, runners `check:all` — required of anyone running the full local matrix, enforced by no workflow. AGENTS.md says the same: a green Dev CI run is not proof E2E passed |

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
| Clippy | — (no CI job) | Required (local policy, CI-unrun) | `check.sh` (clippy workspace, scripts/check.sh:44), `scripts/release.sh` (:61-62). **Not** a `cargo-check` step: that job has exactly two steps, `cargo fmt --all -- --check` (dev-ci.yml:194-195) then `cargo check --workspace --all-targets --all-features` (196-197), and `grep -c clippy .github/workflows/dev-ci.yml .github/workflows/release.yml` = 0 and 0 (2026-09-14; the only clippy under `.github/workflows/` is in the inert `ci.yml.bak`). gates.json files it as status `required` with runners check.sh and **no** `ci` block — required-but-CI-unrun, deliberately not `retired`, which the checker reserves for a gate that enforces nothing (scripts/verify-ci-docs-drift.py:104-110) |
| Rust tests | `cargo-nextest` | Required | `check.sh` (test workspace, test doctests) |
| Go (license-server) | `static-gates` | Required | `check.sh` (go fmt, go vet, go test (short)) |
| Website unit tests | `check` (website.yml) | Required | `check.sh` (website test) |
| Architecture boundaries | `static-gates` | Required | `check.sh` (architecture boundaries) |
| No raw params (ADR #7 Phase 4) | — | Required | `check.sh` (no-raw-params) |
| No hardcoded money format | `static-gates` | Required | `check.sh` (hardcoded-money-format) |
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
| Windows config drift | `static-gates` | Required | `check.sh` (windows config) |
| Unified healthcheck | `static-gates` | Required | `check.sh` (healthcheck script test) |
| Bundle budget | — | Required | `check:all` (bundle budget) |
| E2E tests | `e2e` | Required | `check:all` (e2e) |
| Perf smoke | — | Required | `check:all` (perf smoke) |
| Rust test apps | `cargo-nextest` | Required | — |
| Rust test full | `cargo-nextest` | Required | — |
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
| `dev-ci.yml` | 🟢 **LIVE** | `pull_request` to main, **`push` to main** (added by `e3aff7b56`), `workflow_dispatch` — `sed -n '3,8p' .github/workflows/dev-ci.yml`, 2026-09-14 | Validation on PRs **and** on pushes to `main`; such a push also satisfies `northflank-deploy`'s `if:` (`dev-ci.yml:695`), so a push to `main` deploys — the deploy itself is conditional on `NORTHFLANK_API_TOKEN` being configured (`dev-ci.yml:693-694`). Jobs: `changes`, `website`, `cargo-check`, `cargo-nextest`, `release-bridge-test` (push to `main` only), `ui-test`, `i18n`, `ci-docs-drift`, `static-gates`, `release-readiness`, `northflank-deploy` — **eleven**. **No build or artifact step** — it validates the release toolchain but does not produce release assets; that is `release.yml`. |
| `release.yml` | 🟢 **LIVE** (restored, desktop-only) | tag push (v*) | Builds the three Tauri desktop installers, generates the signed `latest.json`/`beta.json` updater manifests, checksums, attests provenance, and publishes a GitHub Release. Restored in 0.0.36 after `23c96330` renamed it to `.bak` with no replacement. **Docker matrix targets were dropped** — backend images are built by Northflank via `dev-ci.yml#northflank-deploy`. Mobile remains retired (`android.yml`, `ios.yml`). |
| `release.yml.bak` | 🟠 **stale twin of a LIVE workflow** | (inert — GitHub never reads `.bak`) | The pre-retirement release pipeline, 512 lines vs the live 470. Retired by `23c963303` (09-02) and left behind when `release.yml` was restored on 09-04, so the directory now holds two tracked release workflows that differ by 42 lines. See the note below. |
| `ci.yml` | 🔴 retired `.bak` | push/PR to main | Primary CI pipeline (lint, test, build, scan) |
| `nightly.yml` | 🔴 retired `.bak` | schedule (daily) + dispatch | Nightly Rust/doc/UI/E2E + flaky detection |
| `security.yml` | 🔴 retired `.bak` | schedule (weekly) + dispatch | Cargo audit/deny + container scan |
| `android.yml` | 🔴 retired `.bak` | push/PR to main | Android build |
| `ios.yml` | 🔴 retired `.bak` | push/PR to main | iOS build |
| `e2e-pr.yml` | 🔴 retired `.bak` | PR to main | E2E on PRs |
| `deploy.yml` | 🔴 retired `.bak` | push to main | Backend deploy to Northflank (`name: Deploy Backend (Northflank)`, `deploy.yml.bak:46`) — the predecessor of `dev-ci.yml#northflank-deploy`, not a website deploy |
| `docker-digest-drift.yml` | 🔴 retired `.bak` | schedule | Docker digest drift check |
| `docker-persistence.yml` | 🔴 retired `.bak` | schedule | Docker persistence check |
| `website.yml` | 🔴 retired `.bak` | push to main | Website build + deploy |

> **Why `release.yml.bak` is called out rather than just listed.** Every other retired file has
> no live counterpart, so a stale `.bak` there is dead weight. This one is the retired version
> of a pipeline that RUNS, sitting in the same directory as the live file, differing by 42
> lines (512 vs 470). `release.yml` was restored on 2026-09-04 by `3b10ea3a2` from git history
> rather than by renaming the `.bak` back, so `23c963303`'s retirement copy survived it. Two
> concrete costs: `grep -rn` or tab-completion on `release.yml` hits both files, and anyone
> reviving the retired mobile pipelines from this directory has to notice which of two
> `release.yml*` files they are editing. GitHub itself is unaffected - it only reads
> `*.yml`.
>
> **CODE/CONFIG FINDING, recorded not fixed**: `release.yml.bak` should probably be deleted
> (its content is recoverable from `23c963303`'s parent) or renamed to something that cannot
> collide, like `release.yml.pre-restoration`. Deleting a tracked file in the CI directory is
> not a documentation repair, so it is left to whoever owns the pipeline.

---

## Gate Vocabulary

The gate vocabulary is defined in `scripts/gates.json` and shared by:
- `.github/workflows/dev-ci.yml` (live CI jobs)
- `.github/workflows/release.yml` (live tag jobs)
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

> last audited 09-09-26 by docs-auditor
>
> **Dated pointer correction (2026-09-14).** The 2026-09-08 stamp above cites the
> `northflank-deploy` `needs:` list at `dev-ci.yml:656`; that line is `runs-on:
> ubuntu-latest` today and the list reads at `dev-ci.yml:657` (`sed -n '654,657p'
> .github/workflows/dev-ci.yml`). The stamp stands verbatim per this file's convention.
> Three LIVE pointers were repointed in the same pass, each re-read off the workflow: the
> skill-drift-guard step `:472-473` -> `:469-470`, the unified-healthcheck step `:475` ->
> `:471-472`, and the deploy `if:` `:668` -> `:695` (that one moved because `040435d11`
> added 27 comment lines inside that job). Verified still correct and therefore NOT
> touched: `:657` `needs:`, `:658-691` the exclusions comment, `:695` the `if:`, `:6-7` the
> push trigger, `:693-694` the `NORTHFLANK_API_TOKEN` comment, `:407` the drift step's
> `[ "$status" = "PASS" ]`, `:336` inside `i18n`, and `:194-197` in `cargo-check`.

