---
name: pr-repair
description: Systematic workflow for diagnosing, reproducing, repairing, and verifying failed tests and CI checks on a GitHub pull request in kasir.mu. Covers gh CLI diagnosis, scoped reproduction (Rust, UI, E2E, gates, drift scripts), repair patterns, and verification protocols.
---

<!-- Audit stamp: 2026-09-22 · Budak-Korporat · status: ACCURATE — 0 findings · Audited against branch `0.0.39` at `e56bf8307`, working tree clean. Every prior finding against this file is confirmed repaired. Re-measured: `dev-ci.yml` runs **11** jobs (changes, website, cargo-check, cargo-nextest, release-bridge-test, ui-test, i18n, ci-docs-drift, static-gates, release-readiness, northflank-deploy) and `release.yml` **3** (release-validate, release-build, release-publish) — so the corrected "11 jobs / adds 3 more" at `:35` and `:80` is right, and the old "38+ jobs across multiple OS matrices taking 15-25 minutes" is gone from both places. The version lock reads `0.0.39`, matching `Cargo.toml:37`. No `git add` instruction remains anywhere in the file, so the `AGENTS.md` policy violation the 18-09-26 audit found is fixed. `bash scripts/poll-pr-checks.sh` resolves — and note that `scripts/poll-pr-checks.ps1` **also exists now**, so the superseded stamp's justification for preferring the `.sh` ("no `.ps1` exists") is itself stale; it is left verbatim below because this file preserves superseded readings. · NOT re-measured: wall-clock timings. -->

<!-- Superseded audit stamp: 2026-09-03 · DSH · status: ACCURATE at audit time (0 findings on 22-09-26) (rev 2 — version lock corrected 0.0.31 → 0.0.35; poll-pr-checks.ps1 corrected to the real scripts/poll-pr-checks.sh (no .ps1 exists); the Fluent bundle-path wording corrected to the per-feature English/.id.ftl layout; touch-target rule aligned with the design language 48px floor; illustrative Fluent ids reworded so the drift-guard Fluent check stays clean; reset-dev-pg.ps1 mention removed — only the .sh exists; vitest repro switched to npm run test -- filter) · verified this pass: scripts/poll-pr-checks.sh, scripts/reset-dev-pg.sh, scripts/diagnose-pr.py, scripts/verify-ci-docs-drift.py, scripts/verify-architecture-boundaries.py, scripts/verify-no-hardcoded-money-format.py, scripts/test-tdd.sh, crates/kasirmu-api/src/pg_tests.rs, apps/cloud-server/src/db_tests.rs exist; ui npm scripts e2e:api / e2e:ui / typecheck / lint / test confirmed in ui/package.json -->

# PR Repair — Fixing Failed Tests and CI Checks on Pull Requests

This skill defines the standardized, disciplined workflow for diagnosing, reproducing, fixing, and verifying failed tests or failing CI checks on a GitHub pull request in the kasir.mu repository.

---

## When to use

- CI checks are failing on an active pull request (`gh pr checks` shows failures).
- A PR review reports regressions or test failures.
- A rebase or branch sync against `main` broke existing tests.
- Gate scripts or linters (bundle-parity, i18n, clippy, doc-drift) failed during CI execution.

---

## Golden Rules

