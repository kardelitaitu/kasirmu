#!/usr/bin/env bash
# scripts/check.sh — the FULL local matrix, run by hand (bash scripts/check.sh).
# It is NOT what `git push` runs. .githooks/pre-push invokes
# scripts/run-pre-push.py and nothing else, and that script is a SUBSET of this
# one — its Tier 0 static gates plus path-routed cargo check, cargo fmt --check,
# ui typecheck, ui vitest, analytics timezone invariance, website checks and
# lint-i18n — and it never calls check.sh. So a red pre-push is not a failure of
# this matrix, and a green push does not mean these steps ran.
# Nothing here mirrors .github/workflows/ci.yml either: that workflow was
# retired to ci.yml.bak in 23c96330, and the two live ones are dev-ci.yml (PRs
# and pushes to main) and release.yml (v* tags). See docs/operations/ci-pipeline.md.
#
# Usage:  bash scripts/check.sh
#         (run from the workspace root)

set -euo pipefail

cd "$(dirname "$0")/.."

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

step_counter=1

step() {
    local name=$1; shift
    local retry_cmd=$1; shift
    local step_str; step_str=$(printf "%02d" "${step_counter}")
    echo -n "${step_str}. checking ${name}... "
    step_counter=$((step_counter + 1))

    local start; start=$(date +%s)
    if ! "$@" >/dev/null 2>&1; then
        echo -e "${RED}FAIL${NC}"
        echo "run \"$retry_cmd\" for full detailed error messages"
        exit 1
    else
        local end; end=$(date +%s)
        echo -e "${GREEN}PASS ($((end - start))s)${NC}"
    fi
}

total_start=$(date +%s)

# Root policy gate (P8): the repo root holds only name-resolved tool contracts
# and the owner entry files; this also sweeps empty directories, the one junk
# class no git-based check can see. Local-only by design (see the gate header).
step "root policy" "python3 scripts/verify-root-policy.py" python3 scripts/verify-root-policy.py
step "root policy self-test" "python3 scripts/verify-root-policy.py --self-test" python3 scripts/verify-root-policy.py --self-test

# ── Rust (mirrors CI `rust` job) ──────────────────────────────────────────
step "cargo fmt" "cargo fmt --all -- --check" cargo fmt --all -- --check

# Workspace-wide clippy (single compilation pass instead of N per-package invocations).
# Uses default features only — the `slow-tests` feature gates integration tests
# that don't need linting, and clippy doesn't benefit from compiling them.
step "clippy workspace" "cargo clippy --workspace --all-targets -- -D warnings" cargo clippy --workspace --all-targets -- -D warnings

# ── ADR #7 Phase 4: no raw store_id/user_id in command signatures ───────
step "no-raw-params (ADR #7 Phase 4)" "bash scripts/verify-no-raw-params.sh" bash scripts/verify-no-raw-params.sh

# ── H-1/H-2: every registered command has a _scoped variant or allowlist entry ──
step "scoped coverage (H-1)" "bash scripts/verify-scoped-coverage.sh" bash scripts/verify-scoped-coverage.sh

# ── IPC registration parity (F-008/F-050) ────────────────────────────────
# Fails when the UI invokes a command string absent from a shell's
# generate_handler![] unless allowlisted; stale allowlist entries fail
# so the list shrinks to zero as F-006 removes the dead surface.
step "ipc parity" "python3 scripts/verify-ipc-parity.py" python3 scripts/verify-ipc-parity.py

# ── IPC session-token payload parity (round AE) ──────────────────────────
# Fails when the UI invokes a command whose Rust signature requires
# session_token without carrying a sessionToken payload (the round-AC edc
# class). Union semantics across desktop + tablet shells.
step "ipc invoke token parity" "python3 scripts/verify-invoke-parity.py" python3 scripts/verify-invoke-parity.py

# ipc-parity-allowlist.json records "UI command strings not yet registered in this shell", which
# covers two very different things: an ambient call sitting in an ADR #7 else-branch (dead surface,
# harmless) and an ambient call made unconditionally (a runtime `command not found` on that shell).
# The list cannot tell them apart, and one entry that looked like the first was the second --
# get_cart_deduction_location, which made every desktop sale with a stock-target item throw. This
# reads the allowlist, finds each command's wrapper and its production call sites, and fails on any
# call not sitting behind a token test.
step "scoped ambient reads" "python3 scripts/verify-scoped-reads.py --self-test" python3 scripts/verify-scoped-reads.py --self-test
step "unguarded ambient ipc calls" "python3 scripts/verify-scoped-reads.py" python3 scripts/verify-scoped-reads.py
# Ratchet on react-hooks/exhaustive-deps. `npm run lint` is `eslint .` with no --max-warnings 0, so
# it exits 0 while reporting 58 warnings -- and that rule is the ONLY automated check for a stale
# closure. Item 69 found five callbacks listing `userId`, which no component body ever read, while
# two of those same arrays omitted `promotionIds`, which is sent in the checkout payload. Neither was
# gated. This freezes the count at 7 (down from 12): it may go down, never up.
step "exhaustive-deps ratchet" "python3 scripts/verify-exhaustive-deps.py" python3 scripts/verify-exhaustive-deps.py

