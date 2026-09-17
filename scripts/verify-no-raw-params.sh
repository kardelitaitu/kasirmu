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

        # Skip if this function is itself a _scoped variant (user_id here is a
        # domain parameter, e.g. target user for admin assignment).
        if [ -n "$func_name" ] && echo "$func_name" | grep -q '_scoped$'; then
            deprecated_ok=$((deprecated_ok + 1))
            continue
        fi

        # Check if a _scoped variant exists for this function.
        scoped_name="${func_name}_scoped"
        if [ -n "$func_name" ] && echo "$scoped_funcs" | grep -qF "$scoped_name"; then
            # This command has a _scoped variant — deprecated, but OK.
            deprecated_ok=$((deprecated_ok + 1))
            continue
        fi

        echo -e "${RED}VIOLATION in ${file}:${line_num}: ${content}${NC}" >&2
        violations=$((violations + 1))
    done < <(grep -n 'store_id: String\|user_id: String' "$file" 2>/dev/null || true)
done < <(find "$target_dir" -name '*.rs' -type f)

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
