#!/usr/bin/env bats
#
# Test: dead-check-regression.bats
#
# Pins the invariant that every FINDINGS-accumulating loop runs in the
# PARENT shell. Checks 1, 3, 4, 6 and 7 used to accumulate inside a
# pipeline (`grep … | while read …`), which bash runs in a subshell — so
# every `FINDINGS[cat]+=…` write was discarded on loop exit and the
# checks reported "No drift detected" forever, no matter how drifted the
# skills became. The failure was completely silent: exit 0, green CI,
# and a committed clean report.
#
# Two layers of defence:
#   1. Behavioural — inject real drift per category, assert it FIRES.
#      Catches the class for the five checks that broke.
#   2. Structural — scan detect.sh for any pipeline-fed loop whose body
#      writes FINDINGS. Catches the class for every check, including
#      ones added in the future.
#
# Unlike the audit-footer tests this one never touches a tracked file: the
# probe lives in its own skill directory, removed in teardown, and the `refs`
# case drives Check 6 through its OG_FILE fixture override rather than editing
# onboarding-guide.

setup() {
  PROJECT_ROOT="$(cd "$(dirname "${BATS_TEST_FILENAME}")/../../../.." && pwd)"
  cd "$PROJECT_ROOT"
  PROBE_DIR="$PROJECT_ROOT/.agents/skills/__drift_probe__"
  PROBE="$PROBE_DIR/SKILL.md"
  # Check 6 only ever reads the onboarding guide, so point it at a throwaway
  # fixture via OG_FILE instead of mutating the tracked file. A
  # backup-and-restore there is NOT safe: a run killed mid-test leaves the
  # probe line committed into onboarding-guide, which then makes
  # clean-baseline.bats fail for everyone.
  OG_FIXTURE="$BATS_TEST_TMPDIR/onboarding-fixture.md"
}

teardown() {
  rm -rf "$PROBE_DIR"
  rm -f "$PROJECT_ROOT/skill-drift-report.md"
}

# Write a probe skill carrying one piece of drift per category, plus a
# valid audit footer so it never pollutes Checks 8/9/10.
write_probe() {
  mkdir -p "$PROBE_DIR"
  cat > "$PROBE" <<'PROBE_EOF'
---
name: __drift_probe__
description: temporary drift fixture for dead-check-regression.bats
---

# Drift probe

References ui/src/__drift_probe_missing__.tsx and crates/kasirmu-drift-probe-missing

```rust
let m = Money::from_major(100, Currency::Usd);
```

Quoted version "9.9.9" is not in the workspace.

```tsx
<Localized id="__drift_probe_missing_id__" />
```

> last audited 01-01-26 by probe
PROBE_EOF
}

# --------------------------------------------------------------------------
# Layer 1 — behavioural: each previously-dead check must actually fire
# --------------------------------------------------------------------------

@test "dead-check: Check 1 (paths) reports a missing project path" {
  write_probe
  run bash "$PROJECT_ROOT/.agents/skills/skill-drift-guard/scripts/detect.sh" \
      --check=paths
  [ "$status" -ne 0 ]
  [[ "$output" == *"__drift_probe_missing__.tsx"* ]]
}

@test "dead-check: Check 3 (api) reports a Money:: call in a code example" {
  write_probe
  run bash "$PROJECT_ROOT/.agents/skills/skill-drift-guard/scripts/detect.sh" \
      --check=api
  [ "$status" -ne 0 ]
  [[ "$output" == *"Money::from_major"* ]]
}

@test "dead-check: Check 4 (versions) reports a version absent from Cargo.toml" {
  write_probe
  run bash "$PROJECT_ROOT/.agents/skills/skill-drift-guard/scripts/detect.sh" \
      --check=versions
  [ "$status" -ne 0 ]
  [[ "$output" == *"9.9.9"* ]]
}

@test "dead-check: Check 7 (fluent) reports an id absent from ui/src/locales" {
  write_probe
  run bash "$PROJECT_ROOT/.agents/skills/skill-drift-guard/scripts/detect.sh" \
      --check=fluent
  [ "$status" -ne 0 ]
  [[ "$output" == *"__drift_probe_missing_id__"* ]]
}