# ── Architecture boundary checker (P1 pilot) ────────────────────────────
# Existing transitional debt is reported but only new, expired, or stale
# baseline entries fail. This is static-only and has no runtime impact.
step "architecture boundaries" "python3 scripts/verify-architecture-boundaries.py --strict" python3 scripts/verify-architecture-boundaries.py --strict
step "server origins" "node scripts/check-server-origins.mjs" node scripts/check-server-origins.mjs
step "env docs" "node scripts/check-env-docs.mjs" node scripts/check-env-docs.mjs
step "unified routes" "node scripts/check-unified-routes.mjs" node scripts/check-unified-routes.mjs

# ── Money formatting gate (IDR/JPY/KWD exp-2 regression guard) ───────────
# Fails when production .rs code hardcodes `/ 100` division or `{}.{:02}`
# format strings instead of foundation::format_minor(). Pure python — no
# toolchain deps, so it stays fast.
step "no-hardcoded-money-format" "python3 scripts/verify-no-hardcoded-money-format.py" python3 scripts/verify-no-hardcoded-money-format.py

# ── Test shadow-copy gate ──────────────────────────────────────────────
# A test file that redeclares a production function and asserts against its
# own copy cannot fail, no matter what the real code does. Five such suites
# were found in one sweep; one of them (KdsAutoAcceptLogic) had copied the
# in-flight guard onto the wrong field and annotated it "simplified", so its
# test named "rejects when order is in-flight" validated a rule the app does
# not implement. Pure python, no toolchain deps.
step "test shadow copies" "python3 scripts/verify-test-shadow-copies.py" python3 scripts/verify-test-shadow-copies.py

# Workspace-wide test via cargo-nextest — runs each test in its own process
# for 4.5× faster re-runs after compilation. Also run doctests separately
# because nextest does not execute them. Falls back to cargo test if nextest
# is not installed.
cpu_count=$(nproc --all 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)
if command -v cargo-nextest &>/dev/null || cargo nextest --version &>/dev/null 2>&1; then
    step "test workspace (nextest)" "cargo nextest run --workspace --all-features --exclude kasirmu-app --exclude kasirmu-mobile" cargo nextest run --workspace --all-features --exclude kasirmu-app --exclude kasirmu-mobile
    step "test doctests" "cargo test --doc --workspace" cargo test --doc --workspace
    # Grade the run's JUnit report, not its summary line. A retry-rescued flake is
    # invisible to every other reader: nextest turns a genuine failure into
    # `... passed (1 flaky)` with exit 0, and the report's OWN `failures=` attributes
    # count that as a pass -- `<flakyFailure>` is the only place it survives. Measured
    # 2026-09-16 on this repo's real suite: 1084 tests, `failures=0`, exit 0, over a
    # revenue-netting assertion that had in fact failed and been bought back.
    #
    # Deliberately in this branch only: the `cargo test` fallback below emits no JUnit
    # report at all, and a missing report must not be able to read as a clean one.
    #
    # The path is the DEFAULT profile's artifact directory. This command passes no
    # `--profile`, so `path = "junit.xml"` in .config/nextest.toml resolves to
    # target/nextest/default/junit.xml -- nextest resolves it relative to the profile's
    # own dir, not the workspace root, which is why the old config value wrote a
    # doubled path nobody read.
    step "test workspace flake receipt (junit)" "python3 scripts/verify-pg-tests-ran.py --nextest-junit target/nextest/default/junit.xml" python3 scripts/verify-pg-tests-ran.py --nextest-junit target/nextest/default/junit.xml
else
    echo -e "${YELLOW}⚠ nextest not found — falling back to cargo test (slower)${NC}"
    step "test workspace" "cargo test --workspace --all-features -- --test-threads $cpu_count" cargo test --workspace --all-features -- --test-threads "$cpu_count"
fi

