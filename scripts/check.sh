#!/usr/bin/env bash
# scripts/check.sh — the FULL local matrix, run by hand (bash scripts/check.sh).
# It is NOT what `git push` runs. .githooks/pre-push invokes
# scripts/run-pre-push.py and nothing else, and that script is a SUBSET of this
# one — its Tier 0 static gates plus path-routed cargo check, cargo fmt --check,
# ui typecheck, ui vitest, analytics timezone invariance, website checks and
# lint-i18n — and it never calls check.sh. So a red pre-push is not a failure of
# this matrix, and a green push does not mean these steps ran.
# Nothing here mirrors .github/workflows/ci.yml either: that workflow was
# retired to ci.yml.bak in 23c96330. There are FOUR live workflows, not two, and
# this line said "two" for months after the other two were reinstated:
#   dev-ci.yml    PRs and pushes to main
#   release.yml   v* tags
#   android.yml   restored by a9dca0610
#   website.yml   marketing site deploy
# Count them rather than trust this comment:
#   ls .github/workflows/*.yml
# See docs/operations/ci-pipeline.md, which has said four throughout.
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

    # CHECK_FROM: skip everything before step N without paying for it. The matrix has 120
    # steps and the first 36 take about 20 minutes, so re-running it from the top to reach
    # step 37 is how a late leg stays unverified for a hundred rounds. The comparison is
    # against this step's OWN number, before the increment, and the counter still advances
    # for skipped steps -- so a step number printed by a resumed run means exactly what it
    # means in a full one, and the log filename is unchanged. Set it only when you know the
    # earlier steps passed: this trusts you, it proves nothing.
    if [ -n "${CHECK_FROM:-}" ] && [ "${step_counter}" -lt "$CHECK_FROM" ]; then
        echo -n "${step_str}. skipping ${name} (CHECK_FROM=${CHECK_FROM})... "
        echo -e "${YELLOW}SKIPPED${NC}"
        step_counter=$((step_counter + 1))
        return 0
    fi
    step_counter=$((step_counter + 1))

    echo -n "${step_str}. checking ${name}... "

    # Keep the output instead of discarding it. This used to be `>/dev/null 2>&1`
    # plus a "re-run it by hand" hint, and that is precisely how the rustdoc step
    # stayed broken: it exited 127 on every single run, because `step` executes
    # "$@" and bash does NOT treat a word produced by parameter expansion as a
    # variable assignment -- so it went looking for a COMMAND named
    # `RUSTDOCFLAGS=-D warnings`, found none, and reported a bare FAIL. The hint
    # told the reader to re-run it and nobody ever did. One file per step, under
    # target/ so it stays out of the tracked tree, read back only on failure.
    local log_dir="${CHECK_LOG_DIR:-target/check-logs}"
    local slug; slug=$(printf '%s' "$name" | tr -c 'a-zA-Z0-9' '-')
    local log="${log_dir}/${step_str}-${slug}.log"
    mkdir -p "$log_dir"

    local start; start=$(date +%s)
    if ! "$@" >"$log" 2>&1; then
        echo -e "${RED}FAIL${NC}"
        echo "  --- last 25 lines of $log ---"
        tail -n 25 "$log" 2>/dev/null | sed 's/^/  /'
        echo "  --- full output above; re-run by hand: $retry_cmd ---"
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

# ── Rust (mirrors CI `cargo-check` + `cargo-nextest` jobs) ──────────────────────────────────────────
step "cargo fmt" "cargo fmt --all -- --check" cargo fmt --all -- --check

# Workspace-wide clippy (single compilation pass instead of N per-package invocations).
# Uses default features only — the `slow-tests` feature gates integration tests
# that don't need linting, and clippy doesn't benefit from compiling them.
step "clippy workspace" "cargo clippy --workspace --all-targets -- -D warnings" cargo clippy --workspace --all-targets -- -D warnings

# Rustdoc, mirroring the CI `rust-doc` job added with P2-4. `cargo doc` had NO
# runner anywhere -- not here, not in CI, not in release.sh -- so a broken
# intra-doc link was never a failure in any context. Measured 2026-09-28 the
# undeclared check was hiding 295 errors across 20 crates, six of which were
# docs describing APIs that do not exist. `--no-deps` keeps a dependency's own
# doc warnings from failing this step for a crate we do not own.
# Gate: scripts/gates.json -> "rust-doc".
# Notes that matter for this step specifically:
#  * The environment variable goes through `env`, not through a bare `VAR=value` word.
#    MEASURED 2026-09-29: `step ... RUSTDOCFLAGS='-D warnings' cargo doc ...` exits 127,
#    because `step` runs "$@" and bash does NOT treat a word produced by parameter
#    expansion as a variable assignment -- it looks for a COMMAND named
#    "RUSTDOCFLAGS=-D warnings" and finds none. The step could never pass, while the
#    comment below claimed its inline variable was load-bearing. `env` keeps both
#    properties: rustdoc really denies warnings, and nothing leaks into later steps.
#  * `RUSTDOCFLAGS` is set INLINE here, not exported, for the same reason the
#    clippy step passes `-- -D warnings` inline: an exported variable would leak
#    into every later step in this script.
#  * Passing it at all is load-bearing. Without it `cargo doc` reports warnings
#    and still exits 0, so the step would be decoration -- it would look like it
#    checked something and could never fail.
step "rustdoc (deny warnings)" "RUSTDOCFLAGS='-D warnings' cargo doc --workspace --no-deps" env RUSTDOCFLAGS='-D warnings' cargo doc --workspace --no-deps

