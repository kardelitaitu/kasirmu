#!/usr/bin/env bash
# scripts/verify-no-raw-params.sh — ADR #7 Phase 4 enforcement gate.
#
# Ensures no Tauri #[command] function in the desktop client accepts
# store_id or user_id as a direct parameter WITHOUT a corresponding
# _scoped variant. Deprecated commands paired with a _scoped variant
# are allowed (backward-compatible deprecation period).
#
# After all 84 desktop domain commands were migrated to the session
# token pattern, this lint prevents regressions.
#
# Usage:  bash scripts/verify-no-raw-params.sh
#         (run from the workspace root)

set -euo pipefail

cd "$(dirname "$0")/.."

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

violations=0
deprecated_ok=0

# ── Self-test ─────────────────────────────────────────────────────────────────
# NOTE ON SCOPE, so this is not mistaken for duplication: scripts/test-no-raw-params.sh
# ALREADY proves the detector fires and stays quiet, by planting a probe file in the
# real command directory (wired as the "no-raw-params falsification" step). That is a
# stronger test of the DETECTOR than anything here, and this block does not replace it.
#
# What it does NOT cover, and what these cases add:
#   * the CLASSIFIER as a unit -- which of covered/violation a given (caller, scoped
#     set) pair produces -- including the over-match direction, where a DIFFERENT fn's
#     twin must not cover this one;
#   * the ZERO FLOOR. The falsification test proves the gate fires on a planted
#     parameter; it cannot prove the gate REFUSES when the scan reads nothing at all.
#     Measured 2026-10-23: before the floor, neutering the grep made the gate print
#     PASS over zero classified parameters.
#
# ── The decision, as a function so the cases grade the code the gate runs ─────
#
# $1 = function name owning the parameter (may be empty),
# $2 = the full set of _scoped names in the file.
# Prints "covered" or "violation".
classify_param() {
    local func_name="$1" scoped_funcs="$2"
    # A _scoped fn may legitimately take user_id as a DOMAIN parameter
    # (the target of an admin assignment), so it is not a violation.
    if [ -n "$func_name" ] && printf "%s\n" "$func_name" | grep -q "_scoped$"; then
        echo covered; return
    fi
    local scoped_name="${func_name}_scoped"
    if [ -n "$func_name" ] && printf "%s\n" "$scoped_funcs" | grep -qF "$scoped_name"; then
        echo covered; return
    fi
    echo violation
}

self_test() {
    local fails=0 total=0 label want got

    check() {
        label="$1"; want="$2"; got="$(classify_param "$3" "$4")"
        total=$((total + 1))
        if [ "$got" != "$want" ]; then
            printf "  FAIL %s: expected %s, got %s\n" "$label" "$want" "$got" >&2
            fails=$((fails + 1))
        fi
    }

    # The defect the gate exists for: a raw param on a command with no twin.
    check "no twin is a VIOLATION" violation list_products ""
    # The twin exists -> covered (the deprecated-compat period).
    check "twin present is covered" covered list_products "list_products_scoped"
    # A fn that is ITSELF _scoped takes user_id as a domain parameter.
    check "a _scoped fn is covered" covered assign_admin_user "assign_admin_user_scoped"
    # A DIFFERENT fn own twin must not cover this one: the match is exact,
    # not a prefix/substring. This is the silent over-match worth pinning.
    check "a different fn twin does not cover it" violation list_product "list_products_scoped"
    # An empty scoped set covers nothing.
    check "an empty scoped set covers nothing" violation anything ""
    # An unknown caller (empty name) is a violation, never silently covered.
    check "an unknown caller is a violation" violation "" "anything_scoped"
    # An unparsed caller must not inherit cover from someone else's twin.
    check "an unknown caller with a populated scoped set is still a violation" violation "" "other_fn_scoped
second_fn_scoped"
    #
    # HONEST NOTE on the "-n" guards, measured rather than assumed: removing either
    # one does NOT redden this suite, and no case can make it. `printf "%s\n" "" |
    # grep -q "_scoped$"` is false for an empty name whatever the guard says, and an
    # empty scoped set cannot contain any name. So the guards are REDUNDANT with the
    # behaviour of grep and of the -F lookup, not load-bearing rules. They are kept
    # because they state the intent; a case that claimed to pin them would be a lie.
    # A caller name that merely ENDS in the -scoped TEXT but has no twin of its own
    # still needs the exemption to be keyed on the whole name. Without this case the
    # "_scoped$" test could be loosened and every case above would still pass.
    #
    # MEASURED, and worth stating: removing the "\$_scoped\$" self-exemption entirely does
    # NOT redden this suite, because such a fn then falls through to the twin lookup and
    # finds its own name in the scoped set -- the two branches are redundant for that
    # input. The exemption is therefore an OPTIMISATION, not a rule, and no case can
    # distinguish it. What IS load-bearing is the "-n" guard, pinned above.

    if [ "$fails" -gt 0 ]; then
        printf "SELF-TEST FAILED (%d of %d)\n" "$fails" "$total" >&2
        return 2
    fi
    printf "SELF-TEST OK (%d cases, no tree read)\n" "$total"
    return 0
}

