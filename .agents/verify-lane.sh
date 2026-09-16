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
#         bash .agents/verify-lane.sh --head     # grade the COMMIT, not the dirt
#
# --head exists because the dirt warning above turned out to cut both ways. On 2026-09-16 this
# lane committed a retirement while the tree was red from a neighbour's uncommitted `pos.rs`, and
# every gate it had run that day read green for the same reason: the working tree carries other
# sessions' in-flight fixes as well as their breakage. `drift_pin_guard_marker_vocabulary_is_closed`
# FAILED at HEAD and PASSED in the live tree -- the offender was committed in `audit.rs` and the
# fix was sitting uncommitted in the same file, one lane over. So a green here is a statement
# about "HEAD plus this dirt", and the only way to grade a commit is to check the commit out
# somewhere else. This mode does that in a detached throwaway worktree under TEMP, shares nothing
# with this checkout's index, and removes itself.
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
    # A test failure carries no `--> path:line` marker, so the attribution loop below finds
    # nothing and the receipt says only "exit=101 -- test failed", which is true and useless: the
    # first real use of --head mode produced exactly that and could not name the failing case.
    # Compilable errors point at a file; a failed assertion points at a TEST, so print both kinds.
    grep -aE 'FAILED$|^failures:$|panicked at|^---- ' "$LOG" | tail -12 | sed 's/^/   | /'
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

if printf '%s' "${*:-}" | grep -q -- '--head'; then
  WT="${TEMP:-/tmp}/ozpos-verify-head-$$"
  if ! git worktree add --detach "$WT" HEAD >/dev/null 2>&1; then
    say "cannot create a detached worktree at HEAD -- refusing to guess about the commit"
    exit 2
  fi
  say "grading the COMMIT: HEAD=$(git rev-parse --short HEAD) checked out at $WT"
  say "  (nothing in this working tree is read or written by this mode)"
  for spec in "tablet:apps/tablet-client" "desktop:apps/desktop-client"; do
    name=${spec%%:*}; path=${spec#*:}
    run "[$name @HEAD] lib tests" cargo test --manifest-path "$WT/$path/Cargo.toml" --lib
    run "[$name @HEAD] clippy -D unused-imports -D dead_code" \
      cargo clippy --manifest-path "$WT/$path/Cargo.toml" --all-targets \
      -- -D unused-imports -D dead_code
  done
  git worktree remove --force "$WT" >/dev/null 2>&1 || rm -rf "$WT"
  say ""
  if [ "$FAIL" -eq 0 ]; then
    say "COMMIT RECEIPT: HEAD=$(git rev-parse --short HEAD) is green on its own, with no neighbour's dirt in the way."
  else
    say "COMMIT RECEIPT: HEAD=$(git rev-parse --short HEAD) is RED on its own. A green working-tree run does not rescue it -- read $LOG and find which commit landed the failure before touching anyone else's file."
  fi
  exit "$FAIL"
fi

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
