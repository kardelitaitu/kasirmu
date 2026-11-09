#!/usr/bin/env bash
# Prove verify-no-raw-params.sh can still FAIL, and still PASS the shape it must not flag.
#
# WHY THIS EXISTS
# ---------------
# The gate greps for one literal per parameter name -- `store_id: String` and
# `user_id: String` -- inside apps/desktop-tauri/src/commands. Two things can silently
# empty its corpus and leave it printing PASS forever:
#
#   1. a command MOVES out of that directory, or the directory is renamed;
#   2. the parameter TYPE changes shape (UUID, i64, Option<String>) so the literal no
#      longer matches, while the unscoped parameter is still there.
#
# Neither is hypothetical in kind: this project has already shipped a gate that
# exempted every file it scanned, and another whose detector stopped matching after a
# rename. A detector of this shape needs a planted violation to stay honest.
#
# MEASURED 2026-10-23: with a probe file declaring a command that takes
# `store_id: String` and has no `_scoped` twin, the gate reported VIOLATION and
# FAIL: 1. So the detector was alive. Nothing in the tree PINNED that -- this does.
#
# The probe is written into the REAL command directory because that is the tree the
# gate walks. It is removed on every exit path by the trap, and the name is chosen to
# sort first and be obvious in `git status` if a run is killed.
#
# Usage: bash scripts/test-no-raw-params.sh   (from the workspace root)
# Exit 0 = the gate is proven both ways. Non-zero = it is not, and says which way.

set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

GATE="scripts/verify-no-raw-params.sh"
PROBE_DIR="apps/desktop-tauri/src/commands"
PROBE="$PROBE_DIR/__zz_falsification_probe.rs"

[ -f "$GATE" ] || { echo "FATAL: $GATE not found"; exit 1; }
[ -d "$PROBE_DIR" ] || { echo "FATAL: $PROBE_DIR not found -- the gate corpus is gone"; exit 1; }

cleanup() { rm -f "$PROBE"; }
trap cleanup EXIT
trap 'cleanup; exit 130' INT TERM

fails=0
note() { printf "  %-52s %s\n" "$1" "$2"; }

# ── CASE 1: a real violation MUST fire ─────────────────────────────────────
# A command with `store_id: String` and no `_scoped` twin is exactly the shape
# ADR #7 Phase 4 forbids. If the gate returns 0 here it is deaf.
cat > "$PROBE" <<PROBE_EOF
//! Falsification probe -- written and deleted by scripts/test-no-raw-params.sh.
#[tauri::command]
pub async fn probe_ungated_command(store_id: String) -> Result<(), String> {
    Ok(())
}
PROBE_EOF

set +e
out1=$(bash "$GATE" 2>&1); rc1=$?
set -e

if [ "$rc1" -ne 1 ]; then
  note "a planted violation FIRES" "FAIL (rc=$rc1, want 1)"
  printf "%s\n" "$out1" | tail -5 | sed "s/^/      /"
  echo "      the gate did not fail a real unscoped parameter -- it is deaf in the"
  echo "      direction that matters most."
  fails=$((fails + 1))
elif ! printf "%s" "$out1" | grep -q "VIOLATION in .*__zz_falsification_probe.rs"; then
  note "a planted violation FIRES" "FAIL (rc=1 but the probe is not named)"
  printf "%s\n" "$out1" | tail -5 | sed "s/^/      /"
  echo "      a failure that does not name the file cannot be acted on, and may be"
  echo "      failing for an unrelated reason."
  fails=$((fails + 1))
else
  note "a planted violation FIRES" "ok"
fi

# ── CASE 2: the SAME parameter WITH a _scoped twin must NOT fire ───────────
# This is the backward-compat shape the gate deliberately allows. A gate that fails
# here fails every legitimate deprecation and would be turned off within a day.
cat > "$PROBE" <<PROBE_EOF
//! Falsification probe -- written and deleted by scripts/test-no-raw-params.sh.
#[tauri::command]
pub async fn probe_paired_command(store_id: String) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn probe_paired_command_scoped(session_token: String) -> Result<(), String> {
    Ok(())
}
PROBE_EOF

set +e
out2=$(bash "$GATE" 2>&1); rc2=$?
set -e

if [ "$rc2" -ne 0 ]; then
  note "the paired shape stays quiet" "FAIL (rc=$rc2, want 0)"
  printf "%s\n" "$out2" | tail -5 | sed "s/^/      /"
  echo "      a deprecated command with a _scoped twin is ALLOWED; failing it would make"
  echo "      every legitimate deprecation a build break."
  fails=$((fails + 1))
else
  note "the paired shape stays quiet" "ok"
fi

cleanup

if [ "$fails" -ne 0 ]; then
  echo "no-raw-params falsification: $fails case(s) failed." >&2
  exit 1
fi
echo "no-raw-params falsification: both directions proven (fires on a raw parameter, silent on a paired one)."
exit 0
