#!/usr/bin/env bash
# Asserts the UI typecheck TRIPWIRE in .githooks/post-commit actually fires, fires only
# when it should, records the right verdict, and can never abort a commit.
#
# Why extract the live block instead of reimplementing it: a test carrying its own copy
# of the trigger logic passes forever while the real tripwire silently never runs. The
# failure modes defended against here are the quiet ones -- a pathspec that matches
# nothing, a block placed below one of the hook's four early `exit 0` paths, a verdict
# written even though npm never ran. Same reason test-typecheck-gate.sh pulls the live
# step out of pre-commit.
#
# Why a REAL fixture repo and not a stubbed `git`: the trigger is git's own pathspec
# matching (ui/src/*.ts) against a commit, plus `--git-path` resolution. A stub that
# echoes a canned file list "passes" without exercising either. Only `npm` is stubbed,
# which keeps the run under a second and free of ui/node_modules.
#
# This script never touches the repository it runs from: no commits, no index, no
# hooks, no writes outside a mktemp dir. Run it with Git bash by full path -- bare
# `bash` on this machine is WSL and hangs:
#   & 'C:\Program Files\Git\bin\bash.exe' scripts/test-typecheck-tripwire.sh
set -u

HOOK=".githooks/post-commit"
[ -f "$HOOK" ] || { echo "FATAL: $HOOK not found (run from repo root)"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
ok()  { echo "  ok   - $*"; PASS=$((PASS+1)); }
bad() { echo "  FAIL - $*"; FAIL=$((FAIL+1)); }
check() { if [ "$2" = "$3" ]; then ok "$1 ($2)"; else bad "$1 (expected [$3], got [$2])"; fi; }

# -- Extract the live block --------------------------------------------------
START=$(grep -n '^# tripwire-start' "$HOOK" | head -1 | cut -d: -f1)
END=$(grep -n '^# tripwire-end' "$HOOK" | head -1 | cut -d: -f1)
[ -n "$START" ] || { echo "FATAL: no '# tripwire-start' marker in $HOOK -- the tripwire is gone"; exit 1; }
[ -n "$END" ]   || { echo "FATAL: no '# tripwire-end' marker in $HOOK -- the block is unterminated"; exit 1; }
[ "$END" -gt "$START" ] || { echo "FATAL: markers inverted (start L$START, end L$END)"; exit 1; }
sed -n "${START},${END}p" "$HOOK" > "$TMP/tripwire.sh"
NLINES=$(wc -l < "$TMP/tripwire.sh" | tr -d ' ')
echo "extracted ${NLINES} lines of live tripwire (hook L${START}-L${END})"
if [ "$NLINES" -lt 40 ] || [ "$NLINES" -gt 140 ]; then
  echo "FATAL: extracted $NLINES lines (expected 40..140) -- extraction is wrong"; exit 1
fi

echo "case 0 -- placement and shape (static)"
# The whole point of the block's position: it must precede every early exit in the
# hook, or CBM_SKIP_POST_COMMIT=1 / a missing indexer binary silently disables it.
FIRST_EXIT=$(grep -nF 'if [ "${CBM_SKIP_POST_COMMIT:-0}" = "1" ]; then' "$HOOK" | head -1 | cut -d: -f1)
if [ -n "$FIRST_EXIT" ] && [ "$START" -lt "$FIRST_EXIT" ]; then
  ok "block (L$START) sits above the first indexer early-exit (L$FIRST_EXIT)"
else
  bad "block is NOT above the indexer exits (block L${START:-none}, first exit L${FIRST_EXIT:-none})"
fi
if grep -qE '^[[:space:]]*exit[[:space:]]+[1-9]' "$TMP/tripwire.sh"; then
  bad "block contains a non-zero exit -- it could abort a commit"
else
  ok "block has no non-zero exit -- it cannot abort a commit"
fi
if grep -qE '^[[:space:]]*npm[[:space:]]+install' "$TMP/tripwire.sh"; then
  bad "block runs npm install -- it would mutate the tree"
else
  ok "block never runs npm install"
fi

# -- Fixture repo ------------------------------------------------------------
FIX="$TMP/fix"
mkdir -p "$FIX" && cd "$FIX" || exit 1
git init -q . 2>/dev/null
git config user.email t@t; git config user.name t
git config core.autocrlf false
mkdir -p ui/src/features/kds ui/src/api docs apps/desktop-client/src
printf 'export const a = 1;\n' > ui/src/features/kds/A.tsx
printf 'export const b = 1;\n' > ui/src/api/b.ts
printf '# d\n' > docs/x.md
printf 'x\n'  > README.md
# The block branches on `[ -d ui/node_modules ]`. Without this directory every
# "must fire" case takes the SKIP branch for a reason unrelated to the tripwire.
mkdir -p ui/node_modules
git add -A && git commit -q -m "chore: fixture base"

# npm stub: observable (counts invocations) and controllable (verdict via NPM_STUB_MODE).
mkdir -p "$TMP/bin"
cat > "$TMP/bin/npm" <<'STUB'
#!/bin/sh
echo ran >> "${NPM_STUB_LOG:?}"
case "${NPM_STUB_MODE:-pass}" in
  pass)  exit 0 ;;
  fail)  printf 'src/features/kds/A.tsx(1,1): error TS6133: a is never read\nsrc/api/b.ts(2,2): error TS2322: nope\n'; exit 2 ;;
  crash) printf 'npm ERR! code 1\nnpm ERR! enoent\n'; exit 1 ;;