# ── Migration (LOCAL ONLY — no CI job runs this) ──────────────────────────
# This comment used to read "mirrors CI `migration` job". There is no such job:
# dev-ci.yml's ten jobs are changes, website, cargo-check, cargo-nextest, ui-test,
# i18n, ci-docs-drift, static-gates, release-readiness, northflank-deploy. The
# confusion is understandable because two neighbouring gates DO have CI backing since
# 0.0.37 (pg-schema-drift and migration-column-types, both in static-gates), but this
# one is the SQLite migrate-up path and nothing enforces it off a developer machine.
# Recorded in scripts/gates.json -> "migration".
step "migration smoke test" "cargo run -p kasirmu-cli -- migrate" cargo run -p kasirmu-cli -- migrate
step "migration idempotency" "cargo run -p kasirmu-cli -- migrate" cargo run -p kasirmu-cli -- migrate
rm -f kasir.db kasir.db-wal kasir.db-shm

# ── Skill drift guard (blocking in CI too: dev-ci.yml#static-gates) -------
if command -v bash &>/dev/null; then
    step "skill-drift-guard" "bash .agents/skills/skill-drift-guard/scripts/detect.sh --report" bash .agents/skills/skill-drift-guard/scripts/detect.sh --report
else
    echo -e "${YELLOW}⚠ skill-drift-guard skipped (bash not found)${NC}"
fi

# ── Panic-inventory gate (RUST-07 / ADR #33) — fail-closed ────────────────
# Audits production unwrap()/expect() calls (excludes tests, benches, and
# cfg(test)-gated helpers). Panics are only acceptable for documented
# invariant-setup (// SAFETY: / // INVARIANT: on the same or preceding
# line); the recoverable set must stay at zero. Fails when any finding
# lacks a verifiable comment.
# Review the full inventory with: python3 scripts/scan-unwrap-panic.py
if command -v python3 &>/dev/null; then
    echo -n "panic-inventory scan... "
    # Capture combined output: on success the scanner prints one summary line;
    # on failure it prints the FAIL header + findings + fix hint, which we
    # replay below so the failure is self-explanatory.
    if panic_out=$(python3 scripts/scan-unwrap-panic.py --fail-on-recoverable 2>&1); then
        echo -e "${GREEN}PASS (${panic_out})${NC}"
    else
        echo -e "${RED}FAIL (recoverable unwrap/expect calls found — add // SAFETY: / // INVARIANT: or convert to Result)${NC}"
        echo "$panic_out"
        exit 1
    fi
else
    echo -e "${YELLOW}⚠ panic-inventory skipped (python3 not found)${NC}"
fi

# ── Supply chain: cargo-deny (deny.toml) — ADVISORY, never fails the run ──
# This is the runner that deny.toml's own header used to say did not exist.
# Three deliberate absences, each load-bearing:
#   • It is NOT a step() call. step() ends in `exit 1` and this script runs
#     under `set -euo pipefail` (:16), so wrapping an advisory check there
#     would convert one advisory finding into a hard abort of the whole matrix.
#   • It is NOT in CI. No live workflow invokes cargo-deny, and
#     .githooks/pre-push runs scripts/run-pre-push.py, which never calls
#     check.sh — so a green PR is no evidence this leg ran, and this leg
#     running is no evidence that anything was enforced.
#   • It is NOT npm dependency auditing. The UI and website legs below run
#     `npm ci --no-audit`, a deliberate suppression, so this leg is Rust-only
#     and must never be described more widely than that.
# Branching is on rc==0 vs rc!=0 ONLY. No numeric exit code appears anywhere
# in this block: cargo-deny's and cargo-audit's numeric failure semantics are
# not knowable from this checkout, so a code-tested branch would be a guess.
# What the leg does distinguish — an unreachable advisory DB vs a real finding
# — it distinguishes by grepping the captured log, the same shape as the npm
# EPERM/esbuild classifier above. This is the only leg in the matrix that
# touches the network, so an outage must read as neither a pass nor a finding.
# The `command -v` probe is for the NEXT clone, not this box: cargo-deny IS
# installed on the machine that wrote this leg, so the skip branch below has
# never fired here and exists only so that a checkout without the binary skips
# loudly instead of dying under `set -u`.
if command -v cargo-deny &>/dev/null; then
    echo -n "supply chain advisories (advisory)... "
    if deny_out=$(cargo deny check 2>&1); then
        # Success: print the tool's own summary line (panic-inventory style) so
        # the PASS says what was checked, not merely that it passed.
        if deny_summary=$(printf '%s\n' "$deny_out" | grep -E '(advisories|bans|licenses|sources) ok' | tail -1); then
            echo -e "${GREEN}PASS${NC} (${deny_summary})"
        else
            echo -e "${GREEN}PASS${NC} (cargo-deny reported no failures)"
        fi
    elif printf '%s\n' "$deny_out" | grep -qiE 'failed to (fetch|clone|download)|could not (connect|resolve)|network|offline|Updating advisory database'; then
        # Network-class failure: the advisories were never evaluated. Yellow,
        # and worded so the line cannot be misread as a pass.
        echo -e "${YELLOW}⚠ SKIP (advisory database unreachable — supply chain NOT checked; this is not a pass)${NC}"
    else
        # A real finding. Advisory by design, on this repo's own reasoning from
        # the a11y leg below: a gate that arrives yellow gets disabled within a
        # day, so this reports and does not abort.
        echo -e "${YELLOW}WARN (cargo-deny findings — non-blocking, and NOT checked in any CI workflow)${NC}"
        printf '%s\n' "$deny_out" | tail -20
    fi
