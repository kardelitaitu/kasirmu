#!/usr/bin/env bash
# Receipt harness for the Agent-3 (thin shell / IPC parity) lane.
#
# Two defects in the previous habit, both observed on 2026-09-16 and both of them mine:
#
#  1. `cargo clippy ... | Select-String ...; "exit=$LASTEXITCODE"` reports the exit code of
#     Select-String. Every "clippy exit 0" this lane quoted that way was measuring the wrong
#     process. Here every exit code is captured on the statement immediately after the run,
#     with no pipe in between; output is teed to a log file and only the summary is printed.
#
#  2. cargo, Vitest and the python gates all read the WORKING TREE, and this checkout has
#     several lanes committing every few minutes. A red can be borrowed from a stranger -- on
#     2026-09-16 a `-D warnings` run blamed four unused imports on `commands/staff.rs`, a file
#     this lane never touched, and by the next run they were gone: another session's uncommitted
#     edit. A green can hide a real one the same way. So this script prints HEAD and the dirty
#     Rust paths BEFORE and AFTER each run, and the provenance belongs in any sentence quoted
#     from it. It grades "HEAD + this dirt", never "the commit".
#
# Usage:  bash .agents/verify-lane.sh            # rust + gates (default)
#         bash .agents/verify-lane.sh --ui       # also npm typecheck + the touched UI suites
set -u

LOG=.agents/verify-lane.log
: > "$LOG"
FAIL=0
SUITES=${*:-}

say() { printf '%s\n' "$*"; }

provenance() {
  local tag=$1
  say "  provenance[$tag]: HEAD=$(git rev-parse --short HEAD)"
  local dirty
  dirty=$(git status --porcelain -- 'apps/**/*.rs' 'crates/**/*.rs' 2>/dev/null | awk '{print $2}' | tr '\n' ' ')
  say "  provenance[$tag]: dirty .rs = ${dirty:-none}"
}

run() {
  # run <name> <command...>   -- captures exit immediately, keeps full output in $LOG
  local name=$1; shift
  provenance before
  say "── $name"
  "$@" >>"$LOG" 2>&1
  local code=$?
  provenance after
  say "   exit=$code"
  if [ "$code" -ne 0 ]; then
    FAIL=1
    grep -aE '^(error|error\[|error:)' "$LOG" | tail -8 | sed 's/^/   | /'
    # Attribution, the half that took two false accusations to write. On 2026-09-16 this lane
    # read four unused-import errors in `commands/staff.rs` as a finding about its own work and
    # 66 changed lines in `hardware.rs` as its own edit; both belonged to another session's
    # uncommitted state in the SAME working tree, and by the next run the errors were gone.
    # A gate here grades "HEAD plus whatever the neighbours left on disk", so a red must say
    # which camp the named file is in before anyone acts on it.
    local files f
    files=$(grep -aoE -- '--> [^ ]+\.(rs|ts|tsx|py|json|md):[0-9]+' "$LOG" \
            | awk '{print $2}' | sed 's/:[0-9]*$//' | tr '\\' '/' \
            | sed -E 's#^.*((apps|crates|ui|scripts|packages)/)#\1#' | sort -u)
    for f in $files; do
      if [ -n "$(git status --porcelain -- "$f" 2>/dev/null)" ]; then
        say "   attribution: $f is DIRTY -- another session's in-flight edit, this red may not be yours"
      else
        say "   attribution: $f is clean against HEAD -- this red is in committed code"
      fi
    done
  fi
  return 0
}

run "clippy tablet (lib+tests, -D warnings)" cargo clippy -p oz-pos-tablet --all-targets -- -D warnings
run "clippy desktop (lib+tests, -D warnings)" cargo clippy -p oz-pos-app --all-targets -- -D warnings
run "tablet lib tests" cargo test -p oz-pos-tablet --lib
run "desktop lib tests" cargo test -p oz-pos-app --lib
run "tablet registration gate" cargo test -p oz-pos-tablet --lib registration_gate -- --exact \
  commands::registration_gate_tests::drift_pin_debt_ceilings_only_shrink
run "desktop registration gate" cargo test -p oz-pos-app --lib registration_gate
run "ipc parity" python scripts/verify-ipc-parity.py
run "ipc parity self-test" python scripts/verify-ipc-parity.py --self-test
run "scoped coverage" bash scripts/verify-scoped-coverage.sh

if [ -n "$SUITES" ]; then
  run "ui typecheck" npm --prefix ui run typecheck
fi

say ""
if [ "$FAIL" -eq 0 ]; then
  say "RECEIPT: all runs exited 0 against $(git rev-parse --short HEAD) plus the dirt listed above."
else
  say "RECEIPT: at least one run failed. Full output in $LOG -- read it before attributing the failure."
fi
exit "$FAIL"