# ── ADR #7 Phase 4: no raw store_id/user_id in command signatures ───────
step "no-raw-params (ADR #7 Phase 4)" "bash scripts/verify-no-raw-params.sh" bash scripts/verify-no-raw-params.sh

# ── H-1/H-2: every registered command has a _scoped variant or allowlist entry ──
step "scoped coverage (H-1)" "bash scripts/verify-scoped-coverage.sh" bash scripts/verify-scoped-coverage.sh

# ── H-1b: a _scoped variant must actually AUTHORIZE, not merely exist ────
# The check above stops at "a twin exists"; this one opens the twin. A _scoped
# fn reaching the store or HAL must call a permission helper, be named in a
# reasoned list, or carry an `// ungated-ok:` marker in its body.
step "scoped authorization (H-1b)" "bash scripts/verify-scoped-authorization.sh --strict" bash scripts/verify-scoped-authorization.sh --strict

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
step "ipc invoke token parity self-test" "python3 scripts/verify-invoke-parity.py --self-test" python3 scripts/verify-invoke-parity.py --self-test

# ipc-parity-allowlist.json records "UI command strings not yet registered in this shell", which
# covers two very different things: an ambient call sitting in an ADR #7 else-branch (dead surface,
# harmless) and an ambient call made unconditionally (a runtime `command not found` on that shell).
# The list cannot tell them apart, and one entry that looked like the first was the second --
# get_cart_deduction_location, which made every desktop sale with a stock-target item throw. This
# reads the allowlist, finds each command's wrapper and its production call sites, and fails on any
# call not sitting behind a token test.
step "scoped ambient reads" "python3 scripts/verify-scoped-reads.py --self-test" python3 scripts/verify-scoped-reads.py --self-test
step "unguarded ambient ipc calls" "python3 scripts/verify-scoped-reads.py" python3 scripts/verify-scoped-reads.py
# P3-3. P2-6 put `#![deny(unsafe_code)]` at 38 of 43 crate roots, so the crates
# that carry NO unsafe cannot grow any. The five that legitimately keep it
# (kasirmu-logging syslog/eventlog FFI, kasirmu-security CredWriteW,
# kasirmu-hal JNI/Bluetooth, kasirmu-lua Send/Sync impls, the Tauri shells'
# link_section) cannot be protected by a deny, and nothing checked their SAFETY
# comments -- measured 2026-09-27: no script and no gates.json entry mentioned
# SAFETY at all. This makes the justification mechanical instead of a
# reviewer's-eye exercise. Gate: scripts/gates.json -> "unsafe-safety".
step "unsafe safety comments" "python3 scripts/verify-unsafe-safety.py --self-test" python3 scripts/verify-unsafe-safety.py --self-test
step "unsafe safety comments (tree)" "python3 scripts/verify-unsafe-safety.py" python3 scripts/verify-unsafe-safety.py
# Ratchet on react-hooks/exhaustive-deps. `npm run lint` is `eslint .` with no --max-warnings 0, so
# it exits 0 while reporting 58 warnings -- and that rule is the ONLY automated check for a stale
# closure. Item 69 found five callbacks listing `userId`, which no component body ever read, while
# two of those same arrays omitted `promotionIds`, which is sent in the checkout payload. Neither was
# gated. This freezes the count at 7 (down from 12): it may go down, never up.
step "exhaustive-deps ratchet" "python3 scripts/verify-exhaustive-deps.py" python3 scripts/verify-exhaustive-deps.py
# measure()'s own cases, beside the ratchet they prove. Pure string parsing, so this
# step needs no node_modules and runs even where the step above cannot.
step "exhaustive-deps ratchet self-test" "python3 scripts/verify-exhaustive-deps.py --self-test" python3 scripts/verify-exhaustive-deps.py --self-test

# ── Architecture boundary checker (P1 pilot) ────────────────────────────
# Existing transitional debt is reported but only new, expired, or stale
# baseline entries fail. This is static-only and has no runtime impact.
step "architecture boundaries" "python3 scripts/verify-architecture-boundaries.py --strict" python3 scripts/verify-architecture-boundaries.py --strict
step "server origins" "node scripts/check-server-origins.mjs" node scripts/check-server-origins.mjs
step "env docs" "python .agents/skills/docs-auditor/scripts/check-env-docs.py" python .agents/skills/docs-auditor/scripts/check-env-docs.py
step "auditor self-tests" "sh scripts/check-auditor-selftests.sh" sh scripts/check-auditor-selftests.sh
# Every workspace member must be represented in BOTH Dockerfiles' cache stages.
# Orphaned until 2026-09-26 (review 12.2): it existed, worked, and passed, while two
# source files and a plan claimed it ran "in CI" -- and the unified image was in fact
# unbuildable from 2026-09-13 to 2026-09-18 with nothing to catch it.
step "dockerfile workspace" "python3 scripts/verify-dockerfile-workspace.py" python3 scripts/verify-dockerfile-workspace.py
step "dockerfile workspace self-test" "python3 scripts/verify-dockerfile-workspace.py --self-test" python3 scripts/verify-dockerfile-workspace.py --self-test
step "unified routes" "node scripts/check-unified-routes.mjs" node scripts/check-unified-routes.mjs

# ── Money formatting gate (IDR/JPY/KWD exp-2 regression guard) ───────────
# Fails when production .rs code hardcodes `/ 100` division or `{}.{:02}`
# format strings instead of foundation::format_minor(). Pure python — no
# toolchain deps, so it stays fast.
step "no-hardcoded-money-format" "python3 scripts/verify-no-hardcoded-money-format.py" python3 scripts/verify-no-hardcoded-money-format.py
step "no-hardcoded-money-format self-test" "python3 scripts/verify-no-hardcoded-money-format.py --self-test" python3 scripts/verify-no-hardcoded-money-format.py --self-test