| # | Rule | Why |
|---|------|-----|
| 1 | **Evidence first — diagnose before touching code.** | Never guess why a CI check failed. Use `gh pr checks` and `gh run view --log-failed` to extract the exact failure trace. |
| 2 | **Reproduce locally in isolation.** | Reproduce the failing test or check locally using the smallest possible command before writing fixes. |
| 3 | **Minimal surgical fixes.** | Address the root cause. Never delete assertions, skip tests, widen tolerances, or suppress linters unless the test was demonstrably testing an obsolete specification. |
| 4 | **Maintain architectural standards.** | Money values stay in `i64` minor units (`Money`), database writes in `rusqlite` transactions, UI text in `@fluent/react` via `<Localized>`, and Tauri IPC routed through `ui/src/api/`. |
| 5 | **Version is locked at `0.0.40`.** | Never modify the version number in `Cargo.toml`, `package.json`, or any manifest. |
| 6 | **Scope verification to the affected area.** | Run targeted tests during iteration. Full `scripts/check.sh` is reserved for final pre-push or explicit requests. |
| 7 | **Never kill running background processes.** | Do not kill `.exe` or background services that may belong to other agents or active dev servers. |
| 8 | **Never `git push` without an explicit direct command.** | Always stop at local commit. Even after full verification, ask or wait for the user to explicitly tell you to push. |
| 9 | **Catch early, repair instantly — 30s fail-fast polling.** | `dev-ci.yml` runs 14 jobs, all on `ubuntu-latest` — there is no OS matrix — so typical wall time is a few minutes. Never run bare `gh pr checks --watch` which hangs until all checks finish. Instead, poll every 30s with fail-fast early exit (`gh pr checks <PR> --watch --fail-fast -i 30` or `bash scripts/poll-pr-checks.sh`). As soon as 1 or 2 fast checks fail, catch them immediately and start repairing without waiting for the rest. **Measured 2026-09-24 (run 35913445291): the fast-red jobs are `static-gates` (~1 min, ungated, runs on every PR) and `rust-fmt` (~20s when the Rust route is true), then `ci-docs-drift` (24s), `release-readiness` (21s) and `i18n` (64s). `Cargo Nextest` is the long pole at ~14 min, so a Rust test failure is the one verdict you will always wait longest for.** |

---

## The 5-Phase Repair Loop

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────────────┐
│  1. Identify &  │ ──> │  2. Diagnose CI  │ ──> │  3. Reproduce Locally │
│  Checkout PR    │     │  Failure Logs    │     │  (Scoped Isolation)  │
└─────────────────┘     └──────────────────┘     └──────────────────────┘
                                                            │
                                                            ▼
┌─────────────────┐     ┌──────────────────┐     ┌──────────────────────┐
│ 5. Commit & Ask │ <── │   Verify Local   │ <── │ 4. Root Cause &      │
│ for Push Auth   │     │   Pass           │     │    Surgical Fix      │
└─────────────────┘     └──────────────────┘     └──────────────────────┘
```

---

### Phase 1 — Identify & Checkout the PR

Find and switch to the target PR branch:

```powershell
# 1. Check status of PRs relevant to current workspace
gh pr status

# 2. Or list open PRs across the repository
gh pr list --state open --limit 5

# 3. Checkout the target PR locally (e.g. PR #55)
gh pr checkout <PR_NUMBER>

# 4. Ensure local tracking branch is up to date
git pull origin $(git branch --show-current)
```

---

### Phase 2 — Diagnose CI Failure Logs (Fail-Fast Early Catch)

> [!IMPORTANT]
> **Never run bare `gh pr checks --watch` to wait for all checks to finish.**
> In kasir.mu, `dev-ci.yml` runs **14 jobs**, all on `ubuntu-latest` — there is **no OS matrix**, so "waiting for the matrix" is not a thing here. Typical wall time is a few minutes, dominated by `cargo-nextest` and `ui-test`. (This line previously claimed "38+ jobs across multiple OS matrices taking 15–25 minutes", which overstates the count ~2.7x and invents a dimension that does not exist; `release.yml` adds 3 more (`release-validate`, `release-build`, `release-publish`), but only on `v*` tags.) The fail-fast advice below stands regardless, and is if anything more valuable here: with 14 jobs and no matrix, a green run arrives quickly, so a slow poll wastes the whole window in which you could already be fixing the first failure.

```powershell
# Option A: Native gh CLI with 30s interval and fail-fast (exits on the first failed check!):
gh pr checks <PR_NUMBER> --watch --fail-fast -i 30

