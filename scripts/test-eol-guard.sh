#!/usr/bin/env bash
# Prove the pre-commit EOL net leaves alone what it must not touch.
#
# Two bugs, both found by reading the filter against .gitattributes rather than
# trusting its comment:
#
#   1. `*.bat text eol=crlf` -- the loop checked `text` but not `eol`, so it
#      stripped CRs from the WORKING TREE of batch files. The index storing LF is
#      correct (.gitattributes says so); the working tree is meant to be CRLF
#      because cmd.exe mis-parses labels/goto otherwise. Side effect: `git status`
#      reports the file modified with a zero content diff -- phantom M.
#
#   2. `* text=auto` makes check-attr answer "auto" for EVERY path, binary
#      included. Git's real binary sniffing happens later, inside `git add`. So
#      filtering on check-attr alone lets a PNG through, and `tr -d '\r'` then
#      deletes the 0D 0A in the PNG signature -- 1515 -> 1507 bytes on
#      apps/desktop-tauri/icons/32x32.png, signature destroyed, and `git add`
#      stores the mangled blob. Silent data loss behind a green hook.
#
# The guard is EXTRACTED from the hook, not copied, so this test cannot drift
# from the thing it is supposed to police.

set -uo pipefail

HOOK=".githooks/pre-commit"
[ -f "$HOOK" ] || { echo "FATAL: $HOOK not found (run from repo root)"; exit 1; }

REPOROOT="$(pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ── Extract the guard: from the `check-attr text` case through the esac that
#    closes the LAST case in the block. Anchoring the end on the eol case is
#    deliberate: counting depth from the first case stops at the first esac and
#    silently tests half the guard, which then reports .bat as NORM and looks
#    like a detector failure rather than a test failure.
TXT_START=$(grep -n 'case "$(git check-attr text' "$HOOK" | head -1 | cut -d: -f1)
EOL_START=$(grep -n 'case "$(git check-attr eol' "$HOOK" | head -1 | cut -d: -f1)
[ -n "$TXT_START" ] || { echo "FATAL: no check-attr text guard in $HOOK"; exit 1; }
if [ -z "$EOL_START" ]; then
  echo "FATAL: no check-attr eol guard -- that IS bug 1, so this test fails"
  echo "       loudly instead of passing quietly."
  exit 1
fi
EOL_END=$(awk -v s="$EOL_START" 'NR<=s{next} /^[[:space:]]*esac[[:space:]]*$/{print NR; exit}' "$HOOK")
[ -n "${EOL_END:-}" ] || { echo "FATAL: no closing esac after L$EOL_START"; exit 1; }

# Include the grep -qI binary guard if present (it sits between the two cases).
sed -n "${TXT_START},${EOL_END}p" "$HOOK" > "$TMP/guard.sh"
NLINES=$(wc -l < "$TMP/guard.sh" | tr -d ' ')
if [ "$NLINES" -gt 40 ]; then
  echo "FATAL: extracted $NLINES lines -- extraction too greedy, fix the test"
  exit 1
fi
echo "extracted ${NLINES} lines of guard (L$TXT_START-L$EOL_END)"
grep -q 'grep -qI' "$TMP/guard.sh" \
  && echo "  binary guard present" \
  || echo "  WARNING: no grep -qI binary guard -- that IS bug 2"

# ── Fixture repo, using the REAL .gitattributes ────────────────────
cd "$TMP" || exit 1
git init -q .
cp "$REPOROOT/.gitattributes" . || { echo "FATAL: cannot copy .gitattributes"; exit 1; }
mkdir -p scripts icons
printf 'echo hi\r\n'          > scripts/a.bat
printf 'echo hi\r\n'          > scripts/a.cmd
printf '# doc\r\n'            > notes.md
printf 'x=1\r\n'              > data.json
printf 'plain\r\n'            > plain.txt
# A synthetic "\x89PNG\r\n\x1a\n" header is NOT enough to be seen as binary:
# grep's binary detection is NUL-based, and that 8-byte signature has no NUL, so
# the fixture would read as text and the case would fail for the wrong reason.
# Use the real file the bug was found on -- it has NULs, and it is the exact
# bytes whose corruption was measured.
REAL_ICON="$REPOROOT/apps/desktop-tauri/icons/32x32.png"
if [ -f "$REAL_ICON" ]; then
  cp "$REAL_ICON" icons/real.png