# ── Test shadow-copy gate ──────────────────────────────────────────────
# A test file that redeclares a production function and asserts against its
# own copy cannot fail, no matter what the real code does. Five such suites
# were found in one sweep; one of them (KdsAutoAcceptLogic) had copied the
# in-flight guard onto the wrong field and annotated it "simplified", so its
# test named "rejects when order is in-flight" validated a rule the app does
# not implement. Pure python, no toolchain deps.
step "test shadow copies" "python3 scripts/verify-test-shadow-copies.py" python3 scripts/verify-test-shadow-copies.py
step "test shadow copies self-test" "python3 scripts/verify-test-shadow-copies.py --self-test" python3 scripts/verify-test-shadow-copies.py --self-test

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
    # P0-2. The receipt above is only as trustworthy as the checker producing it:
    # a regression inside verify-pg-tests-ran.py grades every future flake wrongly
    # while still printing an authoritative-looking verdict. This self-test runs
    # the checker's own census and grading rules against planted fixtures, so it
    # is the one thing that can catch the checker going stale. Gate:
    # scripts/gates.json -> "pg-receipt-selftest".
    step "pg receipt self-test" "python3 scripts/verify-pg-tests-ran.py --self-test" python3 scripts/verify-pg-tests-ran.py --self-test
    # The two application shells are excluded from the workspace run above, because their
    # unit tests LINK the Tauri runtime (the desktop test binary embeds the Common-Controls v6
    # manifest via .drectve for exactly this reason). Excluded there, they were run by nothing:
    # measured 2026-09-29, neither this script nor any .github/workflows file named kasirmu-app
    # or kasirmu-mobile, so 863 tests -- 173 desktop, 690 tablet -- had no automation at all.
    # `--lib` is load-bearing: without it cargo rebuilds the shell BINARY too, and a dev instance
    # holding target/debug/kasirmu-app.exe makes the step die on `failed to remove file` (measured
    # 2026-09-29) -- a gate that demands you stop the app first is a gate nobody runs. The unit
    # tests live in the lib target on both shells, so `--lib` covers them and nothing else is lost.
    #
    # NOT covered here, measured 2026-09-29: the desktop's six integration targets (tests/
    # gate_audit, wiring_audit, capability_parity, kernel_lifecycle, window_visibility,
    # window_state_multi_monitor). They link the shell BINARY, so building them needs
    # target/debug/kasirmu-app.exe replaced, which fails with `Access is denied` whenever a dev
    # instance is running -- as it normally is on this machine. A gate that fails because the app
    # is open is a gate people bypass, so they stay out of this step. CI builds from scratch, so CI
    # is where they belong; nothing gates them today.
    # Run them explicitly, AFTER the receipt above so this run cannot overwrite the JUnit report
    # that step grades (nextest writes target/nextest/default/junit.xml on every invocation).
    step "test application shells (nextest)" "cargo nextest run -p kasirmu-app -p kasirmu-mobile --lib --all-features" cargo nextest run -p kasirmu-app -p kasirmu-mobile --lib --all-features
else
    echo -e "${YELLOW}⚠ nextest not found — falling back to cargo test (slower)${NC}"
    step "test workspace" "cargo test --workspace --all-features -- --test-threads $cpu_count" cargo test --workspace --all-features -- --test-threads "$cpu_count"
    # The same two shells in the fallback branch; see the note in the nextest branch above.
    step "test application shells" "cargo test -p kasirmu-app -p kasirmu-mobile --lib --all-features -- --test-threads $cpu_count" cargo test -p kasirmu-app -p kasirmu-mobile --lib --all-features -- --test-threads $cpu_count
fi

# ── Fuzz targets (P0-3) ──────────────────────────────────────────────────
#
# The seven fuzz targets are compiled by nothing at runtime on this platform:
# libFuzzer + AddressSanitizer has no MSVC runtime in the nightly toolchain, so
# `cargo fuzz build` cannot link here. What CAN run anywhere is the typecheck,
# and that is the half which catches the failure mode that actually occurred --
# four path dependencies pointing at a non-existent `tools/foundation`, which
# killed `cargo fuzz build` at MANIFEST LOAD and left every target unreachable
# with no compile error to notice. `--all-features` is load-bearing: three of
# the seven (cart_deser, kasirpkg_parse, manifest_parse) sit behind
# kasirmu-core-fuzz / kasirmu-plugin-fuzz. Gate: scripts/gates.json ->
# "fuzz-typecheck".
if command -v cargo >/dev/null 2>&1; then
    step "fuzz typecheck" "cargo +nightly check --bins --all-features (in tools/fuzz)" bash -c 'cd tools/fuzz && cargo check --bins --all-features'
else
    echo -e "${YELLOW}⚠ cargo not found — skipping fuzz typecheck${NC}"
fi