# Option B: Dedicated repo polling script (prints progress and halts on early failure):
bash scripts/poll-pr-checks.sh <PR_NUMBER> 30

# Option C: Non-blocking instant snapshot:
gh pr checks <PR_NUMBER>

# Find recent workflow runs for the PR branch:
gh run list --branch $(git branch --show-current) --limit 3

# View the exact failing step logs immediately:
gh run view <RUN_ID> --log-failed

# Or target a specific failed job:
gh run view <RUN_ID> --job <JOB_ID> --log
```

Analyze the log output to determine which category the failure belongs to:
1. **Rust unit / integration test failure**
2. **Dev PostgreSQL drift** (`Db("db error")`)
3. **Rust formatting or Clippy lint**
4. **UI test failure** (Vitest / Jest)
5. **UI Typecheck (`tsc`) or ESLint failure**
6. **E2E Playwright test failure**
7. **Localization / Bundle-parity failure** (`.ftl` mismatch)
8. **Documentation / Architecture boundary script drift**

---

### Phase 3 — Reproduce Locally (Scoped Isolation)

Always run the reproduction command corresponding to the failed CI gate:

#### 1. Rust Unit & Logic Tests
```powershell
# Run a specific failing test in a specific crate
cargo test -p <crate_name> <test_name> -- --nocapture

# Or use the fast TDD loop
bash scripts/test-tdd.sh -p crates/<crate_name>
```

#### 2. Dev PostgreSQL Drift (`Db("db error")`)
When PG tests like `crates/kasirmu-api/src/pg_tests.rs` or `apps/cloud-server/src/db_tests.rs` fail with cryptic `Db("db error")`:
```powershell
# Reset dev PostgreSQL schema drift
bash scripts/reset-dev-pg.sh

# Re-run the failing test
cargo test -p kasirmu-api --test pg_tests
```

#### 3. Rust Formatting & Linter
```powershell
# Check formatting
cargo fmt --all -- --check

# Run Clippy on the affected crate
cargo clippy -p <crate_name> --all-targets --all-features -- -D warnings
```

#### 4. UI Unit Tests (Vitest)
```powershell
cd ui
# Run a specific test file by name filter (matches ui/src/__tests__/<name>.test.tsx)
npm run test -- <test_name_fragment>

# Or run the full unit suite
npm run test
```

#### 5. UI Typecheck & ESLint
```powershell
cd ui
# Type-check
npm run typecheck

# Lint
npm run lint
```

#### 6. E2E Playwright Tests
```powershell
cd ui
# Run specific E2E test suite
npm run e2e:api
npm run e2e:ui
```

#### 7. Localization & Fluent Bundle Parity
```powershell
# Verify Fluent key parity between the English .ftl and .id.ftl bundles under shared-ui/locales/
bash scripts/lint-i18n.sh

# Check duplicate FTL keys
python scripts/dedupe-ftl.py --dry-run

# Check bundle parity against UI references
python scripts/verify-bundle-parity.py
```

#### 8. Documentation & Script Boundary Gates
```powershell
# Check CI docs drift
python scripts/verify-ci-docs-drift.py

# Check architectural boundary rules
python scripts/verify-architecture-boundaries.py