else
    echo -e "${YELLOW}⚠ supply chain advisories skipped (cargo-deny not installed — cargo install cargo-deny)${NC}"
fi

# ── Go: license-server (mirrors CI `go` job — auto-detected) ────────────
# The license-server is a Go service (auth, licensing, webhooks, revenue).
# CI gates on gofmt + go vet + `go test -short`; the local gate mirrors
# that so a push can't pass locally then fail CI. Only the -short suite
# runs here (the full suite runs nightly in CI).
if command -v go &>/dev/null && [ -f apps/license-server/go.mod ]; then
    step "go fmt" "gofmt -l apps/license-server" gofmt -l apps/license-server
    step "go vet" "go -C apps/license-server vet ./..." go -C apps/license-server vet ./...
    step "go test (short)" "go -C apps/license-server test -short ./..." go -C apps/license-server test -short ./...
else
    echo -e "${YELLOW}⚠ Go license-server checks skipped (go not found or apps/license-server missing)${NC}"
fi

# ── UI (mirrors CI `ui` job — auto-detected) ──────────────────────────────
# Windows can retain esbuild.exe briefly after a Vite/test process exits,
# causing npm ci's node_modules cleanup to fail with EPERM. Retry once after
# terminating only the known native helper; dependency-resolution failures
# still fail on the retry and remain visible to the caller.
npm_ci_with_windows_retry() {
    local npm_log; npm_log=$(mktemp)
    local first_status

    if npm ci --no-audit --no-fund --ignore-scripts >"$npm_log" 2>&1; then
        cat "$npm_log"
        rm -f "$npm_log"
        return 0
    else
        first_status=$?
    fi

    # Preserve ordinary npm failures verbatim. Only retry the known Windows
    # native-binary lock signatures; dependency and lockfile errors must fail
    # immediately instead of killing an unrelated process.
    if ! grep -q 'EPERM' "$npm_log" || \
       ! grep -qiE 'esbuild\.exe|rollup[^[:space:]]*\.node' "$npm_log"; then
        cat "$npm_log" >&2
        rm -f "$npm_log"
        return "$first_status"
    fi

    # esbuild is a standalone native helper and can be safely terminated.
    # Rollup's native module is loaded by Node itself, so never terminate all
    # node.exe processes; just allow its transient file handle to clear.
    if grep -qi 'esbuild\.exe' "$npm_log" && command -v taskkill.exe &>/dev/null; then
        MSYS_NO_PATHCONV=1 taskkill.exe /F /IM esbuild.exe >/dev/null 2>&1 || true
    fi
    sleep 2
    rm -f "$npm_log"
    npm ci --no-audit --no-fund --ignore-scripts
}