# ── Coverage floors (P1-2) ───────────────────────────────────────────────
#
# Ratchet, not target: each floor sits 2 points below the value measured
# 2026-09-27 (foundation 99.4, core 83.8, inventory 78.4, sync 68.7), so the
# gate freezes the level reached without demanding unfunded work.
#
# Two-stage on purpose. `cargo llvm-cov` is expensive and ABORTS on any
# failing test, so it is guarded by a capability check and its failure is
# reported as "could not measure" rather than "coverage regressed" — those
# are different problems and conflating them would send a reader hunting for
# missing tests when the suite is simply red. The GRADING step is the cheap,
# offline, unit-tested part.
#
# Gate: scripts/gates.json -> "coverage-floors".
if command -v cargo-llvm-cov >/dev/null 2>&1 && command -v llvm-cov >/dev/null 2>&1; then
    # `cargo llvm-cov nextest`, not plain `cargo llvm-cov`. The plain form drives `cargo
    # test`, which cannot see the nextest test group (.config/nextest.toml) that serializes
    # the shared-Postgres tests, and has no per-test timeout at all. The first half is
    # measured: the plain form died on
    # `sync_store::tests::pg_integration_conflict_detection_end_to_end` (apps/cloud-server/
    # src/sync_store_tests.rs:1256), one of the very tests that group serializes, and the
    # floors then went ungraded behind a warning. The second half is a property, not an
    # observation: `cargo test` has no timeout, so a wedged test COULD hold this step (and
    # therefore the whole gate) forever. The nextest subcommand keeps the group, the 120s
    # slow-timeout and per-test process isolation, and measured 773s for the full workspace
    # against the plain form's single-invocation failure. One invocation, not the two-pass
    # split this step briefly carried.
    #
    # CORRECTION 2026-09-29: an earlier version of this comment claimed the plain form
    # HUNG, on a bridge test binary that "burned 14,873 CPU-seconds in 15 minutes". That
    # was wrong and the measurement says so: a serial bridge run completed 904 of its 1422
    # tests in a 900s timeout (~1s each, slow not stuck), and ~15,000 CPU-seconds across
    # 16 threads over 15 minutes is ordinary for a suite that needs 960s under nextest. I
    # killed a run that was still working. The reason to use nextest stands on the measured
    # race, not on a hang that never happened.
    if cargo llvm-cov nextest \
        --workspace --all-features \
        --exclude kasirmu-app --exclude kasirmu-mobile \
        --json --output-path coverage-probe.json >/dev/null 2>&1; then
        step "coverage floors" "scripts/coverage-floors.json (ratchet)" python3 scripts/verify-coverage-floors.py
        step "coverage floors self-test" "python3 scripts/verify-coverage-floors.py --self-test" python3 scripts/verify-coverage-floors.py --self-test
    else
        echo -e "${YELLOW}⚠ cargo llvm-cov could not complete (a failing test aborts it) — floors NOT checked${NC}"
    fi
    # The probe is a byproduct, not an artifact: leaving it behind makes the root-policy
    # gate red on a file this script wrote itself (measured 2026-09-28).
    rm -f coverage-probe.json
else
    echo -e "${YELLOW}⚠ cargo-llvm-cov or llvm-cov not installed — coverage floors NOT checked${NC}"
fi

# ── Migration (LOCAL ONLY — no CI job runs this) ──────────────────────────
# This comment used to read "mirrors CI `migration` job". There is no such job:
# dev-ci.yml's eighteen jobs are changes, website, rust-fmt, cargo-check, cargo-clippy, rust-doc, fuzz-typecheck,
# coverage-floors, cargo-nextest, release-bridge-test (push-only), ui-test, i18n, ci-docs-drift, static-gates, go-gate,
# ipc-parity, release-readiness, northflank-deploy. The
# confusion is understandable because two neighbouring gates DO have CI backing since
# 0.0.37 (pg-schema-drift and migration-column-types, both in static-gates), but this
# one is the SQLite migrate-up path and nothing enforces it off a developer machine.
# Recorded in scripts/gates.json -> "migration".
step "migration smoke test" "cargo run -p kasirmu-cli -- migrate" cargo run -p kasirmu-cli -- migrate
step "migration idempotency" "cargo run -p kasirmu-cli -- migrate" cargo run -p kasirmu-cli -- migrate
rm -f var/kasir.db var/kasir.db-wal var/kasir.db-shm

# ── Skill drift guard (blocking in CI too: dev-ci.yml#static-gates) -------
if command -v bash &>/dev/null; then
    step "skill-drift-guard" "bash .agents/skills/skill-drift-guard/scripts/detect.sh --report" bash .agents/skills/skill-drift-guard/scripts/detect.sh --report
    # The 32 bats tests behind that guard. Skipped with a warning, not failed,
    # when bats is absent -- the same bargain every other optional dependency
    # here makes. They cost ~3 minutes, so check.sh runs them and CI does too.
    if command -v bats &>/dev/null; then
        step "skill-drift-guard-tests" "bash .agents/skills/skill-drift-guard/scripts/run-tests.sh" bash .agents/skills/skill-drift-guard/scripts/run-tests.sh
    else
        echo -e "${YELLOW}⚠ skill-drift-guard-tests skipped (bats not found)${NC}"
    fi
else
    echo -e "${YELLOW}⚠ skill-drift-guard skipped (bash not found)${NC}"
fi

# ── Font-claims gate ─────────────────────────────────────────────────────
# check-font-claims.mjs executes the font lane's published claims instead of
# trusting their prose: it re-runs each claim's command and compares against
# the expectation stated HERE. It had NO caller at all until now -- the only
# job that ever ran it was retired to .github/workflows/attic/ci.yml.bak --
# which is the failure its own header names: "A documented check nobody
# executes becomes a description of a past run." 17 s locally. Node is a hard
# requirement of this repo, so unlike the bats step above there is no skip
# branch: a missing node is a broken checkout, not an optional dependency.
step "font-claims" "node scripts/check-font-claims.mjs" node scripts/check-font-claims.mjs

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

