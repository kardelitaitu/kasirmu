#!/usr/bin/env bash
# scripts/verify-scoped-authorization.sh - the second half of H-1/H-2.
#
# `verify-scoped-coverage.sh` checks that every registered command HAS a
# `_scoped` twin. It stops there: the moment a twin exists the command is
# "covered" and the twin body is never opened. So a `_scoped` fn that resolves
# a session and then reads or writes with no authorization at all passes that
# gate - which is how four authorization defects survived this audit
# (`refresh_picker_ticket`, `list_workspace_screens`, and the hardware
# module ungated HAL surface). The convention was enforced; the property the
# convention exists for was not.
#
# This script checks the property. A `_scoped` function that reaches the store
# or the HAL must EITHER:
#
#   1. call a permission helper, OR
#   2. be named in SELF_SCOPED below, OR
#   3. carry a `// ungated-ok: <reason>` marker in its body.
#
# (2) and (3) are the point, not a loophole: most legitimate ungated fns ARE
# legitimate for a reason (a health probe discloses nothing tenant-specific; a
# self-scoped read keyed on session.user_id cannot name anyone else), and the
# reason is what a reviewer needs. An UNEXPLAINED ungated `_scoped` fn is the
# finding.
#
# Usage:  bash scripts/verify-scoped-authorization.sh           # report
#         bash scripts/verify-scoped-authorization.sh --strict  # fail on any
#
# Report mode is the default while the backlog is cleared: a new hard failure
# on a shared branch stops every other agent, so --strict is wired into
# pre-push only once the unreasoned count reaches zero.

set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

STRICT=0
[ "${1:-}" = "--strict" ] && STRICT=1

SRC="crates/kasirmu-bridge/src"

# A permission helper. The bridge spells authorization several ways: a shared
# helper, a module-local one, or the scope-aware session gate.
PERM="require_session_permission|require_permission|require_tax_permission|require_inventory_permission|require_report_scope|resolve_report_scope|require_audit_permission|require_customer_permission|require_loyalty_permission|require_avatar_write|require_category_permission|require_inventory_count_permission|session_config"

# Reaching the store or the hardware layer is what makes authorization
# necessary at all. A fn touching neither is out of scope for this check.
STORE="resolve_store|resolve_scope|open_store|db_manager|ctx[.]registry"

# Ungated by design. One name per line. Every entry needs a category:
#   self   - keyed on the session identity, so it cannot name another actor
#   probe  - process-wide or compile-time; discloses nothing tenant-specific
#   device - per-INSTALL rather than per-store; there is no store to scope it
# Keep sorted. An entry added without a reason defeats the check.
SELF_SCOPED="get_own_avatar_scoped
currency_info_scoped
list_currencies_scoped
edc_terminal_status_scoped
version_scoped
ping_scoped
get_device_id_scoped
get_local_ip_scoped
get_machine_id_scoped
get_hardware_fingerprint_scoped
check_license_status_scoped
test_auth_connection_scoped
get_license_status_scoped
list_active_memos_scoped
acknowledge_memo_scoped
get_user_preferences_scoped
set_user_preferences_scoped
get_active_shift_scoped"