esac
exit 0
STUB
chmod +x "$TMP/bin/npm"
PATH="$TMP/bin:$PATH"; export PATH
export NPM_STUB_LOG="$TMP/npm-ran"
LOGFILE="$FIX/.git/typecheck-tripwire.log"

run_block() { # args: env assignments for the block
  : > "$NPM_STUB_LOG"
  ( cd "$FIX" && env "$@" sh "$TMP/tripwire.sh" >"$TMP/out" 2>"$TMP/err" )
  RC=$?
  NRAN=$(wc -l < "$NPM_STUB_LOG" 2>/dev/null | tr -d ' '); [ -n "$NRAN" ] || NRAN=0
  if [ -f "$LOGFILE" ]; then NLINES_LOG=$(wc -l < "$LOGFILE" | tr -d ' '); else NLINES_LOG=absent; fi
}

N=0
fire() { # fire <mode>: make a NEW ui/src TypeScript commit, then run the block.
  # A new file every time on purpose -- committing an unchanged tree is a no-op,
  # which would silently leave HEAD on the previous (non-TypeScript) commit and
  # the tripwire would correctly write nothing while the test blamed the block.
  N=$((N+1))
  printf 'export const v = %s;\n' "$N" > "ui/src/api/t$N.ts"
  git add -A && git commit -q -m "feat(ui): ts change $N" \
    || { echo "FATAL: fixture commit $N failed -- the case cannot be evaluated"; exit 1; }
  run_block NPM_STUB_MODE="${1:-pass}"
}

echo "case 1 -- commit touching no TypeScript: writes nothing, runs nothing"
printf 'more docs\n' >> docs/x.md; printf 'fn main() {}\n' > apps/desktop-client/src/lib.rs
git add -A && git commit -q -m "docs: no typescript here"
run_block NPM_STUB_MODE=pass
check "exit code" "$RC" "0"
check "log file" "$NLINES_LOG" "absent"
check "npm invocations" "$NRAN" "0"

echo "case 2 -- commit touching clean TypeScript: exactly one PASS line"
fire pass
check "exit code" "$RC" "0"
check "log lines" "$NLINES_LOG" "1"
check "npm invocations" "$NRAN" "1"
LINE=$(head -1 "$LOGFILE" 2>/dev/null)
case "$LINE" in
  *" PASS errors=0"*) ok "line is a PASS verdict: $LINE" ;;
  *) bad "line is not a PASS verdict: [$LINE]" ;;
esac
case "$LINE" in
  *"$(git rev-parse --short HEAD)"*) ok "line names the commit that just landed" ;;
  *) bad "line does not name HEAD: [$LINE]" ;;
esac

echo "case 3 -- commit touching TypeScript while the tree is red: FAIL line with a count"
fire fail
check "exit code" "$RC" "0"
check "log lines" "$NLINES_LOG" "2"
check "npm invocations" "$NRAN" "1"
LINE=$(tail -1 "$LOGFILE" 2>/dev/null)
check "FAIL line carries the error count" "$(printf '%s' "$LINE" | grep -o 'FAIL errors=[0-9]*')" "FAIL errors=2"
if grep -qi 'tripwire' "$TMP/err" && grep -qi 'bypassed' "$TMP/err"; then
  ok "the red verdict is also shouted to stderr"
else
  bad "nothing loud on stderr: [$(head -2 "$TMP/err")]"
fi

echo "case 4 -- placement proof: CBM_SKIP_POST_COMMIT=1 must NOT skip the tripwire"
fire pass
BEFORE=$(wc -l < "$LOGFILE" | tr -d ' ')
run_block CBM_SKIP_POST_COMMIT=1 NPM_STUB_MODE=pass
AFTER=$(wc -l < "$LOGFILE" | tr -d ' ')
check "exit code" "$RC" "0"
check "npm still ran under CBM_SKIP_POST_COMMIT" "$NRAN" "1"
check "log still grew (block is above the indexer exits)" "$AFTER" "$((BEFORE+1))"

echo "case 5 -- a broken check is ERROR, not an invented FAIL"
fire crash
LINE=$(tail -1 "$LOGFILE" 2>/dev/null)
check "verdict when npm itself fails" "$(printf '%s' "$LINE" | grep -oE 'ERROR|FAIL|PASS')" "ERROR"

echo "case 6 -- the log holds a verdict and nothing else"
if grep -q 'ui/src' "$LOGFILE"; then bad "log leaked a file path"; else ok "log has no file paths"; fi
if grep -qE 'error TS|diff --git' "$LOGFILE"; then bad "log leaked diagnostics or a diff"; else ok "log has no diagnostics and no diff"; fi
LONG=$(awk '{ if (length($0)>m) m=length($0) } END { print m+0 }' "$LOGFILE")
if [ "$LONG" -le 120 ]; then ok "longest log line is $LONG chars (bounded)"; else bad "log line is $LONG chars -- unbounded content leaked"; fi

echo "case 7 -- no side effects on the tree"
DIRTY=$(git status --porcelain | wc -l | tr -d ' ')
check "fixture working tree still clean after every firing" "$DIRTY" "0"

echo ""
echo "tripwire test: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
