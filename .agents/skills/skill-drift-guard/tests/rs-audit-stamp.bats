#!/usr/bin/env bats
#
# Test: rs-audit-stamp.bats
#
# Pins Check 16 — the unsubstituted `DD-MM-YY` placeholder in a `.rs` audit
# stamp. Before this check existed NOTHING looked at `.rs` stamps at all:
# AUDIT_RE and FOOTER_RE (Checks 9/10) both require a leading `> ` markdown
# blockquote, and Check 10's corpus is md_footer_files (`*.md` only), so no
# `.rs` file was ever in a corpus the guard reads — and the template had
# survived in 31 production files / 43 occurrences.
#
# Two cases, because a check that only ever passes is not a check:
#   1. a probe carrying the placeholder must FIRE, naming file:line;
#   2. a probe carrying the sanctioned `(date unknown)` marker must be SILENT
#      (the marker is the honest repair for a date nobody recorded; forbidding
#      it would force a fabricated date, which is the worse defect).
#
# The probe lives in its own directory under `.agents/` — deliberately NOT
# under `.agents/skills/`, so no skill-inventory check ever sees it — and is
# removed in teardown. It touches no tracked file.

setup() {
  PROJECT_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../../../.." && pwd)"
  cd "$PROJECT_ROOT"
  PROBE_DIR="$PROJECT_ROOT/.agents/__rs_stamp_probe__"
  PROBE="$PROBE_DIR/probe.rs"
}

teardown() {
  rm -rf "$PROBE_DIR"
  rm -f "$PROJECT_ROOT/skill-drift-report.md"
}

@test "rs-audit-stamp: fires on an unsubstituted DD-MM-YY placeholder" {
  mkdir -p "$PROBE_DIR"
  cat > "$PROBE" <<'PROBE_EOF'
/*
last audited DD-MM-YY by probe
crate: probe | status: SAFE | lint: CLEAN
findings: deliberate fixture for rs-audit-stamp.bats
*/
PROBE_EOF
  run bash "$PROJECT_ROOT/.agents/skills/skill-drift-guard/scripts/detect.sh" \
      --check=rs-audit-stamp
  [ "$status" -ne 0 ]
  [[ "$output" == *"unsubstituted audit-stamp placeholder"* ]]
  [[ "$output" == *"__rs_stamp_probe__/probe.rs:2"* ]]
}

@test "rs-audit-stamp: silent on the sanctioned (date unknown) marker" {
  mkdir -p "$PROBE_DIR"
  cat > "$PROBE" <<'PROBE_EOF'
/*
last audited (date unknown) by probe
crate: probe | status: SAFE | lint: CLEAN
findings: deliberate fixture for rs-audit-stamp.bats
*/
PROBE_EOF
  run bash "$PROJECT_ROOT/.agents/skills/skill-drift-guard/scripts/detect.sh" \
      --check=rs-audit-stamp
  [ "$status" -eq 0 ]
  [[ "$output" == *"No drift detected"* ]]
}
