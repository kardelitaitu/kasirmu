#!/usr/bin/env bats
#
# Test: shape-violation.bats
#
# Injects a footer that passes the digit-substring portion of $AUDIT_RE
# but fails the full regex (whitespace before a parenthetical in the
# by-clause violates `[^[:space:]]+$`). Asserts that detect.sh:
#   - exits non-zero
#   - reports the failure under the `doc-audit` FINDINGS key
#   - quotes the violation pattern "DD-MM-YY + by-clause"
#   - the value check is NOT taken (bypassed when shape fails)
#
# This pins the SHAPE-first invariant: if shape fails, we report shape
# and never even hand the date to Python. If this regresses (e.g. the
# shape check starts accepting `28-06-26 by repo (extra)` as OK, or the
# value check fires for a shape-failure case), this test catches it.

setup() {
  PROJECT_ROOT="$(cd "$(dirname "${BATS_TEST_FILENAME}")/../../../.." && pwd)"
  cd "$PROJECT_ROOT"
  # The fixture lives in a scratch tree, and detect.sh is pointed at THAT tree, so
  # nothing outside $BATS_TEST_TMPDIR is read and nothing in the repo is written.
  # This test used to append the violation to the REAL CONTRIBUTING.md and restore
  # it in teardown. That made the repo hold a fabricated audit stamp for the whole
  # run -- roughly 16s for the doc-audit check -- and left it there permanently if
  # the run was killed, timed out, or the machine slept. shape-violation.bats and
  # invented-date.bats both wrote that same file, so a second run also clobbered
  # the first's backup and restored the wrong bytes.
  SCRATCH="$BATS_TEST_TMPDIR/tree"
  mkdir -p "$SCRATCH"
  printf '# fixture\n\n> last audited 28-06-26 by project-scaffold (extra)\n' \
    > "$SCRATCH/CONTRIBUTING.md"
  export DRIFT_ROOT_OVERRIDE="$SCRATCH"
}

teardown() {
  # Nothing to restore: the fixture was a scratch tree and bats already removes
  # $BATS_TEST_TMPDIR. The old teardown restored CONTRIBUTING.md by copying a
  # backup over it, which is the step that silently un-did other work if a run
  # overlapped. There is no state in the repo for this test to leave behind now,
  # so there is nothing here that can go wrong.
  unset DRIFT_ROOT_OVERRIDE
}

@test "shape-violation: bad by-clause fires Check 10 with shape message" {
  run bash "$PROJECT_ROOT/.agents/skills/skill-drift-guard/scripts/detect.sh" \
      --check=doc-audit
  [ "$status" -ne 0 ]
  [[ "$output" == *"doc-audit"* ]]
  [[ "$output" == *"DD-MM-YY + by-clause"* ]]
  [[ ! "$output" == *"shape OK but date"* ]]
}