if command -v npm &>/dev/null && [ -f ui/package-lock.json ]; then
    cd ui
    step "npm ci" "cd ui; npm ci --no-audit --no-fund --ignore-scripts" npm_ci_with_windows_retry
    step "ui lint" "cd ui; npm run lint" npm run lint
    step "ui typecheck" "cd ui; npm run typecheck" npm run typecheck
    step "ui test" "cd ui; npm run test" npm run test
    # R36-01: the suite above runs in this machine's zone, so a host-local date
    # anchor can pass here and fail on a UTC CI runner. Re-runs the analytics
    # anchor test under four zones and requires identical results.
    step "analytics tz invariance" "python3 scripts/check-tz-invariance.py" python3 ../scripts/check-tz-invariance.py
    # AUDIT-27 CI-06: A11y regression suite (advisory). Never fails the gate —
    # reports status only, because known product-level a11y bugs are tracked but
    # not yet fixed and a blocking gate here would be disabled within a day.
    # This used to say it "mirrors CI's continue-on-error", and the WARN line used
    # to tell the developer to "see CI". Both were false: `git grep a11y
    # .github/workflows/dev-ci.yml` returns nothing, and AGENTS.md states plainly
    # that E2E, a11y, security and nightly suites are NOT enforced in CI. So this
    # run is the only place a11y is ever checked -- a green Dev CI is no evidence it
    # passed. Recorded in scripts/gates.json -> "a11y-advisory".
    echo -n "ui a11y (advisory)... "
    if npm run test:a11y >/dev/null 2>&1; then
        echo -e "${GREEN}PASS${NC}"
    else
        echo -e "${YELLOW}WARN (a11y regressions exist — non-blocking, and NOT checked in CI)${NC}"
    fi
    # i18n lint: runs AFTER ui test (which proves vitest works) but
    # BEFORE ui build (which is ~30s). Fail-fast on a ~1s lint check
    # so contributors don't pay the full build cost for a translation
    # gap. Detects translation gaps and Fluent key duplicates in
    # `shared-ui/locales/*.id.ftl` before they reach CI.
    cd ..
    step "i18n lint" "bash scripts/lint-i18n.sh" bash scripts/lint-i18n.sh
    # AUDIT-27 CI-06: FTL dedupe — detect duplicate Fluent keys so local
    # validation matches check-ui.mjs and the pre-commit gate.
    step "ftl dedupe" "python3 scripts/dedupe-ftl.py" python3 scripts/dedupe-ftl.py
    # Orphan gate: its own liveness cases must pass, and the whole-tree candidate count
    # should be visible locally too, not just in CI. The blocking form of this check is
    # staged-scoped in the pre-commit hook; here it runs the self-test and census.
    step "ftl orphans" "python3 scripts/verify-ftl-orphans.py --self-test" \
        python3 scripts/verify-ftl-orphans.py --self-test
    step "feature registry parity" "python3 scripts/verify-feature-registry.py" python3 scripts/verify-feature-registry.py
    # Topology contract parity — the vendored kasirmu-core copy and the UI copy
    # must stay byte-identical (both sides of the IPC boundary read it).
    step "topology contract parity" "python3 scripts/verify-topology-parity.py" python3 scripts/verify-topology-parity.py
    # npm run build skipped — typecheck + vitest already cover correctness;
    # the production vite bundle is validated by CI independently.
    # AUDIT-27 CI-07: E2E is NOT run here (Docker backend not provisioned).
    # Run `cd ui && npm run check:all` (uses npm run e2e with full
    # Docker+Vite provisioning) or `npm run e2e` directly for managed E2E.
else
    echo -e "${YELLOW}⚠ UI checks skipped (npm not found or ui/package-lock.json missing)${NC}"
fi

# ── Website (mirrors CI website.yml `check` job — auto-detected) ─────────
# Review follow-up (H2): the admin/dashboard SPA helpers (admin-utils.js)
# and the worker auth gate have vitest suites that previously ran nowhere
# but a manual `npm test`. Gate: scripts/gates.json → "website-tests".
if command -v npm &>/dev/null && [ -f website/package-lock.json ]; then
    cd website
    if [ ! -d node_modules ]; then
        step "website npm ci" "cd website; npm ci --no-audit --no-fund" npm ci --no-audit --no-fund
    fi
    step "website test" "cd website; npm test" npm test
    cd ..
else
    echo -e "${YELLOW}⚠ Website checks skipped (npm not found or website/package-lock.json missing)${NC}"
fi

# Asset hygiene is stdlib-only, so it runs even when npm is unavailable above.
# Gate: scripts/gates.json → "website-assets".
step "website assets" "python3 scripts/verify-website-assets.py" python3 scripts/verify-website-assets.py

# ── Plugin guide / API parity (PLG-10 tail; Rust-side, always runs) ─────
step "plugin-guide parity" "python3 scripts/verify-plugin-guide-parity.py" python3 scripts/verify-plugin-guide-parity.py

# ── Windows config drift (AUDIT-28) — NSIS installMode + asInvoker ─────
# Static gate that runs on every local pre-CI run: tauri.conf.json must
# keep NSIS installMode at currentUser (perMachine reintroduces the UAC
# prompt) and every source app.manifest must carry asInvoker. The PE scan
# of actually-built Windows exes is enforced in release.yml's Windows job.
step "windows config drift" "python3 scripts/verify-windows-config.py" python3 scripts/verify-windows-config.py