else
  printf '\x89PNG\r\n\x1a\n\x00\x00\x00\r\nIHDR\x00' > icons/real.png
fi
git add -A >/dev/null 2>&1

# verdict <path> -> SKIP | NORM. The guard is run inside a one-iteration loop so
# its `continue` is legal and means exactly what it means in the hook. Rewriting
# `continue` with sed was the wrong approach: the hook has `continue ;;`, bare
# `continue`, and `continue   # comment`, and sed only caught the end-of-line
# form -- the misses printed a shell error and then fell through to NORM, which
# looked like "the guard does not work" when it was "the test cannot read it".
verdict() {
  local f="$1" out
  out=$(
    f="$f"
    for _i in 1; do
      # shellcheck disable=SC1090
      . "$TMP/guard.sh"
      echo NORM
      break
    done
  )
  if [ -n "$out" ]; then printf '%s' "$out"; else printf 'SKIP'; fi
}

pass=0; fail=0
check() { # <desc> <want> <path>
  local desc="$1" want="$2" f="$3" got
  got=$(cd "$TMP" && verdict "$f")
  if [ "$got" = "$want" ]; then
    pass=$((pass+1)); printf '  ok    %-44s %s\n' "$desc" "$got"
  else
    fail=$((fail+1)); printf '  FAIL  %-44s want=%s got=%s\n' "$desc" "$want" "$got"
    (cd "$TMP" && git check-attr text eol -- "$f" | sed 's/^/          /')
  fi
}

echo
echo "decisions (SKIP = left untouched, NORM = CRs stripped to LF):"
check "batch  .bat  (eol=crlf)"              SKIP scripts/a.bat
check "cmd    .cmd  (eol=crlf)"              SKIP scripts/a.cmd
check "binary PNG (text=auto but has NULs)"  SKIP icons/real.png
check "markdown    (eol=lf)"                 NORM notes.md
check "json        (text=auto, real text)"   NORM data.json
check "plain txt   (eol=lf)"                 NORM plain.txt

# ── And the end-to-end claim: a PNG must survive the whole pipeline ──
echo
echo "end-to-end: run the real normalization step over a PNG and a .bat"
BEFORE=$(sha256sum icons/real.png | cut -d' ' -f1)
BATCH_BEFORE=$(wc -c < scripts/a.bat)
# Replicate the hook's post-guard action exactly for whatever it decides to touch.
for f in icons/real.png scripts/a.bat notes.md; do
  v=$(verdict "$f")
  if [ "$v" = NORM ]; then
    tr -d '\r' < "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  fi
done
AFTER=$(sha256sum icons/real.png | cut -d' ' -f1)
BATCH_AFTER=$(wc -c < scripts/a.bat)
MD_AFTER=$(wc -c < notes.md)

if [ "$BEFORE" = "$AFTER" ]; then
  pass=$((pass+1)); printf '  ok    %-44s unchanged\n' "PNG signature survives"
else
  fail=$((fail+1)); printf '  FAIL  %-44s CORRUPTED (%s -> %s)\n' "PNG signature survives" "$BEFORE" "$AFTER"
fi
if [ "$BATCH_BEFORE" = "$BATCH_AFTER" ]; then
  pass=$((pass+1)); printf '  ok    %-44s %s bytes of CRLF kept\n' ".bat working tree intact" "$BATCH_BEFORE"
else
  fail=$((fail+1)); printf '  FAIL  %-44s %s -> %s (CRs stripped)\n' ".bat working tree intact" "$BATCH_BEFORE" "$BATCH_AFTER"
fi
if [ "$MD_AFTER" = "6" ]; then
  pass=$((pass+1)); printf '  ok    %-44s CRLF -> LF as intended\n' "ordinary text still normalized"
else
  fail=$((fail+1)); printf '  FAIL  %-44s expected 6 bytes, got %s\n' "ordinary text still normalized" "$MD_AFTER"
fi

echo
echo "$pass/$((pass+fail)) cases correct"
[ "$fail" -eq 0 ] || { echo "FAIL: the EOL net is wrong"; exit 1; }
echo "PASS: .bat/.cmd keep CRLF in the working tree, binaries are untouched,"
echo "      and ordinary text is still normalized to LF."