# All of the work happens in one awk pass: it tracks the current `_scoped` fn
# and its body, then classifies each. Keeping it in awk (rather than a bash
# loop over extracted records) avoids a second level of quoting, which is where
# a checker like this usually breaks.
read -r -d '' AWK_PROG <<'AWK' || true

  BEGIN { n = split(LISTED, tmp, "\n"); for (i = 1; i <= n; i++) listed[tmp[i]] = 1 }

  # A new top-level fn closes the previous one. The `_scoped` test comes FIRST:
  # the signature line of the fn being tracked also matches the generic
  # "a top-level fn starts here" pattern, so classifying before checking it
  # would close every fn against an EMPTY body and report the whole crate.
  /^[[:space:]]*pub (async )?fn [a-z_0-9]+_scoped/ {
    if (fn != "") { classify() }
    nm = $0
    sub(/^[[:space:]]*pub (async )?fn /, "", nm)
    sub(/[(<].*/, "", nm)
    fn = nm; body = ""; line = FNR; file = FILENAME
    next
  }
  /^[[:space:]]*pub (async )?fn / || /^[[:space:]]*fn / || /^#\[cfg\(test\)\]/ {
    if (fn != "") { classify() }
    fn = ""; body = ""
    next
  }
  { if (fn != "") body = body $0 "\n" }

  # NOTE: there is deliberately NO END block here. The summary END at the bottom of
  # this program already calls classify() for the final fn. An earlier version had
  # both, so the LAST function in the subject was classified TWICE -- found by
  # writing the self-test, where a single leaky fn reported "UNREASONED: 2".
  # awk allows several END blocks and runs them in order, so the duplicate was silent.
  function classify() {
    scanned++
    # Only fns that touch the store or the HAL need authorization.
    if (body !~ STORE) { return }
    if (body ~ PERM) { return }
    if (body ~ /ungated-ok:/) { explained++; return }
    if (fn in listed) { explained++; return }
    unreasoned++
    printf "  %s:%d  %s\n", file, line, fn
  }

  # The summary is printed from awk, not from the shell: the counters live in
  # this process, so bash would see only an unset variable.
  END {
    if (fn != "") { classify() }
    printf "\nscanned: %d   explained: %d   UNREASONED: %d\n", scanned, explained, unreasoned

    # A FLOOR, for the reason the sibling `verify-scoped-coverage.sh` now
    # carries one: "every _scoped fn is accounted for" and "the scan found no
    # _scoped fns" both print a clean summary and exit 0, because the loop
    # never runs and `unreasoned` stays 0. The subject is a `find` over
    # $SRC, so a moved directory empties it silently. Measured 2026-09-25:
    # 348 scanned, so 150 is a floor a real regression trips long before zero.
    if (scanned < 150) {
      printf "FAIL: scanned only %d _scoped fn(s) in %s - the scan is reading\n", scanned, SRC
      printf "nothing, so this gate would pass vacuously (expected >= 150; measured 348 on 2026-09-25)\n\n"
      exit 2
    }
    printf "\n"
    exit (unreasoned > 0 ? 1 : 0)
  }
AWK

# The classifier's single invocation site: both the live scan below and every
# self-test case drive $AWK_PROG through THIS wrapper, so the cases grade the
# same program text the crate scan runs -- and a wrapper that stops invoking
# awk (broken arg passing, a lost -v) reddens in the self-test instead of
# silencing the live scan.
run_classifier() {
  # The PROGRAM comes first and the files after: awk's first non-option
  # argument IS the program, so a file passed before it (d3dc89c38 put "$@"
  # before "$AWK_PROG") becomes the program and the scan dies with a syntax
  # error -- which non-strict mode then masked as a plain exit 0.
  awk -v PERM="$PERM" -v STORE="$STORE" -v LISTED="$SELF_SCOPED" "$AWK_PROG" "$@"
}