# ── Release toolchain (AUDIT-28 RELEASE-04/05/06) — node self-tests ────
# Validates the release scripts on every local gate run, not only in CI:
# the tag↔version gate, the updater-manifest generator, and the signature
# verifier each carry a --self-test (mirroring release.yml's
# release-validate + release-publish self-test steps).
if command -v node &>/dev/null; then
    step "release version gate" "node scripts/check-release-version.mjs --self-test" node scripts/check-release-version.mjs --self-test
    step "updater manifest generator" "node scripts/generate-latest-json.mjs --self-test" node scripts/generate-latest-json.mjs --self-test
    step "updater signature verifier" "node scripts/verify-updater-signature.mjs --self-test" node scripts/verify-updater-signature.mjs --self-test
else
    echo -e "${YELLOW}⚠ release toolchain checks skipped (node not found)${NC}"
fi

# ── Unified image healthcheck script test ────────────────────────────
# The Docker HEALTHCHECK in the unified image fails the container when the
# SMTP sender-identity probe stays broken for N consecutive runs; this
# exercises that counter logic against a fake-wget harness (see
# apps/unified/test-healthcheck.sh).
step "healthcheck script test" "sh apps/unified/test-healthcheck.sh" sh apps/unified/test-healthcheck.sh

# ── CI docs drift (AUDIT-27 CI-08) — docs/ci-pipeline.md must stay in
# sync with the workflows and the local runner gate vocabulary. The gate
# names + status derive from scripts/gates.json (the single source of
# truth shared with ci.yml, nightly.yml, and check:all). Mirrors the
# `ci-docs-drift` CI job; a named-but-missing job, a drifted
# check.sh/check:all gate, or a status that contradicts a workflow
# fails the gate.
# The router decides whether every other job runs, so it gets a regression test:
# scripts/test-ci-routing.sh extracts the Route shell body from dev-ci.yml and
# runs it against 15 synthetic diffs. c5ec6381 shipped the router with no
# committed test while the release notes claimed one existed.
# Gate: scripts/gates.json -> "ci-routing-test".
step "ci routing test" "bash scripts/test-ci-routing.sh" bash scripts/test-ci-routing.sh

