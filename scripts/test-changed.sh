#!/usr/bin/env bash
# scripts/test-changed.sh — Run tests only for crates affected by changes
# Status (2026-11-08): developer tooling, invoked MANUALLY -- no gate runner by
# design; documented in .agents/skills/tdd/SKILL.md, which names this file.
#
# Compares against origin/main (or the branch specified by BASE_BRANCH)
# and runs `cargo nextest run -p <crate>` only for crates whose source files
# have changed.
#
# Usage:
#   bash scripts/test-changed.sh              # compare against origin/main (nextest)
#   bash scripts/test-changed.sh --all        # run all tests (skip detection)
#   bash scripts/test-changed.sh --vanilla    # use cargo test instead of nextest
#   BASE_BRANCH=origin/dev bash scripts/test-changed.sh
#
# Options:
#   --all      Run the full workspace test suite
#   --check    Only list affected crates, don't run tests
#   --vanilla  Use `cargo test` instead of `cargo nextest run`

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BASE_BRANCH="${BASE_BRANCH:-origin/main}"
USE_NEXTEST=true
LIST_ONLY=false
RUN_ALL=false

# Parse flags
for arg in "$@"; do
  case "$arg" in
    --all)     RUN_ALL=true ;;
    --check)   LIST_ONLY=true ;;
    --vanilla) USE_NEXTEST=false ;;
  esac
done

cd "$PROJECT_ROOT"

# Ensure we have the base branch available
if ! git rev-parse --verify "$BASE_BRANCH" >/dev/null 2>&1; then
  echo "test-changed: fetching $BASE_BRANCH..."
  git fetch origin "$(echo "$BASE_BRANCH" | sed 's|origin/||')" 2>/dev/null || true
fi

# Detect changed files
echo "test-changed: comparing $(git rev-parse --abbrev-ref HEAD) against $BASE_BRANCH"

CHANGED_FILES=$(git diff --name-only "$BASE_BRANCH" HEAD -- '*.rs' 'Cargo.toml' 'Cargo.lock' 2>/dev/null || true)

if [ -z "$CHANGED_FILES" ] && [ "$RUN_ALL" != "true" ]; then
  echo "test-changed: no Rust files changed — nothing to test."
  echo "  (use --all to run the full suite anyway)"
  exit 0
fi

if [ "$RUN_ALL" = "true" ]; then
  echo "test-changed: --all flag set, running full workspace suite"
  if [ "$USE_NEXTEST" = "true" ]; then
    cargo nextest run --workspace --all-features
  else
    cargo test --workspace --all-features
  fi
  exit $?
fi

# Extract unique crate names from changed paths using a heuristic:
# files under crates/<name>/ or platform/<name>/ or apps/<name>/ or modules/<name>/
CRATES=()
while IFS= read -r file; do
  # Skip Cargo.lock changes (they affect everything)
  [[ "$file" == "Cargo.lock" ]] && continue
  
  # Workspace Cargo.toml changes affect everything
  if [[ "$file" == "Cargo.toml" ]]; then
    echo "test-changed: workspace Cargo.toml changed — running full suite"
    if [ "$USE_NEXTEST" = "true" ]; then
      cargo nextest run --workspace --all-features
    else
      cargo test --workspace --all-features
    fi
    exit $?
  fi

  # Extract crate path: crates/<name>/src/... → crates/<name>
  # Or: foundation/src/... → foundation
  # Or: platform/<name>/src/... → platform/<name>
  if [[ "$file" =~ ^(crates/[^/]+|platform/[^/]+|apps/[^/]+|modules/[^/]+|foundation) ]]; then
    crate_path="${BASH_REMATCH[1]}"
    if [[ ! " ${CRATES[*]:-} " =~ " ${crate_path} " ]]; then
      CRATES+=("$crate_path")
    fi
  fi
done <<< "$CHANGED_FILES"

if [ ${#CRATES[@]} -eq 0 ]; then
  echo "test-changed: no Rust crates identified from changed files"
  exit 0
fi

# Use cargo metadata to get the actual package names from paths
echo "test-changed: affected crates (${#CRATES[@]}):"
for crate_path in "${CRATES[@]}"; do
  echo "  - $crate_path"
done

if [ "$LIST_ONLY" = "true" ]; then
  exit 0
fi

# Run tests for each affected crate
FAILED=0
for crate_path in "${CRATES[@]}"; do
  echo ""
  echo "=== $crate_path ==="
  if [ "$USE_NEXTEST" = "true" ]; then
    cargo nextest run --manifest-path "$crate_path/Cargo.toml" || { FAILED=$?; echo "  FAILED"; }
  else
    cargo test --manifest-path "$crate_path/Cargo.toml" || { FAILED=$?; echo "  FAILED"; }
  fi
done

echo ""
if [ $FAILED -eq 0 ]; then
  echo "test-changed: all ${#CRATES[@]} crates passed ✓"
else
  echo "test-changed: some crates failed ✗"
  exit $FAILED
fi
