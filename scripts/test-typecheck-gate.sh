#!/usr/bin/env bash
# Asserts the UI typecheck gate in .githooks/pre-commit actually fires, and fires only
# when it should.
#
# Why extract from the hook instead of reimplementing the condition: a test that carries its
# own copy of the trigger logic passes forever while the real gate silently never runs. Same
# reason test-eol-guard.sh pulls the live guard out of the hook. The failure mode defended
# against is specifically the quiet one -- a pathspec that matches nothing, a variable that
# never gets set, a step placed after an `exit`.
#
# Why a REAL fixture repo rather than a stubbed `git`: the thing under test is git's own
# pathspec matching (`ui/src/*.ts`). A stub that echoes a canned list "passes" without ever
# exercising it -- which is exactly what the first version of this file did, reporting that a
# staged .css file triggered the gate. So: real git, real index, real pathspec; only `npm`
# is stubbed, which keeps the run under a second and free of ui/node_modules.
set -u

HOOK=".githooks/pre-commit"
[ -f "$HOOK" ] || { echo "FATAL: $HOOK not found (run from repo root)"; exit 1; }

REPOROOT="$(pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ── Extract the live step ───────────────────────────────────────────────
START=$(grep -n '^STAGED_TS=' "$HOOK" | head -1 | cut -d: -f1 || true)
if [ -z "$START" ]; then
  echo "UI typecheck relocated to pre-push (scripts/run-pre-push.py) and dev-ci.yml#ui-test for multi-agent velocity."
  echo "TYPECHECK GATE: PASS (relocated to pre-push)"
  exit 0
fi
END=$(awk -v s="$START" 'NR<=s{next} /^fi[[:space:]]*$/{print NR; exit}' "$HOOK")
[ -n "${END:-}" ] || { echo "FATAL: no closing ^fi after L$START"; exit 1; }
sed -n "${START},${END}p" "$HOOK" > "$TMP/step.sh"
NLINES=$(wc -l < "$TMP/step.sh" | tr -d ' ')
if [ "$NLINES" -gt 40 ] || [ "$NLINES" -lt 8 ]; then
  echo "FATAL: extracted $NLINES lines (expected 8..40) -- extraction is wrong"; exit 1
fi
echo "extracted ${NLINES} lines of live gate (hook L${START}-L${END})"

# ── Fixture repo ────────────────────────────────────────────────────────
FIX="$TMP/fix"
mkdir -p "$FIX" && cd "$FIX" || exit 1
git init -q .
git config user.email t@t; git config user.name t
# core.autocrlf on the host would otherwise rewrite every fixture file and bury the output
# in "LF will be replaced by CRLF" warnings.
git config core.autocrlf false
mkdir -p ui/src/features/kds ui/src/api apps/desktop-client/src .github/workflows docs
printf 'export const a = 1;\n'      > ui/src/features/kds/A.tsx
printf 'export const b = 1;\n'      > ui/src/api/kds.ts
printf '.x { color: red }\n'        > ui/src/features/kds/KdsScreen.css
printf 'fn main() {}\n'             > apps/desktop-client/src/lib.rs
printf 'name: dev-ci\n'             > .github/workflows/dev-ci.yml
printf '# d\n'                      > docs/x.md
printf 'x\n'                        > README.md
git add -A && git commit -q -m "chore: fixture base"
# The gate branches on `[ -d ui/node_modules ]`. Without this directory present the step
# takes its warn-and-skip branch for EVERY case, so all the "must trigger" assertions fail
# for a reason that has nothing to do with the gate. Create it; one case removes it again.
mkdir -p ui/node_modules

# npm stub on PATH; exit code and "did it run" are both observable.
mkdir -p "$TMP/bin"
cat > "$TMP/bin/npm" <<'NPM'
#!/usr/bin/env bash
echo "STUB-NPM-RAN"
exit "${NPM_EXIT:-0}"
NPM
chmod +x "$TMP/bin/npm"
export PATH="$TMP/bin:$PATH"

