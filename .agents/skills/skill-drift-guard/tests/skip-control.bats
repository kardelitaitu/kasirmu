#!/usr/bin/env bats
#
# Test: skip-control.bats
#
# Pins the SKIP control, which until 2026-09-30 was advertised in detect.sh's own
# usage block (`SKIP=api,golden ./detect.sh`) and NEVER READ -- `grep -n
# '\${SKIP\|SKIP='` returned only that comment line, while both named checks did
# exist, so the example looked correct. A reader trying to skip the 4m52s
# doc-audit check got the full ~14m16s run and no warning.
#
# Three cases, and the observable is deliberately STRONG. "No drift detected" is
# a weak assertion -- a check that runs and finds nothing prints exactly that --
# so case 2 and 3 seed a probe that is known to FIRE, and prove the skip by its
# silence. A test that could not tell "skipped" from "ran and found nothing"
# would be the same defect as the control it is pinning.
#
# The probe lives under `.agents/` but NOT under `.agents/skills/`, so no
# skill-inventory check sees it, and is removed in teardown. No tracked file is
# touched.

setup() {
  PROJECT_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../../../.." && pwd)"
  cd "$PROJECT_ROOT"
  PROBE_DIR="$PROJECT_ROOT/.agents/__skip_probe__"
  PROBE="$PROBE_DIR/probe.rs"
  DETECT="$PROJECT_ROOT/.agents/skills/skill-drift-guard/scripts/detect.sh"

  # Every check except rs-audit-stamp. Skipping the 15 slow ones keeps this test
  # at seconds instead of minutes while leaving exactly one check able to speak.
  ALL_BUT_RS="paths,crates,api,versions,golden,refs,fluent,audit-date,audit-format,doc-audit,version-lock,crate-prefix,ci-jobs,workflow-claims,git-policy"
  ALL="paths,crates,api,versions,golden,refs,fluent,audit-date,audit-format,doc-audit,version-lock,crate-prefix,ci-jobs,workflow-claims,git-policy,rs-audit-stamp"

  mkdir -p "$PROBE_DIR"
  cat > "$PROBE" <<'PROBE_EOF'
/*
last audited DD-MM-YY by probe
crate: probe | status: SAFE | lint: CLEAN
findings: deliberate fixture for skip-control.bats
*/
PROBE_EOF
}

teardown() {
  rm -rf "$PROBE_DIR"
  rm -f "$PROJECT_ROOT/skill-drift-report.md"
}

@test "skip-control: the probe fires when its check is NOT skipped (control)" {
  run env SKIP="$ALL_BUT_RS" bash "$DETECT"
  [ "$status" -ne 0 ]
  [[ "$output" == *"unsubstituted audit-stamp placeholder"* ]]
}

@test "skip-control: SKIP suppresses the check that would otherwise fire" {
  run env SKIP="$ALL" bash "$DETECT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"No drift detected"* ]]
  [[ "$output" != *"unsubstituted audit-stamp placeholder"* ]]
}

@test "skip-control: an unknown name is rejected, not silently ignored" {
  run env SKIP="bogus-check" bash "$DETECT"
  [ "$status" -eq 1 ]
  [[ "$output" == *"SKIP names unknown check(s): bogus-check"* ]]
  # The rejection lists the real names, so a typo is self-correcting.
  [[ "$output" == *"rs-audit-stamp"* ]]
  [[ "$output" == *"doc-audit"* ]]
}

@test "skip-control: --check= outranks SKIP rather than silently emptying the report" {
  # A name passed to both must still run: --check= is an explicit "run exactly
  # this" request. Without the precedence rule the run would print a clean
  # report and the caller would believe the check had passed.
  run env SKIP="rs-audit-stamp" bash "$DETECT" --check=rs-audit-stamp
  [ "$status" -ne 0 ]
  [[ "$output" == *"unsubstituted audit-stamp placeholder"* ]]
}
