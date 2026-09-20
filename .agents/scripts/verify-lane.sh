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
# Usage:  bash .agents/scripts/verify-lane.sh             # rust + gates (default)
#         bash .agents/scripts/verify-lane.sh --ui        # also npm typecheck + the touched UI suites
#         bash .agents/scripts/verify-lane.sh --head      # grade the COMMIT, not the dirt
#         bash .agents/scripts/verify-lane.sh --self-test # the harness's own controls, in seconds
#
# Run it from the repo root. Every path here is CWD-relative ($LOG, the graded
# `-p` names, the `git status` dirt listing) and the script deliberately does
# not chdir: it sits in `.agents/scripts/`, one level below the tree it grades,
# so resolving paths from $0 would paper over a wrong CWD instead of failing in
# it. This header used to name `.agents/verify-lane.sh`, which has not existed
# since the script moved into `scripts/`; a copy-pasted usage line failed with
# "No such file or directory" rather than with anything that pointed here.
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
# Truncate the log FIRST and refuse to run if that fails. Every step of a --head receipt on
# 2026-09-16 reported exit=1 while cargo never started: the caller had piped this script through
# PowerShell's Tee-Object onto the SAME path, so bash's `>>"$LOG"` open failed with EBUSY, the
# command never executed, and `$?` captured the failed REDIRECT rather than a compiler status. Four
# fake reds, a "HEAD is RED on its own" verdict that graded nothing, and a failure branch that could
# name no file because grepping an empty log finds nothing. A verifier that cannot write its own log
# has to stop, because every number it then prints describes its own I/O rather than the tree.
if ! : > "$LOG" 2>/dev/null; then
  printf '%s\n' "cannot write $LOG -- another process holds it open (do not pipe this script into" \
                "Tee-Object/Out-File on the same path: this script READS that log to attribute" \
                "failures). Refusing to run rather than report redirect failures as build failures."
  exit 2
fi
FAIL=0
SUITES=${*:-}

say() { printf '%s\n' "$*"; }

# Set only by --head. When present, provenance() reports the pinned commit instead of main's live
# HEAD, and suppresses the dirt listing -- which in that mode belongs entirely to other lanes.
HEAD_PIN=""

provenance() {
  local tag=$1
  if [ -n "$HEAD_PIN" ]; then
    say "  provenance[$tag]: graded commit=$HEAD_PIN (pinned when the worktree was created; main's HEAD may have moved since and is NOT what this step ran)"
    return 0
  fi
  say "  provenance[$tag]: HEAD=$(git rev-parse --short HEAD)"
  local dirty
  dirty=$(git status --porcelain -- 'apps/**/*.rs' 'crates/**/*.rs' 2>/dev/null | awk '{print $2}' | tr '\n' ' ')
  say "  provenance[$tag]: dirty .rs = ${dirty:-none}"
}