step "ci docs drift" "python3 scripts/verify-ci-docs-drift.py" python3 scripts/verify-ci-docs-drift.py
# This is the gate that polices every other gate's CI claim, and until 0.0.37 it
# was the only one of the family with no self-test -- six siblings carry one and
# this did not. It now mutates four of its own classifiers and requires each to be
# noticed, plus a control that must still pass, so "the drift gate is green" cannot
# mean "the drift gate stopped looking".
step "ci docs drift self-test" "python3 scripts/verify-ci-docs-drift.py --self-test" python3 scripts/verify-ci-docs-drift.py --self-test
# scripts/__tests__/*.test.mjs is a whole suite that ui/package.json exposes as
# `npm run test:scripts` and that NOTHING invoked -- not the hook, not CI, not check.sh.
# It had been red for an unknown period for exactly that reason: verify-ci-docs-drift.test.mjs
# built a fixture writing docs/ci-pipeline.md after the doc moved to docs/operations/, and
# asserted on a `## Job Matrix (ci.yml)` heading whose suffix had been dropped, so its
# mutation became a no-op. pipefail.test.mjs read the retired ci.yml and nightly.yml (ENOENT)
# and used bare `bash`, which on Windows is WSL and hangs instead of failing.
# Both are fixed, so the whole glob is wired -- not one file at a time. A suite that has to be
# cherry-picked into a gate is a suite whose failures are being negotiated file by file, and
# the only reason either of these stayed red was that nothing ran them.
step "script tests" "node --test scripts/__tests__/*.test.mjs" node --test scripts/__tests__/*.test.mjs
# The drift gate checks that a runner label matches SOME step, using any-of -- so a
# gate declaring three labels was satisfied by one, and deleting the other two left
# gates.json asserting guards that no longer existed while the checker printed
# "0 drift item(s)". The rule is now per-needle; this proves it stays that way, and
# proves the fixture is live (ROOT comes from __file__, so a fixture that forgot to
# copy the checker itself would silently test the real repo and agree with itself).
# Gate: scripts/gates.json -> "runner-labels".
step "runner labels" "python3 scripts/test-runner-labels.py" python3 scripts/test-runner-labels.py

# Gate: scripts/gates.json -> "bundle-parity".
step "bundle parity" "python3 scripts/verify-bundle-parity.py --scan-dirs features,components,app,theme,registries,contexts,hooks" python3 scripts/verify-bundle-parity.py --include-getstring --include-nav-keys --include-key-fields --include-dynamic-literals --include-id-maps --check-domain-pairs --scan-dirs features,components,app,theme,registries,contexts,hooks

# ── Migration correctness (steps 6 and 7 of the pre-commit hook) ───────────
# Both lived in ci.yml, retired to .bak by 23c96330, and were never restored in
# dev-ci.yml -- and, as this file proves, they were never in check.sh either. So
# the ONLY guard was the opt-in pre-commit hook, and core.hooksPath is set by
# scripts/setup-dev.ps1 without being versioned: a fresh clone that skips setup
# could hand-edit 20260813_init.pg.sql (a generated file) or add a float column for
# an exact-decimal amount, and merge it clean. AGENTS.md documented the CI half of
# that hole in three places and nobody closed it. Both are pure text comparison --
# no Docker, no psycopg, no sqlite handle -- and cost ~1.1s together, so there was
# never a build-time reason to leave them out.
# Gate: scripts/gates.json -> "pg-schema-drift", "migration-column-types".
step "pg schema drift" "python3 scripts/generate-pg-migration.py --check" python3 scripts/generate-pg-migration.py --check
step "migration column types" "python3 scripts/verify-migration-column-types.py" python3 scripts/verify-migration-column-types.py

# ── Document uniqueness (R36-14) ────────────────────────────────────────────
# f3d9cca6 moved the repo-root subscription-tiers.md into docs/records/ without
# noticing docs/guides/ already had a copy from 28147fe4 -- leaving two tracked
# files, both stamped "single source of truth" for pricing, whose entitlement
# tables disagree. Nothing detected it, because no gate compared documents to
# each other. This one does, and it is scoped to docs/ with conventional names
# (README/SKILL/AGENTS) excluded, so it does not cry wolf on normal structure.
# Carries a pair-specific baseline for the one known finding, so a NEW duplicate
# still fails. --self-test proves the detector fires and stays quiet correctly.
# Gate: scripts/gates.json -> "doc-uniqueness".
step "doc uniqueness" "python3 scripts/verify-doc-uniqueness.py" python3 scripts/verify-doc-uniqueness.py
step "doc uniqueness self-test" "python3 scripts/verify-doc-uniqueness.py --self-test" python3 scripts/verify-doc-uniqueness.py --self-test

# ── Pre-commit EOL net (R36-15) ────────────────────────────────────────────
# The hook's line-ending step filtered on `git check-attr text` alone, which is
# wrong twice over: it ignored `*.bat text eol=crlf` and stripped CRLF from the
# working tree (phantom-dirty `git status`), and `text=auto` reports "auto" for
# binaries, so a staged PNG had its signature's 0D 0A deleted and the mangled
# blob re-staged. Both are silent data corruption behind a green hook. The test
# extracts the live guard from .githooks/pre-commit rather than copying it, so it
# cannot drift from the thing it polices.
# Gate: scripts/gates.json -> "eol-guard".
step "eol guard" "bash scripts/test-eol-guard.sh" bash scripts/test-eol-guard.sh

# The UI typecheck gate in .githooks/pre-commit only fires when a commit stages
# ui/src TypeScript, so on a Rust-only or docs-only release branch it can go many commits
# without ever being exercised -- and a gate that never runs is indistinguishable from one
# that was deleted. This proves it still fires: it extracts the live step from the hook and
# drives it against a throwaway git repo with a stubbed npm.
# Gate: scripts/gates.json -> "typecheck-gate".
step "typecheck gate" "bash scripts/test-typecheck-gate.sh" bash scripts/test-typecheck-gate.sh

# .githooks/post-commit refreshes the codebase-memory graph on every commit. It
# ran 535 commits without indexing once and nothing reported it: it resolved the
# indexer off PATH onto a stale build that refuses to join a newer running
# daemon, and sent the 30s handshake failure to /dev/null. Same lesson as the two
# guards above -- a hook step that fails silently is indistinguishable from one
# that was deleted -- plus a second hazard: a 'nul' ghost in the repo root (what
# '2> nul' makes under Git bash) aborts discovery before .cbmignore applies.
# Gate: scripts/gates.json -> "cbm-hook-guard".
step "cbm hook guard" "bash scripts/test-cbm-hook.sh" bash scripts/test-cbm-hook.sh

# ── AGENTS.md mirror truthfulness ──────────────────────────────────────────
# Three copies of the agent rules exist and `bump-version.ps1` syncs only their
# version lines. Twice in 0.0.36 a mirror stated something the repo contradicted:
# `.agents/AGENTS.md` said Go had no CI backstop after dev-ci.yml#static-gates
# started running it, and root AGENTS.md said dev-ci runs on push when it has no
# push trigger. A mirror that governs work under `.agents/` and tells agents their
# changes are unguarded is not a cosmetic problem. Ground truth is read from the
# hook, the workflows and Cargo.toml, never asserted -- so adding a gate or
# bumping the version updates the expectation without editing this script.
# --self-test mutates each mirror and requires a named finding, and reports a
# mutation that changes nothing as WRONG rather than passing because its fixture
# no longer applies.
# Gate: scripts/gates.json -> "agents-mirrors".
step "agents mirrors" "python3 scripts/verify-agents-mirrors.py" python3 scripts/verify-agents-mirrors.py
step "agents mirrors self-test" "python3 scripts/verify-agents-mirrors.py --self-test" python3 scripts/verify-agents-mirrors.py --self-test

# ── Conventional-commit subjects ───────────────────────────────────────────
# .githooks/commit-msg enforces the subject format locally, but core.hooksPath is
# set by setup-dev.ps1 and is not versioned, so a clone that skips setup has no
# subject gate. The hook's own header names four commits on this range whose
# entire message is a pasted `git status --porcelain` block -- those are why the
# hook exists, and they are exactly what this finds. The rule (type list, regex,
# and the Merge/Revert/fixup/squash/amend exemptions) is EXTRACTED from the hook
# at run time, so local and CI cannot disagree about what is legal.
# Commits older than the hook's introduction are skipped, derived from
# `git log --diff-filter=A` on the hook rather than a hardcoded sha.
# Gate: scripts/gates.json -> "commit-subjects".
step "commit subjects" "python3 scripts/verify-commit-subjects.py --range main..HEAD" python3 scripts/verify-commit-subjects.py --range main..HEAD
step "commit subjects self-test" "python3 scripts/verify-commit-subjects.py --self-test" python3 scripts/verify-commit-subjects.py --self-test

# ── Release workflow validation (R36-11) ──────────────────────────────────
# release.yml was renamed to .bak by 23c96330 with an empty commit message and
# nothing replaced it, so tagging produced no installers for a release cycle.
# A workflow that never runs cannot report its own breakage, so this checks
# statically what needs no tag, no key material and no macOS/Windows runner:
# action pins, referenced paths, docker residue, an inventory gate demanding an
# artifact no matrix entry builds, and that a missing UPDATER_PRIVATE_KEY still
# hard-fails rather than publishing an unsigned manifest every client rejects.
# --self-test mutates eight of those guarantees and requires each to be caught,
# so a regression cannot silently turn the gate into a no-op.
# Gate: scripts/gates.json -> "release-workflow".
step "release workflow validation" "python3 scripts/verify-release-workflow.py" python3 scripts/verify-release-workflow.py
step "release workflow self-test" "python3 scripts/verify-release-workflow.py --self-test" python3 scripts/verify-release-workflow.py --self-test

# ── Docker build smoke test (optional: --docker-dry-run) ──────────────────
if [ "${1:-}" = "--docker-dry-run" ]; then
    if command -v docker &>/dev/null; then
        step "docker build" "docker build -f ops/docker/Dockerfile.server -t kasir-cloud:local ." docker build -f ops/docker/Dockerfile.server -t kasir-cloud:local .

        SIZE=$(docker run --rm --entrypoint stat kasir-cloud:local --format=%s /app/kasirmu-cloud 2>/dev/null || echo "0")
        if [ "$SIZE" -gt "0" ]; then
            MAX=$((50 * 1024 * 1024))
            if [ "$SIZE" -gt "$MAX" ]; then
                echo -e "${RED}Binary size $SIZE exceeds 50 MB limit${NC}"
                exit 1
            fi
            echo -e "${GREEN}Binary size: $((SIZE / 1024 / 1024)) MB (OK)${NC}"
        else
            echo -e "${YELLOW}⚠ Could not verify binary size (container may have exited)${NC}"
        fi
    else
        echo -e "${YELLOW}⚠ Docker build skipped (docker not found)${NC}"
    fi
fi

# ── Done ──────────────────────────────────────────────────────────────────
total_end=$(date +%s)
echo -e "${GREEN}all checks passed ($((total_end - total_start))s)${NC}"

# ── Commit suggestion ─────────────────────────────────────────────────────
cat <<'COMMIT_GUIDE'

Now make a local commit:

  1. git add <files>     # stage only intended files
  2. git commit          # write a message following the guidelines below

Commit message guidelines:
  • Keep the summary line under 50 characters, imperative mood, no period
  • Leave a blank line after the summary
  • Use bullet points (- or *) for the body — focus on WHAT and WHY, not how
  • Reference related docs/decisions or issue numbers where relevant
  • Keep each bullet under 72 characters

Example:

    feat(sales): add deduction location override via PIN

    - Clicking the badge opens FastPINOverlay for PIN verification
    - Store method overrides deduction location with IMMEDIATE transaction
    - Badge shows "(Override)" indicator after successful override

    References ADR-19

COMMIT_GUIDE