# ── Debt-marker gate — every TODO id must resolve to a plan definition ──
# A marker whose work shipped is a dead pointer; a marker whose id resolves
# nowhere is a citation to a document nobody can open. Both are invisible to
# the compiler, the tests, and the docs-dead-refs checker (it grades
# packages and paths, not debt ids). Shipped required with 0 findings, so the
# step has a green baseline from day one.
step "debt markers" "python3 scripts/verify-debt-markers.py" python3 scripts/verify-debt-markers.py
step "debt markers self-test" "python3 scripts/verify-debt-markers.py --self-test" python3 scripts/verify-debt-markers.py --self-test

# ── Namespace governance — soft rules for module seams (Round 4) ────────
# ADR-62 named the seams; docs/architecture/module-namespace-governance.md names
# the RULES and freezes today's debt as data. Deliberately SOFT: all modules share
# one SQLite connection, so a namespace violation is not yet mechanically
# expressible, and a strict gate now would fail on legitimate existing edges. This reports Rule 1 (cross-vertical
# raw SQL) and Rule 2 (unclassified handler) and fails on a NEW finding; the one
# remaining cross-vertical edge is baselined and carries a grant marker in
# scripts/namespace-governance-baseline.json. Phase 4 P4.5 flipped this step to
# --strict, so an undeclared dependency (Rule 3) now blocks too -- the population
# is clean (0 undeclared edges at flip time), so strict means "stay clean", not
# "fail on the existing tree". A gate whose parsers silently break checks
# nothing, so the self-test runs beside it (verify-selftests-wired.py).
step "namespace governance" "python3 scripts/verify-namespace-governance.py --strict" python3 scripts/verify-namespace-governance.py --strict
step "namespace governance self-test" "python3 scripts/verify-namespace-governance.py --self-test" python3 scripts/verify-namespace-governance.py --self-test

# ── Ownership map parity — one source, three consumers (Phase 2) ───────────
# The table->module map had two hand-maintained copies (governance doc §3 prose
# and TABLE_OWNERS in verify-namespace-governance.py). Phase 2 needs a Rust copy
# so the runtime NamespacedStore check reads the same map; a third hand-edited
# list is what drifts. modules/ownership.json is now the ONE source:
#   • scripts/generate-ownership-map.mjs -> crates/kasirmu-core/src/db/ownership.rs
#   • verify-namespace-governance.py TABLE_OWNERS (--check-ownership)
# --check on the generator (and --check-ownership on the checker) fail on drift.
step "ownership map generate check" "node scripts/generate-ownership-map.mjs --check" node scripts/generate-ownership-map.mjs --check
step "ownership map parity" "python3 scripts/verify-namespace-governance.py --check-ownership" python3 scripts/verify-namespace-governance.py --check-ownership

# ── Capability parity — manifests declare exactly what they may touch (Phase 4)
# A module manifest's `capabilities` set is now mechanical: `read:<id>` and
# `write:<id>` for its own namespace when it owns tables (modules/ownership.json),
# plus `read:<dep>` for every entry in its `dependencies`. Before this gate the
# field was free text, so an undeclared cross-namespace grant was indistinguishable
# from a declared one. verify-namespace-governance.py --check-capabilities derives
# the expected set and fails on any drift; --emit-capabilities rewrites the
# manifests. This is the manifest half of the strict enforcement Phase 4 targets
# (the runtime NamespacedStore check is the other half).
step "capability parity" "python3 scripts/verify-namespace-governance.py --check-capabilities" python3 scripts/verify-namespace-governance.py --check-capabilities

# ── Core size ratchet — the extraction has a number (Phase 3) ──────────────
# The plan's boundary rule is that crates/kasirmu-core must not grow as modules
# move out. Without a measured ceiling that rule is reversible by accident: new
# logic lands back in core and nothing notices. This counts NON-BLANK production
# lines under crates/kasirmu-core/src, minus whole test files and inline
# #[cfg(test)] mod blocks, and fails when the count rises above
# scripts/core-size-baseline.json. LOWERING the ceiling is a deliberate edit,
# exactly how a retired namespace edge leaves namespace-governance-baseline.json.
# Mutation-proven (adding three lines to audit.rs fails with +3). The self-test
# runs beside it (verify-selftests-wired.py).
step "core size ratchet" "python3 scripts/verify-core-size.py" python3 scripts/verify-core-size.py
step "core size ratchet self-test" "python3 scripts/verify-core-size.py --self-test" python3 scripts/verify-core-size.py --self-test

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

# ── Go: license-server (mirrors the Go steps in CI `static-gates` — auto-detected) ────────────
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

