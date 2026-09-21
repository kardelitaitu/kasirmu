#!/usr/bin/env bats
#
# Test: check1-vendored-path.bats
#
# Pins BOTH directions of Check 1 (paths) for the vendored-dependency case.
#
# Check 1 extracts path-looking tokens with a regex whose first segment cannot
# start at the `-` between a crate name and its version, so a cargo-registry
# citation `wry-0.55.1/src/android/main_pipe.rs` is extracted as the bare token
# `src/android/main_pipe.rs` — which then hits the `src*` arm and is reported as
# missing drift. It is not drift: that path exists in the registry, not the repo.
#
# Two failure modes are pinned here, and they pull in opposite directions:
#   * the fix must silence the versioned citation (case 1), and
#   * it must NOT silence a real missing path — alone (case 2), cited beside a
#     versioned one on the same line (case 3), at DEPTH (cases 5-7), or under
#     `ui/src/features/...` (case 7).
#
# The depth cases are not padding. An earlier revision of the fix silenced the
# truncated sibling with an unconditional `*/*/*/*/*` arm, which also swallowed
# every real 4+-slash repo path: `crates/kasirmu-core/src/db/x.rs` and
# `ui/src/features/staff/x.tsx` both went unreported. Cases 5-7 are exactly the
# probe that catches it; cases 1-4 all passed while the check was weakened.
#
# The probe lives in its own skill directory and is removed in teardown; no
# tracked file is ever touched (same contract as dead-check-regression.bats).

setup() {
  PROJECT_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../../../.." && pwd)"
  cd "$PROJECT_ROOT"
  PROBE_DIR="$PROJECT_ROOT/.agents/skills/__vendored_probe__"
  PROBE="$PROBE_DIR/SKILL.md"
}

teardown() {
  rm -rf "$PROBE_DIR"
  rm -f "$PROJECT_ROOT/skill-drift-report.md"
}

write_probe() {
  mkdir -p "$PROBE_DIR"
  printf '%s\n' "$1" > "$PROBE"
}

@test "paths: a versioned cargo-registry citation is NOT drift" {
  write_probe 'Cargo registry: wry-0.55.1/src/android/main_pipe.rs'
  run bash "$PROJECT_ROOT/.agents/skills/skill-drift-guard/scripts/detect.sh" \
      --check=paths
  [ "$status" -eq 0 ]
  [[ "$output" == *"No drift detected"* ]]
  [[ "$output" != *"src/android/main_pipe.rs"* ]]
}

@test "paths: a genuinely missing repo path is STILL reported" {
  write_probe 'References src/does-not-exist.rs'
  run bash "$PROJECT_ROOT/.agents/skills/skill-drift-guard/scripts/detect.sh" \
      --check=paths
  [ "$status" -ne 0 ]
  [[ "$output" == *"src/does-not-exist.rs"* ]]
}

@test "paths: a real path beside a versioned one is still reported" {
  # The versioned token and the missing repo path share ONE line, which is why
  # the skip has to be per-token and not per-line: skipping the line would hide
  # `src/does-not-exist.rs` and this is the only case that notices.
  write_probe 'wry-0.55.1/src/lib.rs and src/does-not-exist.rs'
  run bash "$PROJECT_ROOT/.agents/skills/skill-drift-guard/scripts/detect.sh" \
      --check=paths
  [ "$status" -ne 0 ]
  [[ "$output" == *"src/does-not-exist.rs"* ]]
  [[ "$output" != *": src/lib.rs"* ]]
}

@test "paths: an unversioned crate path keeps its pre-fix behaviour" {
  # `tauri/src/manager/mod.rs` never starts a match at a flagged prefix, so it
  # was never reported; the fix must not start reporting it either.
  write_probe 'see tauri/src/manager/mod.rs'
  run bash "$PROJECT_ROOT/.agents/skills/skill-drift-guard/scripts/detect.sh" \
      --check=paths
  [ "$status" -eq 0 ]
  [[ "$output" == *"No drift detected"* ]]
}

@test "paths: a 4-slash missing repo path is reported (no shape-based skip)" {
  # `crates/kasirmu-core/src/db/__missing__.rs` has four slashes. The check must
  # decide on the TOKEN, not its shape: an unconditional depth-based skip drops
  # this and every other deep path in the repo without a single finding.
  write_probe 'See crates/kasirmu-core/src/db/__missing__.rs for the writer.'
  run bash "$PROJECT_ROOT/.agents/skills/skill-drift-guard/scripts/detect.sh" \
      --check=paths
  [ "$status" -ne 0 ]
  [[ "$output" == *"crates/kasirmu-core/src/db/__missing__.rs"* ]]
}

@test "paths: a missing path under ui/src/features/ is reported" {
  # The most common repo shape there is. Same failure mode as the case above,
  # pinned separately because a future shape-based skip would hit it first.
  write_probe 'Rendered by ui/src/features/staff/__missing__.tsx'
  run bash "$PROJECT_ROOT/.agents/skills/skill-drift-guard/scripts/detect.sh" \
      --check=paths
  [ "$status" -ne 0 ]
  [[ "$output" == *"ui/src/features/staff/__missing__.tsx"* ]]
}

@test "paths: a deep real path beside a versioned token is still reported" {
  # The two mechanisms crossed: a vendored token is skipped by CONTEXT while the
  # deep path on the SAME line has no version prefix of its own and must survive.
  write_probe 'wry-0.55.1/src/lib.rs and crates/kasirmu-core/src/db/__deep__.rs'
  run bash "$PROJECT_ROOT/.agents/skills/skill-drift-guard/scripts/detect.sh" \
      --check=paths
  [ "$status" -ne 0 ]
  [[ "$output" == *"crates/kasirmu-core/src/db/__deep__.rs"* ]]
  [[ "$output" != *": src/lib.rs"* ]]
}

@test "paths: two versioned tokens on one line leave no findings" {
  # Multi-token line whose tokens EACH carry a version prefix. awk skips both on
  # their own context; nothing here should reach the reporter.
  write_probe 'wry-0.55.1/src/lib.rs and tokio-1.2.3/src/lib.rs'
  run bash "$PROJECT_ROOT/.agents/skills/skill-drift-guard/scripts/detect.sh" \
      --check=paths
  [ "$status" -eq 0 ]
  [[ "$output" == *"No drift detected"* ]]
}
