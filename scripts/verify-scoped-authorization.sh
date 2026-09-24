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
awk -v PERM="$PERM" -v STORE="$STORE" -v LISTED="$SELF_SCOPED" '
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
  END { if (fn != "") classify() }

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
    printf "\nscanned: %d   explained: %d   UNREASONED: %d\n\n", scanned, explained, unreasoned
    exit (unreasoned > 0 ? 1 : 0)
  }
' $(find "$SRC" -name "*.rs" ! -name "*_tests.rs")
rc=$?

# awk exits 1 whenever it found an unreasoned fn; only --strict treats that as
# a failure while the backlog is being cleared.
if [ "$STRICT" = "1" ] && [ "$rc" -ne 0 ]; then
  echo "FAIL: ungated _scoped fn(s) with no stated reason (see the list above)"
  exit 1
fi
exit 0