@test "dead-check: Check 6 (refs) reports a broken skill reference" {
  # Check 6 reads only the onboarding guide; OG_FILE redirects it to a fixture.
  # NB: the extractor is `grep -oE '`[a-z][a-z-]+`'` — the token must be
  # lowercase-and-hyphens only, or it is never even considered.
  cat > "$OG_FIXTURE" <<'OG_EOF'
# Onboarding fixture

See the `drift-probe-missing-skill` skill for details.
OG_EOF
  run env OG_FILE="$OG_FIXTURE" \
      bash "$PROJECT_ROOT/.agents/skills/skill-drift-guard/scripts/detect.sh" \
      --check=refs
  [ "$status" -ne 0 ]
  [[ "$output" == *"drift-probe-missing-skill"* ]]
}

@test "dead-check: a still-alive check (crates) keeps firing" {
  # Guards against "fixing" the dead checks by breaking the live ones.
  write_probe
  run bash "$PROJECT_ROOT/.agents/skills/skill-drift-guard/scripts/detect.sh" \
      --check=crates
  [ "$status" -ne 0 ]
  [[ "$output" == *"kasirmu-drift-probe-missing"* ]]
}

# --------------------------------------------------------------------------
# Layer 2 — structural: no FINDINGS write may ever sit in a pipeline subshell
# --------------------------------------------------------------------------

@test "structure: no FINDINGS-accumulating loop is fed by a pipeline" {
  script="$PROJECT_ROOT/.agents/skills/skill-drift-guard/scripts/detect.sh"
  run awk '
    # A `while read` loop is pipeline-fed when the previous line ends in `|`.
    # Strip a trailing backslash-continuation first: the broken form was
    # written as a continued pipeline (grep … | sort -u | \  newline  while
    # read -r path; do), and matching a bare "|$" lets exactly that case
    # through — which is how this test first shipped while still passing
    # against the very script it was written to catch.
    /while[ \t]+read/ {
      inloop = 1; body = ""
      p = prev; sub(/[ \t]*\\[ \t]*$/, "", p)
      piped = (p ~ /\|[ \t]*$/)
    }
    inloop            { body = body $0 "\n" }
    /^[ \t]*done/ {
      if (inloop && body ~ /FINDINGS\[/ && piped) print "DEAD " NR
      inloop = 0
    }
    { prev = $0 }
  ' "$script"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "structure: every declared check category has an implementation block" {
  script="$PROJECT_ROOT/.agents/skills/skill-drift-guard/scripts/detect.sh"
  for cat in paths crates api versions golden refs fluent audit-date \
             audit-format doc-audit; do
    run grep -q "should_run ${cat};" "$script"
    [ "$status" -eq 0 ]
  done
}

# --------------------------------------------------------------------------
# Layer 3 — perf: Check 10 must stay prefiltered, and the prefilter must
# never drift away from the scan it feeds.
# --------------------------------------------------------------------------

@test "perf: Check 10 scans a prefiltered corpus, not every *.md" {
  script="$PROJECT_ROOT/.agents/skills/skill-drift-guard/scripts/detect.sh"
  # The corpus helper exists, batches grep into find, and is what feeds the
  # Check 10 loop. Reverting to a raw `find … | per-file grep` is a 15x
  # regression (90s -> 6s here) that eventually got runs killed mid-suite.
  run grep -qF 'md_footer_files()' "$script"
  [ "$status" -eq 0 ]
  run grep -qF 'done < <(md_footer_files)' "$script"
  [ "$status" -eq 0 ]
  # `-exec … +` specifically, not xargs: BSD/macOS xargs has no -r and would
  # run grep with no file arguments on an empty corpus, blocking on stdin.
  run grep -qF -- '-exec grep -lE "$FOOTER_RE" {} +' "$script"
  [ "$status" -eq 0 ]
}

@test "perf: prefilter and per-file scan share ONE footer pattern" {
  script="$PROJECT_ROOT/.agents/skills/skill-drift-guard/scripts/detect.sh"
  # THE LOAD-BEARING INVARIANT. The prefilter decides which files are read at
  # all; the scan decides what counts as a finding. If the two patterns ever
  # drift apart — prefilter narrower than the scan — files get skipped and
  # findings vanish silently, which is the exact failure class this whole
  # suite exists to stop. Both must reference $FOOTER_RE, and it must be
  # assigned exactly once.
  run grep -c '^FOOTER_RE=' "$script"
  [ "$output" -eq 1 ]
  run grep -qF 'grep -E "$FOOTER_RE" "$file"' "$script"
  [ "$status" -eq 0 ]
  # No second hard-coded copy of the pattern in either code path.
  run awk '/grep -E .\^> last audited|grep -lE .\^> last audited/ {print NR}' "$script"
  [ -z "$output" ]
}