# Check hardcoded money format violations
python scripts/verify-no-hardcoded-money-format.py
```

---

### Phase 4 — Root-Cause & Apply Surgical Fix

Classify the root cause and apply the appropriate repair:

#### Scenario A: Logic Bug Introduced by PR Changes
- **Symptom:** Test expected value `A`, but received `B` due to recent edits.
- **Repair:** Modify the implementation to adhere to the expected business contract. Follow the Golden Rules: `Money` in `i64` minor units, all DB writes inside `rusqlite` transactions.

#### Scenario B: Test Assumptions Outdated by Intentional Feature Change
- **Symptom:** Feature specification deliberately changed (e.g. new status code or updated response structure), but test assertions were not updated.
- **Repair:** Update the test assertion to reflect the new intended contract. Add a code comment explaining why the expectation changed.

#### Scenario C: Dev Database Schema Drift
- **Symptom:** Migration was committed or altered, but test DB container schema was stale.
- **Repair:** Execute `bash scripts/reset-dev-pg.sh` and ensure migrations in `20260813_init.pg.sql` or subsequent migration files match test expectations.

#### Scenario D: Missing or Unsynced Fluent Localization
- **Symptom:** a `<Localized>` key added in React JSX is missing from the matching `shared-ui/locales/<feature>.ftl` (English) or `<feature>.id.ftl` (Indonesian) bundle — e.g. `sales.ftl` for a sales-surface key.
- **Repair:** Add the key and corresponding translated string to **both** the English and the `.id.ftl` bundle.

#### Scenario E: UI Accessibility (`aria-*`) or Touch Target Failure
- **Symptom:** Component fails ESLint `jsx-a11y` or the touch-target minimum size (48px floor for finger-tapped actions per the design language; 34px only in mouse/toolbar contexts).
- **Repair:** Add proper `aria-label`, `role`, or ensure button dimensions meet the design language's size ladder (48/42/34px).

---

### Phase 5 — Verify, Commit, and Push Protocol

#### 1. Verify Locally
Run the targeted check again to verify that the failure is resolved:
```powershell
# E.g. re-run the specific crate test or UI check
cargo test -p <crate_name> <test_name>
cargo fmt --all -- --check
```

#### 2. Verify Pre-Commit Gates
Confirm git status and run quick pre-commit validations:
```powershell
git status
```

#### 3. Commit Locally
Make a clean, descriptive local commit explaining the repair:
```powershell
git commit -m "fix(<scope>): repair <test_name_or_failure_description>" -- <repaired_files>
```

#### 4. Push Protocol — Explicit Permission Required
> [!IMPORTANT]
> **NEVER run `git push` autonomously.**
> Once the local commit is made, present your findings and the applied fix to the user, and ask for permission before pushing.

```powershell
# 1. Only run push after user explicitly instructs to push:
git push origin $(git branch --show-current)

# 2. Quick check: watches and auto-stops on the first failure!
gh pr checks <PR_NUMBER> --watch --fail-fast

# 3. If it auto-stops on failure, run the one-shot diagnoser immediately:
python scripts/diagnose-pr.py <PR_NUMBER>
```

---

## Quick Reference: CI Failure to Local Command

| CI Check Name | Root Cause Indicator | Local Reproduction Command |
|---|---|---|
| `Rust Test / test-workspace` | Rust assertion or panic | `cargo test -p <crate> <test_name> -- --nocapture` |
| `PG Integration / pg_tests` | `Db("db error")` drift | `bash scripts/reset-dev-pg.sh && cargo test -p kasirmu-api --test pg_tests` |
| `Rust Lint / cargo fmt` | Formatting discrepancy | `cargo fmt --all` |
| `Rust Lint / clippy` | Compiler/clippy warning | `cargo clippy -p <crate> --all-targets --all-features -- -D warnings` |
| `UI Test / vitest` | Component/unit test failure | `cd ui && npm run test -- <test_name_fragment>` |
| `UI Lint / tsc` | TypeScript type error | `cd ui && npm run typecheck` |
| `UI Lint / eslint` | Lint or a11y violation | `cd ui && npm run lint` |
| `E2E Playwright` | Browser flow timeout or diff | `cd ui && npm run e2e:ui` |
| `i18n Lint / bundle-parity` | Missing key in `.ftl` | `bash scripts/lint-i18n.sh && python scripts/verify-bundle-parity.py` |
| `CI Docs Drift` | Undocumented script or workflow | `python scripts/verify-ci-docs-drift.py` |
| `Skill Drift Tests` | Stale audit date or broken ref | `bash .agents/skills/skill-drift-guard/scripts/detect.sh` |

> last audited 22-09-26 by Budak-Korporat