run() {
  # run <name> <command...>   -- captures exit immediately, keeps full output in $LOG
  #
  # The command writes to a PRIVATE temp file, and $LOG is appended to afterwards as a best effort.
  # That ordering is the whole point. Redirecting straight into $LOG means the exit code bash reports
  # is the exit code of the REDIRECT when the open fails: with another process holding $LOG (a
  # caller piping this script through Tee-Object onto the same path, which is exactly what happened
  # on 2026-09-16), cargo never starts, `$?` is 1 from a failed `open()`, and four green-capable steps
  # are recorded as four reds -- followed by a "HEAD is RED on its own" verdict and an attribution
  # grep of an empty log. A fresh mktemp path cannot be held by anyone else, so the status can only
  # come from the command. Logging failures are then reported AS logging failures.
  local name=$1; shift
  local tmp
  if ! tmp=$(mktemp 2>/dev/null); then
    say "── $name"
    say "   ABORTED: cannot create a private output file, so an exit code here would describe the shell's I/O and not the command. Refusing."
    FAIL=1
    return 0
  fi
  provenance before
  say "── $name"
  "$@" >"$tmp" 2>&1
  local code=$?
  if ! cat "$tmp" >>"$LOG" 2>&1; then
    say "   LOG NOTE: output could not be appended to $LOG (a handle is held elsewhere). The exit code below is still the command's own, and the greps run on the private copy."
  fi
  provenance after
  say "   exit=$code"
  if [ "$code" -ne 0 ]; then
    FAIL=1
    grep -aE '^(error|error\[|error:)' "$tmp" | tail -8 | sed 's/^/   | /'
    # A test failure carries no `--> path:line` marker, so the attribution loop below finds
    # nothing and the receipt says only "exit=101 -- test failed", which is true and useless: the
    # first real use of --head mode produced exactly that and could not name the failing case.
    # Compilable errors point at a file; a failed assertion points at a TEST, so print both kinds.
    grep -aE 'FAILED$|^failures:$|panicked at|^---- ' "$tmp" | tail -12 | sed 's/^/   | /'
    # Attribution, the half that took two false accusations to write. On 2026-09-16 this lane
    # read four unused-import errors in `commands/staff.rs` as a finding about its own work and
    # 66 changed lines in `hardware.rs` as its own edit; both belonged to another session's
    # uncommitted state in the SAME working tree, and by the next run the errors were gone.
    # A gate here grades "HEAD plus whatever the neighbours left on disk", so a red must say
    # which camp the named file is in before anyone acts on it.
    local files f
    files=$(grep -aoE -- '--> [^ ]+\.(rs|ts|tsx|py|json|md):[0-9]+' "$tmp" \
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
  # The private copy is this run's evidence trail; keep it only as long as the greps need it.
  rm -f "$tmp"
  return 0
}

if printf '%s' "${*:-}" | grep -q -- '--self-test'; then
  # The harness needs a positive control too. Everything it reports about the tree passes through
  # run(), and run() had two ways to lie silently: capture the status of a failed redirect as if it
  # were the command's, and grep the shared log (empty, in that scenario) to attribute a failure.
  # Both are asserted here in SECONDS, without a cargo build -- which is the point: the control for
  # "does this harness capture a status honestly" must not itself take ten minutes to answer.
  #
  # The load-bearing case is 101. A failed `open()` yields 1; `cargo test` with a failing case yields
  # 101. If 101 survives as 101, the number came from cargo. If it arrives as 1, the harness is
  # reporting its own I/O again and this suite says so.
  LOG=$(mktemp)   # planted "errors" must not land in the real receipt log
  ST_N=0; ST_BAD=0
  st() {
    ST_N=$((ST_N + 1))
    if [ "$2" = "0" ]; then say "  ok    $1"; else say "  WRONG $1"; ST_BAD=$((ST_BAD + 1)); fi
  }
  out=$(run 'ctl: passing command' true);            printf '%s' "$out" | grep -q 'exit=0$'
  st "a passing command is recorded as exit=0" "$?"
  out=$(run 'ctl: failing command' false);           printf '%s' "$out" | grep -q 'exit=1$'
  st "a failing command is recorded as exit=1" "$?"
  out=$(run 'ctl: cargo-shaped failure' bash -c 'printf "%s\n" "test a::b ... FAILED" >&2; printf "%s\n" "---- a::b stdout ----" >&2; printf "%s\n" "thread panicked at src/lib.rs:3:5: boom" >&2; exit 101')
  printf '%s' "$out" | grep -q 'exit=101$'
  st "101 arrives as 101, so the status is the command's and not a redirect's" "$?"
  printf '%s' "$out" | grep -q 'panicked at'
  st "a failure with no --> marker is still echoed (the grep reads the private copy)" "$?"
  printf '%s' "$out" | grep -q 'FAILED'
  st "the FAILED line itself is echoed" "$?"
  out=$(run 'ctl: compile-shaped error' bash -c 'printf "%s\n" "error[E0432]: unresolved import" >&2; printf "%s\n" "  --> apps/tablet-client/src/commands/ctl_plant.rs:3:1" >&2; exit 1')
  printf '%s' "$out" | grep -q 'attribution:'
  st "a named file gets an attribution line" "$?"
  printf '%s' "$out" | grep -q 'ctl_plant.rs'
  st "the attributed path is the planted one, not a guess" "$?"
  FAIL=0
  run 'ctl: FAIL toggles' false >/dev/null
  st "FAIL is set by a failing run in the parent shell (not only in a subshell)" "$([ "$FAIL" = "1" ]; echo $?)"
  # And the incident itself, reproduced without needing another process to hold a handle: point the
  # log at something that cannot be appended to. The original failure mode was a logging problem
  # arriving dressed as four build failures; this pair asserts that a logging problem arrives as a
  # LOG NOTE and a CORRECT status instead.
  REAL_LOG=$LOG
  LOG=.
  out=$(run 'ctl: log unwritable' bash -c 'printf "%s\n" "thread panicked at src/lib.rs:9:1: boom" >&2; exit 101')
  printf '%s' "$out" | grep -q 'LOG NOTE'
  st "a log that cannot be written says so" "$?"
  printf '%s' "$out" | grep -q 'exit=101$'
  st "and the status is still the command's, not the redirect's" "$?"
  printf '%s' "$out" | grep -q 'panicked at'
  st "with a failed log the greps still read the private copy, so a red is never unexplained" "$?"
  LOG=$REAL_LOG
  rm -f "$LOG"
  say ""
  say "verify-lane self-test: $ST_N assertions, $ST_BAD failed"
  [ "$ST_BAD" -eq 0 ] || exit 1
  exit 0
fi

if printf '%s' "${*:-}" | grep -q -- '--head'; then
  # Resolve the commit ONCE. The worktree was always pinned -- `git worktree add --detach $WT HEAD`
  # resolves HEAD a single time -- but every provenance line and the receipt itself re-read
  # main's HEAD afterwards, so a receipt on 2026-09-16 printed `HEAD=920d116b0` for three steps and
  # `HEAD=2ad29b96f` for the fourth while grading the first one throughout. The grading was sound;
  # the LABEL drifted, which is worse in a way, because the receipt named a commit it had not run
  # and a reader would go audit the wrong diff. In this checkout peers land commits every few
  # minutes, so a mid-run HEAD move is the normal case, not the exceptional one.
  HEAD_PIN=$(git rev-parse --short HEAD)
  WT="${TEMP:-/tmp}/ozpos-verify-head-$$"
  if ! git worktree add --detach "$WT" "$HEAD_PIN" >/dev/null 2>&1; then
    say "cannot create a detached worktree at $HEAD_PIN -- refusing to guess about the commit"
    exit 2
  fi
  # Remove the worktree even if this run is interrupted. Two stale `ozpos-verify-head-*` trees were
  # found left behind on 2026-09-16 by runs that hit a wall-clock timeout, and `git worktree prune`
  # does NOT clean them: prune only drops records whose directory is already gone. A stale detached
  # tree is worse than disk noise, because `git worktree list` then shows old commits that look like
  # another lane's state. (Honest limit: an EXIT trap cannot run under a hard process kill, so this
  # covers Ctrl-C and SIGTERM; the residue of a TerminateProcess still has to be removed by hand.)
  trap 'git worktree remove --force "$WT" >/dev/null 2>&1' EXIT
  say "grading the COMMIT: $HEAD_PIN checked out at $WT"
  say "  (nothing in this working tree is read or written by this mode, so the dirt other lanes"
  say "   leave behind is not part of this verdict -- and is not listed as provenance either)"
  for spec in "tablet:apps/mobile-tauri" "desktop:apps/desktop-tauri"; do
    name=${spec%%:*}; path=${spec#*:}
    run "[$name @HEAD] lib tests" cargo test --manifest-path "$WT/$path/Cargo.toml" --lib
    run "[$name @HEAD] clippy -D unused-imports -D dead_code" \
      cargo clippy --manifest-path "$WT/$path/Cargo.toml" --all-targets \
      -- -D unused-imports -D dead_code
  done
  git worktree remove --force "$WT" >/dev/null 2>&1 || rm -rf "$WT"
  say ""
  if [ "$FAIL" -eq 0 ]; then
    say "COMMIT RECEIPT: $HEAD_PIN is green on its own, with no neighbour's dirt in the way."
  else
    say "COMMIT RECEIPT: $HEAD_PIN is RED on its own. A green working-tree run does not rescue it -- read $LOG and find which commit landed the failure before touching anyone else's file."
  fi
  exit "$FAIL"
fi

run "clippy tablet (lib+tests, -D warnings)" cargo clippy -p kasirmu-mobile --all-targets -- -D warnings
run "clippy desktop (lib+tests, -D warnings)" cargo clippy -p kasirmu-app --all-targets -- -D warnings
run "tablet lib tests" cargo test -p kasirmu-mobile --lib
run "desktop lib tests" cargo test -p kasirmu-app --lib
run "tablet registration gate" cargo test -p kasirmu-mobile --lib registration_gate -- --exact \
  commands::registration_gate_tests::drift_pin_debt_ceilings_only_shrink
run "desktop registration gate" cargo test -p kasirmu-app --lib registration_gate
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
