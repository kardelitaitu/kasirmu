#!/usr/bin/env bats
#
# Test: crate-prefix-allowlist.bats
#
# Pins the semantics of Check 12's PREFIX_ALLOWLIST.
#
# The check matched the allowlist with `case "$tok" in ${PREFIX_ALLOWLIST}*)`.
# A case pattern is NOT word-split, so the list was effectively SINGLE-ENTRY:
# setting it to two entries (`oz-pos oz-cloud`) produced the one literal
# pattern `oz-pos oz-cloud*`, which matched NEITHER `oz-cloud` NOR the
# previously-working `oz-pos-cloud`. Only `oz-*` matched — and that disables
# the check outright.
#
# The symptom was the inverse of the usual one: ADDING an exception made more
# findings appear, and the only way to silence them was to stop checking. So
# the multi-entry case is the load-bearing assertion here, not the
# single-entry one — a test that only checked `oz-pos` would have passed
# against the broken script.
#
# The probe lives in its own skill directory and is removed in teardown; no
# tracked file is ever touched (same contract as dead-check-regression.bats).

setup() {
  PROJECT_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../../../.." && pwd)"
  cd "$PROJECT_ROOT"
  PROBE_DIR="$PROJECT_ROOT/.agents/skills/__prefix_probe__"
  PROBE="$PROBE_DIR/SKILL.md"
}

teardown() {
  rm -rf "$PROBE_DIR"
  rm -f "$PROJECT_ROOT/skill-drift-report.md"
}

write_probe() {
  mkdir -p "$PROBE_DIR"
  cat > "$PROBE" <<'PROBE_EOF'
---
name: __prefix_probe__
description: temporary crate-prefix fixture
---

A retired crate name: oz-legacy-thing.

Historical artifacts that are NOT crates: oz-pos-cloud, oz-pos-unified, oz-cloud-server.
PROBE_EOF
}

@test "crate-prefix: a retired oz- crate name still fires" {
  write_probe
  run bash "$PROJECT_ROOT/.agents/skills/skill-drift-guard/scripts/detect.sh" \
      --check=crate-prefix
  [ "$status" -ne 0 ]
  [[ "$output" == *"oz-legacy"* ]]
}

@test "crate-prefix: every allow-listed prefix is silent, and adds no finding" {
  write_probe
  run bash "$PROJECT_ROOT/.agents/skills/skill-drift-guard/scripts/detect.sh" \
      --check=crate-prefix
  # `oz-pos-cloud` is the regression canary: the OLD single-entry list silenced
  # it, and a two-entry list written into a case pattern un-silenced it. It must
  # stay silent. (`oz-pos-unified` and `oz-cloud-server` both collapse to an
  # allow-listed prefix, since the token regex stops at the second `-`.)
  [[ "$output" != *"oz-pos-cloud"* ]]
  [[ "$output" != *"oz-pos-unified"* ]]
  [[ "$output" != *"oz-cloud"* ]]
  # And the allow-listed tokens must not each contribute a finding: the probe
  # carries exactly one real problem, so it must yield exactly one finding.
  # Scope the count to the probe: a stale token in some OTHER skill is a real
  # finding belonging to that skill, and this test must not go red for it.
  # (It caught exactly that once — the row documenting this test was added to
  # skill-drift-guard/SKILL.md with a literal retired token in it, and the
  # tree-wide count saw 2. The guard scanning its own docs is correct; the
  # tree-wide assertion was the bug.)
  # Count finding lines rather than the report's "(N findings)" wording, so
  # fixing the pluralisation there cannot break this test.
  count="$(printf '%s\n' "$output" \
    | grep 'stale crate-name reference' \
    | grep -c '__prefix_probe__' || true)"
  [ "$count" -eq 1 ]
}
