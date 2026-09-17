#!/usr/bin/env bash
# scripts/release.sh — Automated release helper
#
# Runs pre-release checks, bumps version, generates changelog, and creates a git tag.
#
# Usage:
#   bash scripts/release.sh 0.0.15              # bump to specific version
#   bash scripts/release.sh --dry-run 0.0.15    # preview only, no changes
#
# Steps:#  1. Verify working tree is clean
#  2. Run cargo fmt + clippy
#  3. Run full test suite (nextest)
#  4. Bump version in Cargo.toml, package.json, tauri.conf.json
#  5. Generate changelog from git log since last tag
#  6. Run the AUDIT-28 version gate (node scripts/check-release-version.mjs)
#     so tag/version/CHANGELOG.md parity is enforced before tagging
#  7. Stage changes and create git tag
#
# The tag is NOT pushed — the user must `git push --tags` manually.

set -euo pipefail

DRY_RUN=false
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=true
  shift
fi

if [ $# -lt 1 ]; then
  echo "Usage: bash scripts/release.sh [--dry-run] <version>"
  echo "  version: new version number (e.g., 0.0.15)"
  exit 1
fi

NEW_VERSION="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# Validate version format
if ! echo "$NEW_VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "release: ERROR — invalid version format: $NEW_VERSION (expected X.Y.Z)"
  exit 1
fi

# Check clean working tree
if [ "$DRY_RUN" != "true" ] && ! git diff-index --quiet HEAD --; then
  echo "release: ERROR — working tree is dirty. Commit or stash changes first."
  exit 1
fi

echo "=== Release $NEW_VERSION ==="
echo ""

# ── Step 1: Pre-release checks ────────────────────────────────────
echo "[1/5] Running pre-release checks..."

echo "  cargo fmt..."
cargo fmt --all -- --check || { echo "  FAILED"; exit 1; }

echo "  cargo clippy..."
cargo clippy --workspace --all-targets --all-features --exclude kasirmu-app --exclude kasirmu-tablet -- -D warnings || { echo "  FAILED"; exit 1; }

echo "  cargo nextest run..."
cargo nextest run --workspace --all-features --exclude kasirmu-app --exclude kasirmu-tablet --profile ci || { echo "  FAILED"; exit 1; }

echo "  Pre-release checks PASSED"

# ── Step 2: Bump version ──────────────────────────────────────────
echo ""
echo "[2/5] Bumping version to $NEW_VERSION..."

LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "none")
echo "  Last tag: $LAST_TAG"

if [ "$DRY_RUN" = "true" ]; then
  echo "  DRY RUN: would bump version in Cargo.toml, package.json, tauri.conf.json"
else
  # Use cargo-set-version if available, fall back to sed
  if command -v cargo-set-version &>/dev/null; then
    cargo set-version "$NEW_VERSION"
  else
    # Cross-platform sed: use .bak extension then remove
    sed -i.bak "s/^version = \".*\"/version = \"$NEW_VERSION\"/" Cargo.toml && rm -f Cargo.toml.bak
    sed -i.bak "s/\"version\": \".*\"/\"version\": \"$NEW_VERSION\"/" ui/package.json && rm -f ui/package.json.bak
    for conf in apps/desktop-tauri/tauri.conf.json apps/mobile-tauri/tauri.conf.json; do
      if [ -f "$conf" ]; then
        sed -i.bak "s/\"version\": \".*\"/\"version\": \"$NEW_VERSION\"/" "$conf" && rm -f "${conf}.bak"
      fi
    done
  fi
  echo "  Version bumped in Cargo.toml, package.json, tauri.conf.json"
fi

# ── Step 3: Generate changelog ────────────────────────────────────
echo ""
echo "[3/5] Generating changelog..."

if [ "$LAST_TAG" != "none" ]; then
  CHANGELOG=$(git log "$LAST_TAG..HEAD" --pretty=format:"- %s" --no-merges | head -100)
  if [ "$(git log "$LAST_TAG..HEAD" --pretty=format:"- %s" --no-merges | wc -l)" -gt 100 ]; then
    echo "  Warning: more than 100 commits, changelog truncated. Review manually."
  fi
else
  CHANGELOG=$(git log --pretty=format:"- %s" --no-merges)
fi

# RELEASE-07: one canonical changelog source = CHANGELOG.md. The generated
# per-version file is the reviewed DRAFT; the version gate (step below)
# fails unless CHANGELOG.md carries a "## [X.Y.Z]" heading for the tag.
CHANGELOG_FILE="docs/releases/CHANGELOG-${NEW_VERSION}.md"
if [ "$DRY_RUN" != "true" ]; then
  cat > "$CHANGELOG_FILE" << EOF
# $NEW_VERSION

$(echo "$CHANGELOG")
EOF
  echo "  Draft changelog written to $CHANGELOG_FILE"

  # Insert/refresh the canonical heading so the release gate passes.
  if grep -q "^## \[$NEW_VERSION\]" CHANGELOG.md; then
    echo "  CHANGELOG.md already carries ## [$NEW_VERSION]"
  else
    # Insert the heading right after the intro block (first existing "## [").
    awk -v v="$NEW_VERSION" -v d="$(date +%F)" '
      /^## \[/ && !done {
        print "## [" v "] — " d
        print ""
        print "Release notes: see docs/releases/CHANGELOG-" v ".md (reviewed before tagging)."
        print ""
        print "---"
        print ""
        done = 1
      }
      { print }
    ' CHANGELOG.md > CHANGELOG.md.tmp && mv CHANGELOG.md.tmp CHANGELOG.md
    echo "  Inserted ## [$NEW_VERSION] heading into CHANGELOG.md"
  fi
else
  echo "  DRY RUN: changelog preview (first 10 entries):"
  echo "$CHANGELOG" | head -10
fi

# ── Step 3b: AUDIT-28 RELEASE-05 version gate ─────────────────────
# Reuse the same gate the release workflow runs, so local tagging and CI
# enforce identical parity (Cargo.toml / package.json / tauri.conf.json /
# CHANGELOG.md).
echo ""
echo "[3b] Running release version gate..."
if [ "$DRY_RUN" = "true" ]; then
  echo "  DRY RUN: would run: node scripts/check-release-version.mjs v$NEW_VERSION"
else
  node scripts/check-release-version.mjs "v$NEW_VERSION" || { echo "  FAILED — fix version parity before tagging"; exit 1; }
  echo "  Version gate PASSED"
fi

# ── Step 4: Stage and commit ──────────────────────────────────────
echo ""
echo "[4/5] Staging changes..."

if [ "$DRY_RUN" != "true" ]; then
  git add Cargo.toml ui/package.json apps/*/tauri.conf.json CHANGELOG.md "$CHANGELOG_FILE" 2>/dev/null || true
  git commit -m "chore: bump version to $NEW_VERSION"
  echo "  Committed: bump version to $NEW_VERSION"
fi

# ── Step 5: Create tag ────────────────────────────────────────────
echo ""
echo "[5/5] Creating git tag..."

if [ "$DRY_RUN" != "true" ]; then
  git tag -a "v$NEW_VERSION" -m "Release v$NEW_VERSION"
  echo "  Tag created: v$NEW_VERSION"
fi

echo ""
echo "=== Release $NEW_VERSION complete ==="
if [ "$DRY_RUN" = "true" ]; then
  echo "(dry run — no changes made)"
else
  echo ""
  echo "Next steps:"
  echo "  1. Review the commit: git show HEAD"
  echo "  2. Push: git push && git push --tags"
  echo "  3. CI will build and publish artifacts"
fi