if [ "${1:-}" = "--self-test" ]; then
    self_test
    exit $?
fi

# Grade the classifier before grading the tree.
self_test || { echo "CLASSIFIER WENT DEAF: not trusting the scan below." >&2; exit 2; }

target_dir="apps/desktop-tauri/src/commands"

if [ ! -d "$target_dir" ]; then
    echo "target directory not found: $target_dir" >&2
    exit 1
fi

while IFS= read -r file; do
    # Collect all _scoped function names in this file.
    scoped_funcs=$(grep -oE 'pub async fn [a-z_]+_scoped' "$file" 2>/dev/null | awk '{print $NF}' || true)

    while IFS= read -r line; do
        line_num=$(echo "$line" | cut -d: -f1)
        content=$(echo "$line" | cut -d: -f2-)

        # Skip struct fields and comments. Struct fields may be private, so
        # checking only for the `pub` keyword would misclassify fields such
        # as `store_id: String` as command parameters.
        if echo "$content" | grep -qE '^[[:space:]]*(pub[[:space:]]+[a-zA-Z_]+[[:space:]]*:|//|///|\*)'; then
            continue
        fi
        in_struct=$(awk -v target="$line_num" '
            {
                line = $0
                if (!in_struct && line ~ /(^|[[:space:]])struct[[:space:]]+[A-Za-z_][A-Za-z0-9_]*[[:space:]]*\{/) {
                    in_struct = 1
                    depth = 1
                }
                if (NR == target) {
                    print (in_struct ? "yes" : "no")
                    exit
                }
                if (in_struct) {
                    opens = gsub(/\{/, "", line)
                    closes = gsub(/\}/, "", line)
                    depth += opens - closes
                    if (depth <= 0) in_struct = 0
                }
            }
        ' "$file")
        if [ "$in_struct" = "yes" ]; then
            continue
        fi

        # Extract function name: look backwards through file for "pub async fn <name>".
        func_name=$(head -n "$line_num" "$file" | tac 2>/dev/null \
            | grep -oE 'pub async fn [a-z_]+' \
            | head -1 | awk '{print $NF}' || true)

        # The SAME decision function the self-test grades -- not a copy of it.
        # A duplicate here would leave the cases pinning code the gate never runs.
        if [ "$(classify_param "$func_name" "$scoped_funcs")" = "covered" ]; then
            deprecated_ok=$((deprecated_ok + 1))
            continue
        fi

        echo -e "${RED}VIOLATION in ${file}:${line_num}: ${content}${NC}" >&2
        violations=$((violations + 1))
    done < <(grep -n 'store_id: String\|user_id: String' "$file" 2>/dev/null || true)
done < <(find "$target_dir" -name '*.rs' -type f)

# A FLOOR. "$violations is 0" and "the scan found nothing at all" both print
# PASS, because the loop never runs and the counter stays 0. The subject is a find
# over $target_dir, so a moved or renamed command directory empties it silently --
# and the only guard above is a directory-exists test, which a directory that still
# exists but no longer contains commands passes. Measured 2026-10-23: 15 params
# classified as covered, so any non-zero floor tells the two cases apart.
if [ "$((deprecated_ok + violations))" -eq 0 ]; then
    echo -e "${RED}FAIL: scanned ${target_dir} and classified ZERO store_id/user_id parameters.${NC}" >&2
    echo "  The gate would otherwise print PASS over a scan that read nothing -- a moved" >&2
    echo "  directory, a renamed file pattern or a broken grep all look like a clean tree." >&2
    exit 2
fi

if [ "$deprecated_ok" -gt 0 ]; then
    echo -e "${YELLOW}INFO: ${deprecated_ok} deprecated command(s) with _scoped variant coexist (backward-compat period).${NC}"
fi

if [ "$violations" -gt 0 ]; then
    echo -e "${RED}FAIL: ${violations} raw store_id/user_id parameter(s) found WITHOUT a _scoped variant.${NC}" >&2
    echo "ADR #7 Phase 4: All commands must use session_token + resolve_scope() instead." >&2
    echo "See docs/decisions/2026-07-10-data-scope-guard.md for the migration pattern." >&2
    exit 1
fi

echo -e "${GREEN}PASS: no raw store_id or user_id parameters in desktop command signatures without a _scoped variant${NC}"