# ── Self-test ────────────────────────────────────────────────────────────────
#
# The classifier is one awk function with four branches, and every branch decides
# silently: a body that matches PERM is skipped, a body that does not match STORE is
# skipped, a listed name is counted as explained. Break any one and the summary still
# prints, still exits 0 when the backlog is clear, and the gate grades nothing.
#
# These cases drive THAT awk program -- the extracted $AWK_PROG, not a copy -- over
# synthetic sources, so an edit to the real classifier reddens here.
#
# Each case: label | expected unreasoned count | source text.
self_test() {
  local fails=0 total=0

  # $1 label, $2 expected unreasoned, $3 source
  run_case() {
    local label="$1" want="$2" src="$3" got
    total=$((total + 1))
    # Cases parse the UNREASONED line, so the hardcoded scanned-floor firing under
    # them is harmless; the floor itself is graded by case 7 below.
    got=$(printf '%s' "$src" | run_classifier SRC="selftest" 2>/dev/null \
      | sed -n 's/.*UNREASONED: \([0-9]*\).*/\1/p')
    if [ "$got" != "$want" ]; then
      printf '  FAIL %s: expected %s unreasoned, got "%s"\n' "$label" "$want" "$got"
      fails=$((fails + 1))
    fi
  }

  # 1. The defect this gate exists for: a _scoped fn that reaches the store with no
  #    permission helper and no stated reason.
  run_case "store + no permission is UNREASONED" 1 \
    'pub async fn leaky_scoped(session: &Session) -> Result<()> {
       let store = resolve_store(&session);
       Ok(())
     }'

  # 2. A permission helper satisfies the rule.
  run_case "store + permission helper is fine" 0 \
    'pub async fn good_scoped(session: &Session) -> Result<()> {
       require_session_permission(&session, Sales, Write)?;
       let store = resolve_store(&session);
       Ok(())
     }'

  # 3. A fn that touches neither store nor HAL is out of scope, not a finding.
  run_case "no store access is out of scope" 0 \
    'pub async fn trivial_scoped(session: &Session) -> String { session.user_id.clone() }'

  # 4. The ungated-ok escape hatch counts as explained.
  run_case "ungated-ok marker explains it" 0 \
    'pub async fn probe_scoped() -> Result<()> {
       // ungated-ok: health probe discloses nothing tenant-specific
       let store = resolve_store(&ctx);
       Ok(())
     }'

  # 5. A name in SELF_SCOPED counts as explained.
  run_case "a listed name is explained" 0 \
    'pub async fn ping_scoped() -> Result<()> {
       let store = resolve_store(&ctx);
       Ok(())
     }'

  # 6. A NON-_scoped fn must never be graded: the gate is about twins.
  run_case "an unscoped fn is not scanned" 0 \
    'pub async fn leaky(session: &Session) -> Result<()> {
       let store = resolve_store(&session);
       Ok(())
     }'

  # THE FILE PATH. This case drives a FILE through the argument position, the
  # only path that can catch a wrapper-order break -- every case above pipes
  # stdin, and the live scan passes find(1) files. Measured 2026-11-08:
  # d3dc89c38 put the program after "$@" and every stdin case stayed green
  # while the live scan died on a syntax error.
  total=$((total + 1))
  case_file=$(mktemp)
  printf '%s\n' 'pub async fn leaky_file_scoped(session: &Session) -> Result<()> {' \
    '  let store = resolve_store(&session);' \
    '  Ok(())' \
    '}' > "$case_file"
  gotf=$(run_classifier SRC="selftest" "$case_file" 2>/dev/null \
    | sed -n 's/.*UNREASONED: \([0-9]*\).*/\1/p')
  rm -f "$case_file"
  if [ "$gotf" != "1" ]; then
    printf '  FAIL a file passed as an argument is graded: expected 1 unreasoned, got "%s"\n' "$gotf"
    fails=$((fails + 1))
  fi

  # 7. THE FLOOR. An empty subject must refuse rather than report a clean zero.
  total=$((total + 1))
  if printf '' | run_classifier SRC="empty" >/dev/null 2>&1; then
    printf '  FAIL the empty subject must exit non-zero, it exited 0\n'
    fails=$((fails + 1))
  fi

  if [ "$fails" -gt 0 ]; then
    printf 'SELF-TEST FAILED (%d of %d)\n' "$fails" "$total" >&2
    return 2
  fi
  printf 'SELF-TEST OK (%d cases, no tree read)\n' "$total"
  return 0
}

if [ "${1:-}" = "--self-test" ]; then
  self_test
  exit $?
fi

# Grade the classifier before grading the crate.
self_test || { echo "CLASSIFIER WENT DEAF: not trusting the scan below." >&2; exit 2; }

run_classifier SRC="$SRC" $(find "$SRC" -name "*.rs" ! -name "*_tests.rs")
rc=$?

# awk exits 1 whenever it found an unreasoned fn; only --strict treats that as
# a failure while the backlog is being cleared.
if [ "$STRICT" = "1" ] && [ "$rc" -ne 0 ]; then
  echo "FAIL: ungated _scoped fn(s) with no stated reason (see the list above)"
  exit 1
fi
exit 0