# ── UI (mirrors CI `ui-test` job — auto-detected) ──────────────────────────────
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
    # AUDIT-27 CI-06 / C24: the a11y suite itself is NOT advisory in CI -- it
    # cannot be, because `ui-test` runs `cd ui && npm test` (dev-ci.yml), which is
    # plain `vitest run` with `exclude: ['e2e/**', 'node_modules/**']`, so every
    # file under src/__tests__/a11y/ executes there and any axe violation fails
    # the job. Verified by injecting an unnamed <button> and watching the suite
    # exit 1.
    #
    # What IS advisory is this *second* run: it exists to give a fast, verbose
    # local report before the full suite, and it stays non-fatal so a developer
    # gets the axe detail without losing the rest of the gate. (The earlier text
    # here claimed a11y was checked nowhere but here, citing that no workflow
    # contains the string "a11y" -- true, but it was looking for a dedicated job
    # rather than the suite's actual execution path.)
    #
    # The real C24 gap is coverage, not enforcement: each screen's suite asserts
    # ONE rendered state, so conditional subtrees (e.g. the PIN pad, reached only
    # after the username step) are never scanned. A mouse-only <tr> survived here
    # for exactly that reason; its keyboard path is now pinned in
    # ui/src/__tests__/TransactionLogScreen.test.tsx. Recorded in
    # scripts/gates.json -> "a11y-advisory".
    echo -n "ui a11y (advisory local re-run)... "
    if npm run test:a11y >/dev/null 2>&1; then
        echo -e "${GREEN}PASS${NC}"
    else
        echo -e "${YELLOW}WARN (a11y regressions — this run is advisory, but ui-test fails CI on the same suite)${NC}"
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
step "feature registry parity self-test" "python3 scripts/verify-feature-registry.py --self-test" python3 scripts/verify-feature-registry.py --self-test
    # Topology contract parity — the vendored kasirmu-core copy and the UI copy
    # must stay byte-identical (both sides of the IPC boundary read it).
    step "topology contract parity" "python3 scripts/verify-topology-parity.py" python3 scripts/verify-topology-parity.py
    # Phase 2's kind-derivation cases, beside the gate they prove. Pure dicts in,
    # list out; the corpus and both contract copies are never read.
    step "topology contract parity self-test" "python3 scripts/verify-topology-parity.py --self-test" python3 scripts/verify-topology-parity.py --self-test
    # npm run build skipped — typecheck + vitest already cover correctness;
    # the production vite bundle is validated by CI independently.
    # AUDIT-27 CI-07: E2E is NOT run here (Docker backend not provisioned).
    # Run `cd ui && npm run check:all` (uses npm run e2e with full
    # Docker+Vite provisioning) or `npm run e2e` directly for managed E2E.
else
    echo -e "${YELLOW}⚠ UI checks skipped (npm not found or ui/package-lock.json missing)${NC}"
fi

# ── Website (mirrors CI `dev-ci.yml#website` — auto-detected) ─────────
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

# Two checkers that had NO check.sh step at all, added 2026-09-29 together with
# verify-selftests-wired.py, which is what found them: both declared a --self-test
# that no runner invoked. The meta-gate goes first -- it is what keeps the next
# one from being the same finding again.
# check-chokepoints.py declares a --self-test that no runner invoked. Found by
# widening verify-selftests-wired.py from verify-* to check-* as well: the gate had been
# scoped to half the convention and so could not see this one. Local matrix only -- the
# checker is not a gate on the merge path, and adding one is a policy decision.
# A shell file that does not parse does not RUN, so every step inside it is
# skipped and nothing reports that. The cheapest gate in the tree, and the one that
# guards the most: sh -n parses without executing. Added 2026-09-29; it reported a
# real parse error in scripts/profile.sh on its first run, which is the whole point.
# The shell gate's sibling, and the higher-stakes one: a workflow that is not valid
# YAML RUNS NOTHING. GitHub reports it errored and executes none of its jobs, so the
# failure presents as a green PR that stopped checking -- not a red one. Only release.yml
# had a syntax check before this; dev-ci.yml, android.yml and website.yml had none.
step "workflow syntax" "python3 scripts/verify-workflow-syntax.py" python3 scripts/verify-workflow-syntax.py
step "workflow syntax self-test" "python3 scripts/verify-workflow-syntax.py --self-test" python3 scripts/verify-workflow-syntax.py --self-test

step "shell syntax" "python3 scripts/verify-shell-syntax.py" python3 scripts/verify-shell-syntax.py
step "shell syntax self-test" "python3 scripts/verify-shell-syntax.py --self-test" python3 scripts/verify-shell-syntax.py --self-test

# PowerShell has no shebang, so is_shell() cannot see it and this needs its own
# parser. The two gates disagree about nothing: both are the cheapest gate in the
# tree and both protect files that silently stop working when they do not parse.
# It refuses with exit 2 on a machine with no PowerShell rather than reporting a
# clean run it did not earn.
step "powershell syntax" "python3 scripts/verify-ps-syntax.py" python3 scripts/verify-ps-syntax.py
step "powershell syntax self-test" "python3 scripts/verify-ps-syntax.py --self-test" python3 scripts/verify-ps-syntax.py --self-test

step "chokepoints" "python3 scripts/check-chokepoints.py" python3 scripts/check-chokepoints.py
step "chokepoints self-test" "python3 scripts/check-chokepoints.py --self-test" python3 scripts/check-chokepoints.py --self-test

step "flaky quarantine" "python3 scripts/verify-flaky-quarantine.py" python3 scripts/verify-flaky-quarantine.py
step "flaky quarantine self-test" "python3 scripts/verify-flaky-quarantine.py --self-test" python3 scripts/verify-flaky-quarantine.py --self-test

# This gate ran in ci.yml and nightly.yml, both retired to .bak, and in no live runner
# since. It is wired HERE only -- a local-matrix step makes it runnable without claiming
# it is enforced on a merge, which is a policy decision and not this commit's to make.
# The self-test is beside it per the convention, and it is the piece that was missing:
# --self-test used to be REFUSED here, so the strict-argument rule that already had one
# documented silent fall-through had no way to be tested at all.
# Four NODE checkers declared a --self-test that no runner invoked. Widening
# verify-selftests-wired.py from verify-*.py/check-*.py to also match check-*/verify-*.mjs
# found them at once. The extension needs no judgement about which .mjs files are
# "checkers": the gate only asks whether a declared --self-test has a caller, and an
# uncalled self-test is uncalled whether or not its file is a gate. All four pass.
step "testid self-test" "node scripts/check-testid.mjs --self-test" node scripts/check-testid.mjs --self-test
step "release version self-test" "node scripts/check-release-version.mjs --self-test" node scripts/check-release-version.mjs --self-test
step "updater compat self-test" "node scripts/check-updater-compat.mjs --self-test" node scripts/check-updater-compat.mjs --self-test
step "updater signature self-test" "node scripts/verify-updater-signature.mjs --self-test" node scripts/verify-updater-signature.mjs --self-test

