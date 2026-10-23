#!/usr/bin/env bash
# Prove scripts/lint-i18n.sh can still SEE the two warnings it greps for.
#
# WHY THIS EXISTS
# ---------------
# lint-i18n.sh decides categories 1 and 2 by grepping vitest output for two EXACT
# strings: the "[i18n]" prefix, and Fluent's "Attempt to override an existing message".
#
# If either spelling changes -- in the emitter, in the test, or in a Fluent upgrade --
# the grep returns nothing, vitest exits 0 (it did not fail, it warned), and the gate
# prints "no issues detected" and exits 0. Silence from a live runner is the one shape
# the script cannot distinguish from a clean tree, because it only fails on a NON-ZERO
# vitest exit.
#
# So this script plants each warning into a vitest-shaped output and asserts the grep
# the gate actually uses still matches it. It reads the patterns OUT OF the gate rather
# than restating them, so a change to the gate cannot drift from this test.
#
# Usage: bash scripts/test-lint-i18n.sh   (from the workspace root)
# Exit 0 = both patterns still fire. Non-zero = the gate has gone deaf, and says which.

set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

GATE="scripts/lint-i18n.sh"
[ -f "$GATE" ] || { echo "FATAL: $GATE not found"; exit 1; }

fails=0
note() { printf "  %-46s %s\n" "$1" "$2"; }

# ---- Extract the patterns the gate really uses -----------------------------
# Reading them out of the script is the point: a test that restated the literals
# would keep passing after the gate changed, which is the drift it exists to catch.
# NOTE on the extraction: the gate line is
#   untranslated=$(grep -E '\[i18n\]' "$OUT" || true)
# and a naive character class stops at the "]"-looking part of the escaped bracket,
# extracting a truncated pattern that then matches nothing. Measured 2026-10-23: the
# first version of this test FAILED for exactly that reason, which IS the test working
# -- it refused to pass on a pattern it could not extract.
# NOTE on the extraction: the gate line is
#   untranslated=$(grep -E '\[i18n\]' "$OUT" || true)
# A naive character class stops at the "]"-looking part of the escaped bracket and
# extracts a truncated pattern that then matches nothing. Measured 2026-10-23: the
# first version of this test FAILED for exactly that reason, which IS the test working
# -- it refused to pass on a pattern it could not extract. So: take the whole gate line,
# cut between the FIRST and the LAST single quote, and use that as the pattern.
UNTRANSLATED_LINE=$(grep -n "translated=\$(grep -E" "$GATE" | head -1 | cut -d: -f2-)
UNTRANSLATED_RE=${UNTRANSLATED_LINE#*\'}
UNTRANSLATED_RE=${UNTRANSLATED_RE%\'*}
DUPLICATE_RE=$(sed -n "s/.*grep -E '\\(Attempt to override[^']*\\)'.*/\1/p" "$GATE" | head -1)

if [ -z "$UNTRANSLATED_RE" ]; then
  note "the untranslated pattern is extractable" "FAIL"
  echo "      could not find the [i18n] grep in $GATE. Either the gate stopped grepping"
  echo "      for it, or the line was reworded -- both mean this test can no longer prove"
  echo "      anything, so it fails rather than passing vacuously."
  fails=$((fails + 1))
else
  note "the untranslated pattern is extractable" "ok"
fi

if [ -z "$DUPLICATE_RE" ]; then
  note "the duplicate-key pattern is extractable" "FAIL"
  echo "      could not find the 'Attempt to override' grep in $GATE."
  fails=$((fails + 1))
else
  note "the duplicate-key pattern is extractable" "ok"
fi

# ---- Plant each warning and assert the gate's own pattern matches ----------
# The samples are the REAL spellings, taken from the two emitters:
#   ui/src/__tests__/i18nBundle.test.tsx:424  (byte-identical bundle warning)
#   ui/src/components/requiredLocalized.ts:39 (missing required message)
if [ -n "$UNTRANSLATED_RE" ]; then
  sample="$(printf '%s\n' \
    'stderr | src/__tests__/i18nBundle.test.tsx' \
    '  [i18n] gift-cards.id.ftl is byte-identical to gift-cards.ftl - Indonesian translation missing' \
    '  [i18n] missing required message: "dashboard-title"')"
  if printf '%s\n' "$sample" | grep -qE "$UNTRANSLATED_RE"; then
    note "a [i18n] warning is still matched" "ok"
  else
    note "a [i18n] warning is still matched" "FAIL"
    echo "      planted a real [i18n] warning and the gate pattern did not match it."
    fails=$((fails + 1))
  fi
fi

if [ -n "$DUPLICATE_RE" ]; then
  sample2="Attempt to override an existing message: 'app-title' (previous message discarded)"
  if printf '%s\n' "$sample2" | grep -qE "$DUPLICATE_RE"; then
    note "an override warning is still matched" "ok"
  else
    note "an override warning is still matched" "FAIL"
    echo "      planted a real Fluent override warning and the gate pattern missed it."
    fails=$((fails + 1))
  fi
fi

# ---- And the negative control: a clean run must match NEITHER --------------
# Without this a pattern of "." would pass every case above.
clean_sample="$(printf '%s\n' 'Test Files  1 passed (1)' '      Tests  21 passed (21)')"
if [ -n "$UNTRANSLATED_RE" ] && printf '%s\n' "$clean_sample" | grep -qE "$UNTRANSLATED_RE"; then
  note "a clean run matches nothing" "FAIL (pattern too broad)"
  fails=$((fails + 1))
elif [ -n "$DUPLICATE_RE" ] && printf '%s\n' "$clean_sample" | grep -qE "$DUPLICATE_RE"; then
  note "a clean run matches nothing" "FAIL (pattern too broad)"
  fails=$((fails + 1))
else
  note "a clean run matches nothing" "ok"
fi

if [ "$fails" -ne 0 ]; then
  echo "lint-i18n falsification: $fails case(s) failed." >&2
  exit 1
fi
echo "lint-i18n falsification: both warning patterns still fire, and neither matches a clean run."
exit 0
