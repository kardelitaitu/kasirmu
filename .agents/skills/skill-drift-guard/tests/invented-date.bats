#!/usr/bin/env bats
#
# Test: invented-date.bats
#
# Injects an invented date ("30-02-26" — a real-shape but invalid-calendar
# date) into a SCRATCH tree, asserts that detect.sh:
#   - exits non-zero (the inject is a manual fix required)
#   - reports the failure under the `doc-audit` FINDINGS key
#   - quotes the date substring "30-02-26" in the message
#   - the shape check passed (didn't fire "footer violates")
#
# This pins the 2-pass validation invariant: shape OK → batched Python
# value check → INVALID. If the Python batching ever regresses (the
# shape-only `AUDIT_RE` falls back, or batch_validate_audit_dates
# accidentally treats the date as OK), this test catches it before
# contributors do.

setup() {
  PROJECT_ROOT="$(cd "$(dirname "${BATS_TEST_FILENAME}")/../../../.." && pwd)"
  cd "$PROJECT_ROOT"
  # Scratch tree, for the reason recorded in shape-violation.bats: this test used
  # to append a DELIBERATELY IMPOSSIBLE date (30 February) to the real
  # CONTRIBUTING.md and restore it afterwards, so an interrupted run left the
  # repo carrying an audit stamp that no audit ever produced.
  SCRATCH="$BATS_TEST_TMPDIR/tree"
  mkdir -p "$SCRATCH"
  printf '# fixture\n\n> last audited 30-02-26 by docs-auditor\n' \
    > "$SCRATCH/CONTRIBUTING.md"
  export DRIFT_ROOT_OVERRIDE="$SCRATCH"
}

teardown() {
  # Nothing to restore; see teardown() in shape-violation.bats.
  unset DRIFT_ROOT_OVERRIDE
}

@test "invented-date: 30-02-26 fires Check 10 with value-failure message" {
  run bash "$PROJECT_ROOT/.agents/skills/skill-drift-guard/scripts/detect.sh" \
      --check=doc-audit
  [ "$status" -ne 0 ]
  [[ "$output" == *"doc-audit"* ]]
  [[ "$output" == *"30-02-26"* ]]
  [[ ! "$output" == *"footer violates DD-MM-YY"* ]]
}