# verify-quota-coverage.sh declares a --self-test that no runner invoked. Found by
# extending verify-selftests-wired.py to .sh -- the same extension-shaped hole .mjs was
# two rounds earlier. NOTE WHAT THIS IS NOT: verify-quota-coverage.sh itself is one of
# the five unwired checkers in open finding GI-4, and it is still unwired. Running its
# self-test proves the checker works; it does not make the checker a gate, and it does
# not close GI-4. Wiring the checker is an owner's decision this commit does not make.
# The self-test is wired; the CHECKER IS DELIBERATELY NOT, and this line is here so a
# reader who greps check.sh for "quota" does not conclude the gate runs. Run by hand,
# verify-quota-coverage.sh exits 1 by design: it reports the seed_primary_store INSERT
# site, whose own comment says gating it "makes a fresh install unbootable, so this door
# is deliberately ungated for good rather than pending a gate". Its non-zero exit is a
# REPORT, not a verdict, so a blocking step here would fail every run on a decision that
# was taken on purpose. Same shape as the docker-digests gate. Provenance and the full
# reasoning: docs/records/audit-open-findings.md, finding GI-4.
step "quota coverage self-test" "bash scripts/verify-quota-coverage.sh --self-test" bash scripts/verify-quota-coverage.sh --self-test

# The two SQLite maintenance scripts carry a --self-test each, because the defect
# they guard is invisible on the documented (relative-path) invocation: a
# sqlite3 .backup destination embedded in a dot-command is NOT path-translated by
# MSYS, so an absolute path failed with "cannot open /c/..." and the RESTORE aborted
# at its own pre-restore safety step. Each self-test asserts the relative AND the
# absolute form, so a translator that breaks the common case fails too.
step "db backup script self-test" "bash scripts/backup-db.sh --self-test" bash scripts/backup-db.sh --self-test
step "db restore script self-test" "bash scripts/restore-db.sh --self-test" bash scripts/restore-db.sh --self-test

step "runner claims" "python3 scripts/verify-runner-claims.py" python3 scripts/verify-runner-claims.py
step "runner claims self-test" "python3 scripts/verify-runner-claims.py --self-test" python3 scripts/verify-runner-claims.py --self-test
# Runs EVERY checker's self-test in one roster. Added 2026-09-29 because until now the
# only way to run the population was a person typing a command -- which is how the
# first sweep of all 37 checkers reported three "failures" that were argparse rejecting
# a flag those three do not implement. This one skips anything that declares no
# --self-test, and reports a rejected flag separately from a failed case, so the two
# cannot be confused.
# Wired 2026-09-29, which is the point of the round-80 deletion. An unwired checker
# reads as coverage to the reader who greps, and this one had been finding a real gap
# since before it had a runner. Green as of that commit (0 bounded families with gaps),
# so it can be a step rather than a note.
step "fluent dynamic families" "python3 scripts/verify-fluent-dynamic-families.py" python3 scripts/verify-fluent-dynamic-families.py

step "selftest sweep" "python3 scripts/verify-selftest-sweep.py" python3 scripts/verify-selftest-sweep.py
step "selftest sweep self-test" "python3 scripts/verify-selftest-sweep.py --self-test" python3 scripts/verify-selftest-sweep.py --self-test

step "runner commands" "python3 scripts/verify-runner-commands.py" python3 scripts/verify-runner-commands.py
step "runner commands self-test" "python3 scripts/verify-runner-commands.py --self-test" python3 scripts/verify-runner-commands.py --self-test

step "self-tests wired" "python3 scripts/verify-selftests-wired.py" python3 scripts/verify-selftests-wired.py
step "self-tests wired self-test" "python3 scripts/verify-selftests-wired.py --self-test" python3 scripts/verify-selftests-wired.py --self-test
step "deployment verification" "python3 scripts/verify-deployment.py" python3 scripts/verify-deployment.py
step "deployment verification self-test" "python3 scripts/verify-deployment.py --self-test" python3 scripts/verify-deployment.py --self-test
# The four parsers' own cases, beside the gate they prove. Pure regexes plus a
# read-only floor; nothing installed, nothing written.
step "plugin-guide parity self-test" "python3 scripts/verify-plugin-guide-parity.py --self-test" python3 scripts/verify-plugin-guide-parity.py --self-test

# ── Windows config drift (AUDIT-28) — NSIS installMode + asInvoker ─────
# Static gate that runs on every local pre-CI run: tauri.conf.json must
# keep NSIS installMode at currentUser (perMachine reintroduces the UAC
# prompt) and every source app.manifest must carry asInvoker. The PE scan
# of actually-built Windows exes is enforced in release.yml's Windows job.
step "windows config drift" "python3 scripts/verify-windows-config.py" python3 scripts/verify-windows-config.py
step "windows config drift self-test" "python3 scripts/verify-windows-config.py --self-test" python3 scripts/verify-windows-config.py --self-test
step "tz invariance self-test" "python3 scripts/check-tz-invariance.py --self-test" python3 scripts/check-tz-invariance.py --self-test

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
# C62 FLIP: this gate was registered advisory with continue-on-error and NO
# check.sh runner, for a stated reason -- its findings sat in
# manager-codebase-review-checklist.md while a peer session was actively
# writing that file, so racing it would have broken every local pre-push.
# The note named the flip condition explicitly ("when check-dead-refs reports
# 0, drop continue-on-error and advisory_at, set status required, and add
# runners.check.sh") and it is now met: the register was repointed
# (c6ebcc165) and the four remaining quoted/illustrative paths were given the
# NEGATIVE_MARKERS wording the checker documents for deliberate absence.
# Measured before flipping: 9 unresolved -> 0.
# Gate: scripts/gates.json -> "dead-refs".
step "docs dead refs" "python3 .agents/skills/docs-auditor/scripts/check-dead-refs.py" python3 .agents/skills/docs-auditor/scripts/check-dead-refs.py

