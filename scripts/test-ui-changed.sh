#!/usr/bin/env bash
# scripts/test-ui-changed.sh — Run vitest only for changed UI files
# Status (2026-11-08): developer tooling, invoked MANUALLY -- no gate runner by
# design; documented in .agents/skills/tdd/SKILL.md, which names this file.
#
# Uses `vitest --changed` which compares against the git base branch
# (origin/main by default) and only runs tests for files that changed
# or import from changed files.
#
# Usage:
#   bash scripts/test-ui-changed.sh                 # vitest --changed (fast)
#   bash scripts/test-ui-changed.sh --all           # run all UI tests
#   bash scripts/test-ui-changed.sh --check         # list affected files only
#   BASE_BRANCH=origin/dev bash scripts/test-ui-changed.sh
#
# Options:
#   --all      Run all UI tests (skip changed-detection)
#   --check    Dry-run: list which test files would run
#   --pool     Override pool (default: threads for local)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BASE_BRANCH="${BASE_BRANCH:-origin/main}"
RUN_ALL=false
LIST_ONLY=false
POOL="threads"

for arg in "$@"; do
  case "$arg" in
    --all)     RUN_ALL=true ;;
    --check)   LIST_ONLY=true ;;
    --pool=*)  POOL="${arg#--pool=}" ;;
  esac
done

cd "$PROJECT_ROOT/ui"

# Ensure we have the base branch available
if ! git rev-parse --verify "$BASE_BRANCH" >/dev/null 2>&1; then
  echo "test-ui-changed: fetching $BASE_BRANCH..."
  git fetch origin "$(echo "$BASE_BRANCH" | sed 's|origin/||')" 2>/dev/null || true
fi

# Detect changed UI files
echo "test-ui-changed: comparing $(git rev-parse --abbrev-ref HEAD) against $BASE_BRANCH"

CHANGED_FILES=$(git diff --name-only "$BASE_BRANCH" HEAD -- '*.ts' '*.tsx' '*.ftl' '*.css' 2>/dev/null || true)

if [ -z "$CHANGED_FILES" ] && [ "$RUN_ALL" != "true" ]; then
  echo "test-ui-changed: no UI files changed — nothing to test."
  echo "  (use --all to run the full suite anyway)"
  exit 0
fi

if [ "$LIST_ONLY" = "true" ]; then
  echo "test-ui-changed: files that would be tested (vitest --changed):"
  echo "$CHANGED_FILES" | head -30
  exit 0
fi

if [ "$RUN_ALL" = "true" ]; then
  echo "test-ui-changed: --all flag set, running full UI suite"
  npx vitest run --pool="$POOL" --reporter=verbose
  exit $?
fi

echo "test-ui-changed: running vitest --changed (files changed: $(echo "$CHANGED_FILES" | wc -l))"
echo "  Change origin: $BASE_BRANCH"

# Run vitest with --changed (only tests affected by changed files)
npx vitest run --pool="$POOL" --changed="$BASE_BRANCH" --reporter=verbose
