#!/usr/bin/env bats
#
# Test: check1-dead-path-note.bats
#
# Pins BOTH directions of Check 1 (paths) for the DEAD-PATH-IN-PROSE case.
#
# A skill that documents a correction must be able to NAME the path it corrected
# from. Three live examples were reported as drift on 2026-10-13 and none is a
# claim that the path exists:
#
#   docs-auditor/SKILL.md:497        "the true old path was `ui/src/styles/tokens.css`"
#   deploy-cloudflare/SKILL.md:148   "website.yml deliberately does NOT build the
#                                     portal (`docs/book` is untracked)"
#   figma-bridge/SKILL.md:17         "a deploy-cloudflare `docs/book` hit that is a
#                                     dated note about an untracked path, not a claim"
#
# figma-bridge even records that the guard reports it and calls it a false positive,
# so the finding was being carried as accepted noise — which is how a gate stops
# being read.
#
# The fix follows the check's own precedent for the vendored-path case: decide on
# the LINE CONTEXT in awk, not on the token. A path is a citation of something GONE
# when the text before it says so.
#
# WHY BOTH DIRECTIONS ARE PINNED HERE. Silencing 'old/gone/untracked' near a path
# is one adjective away from silencing a real finding. The negative cases below are
# not padding: they are the shapes a lazy context test would swallow. Same contract
# as check1-vendored-path.bats — the probe lives in its own skill directory and no
# tracked file is touched.

setup() {
  PROJECT_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../../../.." && pwd)"
  cd "$PROJECT_ROOT"
  PROBE_DIR="$PROJECT_ROOT/.agents/skills/__deadpath_probe__"
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

# ── the three real shapes: NOT drift ─────────────────────────────────────────

@test "paths: a path named as the TRUE OLD PATH is not drift" {
  write_probe 'the true old path was `ui/src/styles/tokens.css`; it moved to ui/src/theme/'
  run bash "$PROJECT_ROOT/.agents/skills/skill-drift-guard/scripts/detect.sh" --check=paths
  [ "$status" -eq 0 ]
  [[ "$output" == *"No drift detected"* ]]
  [[ "$output" != *"ui/src/styles/tokens.css"* ]]
}

@test "paths: a path in an 'is untracked' clause is not drift" {
  write_probe 'website.yml deliberately does NOT build the portal (`docs/book` is untracked)'
  run bash "$PROJECT_ROOT/.agents/skills/skill-drift-guard/scripts/detect.sh" --check=paths
  [ "$status" -eq 0 ]
  [[ "$output" == *"No drift detected"* ]]
}

@test "paths: a path described as a dated NOTE is not drift" {
  write_probe 'the remaining findings are the pre-existing ones plus a `docs/book` hit that is a dated note'
  run bash "$PROJECT_ROOT/.agents/skills/skill-drift-guard/scripts/detect.sh" --check=paths
  [ "$status" -eq 0 ]
  [[ "$output" == *"No drift detected"* ]]
}

@test "paths: the three real skills report no dead-path finding" {
  # The end-to-end shape: run the guard as shipped and assert the three specific
  # false positives from 2026-10-13 are gone. This is what a reader checks.
  run bash "$PROJECT_ROOT/.agents/skills/skill-drift-guard/scripts/detect.sh" --check=paths
  [[ "$output" != *"docs/book"* ]]
  [[ "$output" != *"ui/src/styles/tokens.css"* ]]
}

# ── the shapes a lazy context test would swallow: STILL drift ─────────────────

@test "paths: a plain missing repo path is still reported" {
  write_probe 'References src/does-not-exist.rs for the writer.'
  run bash "$PROJECT_ROOT/.agents/skills/skill-drift-guard/scripts/detect.sh" --check=paths
  [ "$status" -ne 0 ]
  [[ "$output" == *"src/does-not-exist.rs"* ]]
}

@test "paths: 'old' far from the path does not excuse it" {
  # The context marker must be ADJACENT to the token. A paragraph that happens to
  # contain 'old' somewhere cannot silence a real finding on another clause.
  write_probe 'This old document is superseded. See crates/kasirmu-core/src/db/__missing__.rs now.'
  run bash "$PROJECT_ROOT/.agents/skills/skill-drift-guard/scripts/detect.sh" --check=paths
  [ "$status" -ne 0 ]
  [[ "$output" == *"crates/kasirmu-core/src/db/__missing__.rs"* ]]
}

@test "paths: a dead note and a real path on ONE line keeps the real one" {
  # Per-TOKEN, not per-line. The vendored fix needed the same property and says so.
  write_probe 'the old path was ui/src/theme/__gone__.css but staff use ui/src/features/staff/__missing__.tsx'
  run bash "$PROJECT_ROOT/.agents/skills/skill-drift-guard/scripts/detect.sh" --check=paths
  [ "$status" -ne 0 ]
  [[ "$output" == *"ui/src/features/staff/__missing__.tsx"* ]]
  [[ "$output" != *"__gone__.css"* ]]
}

@test "paths: a deep real path under ui/src/features/ is still reported" {
  write_probe 'Rendered by ui/src/features/staff/__missing__.tsx'
  run bash "$PROJECT_ROOT/.agents/skills/skill-drift-guard/scripts/detect.sh" --check=paths
  [ "$status" -ne 0 ]
  [[ "$output" == *"ui/src/features/staff/__missing__.tsx"* ]]
}