# The API reference page is the IPC contract read first by every agent and integrator, and
# nothing enforced it: it had drifted 169 ways from the registries (101 names that exist
# nowhere, 55 registered commands with no row, 10 wrong availability markers, 3 defined but
# in no handler). Page repaired and gate added together 2026-09-29, so this leg has a green
# baseline -- a gate introduced against a red page gets muted, which is how this checker sat
# unwired from 08-09-26 to 09-29. The checker exits 2, not 0, on an unparseable input, so a
# broken checker cannot read as a clean page. Gate: scripts/gates.json -> "api-surface".
step "api surface" "python3 .agents/skills/docs-auditor/scripts/check-api-surface.py" python3 .agents/skills/docs-auditor/scripts/check-api-surface.py
# docs/records/README.md calls itself the single entry point, and its freshness
# gate was "unbuilt by decision" (docs/README.md) — a decision the 2026-09-23
# documentation audit reversed once the generator defect behind seven dead
# snapshots/ rows was fixed and the 148-vs-158-line drift repaired: a gate
# deferred to avoid crying wolf had let the wolf in.
# Gate: scripts/gates.json -> "records-index".
step "records index freshness" "node scripts/generate-records-index.mjs --check" node scripts/generate-records-index.mjs --check
# The generator above RUNS, so it cannot say anything about whether its cell
# sanitizer still bites: --check is happy with whatever the generator writes. That
# guard is scripts/test-records-index-escaping.sh, and it ran in no runner at all --
# not check.sh, not any workflow -- so an escaping regression would have shipped a
# generator that still regenerated its own output faithfully. It drives the LIVE
# generator through KASIRMU_RECORDS_ROOT and then a frozen deliberately-unfixed one
# that MUST fail the same exploit assertion, so a green run proves the guard bites
# rather than merely that the fixture is well formed. Measured 2.3s.
# Gate: scripts/gates.json -> "records-index-escaping".
step "records index escaping" "bash scripts/test-records-index-escaping.sh" bash scripts/test-records-index-escaping.sh
# The hand table in docs/decisions/README.md has reconciled its status column
# against ADR frontmatter by hand three times (2026-08-09 x26 empty cells,
# 2026-09-23 x3 trailing ones), and that file's Conventions order the column
# re-derived "with a script, never by hand". This is the script: each row's
# status WORD against its linked ADR's frontmatter, frontmatter over header
# line, matched by file path so the documented duplicate #43 checks both
# files, cross-reference table excluded (prose cells). Audit open item 2,
# green from day one (54/54). Gate: scripts/gates.json -> "adr-status".
step "adr status drift" "python3 .agents/skills/docs-auditor/scripts/check-adr-status.py" python3 .agents/skills/docs-auditor/scripts/check-adr-status.py
# website/src/content docs link each other with Astro ROUTES (../cloud-sync/,
# ../../pricing/, /en/docs/...), not filesystem paths: a file scanner flagged ~90
# of them in the 2026-09-23 audit while every one resolved, and could not see a
# ghost slug either way (audit open item 4). This builds the route table the site
# actually serves -- astro.config i18n locales x src/pages ([locale] expanded,
# directory-format URLs) x content routes enumerated the way [...slug].astro emits
# them x public/ files and _redirects sources -- and resolves each markdown link
# against it. Green from day one (38 content docs). Gate: scripts/gates.json -> "site-links".
step "site links" "python3 .agents/skills/docs-auditor/scripts/check-site-links.py" python3 .agents/skills/docs-auditor/scripts/check-site-links.py
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
# The extractor's own cases, beside the gate they prove — the same shape as the
# "ci docs drift self-test" step above. Added 2026-09-29 with the --self-test flag:
# before it, this checker had no test of any kind, and its whole job is regex
# extraction, so a pattern that stopped matching would report "0 missing key(s)"
# and pass on a tree it was no longer reading.
step "bundle parity self-test" "python3 scripts/verify-bundle-parity.py --self-test" python3 scripts/verify-bundle-parity.py --self-test

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
step "migration column types self-test" "python3 scripts/verify-migration-column-types.py --self-test" python3 scripts/verify-migration-column-types.py --self-test

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

# .githooks/post-commit carries a SECOND typecheck tripwire, and this one was never wired to
# any runner. It defends the failure modes the pre-commit gate cannot see: a pathspec that
# matches nothing, a block placed BELOW one of the hook's four early `exit 0` paths, and a
# verdict written even though npm never ran. The test extracts the live block between the
# '# tripwire-start' and '# tripwire-end' markers rather than reimplementing the trigger, so a
# test carrying its own copy would pass forever while the real tripwire silently never runs.
# Gate: scripts/gates.json -> "typecheck-tripwire".
step "typecheck tripwire" "bash scripts/test-typecheck-tripwire.sh" bash scripts/test-typecheck-tripwire.sh

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
# Root AGENTS.md is the only copy of the agent rules today: .agents/management/AGENTS.md
# was deleted 2026-09-24 (5ec0ca164) and .prime/AGENTS.md went with the .prime/ tree on
# 08-09-26, so the verifier's MIRRORS list holds one path and bump-version.ps1 no longer
# syncs a second one. Twice in 0.0.36 a mirror stated something the repo contradicted:
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