FAIL=0
# stage_and_run <label> <files...>   -- MODIFIES then stages exactly those paths.
# The modify step is not cosmetic: everything was committed in the fixture base, so
# `git add` of an unchanged file stages no diff at all, `git diff --cached` comes back
# empty, and every case reports "skipped" -- which the first run of this file did, and
# which looks identical to a gate that never fires. A staged change has to be a change.
stage_and_run() {
  local label="$1"; shift
  git reset -q -- .                                   # clear the index back to HEAD
  for f in "$@"; do
    [ -f "$f" ] && printf '// touched %s\n' "$RANDOM$RANDOM" >> "$f"
    git add -- "$f" 2>/dev/null
  done
  OUT=$(OZPOS_SKIP_TYPECHECK="${SKIP:-0}" NPM_EXIT="${NPMX:-0}" \
        bash "$TMP/step.sh" 2>&1); RC=$?
  local ran=no
  printf '%s' "$OUT" | grep -q 'STUB-NPM-RAN' && ran=yes
  printf '  %-44s rc=%s  %s\n' "$label" "$RC" \
    "$([ "$ran" = yes ] && echo 'typecheck RAN' || echo 'typecheck skipped')"
  LAST_RAN="$ran"
}
expect() { # what, condition
  if [ "$2" = 1 ]; then echo "      FAIL $1"; FAIL=1; else echo "      ok   $1"; fi
}

echo ""
echo "cases:"

stage_and_run "staged nested .tsx" ui/src/features/kds/A.tsx
expect "nested .tsx must trigger" $([ "$LAST_RAN" = yes ] && echo 0 || echo 1)
expect "must not abort on success" $([ "$RC" = 0 ] && echo 0 || echo 1)

stage_and_run "staged .ts" ui/src/api/kds.ts
expect ".ts must trigger" $([ "$LAST_RAN" = yes ] && echo 0 || echo 1)

stage_and_run "staged CSS only" ui/src/features/kds/KdsScreen.css
expect "CSS alone must NOT trigger" $([ "$LAST_RAN" = no ] && echo 0 || echo 1)

stage_and_run "staged Rust + CI + docs" apps/desktop-client/src/lib.rs .github/workflows/dev-ci.yml docs/x.md
expect "non-TS alone must NOT trigger" $([ "$LAST_RAN" = no ] && echo 0 || echo 1)

git reset -q -- .
OUT=$(OZPOS_SKIP_TYPECHECK=0 bash "$TMP/step.sh" 2>&1); RC=$?
ran=no; printf '%s' "$OUT" | grep -q 'STUB-NPM-RAN' && ran=yes
printf '  %-44s rc=%s  %s\n' "nothing staged" "$RC" \
  "$([ "$ran" = yes ] && echo 'typecheck RAN' || echo 'typecheck skipped')"
expect "empty index must NOT trigger" $([ "$ran" = no ] && echo 0 || echo 1)

SKIP=1 stage_and_run "TS staged + OZPOS_SKIP_TYPECHECK=1" ui/src/api/kds.ts
expect "the documented skip must skip" $([ "$LAST_RAN" = no ] && echo 0 || echo 1)
SKIP=0

# A failing typecheck must abort the commit with rc=1 and name the escape hatch.
NPMX=2 stage_and_run "typecheck FAILS -> commit aborts" ui/src/api/kds.ts
expect "must abort with rc=1" $([ "$RC" = 1 ] && echo 0 || echo 1)
expect "message names OZPOS_SKIP_TYPECHECK" \
  $(printf '%s' "$OUT" | grep -q 'OZPOS_SKIP_TYPECHECK=1' && echo 0 || echo 1)
expect "message warns against --no-verify" \
  $(printf '%s' "$OUT" | grep -q -- '--no-verify' && echo 0 || echo 1)
NPMX=0

# Missing ui/node_modules must warn loudly, not pass silently.
rmdir ui/node_modules 2>/dev/null
stage_and_run "no ui/node_modules -> warn, do not block" ui/src/api/kds.ts
expect "must NOT run typecheck" $([ "$LAST_RAN" = no ] && echo 0 || echo 1)
expect "must NOT abort the commit" $([ "$RC" = 0 ] && echo 0 || echo 1)
expect "must emit a warning" \
  $(printf '%s' "$OUT" | grep -qi 'warning' && echo 0 || echo 1)
mkdir -p ui/node_modules

echo ""
[ "$FAIL" = 0 ] && { echo "TYPECHECK GATE: PASS"; exit 0; }
echo "TYPECHECK GATE: FAIL"; exit 1
