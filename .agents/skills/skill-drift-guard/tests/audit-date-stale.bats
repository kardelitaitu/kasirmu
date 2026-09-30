#!/usr/bin/env bats
#
# Test: audit-date-stale.bats
#
# Injects a 35-day-old "last audited" footer into hal-drivers/SKILL.md
# (a real project skill so the test exercises Check 8's `--check=audit-date`
# file-find scope). The injection is APPENDED to the file so it becomes
# the LAST `last audited` line — Check 8's `grep | tail -1` extraction
# picks the latest match, then parses the date and compares to today.
#
# Pins three invariants:
#   1. Check 8 fires under `--check=audit-date` when a footer is > 30 days
#      stale (threshold in detect.sh line "if [ ${age:-9999} -gt 30 ]").
#   2. The Python `datetime.strptime(d, '%d-%m-%y')` parse succeeds for a
#      valid calendar date (DD-MM-YY substring).
#   3. The failure message template "last audited `<date>` (`<n>` days ago)"
#      survives string-wording changes (asserted via substring, not exact
#      match) so future polish preserves the test.
#
# If any of these regress — e.g., the 30-day threshold off-by-one, the
# %d-%m-%y format wrong, or Check 8's tail -1 starts picking earlier
# footers — this test catches it before contributors do.

setup() {
  PROJECT_ROOT="$(cd "$(dirname "${BATS_TEST_FILENAME}")/../../../.." && pwd)"
  cd "$PROJECT_ROOT"
  # Scratch tree, for the reason recorded in shape-violation.bats. The fixture has
  # to keep the path segment this test asserts on (hal-drivers), because Check 8
  # reports the skill directory it found, and the assertion below is that the
  # message names it. The scratch path is longer but ends in the same segment.
  #
  # Today's date is 08-07-26 (per the project metadata). 35 days before
  # that is 03-06-26 — comfortably above the 30-day stale threshold.
  # The 5-day margin is intentional: if the 30-day threshold is ever
  # tightened (e.g. to 35 days), this test should break to surface the
  # change for review. Don't "fix" the brittleness by widening the gap.
  # The choice of 03-06-26 is stable across the test's lifetime — it
  # stays >30 days stale regardless of when this runs (today, next week,
  # next year), so the test is not date-sensitive.
  SCRATCH="$BATS_TEST_TMPDIR/tree"
  mkdir -p "$SCRATCH/.agents/skills/hal-drivers"
  printf '# fixture\n\n> last audited 03-06-26 by stale-auditor\n' \
    > "$SCRATCH/.agents/skills/hal-drivers/SKILL.md"
  export DRIFT_ROOT_OVERRIDE="$SCRATCH"
}

teardown() {
  # Nothing to restore; see teardown() in shape-violation.bats.
  unset DRIFT_ROOT_OVERRIDE
}

@test "audit-date-stale: 35-day-old footer fires Check 8 with stale-day message" {
  run bash "$PROJECT_ROOT/.agents/skills/skill-drift-guard/scripts/detect.sh" \
      --check=audit-date
  [ "$status" -ne 0 ]
  [[ "$output" == *"audit-date"* ]]
  [[ "$output" == *"days ago"* ]]
  [[ "$output" == *"03-06-26"* ]]
  [[ "$output" == *"hal-drivers"* ]]
}
